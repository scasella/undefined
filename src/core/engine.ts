/**
 * The orchestrator. The model is the upstream source of code; the toolchain (compiler, tests, properties,
 * invariants) is the downstream consumer that decides what is kept. This module wires the two together and
 * publishes everything the UI shows through one immutable `EngineState` signal. The UI owns no logic.
 *
 * Every environment dependency (generator, runtime worker, compiler, gate worker, persistence, clock, sleep, ids,
 * pacing, examples) is injectable through `EngineDeps`, so the whole flow runs in Node tests with the REAL compiler,
 * the REAL gate executor and the REAL REPL core.
 *
 * Known, documented behaviour (not hidden):
 * - Growth re-evaluates the ORIGINAL input, so side effects that ran before the undefined call run twice.
 * - The REPL transcript is not persisted; the image, the live state (REPL variables) and two flags are.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type {
  Artifact,
  AttemptView,
  CallRecord,
  Candidate,
  DatasetPreview,
  DatasetRef,
  Declined,
  Engine,
  EngineState,
  EvalOutcome,
  Evidence,
  ExampleInfo,
  FunctionSpec,
  GateId,
  GateResult,
  GenerateError,
  GenerateRequest,
  GenerateResult,
  GenerationView,
  Generator,
  Hash,
  Json,
  MutationReport,
  Pacing,
  Pin,
  PinArg,
  Program,
  Recording,
  RecordingPreview,
  ReplEntry,
  RestartId,
  RestartOption,
  Revision,
  ServiceStatus,
  SpecPatch,
} from '../types';
import { GATE_ORDER } from '../types';
import { compileCandidate, transpileUserCode, warmUp, type CompileOutput } from '../gates/compile';
import { specFromCall } from '../gates/source';
import { evidenceFrom, runExecutionGates, type ExecGateInput, type PinnedCase } from '../sandbox/gateRunner';
import { DEFAULT_MAX_MUTANTS, DEFAULT_TIME_BOX_MS, runMutation as runMutants, type MutantRunner } from '../mutation/run';
import { generateMutants } from '../mutation/mutate';
import { NO_TESTS_REASON, skippedReport } from '../mutation/classify';
import { suggestProperties } from '../suggest/suggest';
import { appendProperty } from '../suggest/apply';
import { addedCheckReason, MUTATION_FAILED_PREFIX } from '../shared/evidence';
import { MASKED_NAMES } from '../sandbox/mask';
import { Runtime } from '../sandbox/runtime';
import { gateSeed, hashesFor, sha256Hex } from '../shared/hash';
import { buildPrompt, declarationLine, parseDecline, type PromptInput } from '../shared/prompt';
import { FUNCTION_ARG_TYPE } from '../shared/inferType';
import { decodeEnv, decodeValue } from '../shared/serialize';
import { show } from '../shared/show';
import { tablePreview } from '../sandbox/replCore';
import { parseCsv } from '../data/csv';
import { parseJsonData } from '../data/json';
import { coerceCsvRows } from '../data/infer';
import { buildDataset, canonicalJson, DATASET_LIMITS, utf8Length, validateVariableName } from '../data/dataset';
import { CORS_HINT, fetchRecording, parseRecordingText, recordingParamFromLocation, seedFromRecording, type FetchResult } from '../share/source';
import { createSessionLog, SESSION_LOG_FLAG, type SessionLog, type SessionLogEntry } from '../sessionlog/log';
import { testNamesOf } from '../shared/specInfo';
import { describeSend, sampleForModel } from '../data/sample';
import {
  GenerationFailure,
  LiveGenerator,
  loadBundledRecordings,
  probeService,
  realSleep,
  recordedAttempt,
  recordedPrompt,
  RecordingSink,
  ReplayGenerator,
} from './generator';
import {
  describeCommit,
  emptyProgram,
  initialRevision,
  isLive,
  jsFunctions,
  newRevision,
  referencedDatasets,
  rollbackRevision,
  summarize,
  withArtifact,
  withDataset,
  withoutDataset,
  withPins,
  withSpec,
} from './program';
import * as store from './store';

// ───────────────────────── dependency injection ─────────────────────────

/** What the engine needs from an example (src/examples ExampleDef satisfies it structurally). */
export interface EngineExample extends ExampleInfo {
  /** Absent for a spec-less example (the call grows the function from its argument types alone). */
  spec?: FunctionSpec;
  breakPatch: SpecPatch;
  /** Bundled data bound to a REPL variable when the example is clicked (deps.bundledData supplies the text). */
  dataset?: { name: string; filename: string };
}

/**
 * The part of sandbox/runtime.ts Runtime the engine uses. `reset` may resolve to nothing (older runtimes) or to
 * `{ lost }`, the REPL variables that could not be restored in the rebuilt worker; both are handled.
 */
export type RuntimeLike = Pick<Runtime, 'define' | 'undefine' | 'evaluate' | 'snapshotEnv' | 'envShown' | 'dispose' | 'bindDataset' | 'unbindDataset'> & {
  /** `datasets` (hash → decoded rows) resolves the env's dataset refs, so dataset variables are rebound. */
  reset(functions: Parameters<Runtime['reset']>[0], env: Record<string, Json>, datasets?: Record<Hash, unknown[]>): Promise<void | { lost?: string[] }>;
};

export interface EngineStore {
  loadPersisted(): Promise<store.Persisted | null>;
  appendRevision(rev: Revision, head: number): Promise<void>;
  saveFlags(flags: store.Persisted['flags']): Promise<void>;
  saveLiveEnv(env: Record<string, Json>): Promise<void>;
  /** Re-store an existing revision without moving the head (evidence attached after the fact). Optional for older stores. */
  updateRevision?(rev: Revision): Promise<void>;
  /** Dataset rows, encoded, by hash (only the ones some revision still refers to). Optional for older stores. */
  saveDatasets?(datasets: Record<Hash, Json>): Promise<void>;
  clearAll(): Promise<void>;
}

export interface EngineDeps {
  /** Examples; when absent they are loaded lazily from src/examples. */
  examples?: EngineExample[];
  /** Initial example id (default: src/examples INITIAL_EXAMPLE_ID, or the first example). */
  initialExampleId?: string;
  loadExamples(): Promise<{ examples: EngineExample[]; initialId: string }>;
  probeService(): Promise<ServiceStatus>;
  createLiveGenerator(): Generator;
  loadRecordings(): Promise<Recording[]>;
  createReplayGenerator(recordings: Recording[], maxMs: number): Generator;
  createRuntime(): RuntimeLike;
  compile(spec: FunctionSpec, body: string): Promise<CompileOutput>;
  warmUp(): Promise<void>;
  transpile(src: string): { js: string; error?: string };
  execGates(input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]>;
  store: EngineStore;
  /** Wall clock (ms since epoch) for committedAt / revision timestamps. */
  now(): number;
  /** Must reject (or resolve early) when the signal aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  newId(prefix: string): string;
  pacing: Pacing;
  /** Remembers the last REPL input across reloads (best effort). */
  inputMemory: { load(): string | null; save(text: string): void };
  /** Text of a bundled data file (e.g. `orders.csv` for the orders example); null when there is none. */
  bundledData(filename: string): Promise<string | null>;
  /**
   * Lazy mutation check timing (real timers, never deps.sleep): start once the engine has been idle `idleMs`
   * (default 4000) and at least `quietMs` (default 10000) after the last Enter; stop starting mutants after
   * `timeBoxMs` (default 6000). Optional so older callers and tests keep the defaults.
   */
  mutation?: { idleMs?: number; quietMs?: number; timeBoxMs?: number };
  /** The local session log (default: createSessionLog(), IndexedDB with a memory fallback). Optional. */
  createSessionLog?(): SessionLog;
  /** fetch used ONLY for a recording URL the user supplied (menu field or `?recording=`). Optional. */
  fetchRecording?: typeof fetch;
  /** The page address, read once at boot for `?recording=<url>`. Optional; null outside a browser. */
  location?(): { search: string; hash: string } | null;
}

export const DEFAULT_PACING: Pacing = { typeCharMs: 6, gateDwellMs: 450, replayMaxMs: 5000 };

/** Growths allowed per submit (chained unknowns like `f(g(1))`). */
export const MAX_GROWTHS_PER_SUBMIT = 5;
/** Cap on the whole typewriter reveal of one candidate. */
const MAX_TYPING_MS = 2200;
const TYPE_TICK_MS = 30;
/** Uncharged retries per grow for TS7023/7024 (recursion without a declared return type). */
const MAX_FREE_RECURSION_RETRIES = 1;

export const TAKEAWAY_TEXT = "You didn't write this. The model wrote it. Your tests hold the contract, and your toolchain enforced it.";
export const RECURSION_HINT =
  'No return type is declared, so a directly recursive body cannot be typed (TS7023). Avoid direct recursion (use a loop), or give any recursive helper inside the body an explicit return type annotation.';

const RESTART: Record<'retryFault' | 'retryGrow' | 'rollback' | 'editSpec' | 'writeSpec' | 'dismiss', RestartOption> = {
  retryFault: { id: 'retry', label: 'Retry with the error fed back', description: 'Ask the model again, showing it this error.' },
  retryGrow: { id: 'retry', label: 'Retry', description: 'Run the grow loop again with a fresh budget.' },
  rollback: { id: 'rollback', label: 'Roll back', description: 'Restore the revision before this function was committed.' },
  editSpec: { id: 'edit-spec', label: 'Edit the spec', description: 'Open the spec in the repo tab.' },
  writeSpec: {
    id: 'edit-spec',
    label: 'Write a spec',
    description: "Open this function's spec in the repo tab (parameters filled in from the call) and say what it should do.",
  },
  dismiss: { id: 'dismiss', label: 'Dismiss', description: 'Leave the program as it is.' },
};

/** Note on every gate of a declined candidate: nothing was run. */
export const DECLINED_GATE_NOTE = 'the model declined';
/** REPL line when the undefined function was called by an Array method with (value, index, array). */
export const ARRAY_CALLBACK_INFO = '(called by an Array method with (value, index, array); using the value only)';
/** Prefix of gateExecutor's NEVER_CALLED_NOTE (not imported: that module pulls fast-check into the main bundle). */
const NEVER_CALLED_PREFIX = 'the candidate was never called';
export const FUNCTION_ARG_NOTE = "an argument was a function, which can't be replayed";

function endSentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** The REPL message for a decline: what the model said, why, and what to do next, in plain language. */
export function declineMessage(fn: string, d: Declined): string {
  if (d.reason === 'cannot-be-pure') {
    return `The model declined to write \`${fn}\`: ${endSentence(d.message)} Generated functions are pure — no clock, randomness, network, files or hidden state — so it would only be faking it. Pass what it needs in as an argument (for example a seed or a timestamp).`;
  }
  return `The model couldn't tell what \`${fn}\` should do: ${endSentence(d.message)} Add a one-line spec and call it again.`;
}

const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for function if ' +
    'import in instanceof new null return super switch this throw true try typeof var void while with yield let static ' +
    'implements interface package private protected public await arguments undefined NaN Infinity'
  ).split(' '),
);
const CODE_FROM_STRINGS = new Set(['eval', 'Function']);
const MASKED = new Set<string>(MASKED_NAMES);
const NAME_SUGGESTION: Record<string, string> = {
  process: 'processData',
  fetch: 'fetchData',
  eval: 'evaluate',
  Function: 'makeFunction',
  constructor: 'construct',
  toString: 'toText',
  valueOf: 'valueFrom',
  hasOwnProperty: 'hasKey',
  isPrototypeOf: 'isAncestor',
  toLocaleString: 'toLocalText',
  propertyIsEnumerable: 'isListedKey',
  default: 'byDefault',
  delete: 'remove',
  new: 'create',
  class: 'classify',
  function: 'fn',
  undefined: 'missing',
};

function suggestName(name: string): string {
  return NAME_SUGGESTION[name] ?? `my${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Why `name` is never generated, as one plain sentence that says what to do instead; null when it can be.
 * Used for the REPL error (after "<name> is not defined.") and for a spec saved under such a name.
 */
export function notGrowableReason(name: string): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return `\`${name}\` cannot be generated: function names here must be ASCII letters, digits, _ or $ (and not start with a digit).`;
  }
  const instead = `pick another name, e.g. ${suggestName(name)}`;
  if (CODE_FROM_STRINGS.has(name)) {
    return `\`${name}\` turns strings into code, which generated code is not allowed to do; ${instead}.`;
  }
  if (MASKED.has(name)) {
    return `\`${name}\` is the name of a host global (network, timers, clock, randomness or the environment) that generated code is not allowed to touch; ${instead}.`;
  }
  if (RESERVED.has(name)) {
    return `\`${name}\` is a JavaScript keyword or built-in value, so it cannot name a function; ${instead}.`;
  }
  if (name in Object.prototype) {
    return `\`${name}\` is a name every JavaScript object already has, so it cannot name a function in this program (functions are looked up by name); ${instead}.`;
  }
  return null;
}

function defaultInputMemory(): EngineDeps['inputMemory'] {
  const KEY = 'undefined.lastInput';
  return {
    load() {
      try {
        return globalThis.localStorage?.getItem(KEY) ?? null;
      } catch {
        return null;
      }
    },
    save(text) {
      try {
        globalThis.localStorage?.setItem(KEY, text);
      } catch {
        /* storage blocked: not remembered */
      }
    },
  };
}

let idCounter = 0;

function defaultDeps(): EngineDeps {
  return {
    async loadExamples() {
      const m = await import('../examples');
      return { examples: m.EXAMPLES, initialId: m.INITIAL_EXAMPLE_ID };
    },
    probeService: () => probeService(),
    createLiveGenerator: () => new LiveGenerator(),
    loadRecordings: () => loadBundledRecordings(),
    createReplayGenerator: (recordings, maxMs) => new ReplayGenerator(recordings, { maxMs }),
    createRuntime: () => new Runtime(),
    compile: compileCandidate,
    warmUp,
    transpile: transpileUserCode,
    execGates: runExecutionGates,
    store: {
      loadPersisted: store.loadPersisted,
      appendRevision: store.appendRevision,
      saveFlags: store.saveFlags,
      saveLiveEnv: store.saveLiveEnv,
      updateRevision: store.updateRevision,
      saveDatasets: store.saveDatasets,
      clearAll: store.clearAll,
    },
    now: () => Date.now(),
    sleep: realSleep,
    newId: (prefix) => `${prefix}${++idCounter}-${Math.random().toString(36).slice(2, 7)}`,
    pacing: DEFAULT_PACING,
    inputMemory: defaultInputMemory(),
    async bundledData(filename) {
      if (filename !== 'orders.csv') return null;
      const m = await import('../data/orders');
      return m.BUNDLED_ORDERS_CSV();
    },
    location: () => {
      try {
        const loc = (globalThis as { location?: { search?: unknown; hash?: unknown } }).location;
        return loc && typeof loc.search === 'string' && typeof loc.hash === 'string' ? { search: loc.search, hash: loc.hash } : null;
      } catch {
        return null;
      }
    },
  };
}

// ───────────────────────── helpers ─────────────────────────

const pendingGate = (gate: GateId): GateResult => ({ gate, status: 'pending', ms: 0, summary: '', diagnostics: [] });
const notReached = (gate: GateId): GateResult => ({ gate, status: 'skipped', ms: 0, summary: 'not reached', diagnostics: [], note: 'not reached' });

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAbort(e: unknown): boolean {
  return (
    (e instanceof GenerationFailure && e.info.code === 'aborted') ||
    (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError')
  );
}

function short(hash: string): string {
  return `${hash.slice(0, 4)}…`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

class Aborted extends Error {
  constructor() {
    super('aborted');
    this.name = 'Aborted';
  }
}

/**
 * The triggering call's real arguments, decoded from the runtime's `args` (shared/serialize.ts encoding), for the
 * Invariants replay. undefined when the runtime did not send them or when any argument (at any depth) could not be
 * serialised: a placeholder would not be the value the call really received.
 */
export function decodeCallArgs(args: unknown): unknown[] | undefined {
  if (!Array.isArray(args)) return undefined;
  const keyed: Record<string, Json> = {};
  args.forEach((a, i) => (keyed[String(i)] = a as Json));
  try {
    const { env, unserializable } = decodeEnv(keyed);
    if (unserializable.length > 0) return undefined;
    return args.map((_, i) => env[String(i)]);
  } catch {
    return undefined;
  }
}

// ───────────────────────── evidence & mutation ─────────────────────────

/** Idle time before the lazy mutation check starts (no generation, no submit, no queued operation). */
export const MUTATION_IDLE_MS = 4000;
/** The check never starts sooner than this after an Enter, so nothing new moves while the opening sequence plays. */
export const MUTATION_QUIET_MS = 10_000;
/** Per-call budget for mutants (a mutant is a broken copy: it gets at most a second per call). */
const MUTANT_CALL_BUDGET_MS = 1000;
export const RECHECK_FAILED_INFO =
  'You added a check and the function committed earlier fails it. It will be regenerated on the next call.';

/** Gate-result failures that are not a verdict on the mutant: the run could not happen. */
const INFRA_DIAGNOSTICS = new Set(['(load)', '(spec error)', '(gate runner)', '(gate worker)']);
const INFRA_NOTES = new Set(['spec error', 'gate worker error']);

function infraFailure(r: GateResult): string | null {
  if (r.status !== 'fail') return null;
  const d = r.diagnostics.find((x) => x.kind === 'test' && INFRA_DIAGNOSTICS.has(x.name));
  if (d || (r.note && INFRA_NOTES.has(r.note)) || r.summary === 'gate runner error') {
    const what = d && d.kind === 'test' ? (d.error ?? d.message) : (r.headline ?? r.summary);
    return `${r.summary || r.note || 'gate error'}: ${what}`.replace(/^(.+): \1$/, '$1');
  }
  return null;
}

/**
 * One mutant's fate from its Tests/Properties gate results (plus an Invariants failure, attribution rule):
 * no failure → 'survived'; an Invariants `bounded` failure (the watchdog stopped a call, or the per-mutant overall
 * cap, which is a time limit too) → 'killed-by-bound'; any other test/property/invariant failure → 'killed'.
 * A load error, spec error or gate-runner fault is not a kill: it throws, and the whole check fails visibly.
 */
export function classifyMutant(results: readonly GateResult[]): 'killed' | 'killed-by-bound' | 'survived' {
  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length === 0) return 'survived';
  for (const r of failed) {
    const infra = infraFailure(r);
    if (infra) throw new Error(infra);
  }
  const inv = failed.find((r) => r.gate === 'invariants');
  if (inv && inv.diagnostics.some((d) => d.kind === 'invariant' && d.invariant === 'bounded')) return 'killed-by-bound';
  return 'killed';
}

/** Facts about what ran against an accepted candidate (compile passed, by construction). */
export function evidenceOf(gates: readonly GateResult[], mutation?: MutationReport): Evidence {
  return { compiled: true, ...evidenceFrom(gates), ...(mutation ? { mutation } : {}) };
}

// ───────────────────────── data ─────────────────────────

/** Default REPL variable for loaded data. */
export const DEFAULT_DATASET_NAME = 'rows';
/** Rows shown in the data drawer's preview table. */
export const PREVIEW_ROWS = 20;
/** Sample rows sent with the type (live mode, samples on). */
export const SAMPLE_ROWS = 3;
export const PINNED_INFO = 'Pinned. The next regeneration has to reproduce this result.';

export type ParsedData =
  | { ok: true; rows: Array<Record<string, unknown>>; warnings: string[]; format: 'csv' | 'tsv' | 'json' }
  | { ok: false; error: string };

/**
 * Pasted or dropped text → rows. JSON / JSON Lines when the text starts with `[` or `{` or the filename ends in
 * .json/.jsonl/.ndjson; otherwise CSV (the delimiter, TAB included, is sniffed) with numbers, booleans and empty
 * cells coerced per column. Never throws.
 */
export function parseDataText(text: string, filename?: string): ParsedData {
  try {
    const t = typeof text === 'string' ? text : '';
    const body = t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
    if (body.trim() === '') return { ok: false, error: 'Nothing to load: paste CSV or JSON, or drop a file.' };
    const json = /^\s*[[{]/.test(body) || /\.(json|jsonl|ndjson)$/i.test(filename ?? '');
    if (json) {
      const r = parseJsonData(body);
      if ('error' in r) return { ok: false, error: r.error };
      if (r.rows.length === 0) return { ok: false, error: 'No rows: the JSON holds an empty list.' };
      return { ok: true, rows: r.rows, warnings: r.warnings, format: 'json' };
    }
    const csv = parseCsv(body);
    if (csv.rows.length === 0) return { ok: false, error: 'No rows: the text has a header line but no data lines.' };
    const { rows } = coerceCsvRows(csv.rows);
    return { ok: true, rows, warnings: csv.warnings, format: csv.delimiter === '\t' ? 'tsv' : 'csv' };
  } catch (e) {
    return { ok: false, error: `Could not read the data: ${errorText(e)}` };
  }
}

/** The row type's name for a dataset variable: `rows` → `Row`, `orders` → `OrdersRow` (distinct per variable). */
export function typeNameFor(name: string): string {
  if (name === DEFAULT_DATASET_NAME) return 'Row';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}Row`;
}

/** `fn(rows, 3)`: a call as the user would write it, with dataset arguments named rather than inlined. */
export function pinLabel(fn: string, args: readonly PinArg[]): string {
  const parts = args.map((a) => {
    if (a.kind === 'dataset') return a.name;
    try {
      return show(decodeValue(a.encoded));
    } catch {
      return '…';
    }
  });
  return `${fn}(${parts.join(', ')})`;
}

// ───────────────────────── data (pure) ─────────────────────────

type BuiltData =
  | { ok: true; ref: DatasetRef; encoded: Json; rows: Array<Record<string, unknown>>; warnings: string[] }
  | { ok: false; error: string };

/** Parse, coerce, type and content-address `input` (no binding, nothing stored). Never throws. */
export async function buildData(input: { text: string; filename?: string; name?: string; source?: DatasetRef['source'] }): Promise<BuiltData> {
  const parsed = parseDataText(input.text, input.filename);
  if (!parsed.ok) return parsed;
  const name = input.name ?? DEFAULT_DATASET_NAME;
  const source = input.source ?? (input.filename !== undefined ? 'file' : 'paste');
  const built = await buildDataset(name, parsed.rows, {
    source,
    typeName: typeNameFor(name),
    ...(input.filename !== undefined ? { filename: input.filename } : {}),
  });
  if ('error' in built) return { ok: false, error: built.message };
  return { ok: true, ref: built.ref, encoded: built.encoded, rows: parsed.rows, warnings: parsed.warnings };
}

/**
 * The data drawer's preview: counts, columns, the declared type, the first PREVIEW_ROWS rows as a table (with the
 * real total), parse warnings, exactly the sample text that would be sent, and the plain sentence about what leaves
 * the browser under the current `send` choice. Never throws.
 */
export async function datasetPreview(input: { text: string; filename?: string; name?: string }, send: { samples: boolean; sampleRows: number }): Promise<DatasetPreview> {
  try {
    const b = await buildData(input);
    if (!b.ok) return b;
    const { ref } = b;
    const sample = sampleForModel(b.rows, { count: send.sampleRows });
    const shared = send.samples ? sample : { ...sample, rows: [], text: '[]', truncated: true, valuesCut: false };
    const table = tablePreview(b.rows.slice(0, PREVIEW_ROWS)) ?? { columns: ref.columns.map((c) => c.name), rows: [], total: 0 };
    return {
      ok: true,
      name: ref.name,
      rowCount: ref.rowCount,
      columns: ref.columns,
      typeName: ref.typeName,
      typeDecl: ref.typeDecl,
      bytes: ref.bytes,
      warnings: b.warnings,
      sampleText: sample.text,
      sendDescription: describeSend(ref, shared),
      table: { ...table, total: ref.rowCount },
    };
  } catch (e) {
    return { ok: false, error: `Could not read the data: ${errorText(e)}` };
  }
}

/** Whether a pin already holds exactly this call and result (labels and canonical JSON compared). */
function samePin(p: Pick<Pin, 'label' | 'args' | 'expected'>, q: Pick<Pin, 'label' | 'args' | 'expected'>): boolean {
  return (
    p.label === q.label &&
    canonicalJson(p.args as unknown as Json) === canonicalJson(q.args as unknown as Json) &&
    canonicalJson(p.expected) === canonicalJson(q.expected)
  );
}

/** A dataset argument of the triggering call (what the DATA block of the prompt describes). */
interface DataArg {
  name: string;
  hash: Hash;
  typeName: string;
  rowCount: number;
}

/** `lost` from a runtime reset result or a timeout outcome; [] when absent (older runtimes resolve to nothing). */
function lostOf(r: unknown): string[] {
  if (typeof r !== 'object' || r === null) return [];
  const lost = (r as { lost?: unknown }).lost;
  return Array.isArray(lost) ? lost.filter((x): x is string => typeof x === 'string') : [];
}

export const LOST_PREFIX = 'variables that could not be restored: ';
const WAITING_PREFIX = 'Waiting for the current operation to finish before you ';

/** Context kept per REPL error entry so a restart knows what to do. */
interface RestartContext {
  kind: 'fault' | 'timeout' | 'grow-failed';
  fn: string;
  call: string;
  input: string;
  spec?: FunctionSpec;
  callArgTypes?: string[];
  /** Decoded real arguments of the triggering call (Invariants probe), when available. */
  callArgs?: unknown[];
  /** An argument of the triggering call was a function (so the call cannot be replayed by the gates). */
  functionArgs?: boolean;
  fault?: { errorName: string; message: string; previousBody: string };
  /** Revision the faulting artifact was committed in. */
  artifactRevision?: number;
  /** Datasets the triggering call ran over. */
  dataArgs?: DataArg[];
}

interface GrowRequest {
  fn: string;
  call: string;
  spec: FunctionSpec;
  callArgTypes?: string[];
  /** Real argument values of the triggering call, replayed by the Invariants gate. */
  callArgs?: unknown[];
  /** An argument of the triggering call was a function: callArgs is absent, and the Invariants note says why. */
  functionArgs?: boolean;
  runtimeFault?: PromptInput['runtimeFault'];
  /** Datasets the triggering call ran over: the prompt describes them (type, count, and samples when allowed). */
  dataArgs?: DataArg[];
}

/** A function grown during one REPL input (for the "nothing checked that this is what you meant" note). */
interface Grown {
  fn: string;
  /** The spec had neither tests nor properties. */
  ungated: boolean;
  notes: string;
}

type GrowResult = { kind: 'committed'; revision: number; grown: Grown } | { kind: 'failed' } | { kind: 'aborted' };

// ───────────────────────── shared recordings ─────────────────────────

/** Said before anything from someone else's recording is loaded. */
export const RECORDING_WARNING = 'This recording includes test code written by someone else. It runs in the sandbox like any spec you write.';
/** Recorded calls kept from one recording (each is pre-typed, one at a time; never run without Enter). */
const MAX_RECORDED_CALLS = 200;

/** Where a recording came from, for the banner: the URL's host, else what the caller said, else "a file". */
export function recordingSourceName(input: { url?: string; source?: string }): string {
  if (input.source && input.source.trim() !== '') return input.source.trim().slice(0, 120);
  if (input.url) {
    try {
      return new URL(input.url).host || 'a link';
    } catch {
      return 'a link';
    }
  }
  return 'a file';
}

/** A recording checked against this program: what loading it would add, bind and replay. */
interface PreparedRecording {
  recording: Recording;
  title: string;
  source: string;
  specs: FunctionSpec[];
  /** Verified dataset rows (hash = sha256 of their canonical JSON), by hash. */
  content: Record<Hash, Json>;
  /** Bindings to make (each over verified rows, rebuilt from them). */
  refs: DatasetRef[];
  calls: string[];
  preview: Extract<RecordingPreview, { ok: true }>;
}

// ───────────────────────── engine ─────────────────────────

export type EngineHandle = Engine & {
  /** Abort any in-flight grow and stop the runtime. */
  dispose(): void;
};

export function createEngine(overrides: Partial<EngineDeps> = {}): EngineHandle {
  const deps: EngineDeps = { ...defaultDeps(), ...overrides };
  const pacing = deps.pacing;
  let slog: SessionLog;
  try {
    slog = deps.createSessionLog ? deps.createSessionLog() : createSessionLog();
  } catch {
    slog = createSessionLog({ storage: { getItem: () => null, setItem: () => undefined } });
  }

  const state = signal<EngineState>({
    ready: false,
    mode: 'replay',
    service: { state: 'checking' },
    program: emptyProgram(),
    headRevision: 0,
    revisions: [],
    repl: [],
    replInput: '',
    generation: null,
    env: {},
    hints: { opener: true, takeaway: false },
    datasets: [],
    send: { samples: true, sampleRows: SAMPLE_ROWS },
    busy: false,
    examples: [],
    pacing,
    sessionLog: { enabled: slog.isEnabled(), count: 0, status: slog.status() },
  });

  let history: Revision[] = [];
  let head = 0;
  let flags: store.Persisted['flags'] = { takeawayShown: false, openerDismissed: false };
  let examples: EngineExample[] = [];
  let initialId = '';
  let runtime: RuntimeLike | null = null;
  let generator: Generator | null = null;
  let recordings: Recording[] = [];
  /** Recordings the user loaded, newest first: their sessions replay by hash ahead of the live service. */
  let loaded: Recording[] = [];
  let loadedReplay: ReplayGenerator | null = null;
  /** The last recording fetched from a URL: loading it re-uses this instead of fetching twice. */
  let fetched: { url: string; result: Extract<FetchResult, { ok: true }> } | null = null;
  const sink = new RecordingSink();
  const sinkFns = new Set<string>();
  const contexts = new Map<string, RestartContext>();
  let growCtrl: AbortController | null = null;
  /** Bumped by reset/dispose so a superseded async flow stops touching state. */
  let epoch = 0;
  let focusNonce = 0;
  let disposed = false;
  /** Tail of the operation queue: every operation that changes the program or the history runs alone, in order. */
  let opTail: Promise<void> = Promise.resolve();
  let opsPending = 0;
  /** Number of REPL evaluations (submit / retry) requested and not finished: `busy` is `busyCount > 0`. */
  let busyCount = 0;
  /**
   * Dataset rows, stored once by content hash (revisions, env snapshots and pins only refer to them): the encoded
   * form (persisted / exported) and the decoded rows (gates, samples). Garbage-collected to what some revision uses.
   */
  const content = new Map<Hash, { encoded: Json; rows: unknown[] }>();
  /** Lazy mutation check: functions waiting for one, the run in flight, its idle timer, and the activity clock. */
  const mutCfg = {
    idleMs: deps.mutation?.idleMs ?? MUTATION_IDLE_MS,
    quietMs: deps.mutation?.quietMs ?? MUTATION_QUIET_MS,
    timeBoxMs: deps.mutation?.timeBoxMs ?? DEFAULT_TIME_BOX_MS,
  };
  const mutQueue: string[] = [];
  let mutRun: { fn: string; ctrl: AbortController } | null = null;
  let mutTimer: ReturnType<typeof setTimeout> | null = null;
  // performance.now(), not deps.now(): tests drive deps.now() as a fake clock
  let lastActivity = performance.now();
  let lastEnter = Number.NEGATIVE_INFINITY;

  // ── state plumbing ──

  const set = (patch: Partial<EngineState>): void => {
    state.value = { ...state.value, ...patch };
  };
  const pushRepl = (...entries: ReplEntry[]): void => {
    set({ repl: [...state.value.repl, ...entries] });
  };
  const id = (p: string): string => deps.newId(p);
  const notice = (tone: 'info' | 'error', text: string): void => {
    set({ notice: { tone, text } });
    if (tone === 'error') log({ kind: 'error', summary: text });
  };
  const headRev = (): Revision => history.find((r) => r.id === head) ?? history[history.length - 1]!;
  const rowsOf = (revs: Revision[]): EngineState['revisions'] =>
    revs.map(({ program, env: _env, ...rest }) => ({ ...rest, ...summarize(program) }));

  const publishHistory = (): void => {
    const h = headRev();
    set({ program: h.program, headRevision: h.id, revisions: rowsOf(history), datasets: Object.values(h.program.datasets ?? {}) });
  };

  const decodeRows = (encoded: Json): unknown[] => {
    try {
      const v = decodeValue(encoded);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const addContent = (hash: Hash, encoded: Json): void => {
    if (!content.has(hash)) content.set(hash, { encoded, rows: decodeRows(encoded) });
  };
  const replaceContent = (datasets: Record<Hash, Json> | undefined): void => {
    content.clear();
    for (const [h, enc] of Object.entries(datasets ?? {})) addContent(h, enc);
  };
  /** Fresh decoded copies for the runtime (it binds them as live, mutable REPL values; the store keeps its own). */
  const runtimeDatasets = (): Record<Hash, unknown[]> => {
    const out: Record<Hash, unknown[]> = {};
    for (const [h, c] of content) out[h] = decodeRows(c.encoded);
    return out;
  };
  /** The encoded rows some revision still refers to (bound datasets and pin arguments), by hash. */
  const referencedContent = (): Record<Hash, Json> => {
    const used = referencedDatasets(history);
    const out: Record<Hash, Json> = {};
    for (const [h, c] of content) if (used.has(h)) out[h] = c.encoded;
    return out;
  };
  /** Drop rows no revision refers to and persist the rest. */
  async function persistDatasets(): Promise<void> {
    const kept = referencedContent();
    for (const h of [...content.keys()]) if (!(h in kept)) content.delete(h);
    await deps.store.saveDatasets?.(kept);
  }

  const errorEntry = (name: string, message: string, restarts?: RestartOption[], ctx?: RestartContext, quiet = false): string => {
    if (!quiet) log({ kind: 'error', summary: `${name}: ${message}`, ...(ctx ? { fn: ctx.fn } : {}) });
    const entryId = id('er');
    const e: ReplEntry = { kind: 'error', id: entryId, name, message };
    if (restarts && restarts.length > 0) e.restarts = restarts;
    if (ctx) contexts.set(entryId, ctx);
    pushRepl(e);
    return entryId;
  };
  const info = (text: string, tone: 'muted' | 'accent' | 'warn' = 'muted'): void => {
    pushRepl({ kind: 'info', id: id('if'), text, tone });
  };

  // ── the local session log (opt-in; never prompts, never dataset rows) ──

  const refreshLogState = async (): Promise<void> => {
    const count = await slog.count();
    if (!disposed) set({ sessionLog: { enabled: slog.isEnabled(), count, status: slog.status() } });
  };
  /** Append to the session log; a no-op while it is off. The count in state follows once the entry is stored. */
  const log = (e: Omit<SessionLogEntry, 't' | 'session'>): void => {
    if (!slog.isEnabled()) return;
    void slog.append(e).then(refreshLogState, () => undefined);
  };

  const setGen = (fnOrPatch: Partial<GenerationView> | ((g: GenerationView) => GenerationView)): void => {
    const g = state.value.generation;
    if (!g) return;
    set({ generation: typeof fnOrPatch === 'function' ? fnOrPatch(g) : { ...g, ...fnOrPatch } });
  };
  const setAttempt = (index: number, patch: Partial<AttemptView>): void => {
    setGen((g) => ({ ...g, attempts: g.attempts.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));
  };

  const persistFlags = (): Promise<void> => deps.store.saveFlags({ ...flags });

  const busyStart = (): void => {
    busyCount++;
    if (!state.value.busy) set({ busy: true });
  };
  const busyEnd = (): void => {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) set({ busy: false });
  };

  /**
   * Runs `op` after every operation requested before it has finished (one promise queue for submit, retry,
   * rollback, spec edits, examples, import and reset), so two quick rollbacks or an edit during a commit can never
   * interleave. An operation that has to wait says so (`what` names it). Operations requested before a reset or
   * dispose are superseded by it and do not run. Never rejects.
   */
  function exclusive(what: string | null, op: () => Promise<void>, onSkip?: () => void): Promise<void> {
    const myEpoch = epoch;
    if (opsPending > 0 && what) notice('info', `${WAITING_PREFIX}${what}…`);
    // Every operation that may change the program stops a running mutation check (it re-runs after the next idle).
    cancelMutation();
    opsPending++;
    const run = opTail.then(async () => {
      if (disposed || myEpoch !== epoch) {
        onSkip?.();
        return;
      }
      if (state.value.notice?.text.startsWith(WAITING_PREFIX)) {
        const { notice: _done, ...rest } = state.value;
        state.value = rest;
      }
      await op();
    });
    const settled = run.then(
      () => {
        opsPending--;
        idleAgain();
      },
      (e: unknown) => {
        opsPending--;
        idleAgain();
        console.warn('[engine] operation failed', e);
      },
    );
    opTail = settled;
    return settled;
  }

  /** Must run inside `exclusive`: the id is derived from the history as it is at this moment. */
  async function commitRevision(rev: Revision): Promise<void> {
    const lastId = history[history.length - 1]?.id ?? 0;
    if (rev.id !== lastId + 1) throw new Error(`internal: revision r${rev.id} does not follow r${lastId}`);
    history = [...history, rev];
    head = rev.id;
    publishHistory();
    await deps.store.appendRevision(rev, head);
  }

  const reportLost = (lost: string[]): void => {
    if (lost.length > 0) info(`${LOST_PREFIX}${lost.join(', ')}`, 'warn');
  };

  /** Replace the live program wholesale; returns the REPL variables the runtime could not restore. */
  async function resetRuntime(fns: Parameters<RuntimeLike['reset']>[0], env: Record<string, Json>): Promise<string[]> {
    const r: unknown = await runtime!.reset(fns, env, runtimeDatasets());
    return lostOf(r);
  }

  /**
   * Never trust stored or imported `artifact.js`: recompile every LIVE artifact's body against its spec and use the
   * fresh js / returnType / source. An artifact whose body no longer compiles is dropped (artifact = null).
   * Provenance and candidate history are kept. Identical (spec, body) pairs across revisions compile once.
   */
  async function recompileArtifacts(revisions: Revision[]): Promise<{ revisions: Revision[]; recompiled: number; dropped: string[] }> {
    const cache = new Map<string, Promise<CompileOutput | null>>();
    const dropped = new Set<string>();
    const out: Revision[] = [];
    for (const rev of revisions) {
      const functions: Program['functions'] = {};
      for (const [name, rec] of Object.entries(rev.program.functions)) {
        if (!isLive(rec)) {
          functions[name] = rec;
          continue;
        }
        const artifact = rec.artifact!;
        const key = `${rec.specHash}\u0000${rec.testsHash}\u0000${JSON.stringify(rec.spec)}\u0000${artifact.body}`;
        let compiled = cache.get(key);
        if (!compiled) {
          compiled = deps
            .compile(rec.spec, artifact.body)
            .then((c) => (c.gate.status !== 'fail' && c.js !== null ? c : null))
            .catch(() => null);
          cache.set(key, compiled);
        }
        const c = await compiled;
        if (c) {
          functions[name] = { ...rec, artifact: { ...artifact, js: c.js!, returnType: c.returnType, source: c.source } };
        } else {
          functions[name] = { ...rec, artifact: null };
          dropped.add(name);
        }
      }
      out.push({ ...rev, program: { ...rev.program, functions } });
    }
    const results = await Promise.all(cache.values());
    return { revisions: out, recompiled: results.filter((c) => c !== null).length, dropped: [...dropped].sort() };
  }

  function recompileSummary(r: { recompiled: number; dropped: string[] }): string {
    const base = `recompiled ${plural(r.recompiled, 'artifact')} from ${r.recompiled === 1 ? 'its body' : 'their bodies'}`;
    return r.dropped.length > 0
      ? `${base}; dropped the artifact of ${r.dropped.join(', ')} (its body does not compile; the next call regenerates)`
      : base;
  }

  async function refreshEnv(): Promise<void> {
    if (!runtime) return;
    try {
      const [shown, snap] = await Promise.all([runtime.envShown(), runtime.snapshotEnv()]);
      set({ env: shown });
      await deps.store.saveLiveEnv(snap);
    } catch (e) {
      console.warn('[engine] could not read the live state', e);
    }
  }

  async function snapshotEnv(): Promise<Record<string, Json>> {
    try {
      return runtime ? await runtime.snapshotEnv() : {};
    } catch {
      return {};
    }
  }

  const sleep = async (ms: number, sig?: AbortSignal): Promise<void> => {
    if (sig?.aborted) throw new Aborted();
    if (ms <= 0) return;
    try {
      await deps.sleep(ms, sig);
    } catch (e) {
      if (sig?.aborted || isAbort(e)) throw new Aborted();
      throw e;
    }
    if (sig?.aborted) throw new Aborted();
  };

  const allRecordings = (): Recording[] => [...loaded, ...recordings];

  const initialExample = (): EngineExample | undefined => examples.find((e) => e.id === initialId) ?? examples[0];

  async function seedProgram(): Promise<Revision> {
    const ex = initialExample();
    const program = ex?.spec ? await withSpec(emptyProgram(), ex.spec) : emptyProgram();
    const r1 = initialRevision(program);
    return { ...r1, at: deps.now(), title: ex?.spec ? `Initial image: ${ex.spec.name} spec, no artifact` : 'Initial image (empty program)' };
  }

  function chooseGenerator(status: ServiceStatus): void {
    if (status.state === 'up' || status.state === 'degraded') {
      generator = deps.createLiveGenerator();
      set({ mode: 'live', service: status });
    } else {
      generator = deps.createReplayGenerator(recordings, pacing.replayMaxMs);
      set({ mode: 'replay', service: status });
    }
  }

  // ───────────────────────── init ─────────────────────────

  async function init(): Promise<void> {
    const myEpoch = epoch;
    // examples
    try {
      if (deps.examples) {
        examples = deps.examples;
        initialId = deps.initialExampleId ?? examples[0]?.id ?? '';
      } else {
        const loaded = await deps.loadExamples();
        examples = loaded.examples;
        initialId = deps.initialExampleId ?? loaded.initialId;
      }
    } catch (e) {
      console.warn('[engine] examples unavailable', e);
      examples = [];
    }
    set({
      examples: examples.map(({ id: exId, title, blurb, call, fn, breakIt }) => ({ id: exId, title, blurb, call, fn, breakIt })),
    });

    // Compiler warm-up in the background: never blocks ready.
    void deps.warmUp().catch((e: unknown) => console.warn('[engine] compiler warm-up failed', e));

    const [persisted, status] = await Promise.all([
      deps.store.loadPersisted().catch(() => null),
      deps.probeService().catch((): ServiceStatus => ({ state: 'down' })),
    ]);
    if (status.state !== 'up' && status.state !== 'degraded') {
      recordings = await deps.loadRecordings().catch(() => []);
    }
    if (myEpoch !== epoch) return;

    let liveEnv: Record<string, Json> = {};
    if (persisted) {
      const image = await store.reverify(persisted.image).catch(() => persisted.image);
      // Stored js is never trusted: every live artifact is recompiled from its body.
      const fresh = await recompileArtifacts(image.revisions);
      if (myEpoch !== epoch) return;
      history = fresh.revisions;
      head = image.head;
      flags = { ...persisted.flags };
      liveEnv = persisted.liveEnv;
      replaceContent(persisted.datasets ?? image.datasets);
      if (typeof flags.sendSamples === 'boolean') set({ send: { ...state.value.send, samples: flags.sendSamples } });
      if (fresh.dropped.length > 0) notice('error', `Restored image: ${recompileSummary(fresh)}.`);
    } else {
      const r1 = await seedProgram();
      history = [r1];
      head = 1;
      flags = { takeawayShown: false, openerDismissed: false };
      await deps.store.appendRevision(r1, 1);
    }
    publishHistory();
    chooseGenerator(status);

    runtime = deps.createRuntime();
    try {
      reportLost(await resetRuntime(jsFunctions(headRev().program), liveEnv));
    } catch (e) {
      notice('error', `Could not restore the live program (${errorText(e)}); starting with no live functions.`);
      await runtime.reset({}, {}).catch(() => undefined);
    }
    await refreshEnv();
    if (persisted) await persistDatasets();

    const ex = initialExample();
    const remembered = persisted ? deps.inputMemory.load() : null;
    set({
      replInput: remembered ?? ex?.call ?? '',
      hints: { opener: !flags.openerDismissed, takeaway: flags.takeawayShown },
      ready: true,
    });

    // The session log's count: only touch its storage when it is on or was used before (no database otherwise).
    if (slog.isEnabled() || sessionLogWasUsed()) void refreshLogState();
    // `?recording=<url>`: fetch and validate it now (in the background), but only OFFER it; the user decides.
    let loc: { search: string; hash: string } | null = null;
    try {
      loc = deps.location?.() ?? null;
    } catch {
      loc = null;
    }
    const offerUrl = loc ? recordingParamFromLocation(loc.search, loc.hash) : null;
    if (offerUrl) void offerRecording(offerUrl, myEpoch);
  }

  function sessionLogWasUsed(): boolean {
    try {
      return (globalThis as { localStorage?: Storage }).localStorage?.getItem(SESSION_LOG_FLAG) != null;
    } catch {
      return false;
    }
  }

  async function offerRecording(url: string, myEpoch: number): Promise<void> {
    const source = recordingSourceName({ url });
    const got = await previewRecording({ url, source });
    if (disposed || myEpoch !== epoch) return;
    // a link that fails to load always says how to share one that works (CORS is the usual cause)
    const preview: RecordingPreview = got.ok || got.hint ? got : { ...got, hint: CORS_HINT };
    set({ recordingOffer: { url, source, preview } });
  }

  // ───────────────────────── submit ─────────────────────────

  /** REPL Enter. Ignored while another evaluation is running (`busy`; the input stays in the box). */
  function submit(): Promise<void> {
    const s = state.value;
    const text = s.replInput.trim();
    if (!s.ready || s.busy || text === '' || !runtime) return Promise.resolve();
    const myEpoch = epoch;
    lastEnter = performance.now();
    busyStart();
    set({ replInput: '' });
    deps.inputMemory.save(text);
    log({ kind: 'input', input: text, summary: 'REPL input' });
    return exclusive(null, async () => {
      pushRepl({ kind: 'input', id: id('in'), text });
      if (!flags.openerDismissed) {
        flags = { ...flags, openerDismissed: true };
        set({ hints: { ...state.value.hints, opener: false } });
        void persistFlags();
      }
      try {
        await runInput(text, myEpoch);
      } catch (e) {
        if (!(e instanceof Aborted) && myEpoch === epoch) errorEntry('InternalError', errorText(e));
      } finally {
        if (myEpoch === epoch) {
          await refreshEnv();
          busyEnd();
          pretypeNextRecordedCall(text);
        }
      }
    });
  }

  /** After a recorded call ran, type the recording's next call in (only into an empty input; never run). */
  function pretypeNextRecordedCall(ran: string): void {
    const lr = state.value.loadedRecording;
    if (!lr || state.value.replInput !== '') return;
    const at = lr.calls.indexOf(ran);
    const next = at >= 0 ? lr.calls[at + 1] : undefined;
    if (next !== undefined) set({ replInput: next });
  }

  /**
   * Evaluate `input`, growing undefined functions (up to MAX_GROWTHS_PER_SUBMIT) and re-evaluating. `already` carries
   * what an earlier grow for this same input (a retry) produced.
   */
  async function runInput(input: string, myEpoch: number, already?: { revision: number; grown: Grown }): Promise<void> {
    let revision = already?.revision;
    const grown: Grown[] = already ? [already.grown] : [];
    let growths = 0;
    for (;;) {
      const outcome = await runtime!.evaluate(input);
      if (myEpoch !== epoch) return;
      if (outcome.kind !== 'undefined-call') {
        reportOutcome(outcome, input, grown, revision);
        return;
      }
      const reason = notGrowableReason(outcome.name);
      if (reason) {
        errorEntry('ReferenceError', `${outcome.name} is not defined. ${reason}`);
        return;
      }
      if (growths >= MAX_GROWTHS_PER_SUBMIT) {
        errorEntry('ReferenceError', `${outcome.name} is not defined (stopped after growing ${MAX_GROWTHS_PER_SUBMIT} functions for one input)`);
        return;
      }
      errorEntry('ReferenceError', `${outcome.name} is not defined`, undefined, undefined, true);
      log({ kind: 'outcome', fn: outcome.name, summary: `undefined-call: ${outcome.name} is not defined; growing it` });
      if (outcome.argsTrimmed === 'array-callback') info(ARRAY_CALLBACK_INFO);
      info('Generating…', 'accent');
      const rec = state.value.program.functions[outcome.name];
      // `args` may be missing (older runtimes): then the Invariants gate has only the arguments sampled in the
      // Tests/Properties phases.
      const resolved = resolveCall(outcome);
      const spec = rec?.spec ?? callSpec(outcome.name, outcome.argTypes, resolved.typeDecls);
      const { callArgs, dataArgs } = resolved;
      const functionArgs = outcome.argTypes.includes(FUNCTION_ARG_TYPE);
      const result = await grow(
        {
          fn: outcome.name,
          call: resolved.call,
          spec,
          ...(spec.origin === 'call' ? { callArgTypes: outcome.argTypes } : {}),
          ...(callArgs ? { callArgs } : {}),
          ...(functionArgs ? { functionArgs } : {}),
          ...(dataArgs.length > 0 ? { dataArgs } : {}),
        },
        input,
        myEpoch,
      );
      if (result.kind !== 'committed') return;
      revision = result.revision;
      grown.push(result.grown);
      growths++;
    }
  }

  /**
   * An undefined call's real arguments for the gates, with every argument that IS a bound dataset replaced by the
   * stored rows (looked up by name → hash in the content store, so big datasets are never decoded from the call's
   * own encoding), plus the datasets' type declarations (deduplicated) and the call written with dataset names.
   */
  function resolveCall(outcome: Extract<EvalOutcome, { kind: 'undefined-call' }>): {
    callArgs?: unknown[];
    dataArgs: DataArg[];
    typeDecls: string;
    call: string;
  } {
    const encoded = (outcome as { args?: unknown }).args;
    const names = outcome.argDatasets;
    if (!names || !names.some((n) => n !== null)) {
      const callArgs = decodeCallArgs(encoded);
      return { ...(callArgs ? { callArgs } : {}), dataArgs: [], typeDecls: '', call: outcome.call };
    }
    const bound = headRev().program.datasets ?? {};
    const dataArgs: DataArg[] = [];
    const decls: string[] = [];
    const fromStore = new Map<number, unknown[]>();
    const rest: Json[] = [];
    const restIndex: number[] = [];
    names.forEach((n, i) => {
      const ref = n !== null ? bound[n] : undefined;
      const stored = ref ? content.get(ref.hash) : undefined;
      if (ref && stored) {
        fromStore.set(i, stored.rows);
        if (!dataArgs.some((d) => d.name === ref.name)) dataArgs.push({ name: ref.name, hash: ref.hash, typeName: ref.typeName, rowCount: ref.rowCount });
        if (!decls.includes(ref.typeDecl)) decls.push(ref.typeDecl);
      } else if (Array.isArray(encoded)) {
        rest.push(encoded[i] as Json);
        restIndex.push(i);
      }
    });
    let callArgs: unknown[] | undefined;
    const decodedRest = rest.length === 0 ? [] : Array.isArray(encoded) ? decodeCallArgs(rest) : undefined;
    if (decodedRest) {
      callArgs = names.map((_, i) => (fromStore.has(i) ? fromStore.get(i) : decodedRest[restIndex.indexOf(i)]));
    }
    const call = `${outcome.name}(${outcome.argShown.map((shown, i) => names[i] ?? shown).join(', ')})`;
    return { ...(callArgs ? { callArgs } : {}), dataArgs, typeDecls: decls.join('\n'), call };
  }

  /** Spec for a never-seen call; tagged with the example it belongs to (so the Repo tab offers its "Break it"). */
  function callSpec(name: string, argTypes: string[], typeDecls: string): FunctionSpec {
    const spec = specFromCall(name, argTypes, typeDecls ? { typeDecls } : {});
    const ex = examples.find((e) => e.fn === name);
    if (ex) spec.exampleId = ex.id;
    return spec;
  }

  /**
   * `note` on a result line marks a call that grew a function nobody checked against an intent (no tests, no
   * properties): the UI prints UNCHECKED_TEXT, then "Model's note: …" when the note is non-empty. Absent otherwise.
   */
  function uncheckedNote(grown: Grown[]): string | undefined {
    const ungated = grown.filter((g) => g.ungated);
    if (ungated.length === 0) return undefined;
    const notes = ungated.map((g) => ({ fn: g.fn, notes: g.notes.replace(/\s*\n\s*/g, ' ').trim() })).filter((g) => g.notes !== '');
    if (notes.length === 0) return '';
    return ungated.length === 1 ? notes[0]!.notes : notes.map((g) => `${g.fn}: ${g.notes}`).join(' · ');
  }

  /** The outermost (last completed) committed-function call of the line, when its result can be pinned. */
  function pinnableOf(records: CallRecord[] | undefined): Extract<ReplEntry, { kind: 'output' }>['pinnable'] | undefined {
    const last = records?.[records.length - 1];
    if (!last || last.result === null || !state.value.program.functions[last.fn]) return undefined;
    return { fn: last.fn, call: pinLabel(last.fn, last.args), args: last.args, expected: last.result };
  }

  function reportOutcome(outcome: Exclude<EvalOutcome, { kind: 'undefined-call' }>, input: string, grownNow: Grown[], revision?: number): void {
    const grew = grownNow.length > 0;
    // the kind of outcome only: never the value
    log({
      kind: 'outcome',
      ...(outcome.kind === 'fault' ? { fn: outcome.fn } : outcome.kind === 'timeout' && outcome.fn ? { fn: outcome.fn } : {}),
      summary:
        outcome.kind === 'value'
          ? grew
            ? 'value (after growing a function)'
            : 'value'
          : outcome.kind === 'error'
            ? `error: ${outcome.errorName}`
            : outcome.kind === 'fault'
              ? `fault: ${outcome.fn} threw ${outcome.errorName}`
              : 'timeout',
    });
    switch (outcome.kind) {
      case 'value': {
        // 'cached artifact · certified rN' only when the called function's artifact is live (its hashes match the
        // spec it is shown under); anything else gets no label.
        const calledRec = outcome.calls.length > 0 ? state.value.program.functions[outcome.calls[0]!] : undefined;
        const cached = !grew && calledRec !== undefined && isLive(calledRec);
        const entry: ReplEntry = {
          kind: 'output',
          id: id('out'),
          value: outcome.shown,
          ms: outcome.ms,
          label: grew ? 'generated' : cached ? 'cached artifact' : null,
        };
        if (grew && revision !== undefined) entry.detail = `revision ${revision}`;
        if (cached) entry.detail = `certified r${calledRec.artifact!.revision}`;
        const note = uncheckedNote(grownNow);
        if (note !== undefined) entry.note = note;
        if (outcome.table) entry.table = outcome.table;
        const pinnable = pinnableOf(outcome.callRecords);
        if (pinnable) {
          entry.pinnable = pinnable;
          const pins = state.value.program.functions[pinnable.fn]?.spec.pins ?? [];
          if (pins.some((p) => samePin(p, { label: pinnable.call, args: pinnable.args, expected: pinnable.expected }))) entry.pinned = true;
        }
        pushRepl(entry);
        if (cached && !flags.takeawayShown) {
          flags = { ...flags, takeawayShown: true };
          pushRepl({ kind: 'takeaway', id: id('tk'), text: TAKEAWAY_TEXT });
          set({ hints: { ...state.value.hints, takeaway: true } });
          void persistFlags();
        }
        return;
      }
      case 'error':
        errorEntry(outcome.errorName, outcome.message);
        return;
      case 'fault': {
        const rec = state.value.program.functions[outcome.fn];
        const ctx: RestartContext = {
          kind: 'fault',
          fn: outcome.fn,
          call: outcome.call,
          input,
          fault: { errorName: outcome.errorName, message: outcome.message, previousBody: rec?.artifact?.body ?? '' },
          ...(rec?.artifact ? { artifactRevision: rec.artifact.revision } : {}),
        };
        errorEntry(
          outcome.errorName,
          `${outcome.call} threw ${outcome.errorName}: ${outcome.message}`,
          [RESTART.retryFault, RESTART.rollback, RESTART.editSpec],
          ctx,
        );
        return;
      }
      case 'timeout': {
        const rec = outcome.fn ? state.value.program.functions[outcome.fn] : undefined;
        const n = rec ? rec.spec.budgetMs : outcome.ms;
        const lost = lostOf(outcome);
        const message = `${outcome.call ?? 'call'} exceeded ${n} ms and was terminated; ${
          lost.length > 0
            ? `the program was restored except ${plural(lost.length, 'variable')} that could not be restored (${lost.join(', ')})`
            : 'the program was restored'
        }`;
        if (outcome.fn && outcome.call) {
          errorEntry('TimeoutError', message, [RESTART.retryFault, RESTART.rollback, RESTART.editSpec], {
            kind: 'timeout',
            fn: outcome.fn,
            call: outcome.call,
            input,
            fault: {
              errorName: 'TimeoutError',
              message: `did not return within ${n} ms`,
              previousBody: rec?.artifact?.body ?? '',
            },
            ...(rec?.artifact ? { artifactRevision: rec.artifact.revision } : {}),
          });
        } else {
          errorEntry('TimeoutError', message);
        }
        reportLost(lost);
        return;
      }
    }
  }

  // ───────────────────────── grow loop ─────────────────────────

  async function grow(req: GrowRequest, input: string, myEpoch: number): Promise<GrowResult> {
    growCtrl?.abort();
    const ctrl = new AbortController();
    growCtrl = ctrl;
    const sig = ctrl.signal;
    try {
      return await growInner(req, input, sig);
    } catch (e) {
      if (e instanceof Aborted || isAbort(e) || sig.aborted || myEpoch !== epoch) return { kind: 'aborted' };
      throw e;
    } finally {
      if (growCtrl === ctrl) growCtrl = null;
    }
  }

  async function growInner(req: GrowRequest, input: string, sig: AbortSignal): Promise<GrowResult> {
    const { fn, spec } = req;
    const { specHash, testsHash } = await hashesFor(spec);
    // A loaded recording that holds this exact spec text replays it, even when the live service is up.
    const gen: Generator | null = loadedReplay?.has(fn, specHash, testsHash) ? loadedReplay : generator;
    const mode = gen?.mode ?? state.value.mode;
    let maxAttempts = Math.max(1, spec.maxAttempts);
    const view: GenerationView = {
      id: id('g'),
      fn,
      signature: declarationLine(spec),
      call: req.call,
      phase: 'generating',
      attempt: 1,
      maxAttempts,
      progress: [],
      attempts: [],
      ungated: isUngated(spec),
      mode,
    };
    set({ generation: view });
    const pinned = decodePins(spec);

    const rejected: PromptInput['history'] = [];
    const candidates: Candidate[] = [];
    let charged = 0;
    let freeRetries = 0;
    let model = '';
    let codexVersion = '';
    const growCtx: RestartContext = {
      kind: 'grow-failed',
      fn,
      call: req.call,
      input,
      spec,
      ...(req.callArgTypes ? { callArgTypes: req.callArgTypes } : {}),
      ...(req.callArgs ? { callArgs: req.callArgs } : {}),
      ...(req.functionArgs ? { functionArgs: true } : {}),
      ...(req.dataArgs ? { dataArgs: req.dataArgs } : {}),
    };
    if (req.runtimeFault) {
      growCtx.fault = { errorName: req.runtimeFault.errorName, message: req.runtimeFault.message, previousBody: req.runtimeFault.previousBody };
    }

    while (charged < maxAttempts) {
      const index = candidates.length; // 0-based: also the GenerateRequest.attempt (replay indexes by it)
      const attemptNo = index + 1;
      setGen((g) => ({
        ...g,
        phase: 'generating',
        attempt: attemptNo,
        maxAttempts,
        progress: [],
        attempts: [...g.attempts, { attempt: attemptNo, status: 'generating', shown: '', gates: [] }],
      }));

      const promptInput: PromptInput = { spec, history: [...rejected] };
      if (req.callArgTypes) promptInput.callArgTypes = req.callArgTypes;
      if (req.runtimeFault) promptInput.runtimeFault = req.runtimeFault;
      if (req.dataArgs && req.dataArgs.length > 0) promptInput.dataSamples = dataSamplesFor(req.dataArgs, mode);
      const genReq: GenerateRequest = { fn, specHash, testsHash, attempt: index, prompt: buildPrompt(promptInput) };

      let result: GenerateResult;
      const t0 = deps.now();
      try {
        if (!gen) throw new GenerationFailure({ code: 'service_unreachable', message: 'No generator is available' });
        result = await gen.generate(
          genReq,
          (p) => setGen((g) => ({ ...g, progress: [...g.progress, p] })),
          sig,
        );
      } catch (e) {
        if (sig.aborted || isAbort(e)) throw new Aborted();
        const err: GenerateError =
          e instanceof GenerationFailure ? { ...e.info } : { code: 'codex_failed', message: `Generation failed: ${errorText(e)}` };
        const problemFix = state.value.service.problem?.fix;
        if (!err.fix && problemFix && state.value.mode === 'live') err.fix = problemFix;
        setAttempt(index, { status: 'aborted' });
        setGen({ phase: 'failed', error: err });
        const serviceError = ['codex_missing', 'not_logged_in', 'service_unreachable', 'codex_failed', 'timeout', 'aborted'].includes(err.code);
        errorEntry(
          'GenerationFailed',
          err.message,
          serviceError ? [RESTART.retryGrow, RESTART.dismiss] : [RESTART.retryGrow, RESTART.editSpec, RESTART.dismiss],
          growCtx,
        );
        return { kind: 'failed' };
      }
      if (sig.aborted) throw new Aborted();
      const generationMs = result.durationMs || Math.max(0, deps.now() - t0);
      model = result.model;
      codexVersion = result.codexVersion;
      // Everything generated this session can be shared: live candidates as generated, replayed ones verbatim from
      // their recording (with the model that really wrote them; nothing replayed is ever marked live).
      const shareCtx = { spec, call: input, ...recordingData(req.dataArgs) };
      if (result.source === 'live' && mode === 'live') {
        const effort = state.value.service.effort;
        sink.add(genReq, result, `${fn} — ${spec.doc.trim().slice(0, 40) || 'inferred from a call'}`, { ...shareCtx, ...(effort ? { effort } : {}) });
        sinkFns.add(fn);
      } else if (result.source === 'replay') {
        const from = recordedAttempt(allRecordings(), genReq);
        if (from) {
          sink.add(genReq, result, from.label, { ...shareCtx, replayed: { attempt: from.attempt, provenance: from.provenance } });
          sinkFns.add(fn);
        }
      }
      // "What the model saw": the prompt really sent. A replayed candidate was generated from the prompt stored in
      // the recording, which can differ from the one this build would send today.
      const sentPrompt = result.source === 'replay' ? (recordedPrompt(allRecordings(), genReq) ?? genReq.prompt) : genReq.prompt;

      // typewriter
      const body = result.body;
      setAttempt(index, { status: 'typing', shown: '' });
      await typeOut(index, body, sig);
      setAttempt(index, { shown: body });

      // A decline ("I cannot honestly write this") is final for this call: no gate runs, nothing is retried or
      // committed. It is not a rejection: no gate judged anything.
      const declined = parseDecline(body);
      if (declined) {
        const gates: GateResult[] = GATE_ORDER.map((gate) => ({
          gate,
          status: 'skipped',
          ms: 0,
          summary: 'not run',
          note: DECLINED_GATE_NOTE,
          diagnostics: [],
        }));
        const candidate: Candidate = {
          id: id('c'),
          attempt: attemptNo,
          body,
          notes: result.notes,
          source: result.source,
          generationMs,
          gates,
          verdict: 'aborted',
          prompt: sentPrompt,
          declined,
        };
        candidates.push(candidate);
        setAttempt(index, { status: 'aborted', shown: body, gates, candidate });
        setGen({ phase: 'failed', declined });
        log({ kind: 'decline', fn, summary: declined.message, detail: { reason: declined.reason, attempt: attemptNo, source: result.source } });
        errorEntry(
          'Declined',
          declineMessage(fn, declined),
          declined.reason === 'needs-spec' ? [RESTART.writeSpec, RESTART.dismiss] : [RESTART.dismiss],
          growCtx,
          true, // already in the session log as a 'decline'
        );
        return { kind: 'failed' };
      }

      // gates
      setGen({ phase: 'gating' });
      const gated = await runGates(index, spec, body, specHash, testsHash, sig, req.callArgs, pinned);
      // TS7023/7024: with no declared return type a directly recursive body cannot be typed. The note travels to
      // the model (formatDiagnosticsForModel prints a failing gate's note) and is shown on the gate row.
      const recursion =
        spec.returns === null &&
        gated.gates[0]!.status === 'fail' &&
        gated.gates[0]!.diagnostics.some((d) => d.kind === 'compile' && (d.code === 7023 || d.code === 7024));
      if (recursion) gated.gates[0] = { ...gated.gates[0]!, note: RECURSION_HINT };
      // A function argument cannot be frozen and replayed, so the call never reached the Invariants gate: say why.
      const inv = gated.gates[3]!;
      if (req.functionArgs && inv.status === 'skipped' && inv.note?.startsWith(NEVER_CALLED_PREFIX)) {
        gated.gates[3] = { ...inv, note: `${inv.note}: ${FUNCTION_ARG_NOTE}` };
      }
      const failing = gated.gates.find((g) => g.status === 'fail');
      const verdict: Candidate['verdict'] = gated.specError ? 'aborted' : failing ? 'rejected' : 'accepted';
      const candidate: Candidate = {
        id: id('c'),
        attempt: attemptNo,
        body,
        notes: result.notes,
        source: result.source,
        generationMs,
        gates: gated.gates,
        verdict,
        prompt: sentPrompt,
      };
      if (failing && verdict === 'rejected') candidate.rejectedBy = failing.gate;
      if (failing?.headline) candidate.headline = failing.headline;
      candidates.push(candidate);
      setAttempt(index, {
        status: verdict === 'accepted' ? 'accepted' : verdict === 'aborted' ? 'aborted' : 'rejected',
        shown: body,
        gates: gated.gates,
        candidate,
      });

      if (failing) {
        log({
          kind: 'gate',
          fn,
          summary: failing.headline ?? `rejected by ${failing.gate}`,
          detail: { gate: failing.gate, attempt: attemptNo, source: result.source, ...(gated.specError ? { specError: true } : {}) },
        });
      }
      if (gated.specError) {
        setGen({ phase: 'failed' });
        errorEntry(
          'SpecError',
          `${req.call}: the spec's ${gated.specError.gate} do not load (${gated.specError.message}). Fix the spec; no candidate budget was spent.`,
          [RESTART.editSpec, RESTART.retryGrow, RESTART.dismiss],
          growCtx,
        );
        return { kind: 'failed' };
      }

      if (verdict === 'accepted') {
        // What actually ran, as facts (never a score). No tests, properties or pins: nothing could kill a mutant, so
        // the mutation check is recorded as skipped right away; otherwise it runs lazily once the engine is idle.
        const ungated = isUngated(spec);
        const evidence = evidenceOf(gated.gates, ungated ? skippedReport(NO_TESTS_REASON, deps.now()) : undefined);
        const revision = await commit(req, body, gated.compile, specHash, testsHash, model, codexVersion, candidates, maxAttempts, evidence);
        if (!ungated) enqueueMutation(fn);
        log({ kind: 'commit', fn, summary: `${fn} committed as r${revision}`, detail: { revision, attempt: attemptNo, candidates: candidates.length, source: result.source } });
        setGen({ phase: 'committed', revision });
        return { kind: 'committed', revision, grown: { fn, ungated: isUngated(spec), notes: result.notes } };
      }

      // rejected
      let headline = candidate.headline;
      if (recursion && freeRetries < MAX_FREE_RECURSION_RETRIES) {
        freeRetries++;
        maxAttempts++; // this candidate is not charged: the spec, not the model, made it unanswerable
        headline = `${headline ?? 'Rejected by compile'} — ${RECURSION_HINT}`;
      } else {
        charged++;
      }
      rejected.push({ attempt: attemptNo, body, gates: gated.gates, ...(headline ? { headline } : {}) });
      if (charged < maxAttempts) setGen({ phase: 'generating', maxAttempts });
    }

    setGen({ phase: 'failed' });
    errorEntry(
      'GrowthFailed',
      `${req.call}: Budget exhausted after ${plural(candidates.length, 'candidate')} — the program is unchanged.`,
      [RESTART.retryGrow, RESTART.editSpec, RESTART.dismiss],
      growCtx,
    );
    return { kind: 'failed' };
  }

  /** No tests, no properties and no pins: nothing checks the candidate against an intent. */
  function isUngated(spec: FunctionSpec): boolean {
    return !spec.tests.trim() && !spec.properties.trim() && !(spec.pins && spec.pins.length > 0);
  }

  /**
   * The DATA blocks of the prompt: name, type and row count always; sample rows only in live mode with samples on
   * (`state.send`). In replay mode nothing is sent anywhere, and the type-only block is what the prompt says.
   */
  function dataSamplesFor(dataArgs: DataArg[], mode: 'live' | 'replay'): NonNullable<PromptInput['dataSamples']> {
    const send = state.value.send;
    return dataArgs.map((d) => {
      const entry: NonNullable<PromptInput['dataSamples']>[number] = { name: d.name, typeName: d.typeName, rowCount: d.rowCount };
      const stored = content.get(d.hash);
      if (mode === 'live' && send.samples && stored) entry.sampleText = sampleForModel(stored.rows, { count: send.sampleRows }).text;
      return entry;
    });
  }

  /** Rows and bindings a live recording needs to re-run its calls. */
  function recordingData(dataArgs: DataArg[] | undefined): { datasets?: Record<Hash, Json>; datasetRefs?: DatasetRef[] } {
    if (!dataArgs || dataArgs.length === 0) return {};
    const bound = headRev().program.datasets ?? {};
    const datasets: Record<Hash, Json> = {};
    const datasetRefs: DatasetRef[] = [];
    for (const d of dataArgs) {
      const stored = content.get(d.hash);
      if (stored) datasets[d.hash] = stored.encoded;
      const ref = bound[d.name];
      if (ref && ref.hash === d.hash) datasetRefs.push(ref);
    }
    return { datasets, datasetRefs };
  }

  /**
   * A spec's pins as gate cases: arguments and expected value decoded, dataset arguments resolved to the stored rows
   * by hash. A pin whose dataset is no longer stored is skipped, and the user is told.
   */
  function decodePins(spec: FunctionSpec, quiet = false): PinnedCase[] {
    const out: PinnedCase[] = [];
    const skipped: string[] = [];
    for (const pin of spec.pins ?? []) {
      try {
        const args: unknown[] = [];
        let missing = false;
        for (const a of pin.args) {
          if (a.kind === 'dataset') {
            const stored = content.get(a.hash);
            if (!stored) missing = true;
            else args.push(stored.rows);
          } else {
            args.push(decodeValue(a.encoded));
          }
        }
        if (missing) skipped.push(pin.label);
        else out.push({ label: pin.label, args, expected: decodeValue(pin.expected) });
      } catch {
        skipped.push(pin.label);
      }
    }
    if (skipped.length > 0 && !quiet) {
      notice(
        'error',
        `Skipped ${plural(skipped.length, 'pinned test')} (${skipped.join(', ')}): the data it was pinned on is no longer stored. Remove the pin in the Repo tab, or pin the result again.`,
      );
    }
    return out;
  }

  async function typeOut(index: number, body: string, sig: AbortSignal): Promise<void> {
    if (pacing.typeCharMs <= 0 || body.length === 0) return;
    const total = Math.min(MAX_TYPING_MS, body.length * pacing.typeCharMs);
    const steps = Math.max(1, Math.ceil(total / TYPE_TICK_MS));
    for (let i = 1; i <= steps; i++) {
      await sleep(total / steps, sig);
      setAttempt(index, { shown: body.slice(0, Math.round((body.length * i) / steps)) });
    }
  }

  interface Gated {
    gates: GateResult[];
    compile: CompileOutput;
    specError?: { gate: 'tests' | 'properties'; message: string };
  }

  async function runGates(
    index: number,
    spec: FunctionSpec,
    body: string,
    specHash: string,
    testsHash: string,
    sig: AbortSignal,
    callArgs?: unknown[],
    pinned?: PinnedCase[],
  ): Promise<Gated> {
    const gates: GateResult[] = GATE_ORDER.map(pendingGate);
    const show = (): void => setAttempt(index, { status: 'gating', gates: [...gates] });
    show();

    // Gate 1: compile
    gates[0] = { ...gates[0]!, status: 'running' };
    show();
    let started = performance.now();
    const compiled = await deps.compile(spec, body);
    await sleep(pacing.gateDwellMs - (performance.now() - started), sig);
    gates[0] = compiled.gate;
    if (compiled.gate.status === 'fail' || compiled.js === null) {
      for (let i = 1; i < gates.length; i++) gates[i] = notReached(GATE_ORDER[i]!);
      show();
      return { gates: [...gates], compile: compiled };
    }
    show();

    // Spec check: the user's tests/properties must transpile. A failure is the spec's fault, not the candidate's.
    const tests = deps.transpile(spec.tests);
    const props = deps.transpile(spec.properties);
    const bad = tests.error ? { gate: 'tests' as const, message: tests.error } : props.error ? { gate: 'properties' as const, message: props.error } : null;
    if (bad) {
      const at = GATE_ORDER.indexOf(bad.gate);
      for (let i = 1; i < gates.length; i++) {
        gates[i] =
          i === at
            ? {
                gate: bad.gate,
                status: 'fail',
                ms: 0,
                summary: 'spec error',
                note: 'spec error',
                headline: `Spec error: ${bad.gate} ${bad.message}`,
                diagnostics: [{ kind: 'test', name: '(spec error)', message: bad.message, error: bad.message }],
              }
            : notReached(GATE_ORDER[i]!);
      }
      show();
      return { gates: [...gates], compile: compiled, specError: bad };
    }

    // Gates 2–4: one deferred per gate; results light up in order, each visibly running ≥ gateDwellMs.
    const waiting = new Map<GateId, { promise: Promise<GateResult>; resolve: (r: GateResult) => void }>();
    for (const g of GATE_ORDER.slice(1)) {
      let resolve!: (r: GateResult) => void;
      const promise = new Promise<GateResult>((r) => (resolve = r));
      waiting.set(g, { promise, resolve });
    }
    const known = new Map<GateId, GateResult>();
    const deliver = (r: GateResult): void => {
      if (known.has(r.gate)) return;
      known.set(r.gate, r);
      waiting.get(r.gate)?.resolve(r);
    };
    const input: ExecGateInput = {
      name: spec.name,
      js: compiled.js,
      testsJs: tests.js,
      propertiesJs: props.js,
      budgetMs: spec.budgetMs,
      seed: gateSeed(specHash, testsHash),
      // The triggering call's real arguments: without them a spec with no tests/properties gives the Invariants
      // replay nothing to call, and impure / mutating / non-terminating bodies would pass.
      ...(callArgs ? { callArgs } : {}),
      // Results the user pinned from earlier calls: unit tests the candidate must reproduce.
      ...(pinned && pinned.length > 0 ? { pinned } : {}),
    };
    const all = deps
      .execGates(input, deliver)
      .then((results) => {
        for (const r of results) deliver(r);
        return results;
      })
      .catch((e: unknown) => {
        const failed: GateResult = {
          gate: 'tests',
          status: 'fail',
          ms: 0,
          summary: 'gate runner error',
          headline: `Rejected: gate runner error: ${errorText(e)}`,
          diagnostics: [{ kind: 'test', name: '(gate runner)', message: errorText(e), error: errorText(e) }],
        };
        const out = [failed, notReached('properties'), notReached('invariants')];
        for (const r of out) deliver(r);
        return out;
      });
    // Gates nobody reports (should not happen) resolve as not reached once the run is over.
    void all.then(() => {
      for (const g of GATE_ORDER.slice(1)) if (!known.has(g)) deliver(notReached(g));
    });

    for (let i = 1; i < GATE_ORDER.length; i++) {
      const g = GATE_ORDER[i]!;
      const already = known.get(g);
      if (already && already.status === 'skipped') {
        gates[i] = already;
        show();
        continue;
      }
      gates[i] = { ...gates[i]!, status: 'running' };
      show();
      started = performance.now();
      const r = await waiting.get(g)!.promise;
      if (sig.aborted) throw new Aborted();
      await sleep(pacing.gateDwellMs - (performance.now() - started), sig);
      gates[i] = r;
      if (r.status === 'fail') {
        // Later gates were not reached: show them together with the failure, not one by one.
        await all;
        for (let j = i + 1; j < GATE_ORDER.length; j++) gates[j] = known.get(GATE_ORDER[j]!) ?? notReached(GATE_ORDER[j]!);
        show();
        break;
      }
      show();
    }
    await all;
    const final = [...gates];
    const specErr = final.find((g) => g.note === 'spec error' && g.status === 'fail');
    if (specErr && (specErr.gate === 'tests' || specErr.gate === 'properties')) {
      const d = specErr.diagnostics[0];
      const message = d && d.kind === 'test' ? d.message : (specErr.headline ?? 'spec error');
      return { gates: final, compile: compiled, specError: { gate: specErr.gate, message } };
    }
    return { gates: final, compile: compiled };
  }

  async function commit(
    req: GrowRequest,
    body: string,
    compiled: CompileOutput,
    specHash: string,
    testsHash: string,
    model: string,
    codexVersion: string,
    candidates: Candidate[],
    maxAttempts: number,
    evidence: Evidence,
  ): Promise<number> {
    const { fn, spec } = req;
    const base = headRev().program;
    const existing = base.functions[fn];
    const withRec: Program =
      existing && existing.specHash === specHash && existing.testsHash === testsHash && sameSpec(existing.spec, spec)
        ? base
        : await withSpec(base, spec);
    const env = await snapshotEnv();
    // No await from here to commitRevision: the id is derived from the history as it is at the moment of commit.
    const revisionId = (history[history.length - 1]?.id ?? 0) + 1;
    const artifact: Artifact = {
      body,
      source: compiled.source,
      js: compiled.js!,
      returnType: compiled.returnType,
      specHash,
      testsHash,
      model,
      codexVersion,
      committedAt: deps.now(),
      candidates: [...candidates],
      revision: revisionId,
      evidence,
    };
    const program = withArtifact(withRec, fn, artifact);
    const rejected = candidates.filter((c) => c.verdict !== 'accepted').length;
    const rev = newRevision(history, {
      kind: 'commit',
      title: describeCommit(fn, candidates, maxAttempts),
      detail: `${plural(candidates.length, 'candidate')} (${rejected} rejected) · ${model || 'model'} via Codex ${codexVersion || '?'} · ${
        candidates[candidates.length - 1]!.source
      }`,
      fn,
      program,
      env,
      at: deps.now(),
    });
    await commitRevision(rev);
    await runtime!.define(fn, artifact.js, spec.budgetMs); // hot swap: no restart, REPL variables untouched
    return rev.id;
  }

  function sameSpec(a: FunctionSpec, b: FunctionSpec): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // ───────────────────────── spec edits ─────────────────────────
  // The public operations below go through `exclusive`; the *Inner variants assume they already hold the queue
  // (they call each other, never the public ones, so nothing waits on itself).

  async function applySpec(next: FunctionSpec, opts: { kind: Revision['kind']; title?: string; quiet?: boolean }): Promise<void> {
    const name = next.name;
    const base = headRev().program;
    const before = base.functions[name];
    let program = await withSpec(base, next);
    let after = program.functions[name]!;
    const specChanged = !before || before.specHash !== after.specHash;
    const testsChanged = !before || before.testsHash !== after.testsHash;
    const hadLive = before ? isLive(before) : false;
    const invalidates = hadLive && !isLive(after);
    // Editing a spec back to the text an existing artifact was certified against makes that artifact live again.
    // Its stored js is not trusted (a stale artifact is not recompiled on import/load): recompile it from the body.
    let revalidated: Artifact | null = null;
    let unrecompilable = false;
    if (!hadLive && after.artifact && isLive(after)) {
      const c = await deps.compile(after.spec, after.artifact.body).catch(() => null);
      if (c && c.gate.status !== 'fail' && c.js !== null) {
        revalidated = { ...after.artifact, js: c.js, returnType: c.returnType, source: c.source };
        program = withArtifact(program, name, revalidated);
      } else {
        unrecompilable = true;
        program = { ...program, functions: { ...program.functions, [name]: { ...after, artifact: null } } };
      }
      after = program.functions[name]!;
    }
    if (invalidates) await runtime?.undefine(name).catch(() => undefined);
    if (revalidated && runtime) await runtime.define(name, revalidated.js, after.spec.budgetMs);
    const env = await snapshotEnv();
    const title =
      opts.title ??
      (before
        ? !specChanged && !testsChanged
          ? `Spec edited: ${name} — artifact unaffected`
          : revalidated
            ? `Spec edited: ${name} — artifact revalidated (certified r${revalidated.revision})`
            : unrecompilable
              ? `Spec edited: ${name} — artifact dropped (its body no longer compiles)`
              : invalidates || (before.artifact && !isLive(after))
                ? `Spec edited: ${name} — artifact invalidated`
                : `Spec edited: ${name} — no artifact yet`
        : `Spec added: ${name} — no artifact yet`);
    const changes: string[] = [];
    if (before && specChanged) changes.push(`spec hash ${short(before.specHash)} → ${short(after.specHash)}`);
    if (before && testsChanged) changes.push(`tests hash ${short(before.testsHash)} → ${short(after.testsHash)}`);
    const rev = newRevision(history, {
      kind: opts.kind,
      title,
      fn: name,
      program,
      env,
      at: deps.now(),
      ...(changes.length ? { detail: changes.join(' · ') } : {}),
    });
    await commitRevision(rev);
    log({ kind: opts.kind === 'example' ? 'note' : 'spec-edit', fn: name, summary: title, detail: { revision: rev.id } });
    if (before && !opts.quiet) {
      const tail = invalidates
        ? 'artifact invalidated; the next call regenerates'
        : revalidated
          ? `artifact revalidated (certified r${revalidated.revision}); calls use it again`
          : unrecompilable
            ? 'the artifact certified for this text no longer compiles and was dropped; the next call generates'
            : !specChanged && !testsChanged
              ? before.artifact
                ? 'hashes unchanged; the artifact is still valid'
                : 'hashes unchanged'
              : 'no live artifact; the next call generates';
      info(`${name}: ${changes.length ? `${changes.join(' · ')} · ` : ''}${tail}`, invalidates || unrecompilable ? 'warn' : 'muted');
    }
  }

  async function editSpecInner(fn: string, patch: SpecPatch): Promise<void> {
    try {
      const rec = headRev().program.functions[fn];
      if (!rec) {
        notice('error', `No function named ${fn}`);
        return;
      }
      const next: FunctionSpec = { ...rec.spec, ...patch };
      if (sameSpec(next, rec.spec)) return;
      await applySpec(next, { kind: 'spec-edit' });
    } catch (e) {
      notice('error', `Spec edit failed: ${errorText(e)}`);
    }
  }

  function editSpec(fn: string, patch: SpecPatch): Promise<void> {
    return exclusive('edit the spec', () => editSpecInner(fn, patch));
  }

  function upsertSpec(spec: FunctionSpec): Promise<void> {
    return exclusive('change the spec', async () => {
      try {
        const reason = notGrowableReason(spec.name);
        if (reason) {
          notice('error', reason);
          return;
        }
        await applySpec(spec, { kind: 'spec-edit' });
      } catch (e) {
        notice('error', `Saving the spec failed: ${errorText(e)}`);
      }
    });
  }

  async function loadExampleInner(exampleId: string): Promise<void> {
    const ex = examples.find((e) => e.id === exampleId);
    if (!ex) {
      notice('error', `Unknown example: ${exampleId}`);
      return;
    }
    if (ex.spec && !headRev().program.functions[ex.fn]) {
      try {
        await applySpec(ex.spec, { kind: 'example', title: `Loaded example: ${ex.title}` });
      } catch (e) {
        notice('error', `Loading the example failed: ${errorText(e)}`);
        return;
      }
    }
    if (ex.dataset) {
      const { name, filename } = ex.dataset;
      const bound = headRev().program.datasets?.[name];
      if (!bound || bound.source !== 'bundled' || bound.filename !== filename) {
        const text = await deps.bundledData(filename).catch(() => null);
        if (text === null) {
          notice('error', `Loading the example failed: the bundled data ${filename} is not available`);
          return;
        }
        if (!(await loadDatasetInner({ text, filename, name, source: 'bundled' }))) return;
      }
    }
    set({ replInput: ex.call });
  }

  function loadExample(exampleId: string): Promise<void> {
    // Type the call in now: an Enter right after the click must run THIS example's call (its spec load is queued
    // ahead of that submit), not whatever was in the input.
    const ex = examples.find((e) => e.id === exampleId);
    if (ex && !state.value.busy) set({ replInput: ex.call });
    return exclusive('load an example', () => loadExampleInner(exampleId));
  }

  function breakIt(exampleId: string): Promise<void> {
    return exclusive('break the spec', async () => {
      const ex = examples.find((e) => e.id === exampleId);
      if (!ex) {
        notice('error', `Unknown example: ${exampleId}`);
        return;
      }
      if (!headRev().program.functions[ex.fn]) {
        await loadExampleInner(exampleId);
        if (!headRev().program.functions[ex.fn]) {
          // a spec-less example has nothing to break until its call has grown the function
          notice('info', `Run the call first: ${ex.call} grows ${ex.fn}; then "${ex.breakIt.label}" changes its spec.`);
          set({ replInput: ex.call });
          return;
        }
      }
      await editSpecInner(ex.fn, ex.breakPatch);
      set({ replInput: ex.call });
    });
  }

  // ───────────────────────── history ─────────────────────────

  async function rollbackInner(target: number): Promise<void> {
    const source = history.find((r) => r.id === target);
    if (!source) {
      notice('error', `There is no revision r${target}`);
      return;
    }
    try {
      const fns = jsFunctions(source.program);
      const lost = await resetRuntime(fns, source.env);
      // The new id is derived from the history as it is now (no await between this and the commit's push).
      const rev = { ...rollbackRevision(history, target), at: deps.now() };
      await commitRevision(rev);
      set({ generation: null });
      await refreshEnv();
      const restored = Object.keys(rev.env).filter((k) => !lost.includes(k)).length;
      info(`Rolled back to r${target} — restored ${plural(Object.keys(fns).length, 'function')} and ${plural(restored, 'variable')}`);
      log({ kind: 'rollback', summary: `rolled back to r${target} as r${rev.id}`, detail: { target, revision: rev.id } });
      reportLost(lost);
    } catch (e) {
      notice('error', `Rollback failed: ${errorText(e)}`);
      if (runtime) await resetRuntime(jsFunctions(headRev().program), headRev().env).catch(() => undefined);
    }
  }

  function rollback(target: number): Promise<void> {
    return exclusive('roll back', () => rollbackInner(target));
  }

  function invokeRestart(entryId: string, restart: RestartId): Promise<void> {
    const entry = state.value.repl.find((e) => e.id === entryId);
    if (!entry || entry.kind !== 'error' || entry.resolved) return Promise.resolve();
    const ctx = contexts.get(entryId);
    if (restart !== 'dismiss' && !ctx) return Promise.resolve();
    set({ repl: state.value.repl.map((e) => (e.id === entryId && e.kind === 'error' ? { ...e, resolved: true } : e)) });
    if (restart === 'dismiss' || !ctx) return Promise.resolve();

    if (restart === 'edit-spec') {
      set({ focusSpec: { fn: ctx.fn, nonce: ++focusNonce } });
      return Promise.resolve();
    }
    if (restart === 'rollback') {
      return exclusive('roll back', async () => {
        const before = ctx.artifactRevision !== undefined ? [...history].reverse().find((r) => r.id < ctx.artifactRevision!) : undefined;
        await rollbackInner(before?.id ?? 1);
      });
    }
    // retry: an evaluation like submit, so it counts as busy from the moment it is requested
    const myEpoch = epoch;
    busyStart();
    return exclusive('retry', async () => {
      try {
        const rec = headRev().program.functions[ctx.fn];
        const spec = rec?.spec ?? ctx.spec;
        if (!spec) {
          errorEntry('Error', `${ctx.fn} has no spec any more; call it again to grow it from the call`);
          return;
        }
        info(ctx.kind === 'grow-failed' ? `Retrying ${ctx.fn}…` : `Regenerating ${ctx.fn} with the error fed back…`, 'accent');
        const growReq: GrowRequest = { fn: ctx.fn, call: ctx.call, spec };
        if (spec.origin === 'call' && ctx.callArgTypes) growReq.callArgTypes = ctx.callArgTypes;
        if (ctx.callArgs) growReq.callArgs = ctx.callArgs;
        if (ctx.functionArgs) growReq.functionArgs = true;
        if (ctx.dataArgs) growReq.dataArgs = ctx.dataArgs;
        // A fault/timeout retry feeds the error back; so does re-running a grow that was itself such a retry.
        if (ctx.fault) {
          growReq.runtimeFault = { call: ctx.call, errorName: ctx.fault.errorName, message: ctx.fault.message, previousBody: ctx.fault.previousBody };
        }
        const result = await grow(growReq, ctx.input, myEpoch);
        if (result.kind === 'committed' && myEpoch === epoch) await runInput(ctx.input, myEpoch, result);
      } catch (e) {
        if (!(e instanceof Aborted) && myEpoch === epoch) errorEntry('InternalError', errorText(e));
      } finally {
        if (myEpoch === epoch) {
          await refreshEnv();
          busyEnd();
        }
      }
    });
  }

  // ───────────────────────── data ─────────────────────────

  function previewDataset(input: { text: string; filename?: string; name?: string }): Promise<DatasetPreview> {
    return datasetPreview(input, state.value.send);
  }

  /** Must run inside `exclusive`. Returns whether the dataset was bound; a problem becomes a notice. */
  async function loadDatasetInner(input: { text: string; filename?: string; name?: string; source?: DatasetRef['source'] }): Promise<boolean> {
    try {
      const b = await buildData(input);
      if (!b.ok) {
        notice('error', `Could not load the data: ${b.error}`);
        return false;
      }
      const { ref } = b;
      const base = headRev().program;
      if (base.functions[ref.name]) {
        notice('error', `Could not load the data: \`${ref.name}\` is a function in this program; pick another variable name.`);
        return false;
      }
      const previous = base.datasets?.[ref.name];
      addContent(ref.hash, b.encoded);
      // rows first, then the revision that refers to them: a stored revision must never point at rows that were not
      // saved (the store discards an image whose datasets are missing)
      await deps.store.saveDatasets?.({ ...referencedContent(), [ref.hash]: b.encoded });
      await runtime!.bindDataset(ref.name, ref.hash, decodeRows(b.encoded), ref.typeName);
      const env = await snapshotEnv();
      const cols = ref.columns.length;
      const rev = newRevision(history, {
        kind: 'dataset',
        title: `Loaded dataset ${ref.name}: ${plural(ref.rowCount, 'row')} × ${plural(cols, 'column')}`,
        detail: [
          ref.source === 'bundled' ? `bundled ${ref.filename ?? 'data'}` : ref.filename ? `from ${ref.filename}` : 'pasted',
          `hash ${short(ref.hash)}`,
          ...(previous ? [previous.hash === ref.hash ? 'same rows as before' : `replaces the previous ${ref.name} (hash ${short(previous.hash)})`] : []),
        ].join(' · '),
        program: withDataset(base, ref),
        env,
        at: deps.now(),
      });
      await commitRevision(rev);
      await persistDatasets();
      await refreshEnv();
      info(`\`${ref.name}\` is bound: \`${ref.typeDecl}\` (${plural(ref.rowCount, 'row')})`);
      // name, row and column counts only: never the rows
      log({ kind: 'dataset', summary: `loaded dataset ${ref.name}`, detail: { name: ref.name, rows: ref.rowCount, columns: ref.columns.length } });
      return true;
    } catch (e) {
      notice('error', `Could not load the data: ${errorText(e)}`);
      return false;
    }
  }

  function loadDataset(input: { text: string; filename?: string; name?: string; source?: DatasetRef['source'] }): Promise<void> {
    return exclusive('load the data', async () => {
      await loadDatasetInner(input);
    });
  }

  function removeDataset(name: string): Promise<void> {
    return exclusive('remove the data', async () => {
      const base = headRev().program;
      const ref = base.datasets?.[name];
      if (!ref) {
        notice('error', `No dataset is bound to ${name}`);
        return;
      }
      try {
        await runtime!.unbindDataset(name);
        const env = await snapshotEnv();
        const rev = newRevision(history, {
          kind: 'dataset',
          title: `Removed dataset ${name}`,
          detail: `${plural(ref.rowCount, 'row')} · hash ${short(ref.hash)}`,
          program: withoutDataset(base, name),
          env,
          at: deps.now(),
        });
        await commitRevision(rev);
        await persistDatasets();
        await refreshEnv();
        info(`\`${name}\` is no longer bound (earlier revisions keep it: roll back to get it again)`);
        log({ kind: 'dataset', summary: `removed dataset ${name}`, detail: { name, rows: ref.rowCount, columns: ref.columns.length } });
      } catch (e) {
        notice('error', `Removing the data failed: ${errorText(e)}`);
      }
    });
  }

  function setSendSamples(on: boolean): void {
    if (state.value.send.samples === on) return;
    flags = { ...flags, sendSamples: on };
    set({ send: { ...state.value.send, samples: on } });
    void persistFlags();
  }

  // ───────────────────────── pins ─────────────────────────

  const markPinned = (match: (e: Extract<ReplEntry, { kind: 'output' }>) => boolean, pinned: boolean): void => {
    set({
      repl: state.value.repl.map((e) => {
        if (e.kind !== 'output' || !match(e)) return e;
        if (pinned) return { ...e, pinned: true };
        const { pinned: _was, ...rest } = e;
        return rest;
      }),
    });
  };

  function pinResult(entryId: string): Promise<void> {
    return exclusive('pin the result', async () => {
      const entry = state.value.repl.find((e) => e.id === entryId);
      if (!entry || entry.kind !== 'output' || !entry.pinnable || entry.pinned) return;
      const { fn, call, args, expected } = entry.pinnable;
      try {
        const base = headRev().program;
        const rec = base.functions[fn];
        if (!rec) {
          notice('error', `${fn} is no longer in the program, so there is nothing to pin this result on.`);
          return;
        }
        const lost = args.find((a): a is Extract<PinArg, { kind: 'dataset' }> => a.kind === 'dataset' && !content.has(a.hash));
        if (lost) {
          notice('error', `Can't pin ${call}: the rows of \`${lost.name}\` it ran on are no longer stored.`);
          return;
        }
        const existing = rec.spec.pins ?? [];
        const candidate = { label: call, args, expected };
        if (existing.some((p) => samePin(p, candidate))) {
          markPinned((e) => e.id === entryId, true);
          return;
        }
        const pinId = (await sha256Hex(canonicalJson([call, args as unknown as Json, expected]))).slice(0, 12);
        const pin: Pin = { id: pinId, label: call, args, expected, pinnedAt: deps.now() };
        const env = await snapshotEnv();
        let shownExpected = '';
        try {
          shownExpected = show(decodeValue(expected));
        } catch {
          shownExpected = '…';
        }
        const rev = newRevision(history, {
          kind: 'pin',
          title: `Pinned: ${call}`,
          detail: `expected ${shownExpected.length > 120 ? `${shownExpected.slice(0, 119)}…` : shownExpected} · ${plural(existing.length + 1, 'pinned test')} on ${fn} · hashes unchanged`,
          fn,
          program: withPins(base, fn, [...existing, pin]),
          env,
          at: deps.now(),
        });
        await commitRevision(rev);
        await persistDatasets();
        markPinned((e) => e.id === entryId || (e.pinnable !== undefined && e.pinnable.fn === fn && samePin({ label: e.pinnable.call, args: e.pinnable.args, expected: e.pinnable.expected }, candidate)), true);
        info(PINNED_INFO, 'accent');
        log({ kind: 'pin', fn, summary: `pinned ${call}`, detail: { revision: rev.id } });
      } catch (e) {
        notice('error', `Pinning failed: ${errorText(e)}`);
      }
    });
  }

  function removePin(fn: string, pinId: string): Promise<void> {
    return exclusive('remove the pin', async () => {
      try {
        const base = headRev().program;
        const rec = base.functions[fn];
        const pin = rec?.spec.pins?.find((p) => p.id === pinId);
        if (!rec || !pin) {
          notice('error', `No pinned test ${pinId} on ${fn}`);
          return;
        }
        const left = (rec.spec.pins ?? []).filter((p) => p.id !== pinId);
        const env = await snapshotEnv();
        const rev = newRevision(history, {
          kind: 'pin',
          title: `Unpinned: ${pin.label}`,
          detail: `${plural(left.length, 'pinned test')} left on ${fn} · hashes unchanged`,
          fn,
          program: withPins(base, fn, left),
          env,
          at: deps.now(),
        });
        await commitRevision(rev);
        await persistDatasets();
        markPinned((e) => e.pinnable !== undefined && e.pinnable.fn === fn && samePin({ label: e.pinnable.call, args: e.pinnable.args, expected: e.pinnable.expected }, pin), false);
        info(`Removed the pinned test ${pin.label} from ${fn}.`);
        log({ kind: 'pin', fn, summary: `unpinned ${pin.label}`, detail: { revision: rev.id } });
      } catch (e) {
        notice('error', `Removing the pin failed: ${errorText(e)}`);
      }
    });
  }

  // ───────────────────────── mutation check (lazy) ─────────────────────────
  // Mutation testing asks "did the checks actually check anything?": broken copies of the committed function are run
  // against the same tests, properties and pins. It runs OUTSIDE the operation queue, only when the engine is idle,
  // and every queued operation cancels it (no partial report is stored; it re-runs after the next idle). The report
  // is metadata attached to the artifact after the fact: evidence is not part of any hash, so nothing goes stale.

  const setMutation = (m: EngineState['mutation'] | null): void => {
    if (m) {
      set({ mutation: m });
    } else if (state.value.mutation) {
      const { mutation: _gone, ...rest } = state.value;
      state.value = rest;
    }
  };

  function scheduleMutation(): void {
    if (disposed || mutRun || mutQueue.length === 0) return;
    if (mutTimer !== null) clearTimeout(mutTimer);
    const now = performance.now();
    const wait = Math.max(lastActivity + mutCfg.idleMs - now, lastEnter + mutCfg.quietMs - now, 0);
    mutTimer = setTimeout(mutationTick, Math.ceil(wait) + 5);
  }

  /** An operation finished: the idle clock restarts. */
  function idleAgain(): void {
    lastActivity = performance.now();
    scheduleMutation();
  }

  function enqueueMutation(fn: string): void {
    if (!mutQueue.includes(fn)) mutQueue.push(fn);
    if (!mutRun) setMutation({ fn: mutQueue[0]!, phase: 'waiting', done: 0, total: 0 });
    scheduleMutation();
  }

  /** Stop a running check (it goes back to the front of the queue); the idle clock restarts. */
  function cancelMutation(): void {
    lastActivity = performance.now();
    if (mutRun) {
      const { fn, ctrl } = mutRun;
      mutRun = null;
      ctrl.abort();
      if (!mutQueue.includes(fn)) mutQueue.unshift(fn);
      setMutation({ fn: mutQueue[0]!, phase: 'waiting', done: 0, total: 0 });
    }
    scheduleMutation();
  }

  function clearMutations(): void {
    mutQueue.length = 0;
    mutRun?.ctrl.abort();
    mutRun = null;
    if (mutTimer !== null) clearTimeout(mutTimer);
    mutTimer = null;
    setMutation(null);
  }

  function mutationTick(): void {
    mutTimer = null;
    if (disposed || mutRun || mutQueue.length === 0) return;
    const now = performance.now();
    if (busyCount > 0 || opsPending > 0 || now < lastActivity + mutCfg.idleMs || now < lastEnter + mutCfg.quietMs) {
      scheduleMutation();
      return;
    }
    void runMutationNow(mutQueue.shift()!);
  }

  /** The live artifact of `fn` this check is about (identity: revision, hashes, body). */
  const sameArtifact = (a: Artifact | null | undefined, b: Artifact): boolean =>
    !!a && a.revision === b.revision && a.specHash === b.specHash && a.testsHash === b.testsHash && a.body === b.body;

  /** Run the check for `fn` now (outside the queue). Resolves when it is stored, cancelled or not applicable. */
  async function runMutationNow(fn: string): Promise<void> {
    const rec = headRev().program.functions[fn];
    if (!rec || !isLive(rec)) {
      // regrown, edited or rolled away since it was queued: nothing to check
      if (state.value.mutation?.fn === fn) setMutation(null);
      next();
      return;
    }
    const artifact = rec.artifact!;
    if (isUngated(rec.spec)) {
      await attachMutation(fn, artifact, skippedReport(NO_TESTS_REASON, deps.now()));
      setMutation({ fn, phase: 'done', done: 0, total: 0 });
      next();
      return;
    }
    const ctrl = new AbortController();
    mutRun = { fn, ctrl };
    setMutation({ fn, phase: 'running', done: 0, total: 0 });
    let report: MutationReport;
    let baseline: Evidence | undefined;
    try {
      const r = await mutationReport(rec, ctrl.signal, (done, total) => {
        if (mutRun?.ctrl === ctrl) setMutation({ fn, phase: 'running', done, total });
      });
      report = r.report;
      baseline = r.baseline;
    } catch (e) {
      if (ctrl.signal.aborted || mutRun?.ctrl !== ctrl) return; // cancelled: re-queued by cancelMutation
      report = skippedReport(`${MUTATION_FAILED_PREFIX}${errorText(e)}`, deps.now());
    }
    if (ctrl.signal.aborted || mutRun?.ctrl !== ctrl || disposed) return;
    mutRun = null;
    await attachMutation(fn, artifact, report, baseline);
    setMutation({ fn, phase: 'done', done: report.total, total: report.total });
    next();

    function next(): void {
      if (mutQueue.length > 0) {
        setMutation({ fn: mutQueue[0]!, phase: 'waiting', done: 0, total: 0 });
        scheduleMutation();
      }
    }
  }

  /**
   * Generate up to DEFAULT_MAX_MUTANTS mutants of the artifact's compiled JS and run each against the spec's tests,
   * properties and pins (phases tests + properties; the Invariants gate still reports a bounded/pure violation).
   * Same seed as the gates. An artifact committed before evidence was kept first gets a baseline run of all gates
   * (a kill only means something if the original passes).
   */
  async function mutationReport(
    rec: Program['functions'][string],
    sig: AbortSignal,
    progress: (done: number, total: number) => void,
  ): Promise<{ report: MutationReport; baseline?: Evidence }> {
    const { spec } = rec;
    const artifact = rec.artifact!;
    const seed = gateSeed(rec.specHash, rec.testsHash);
    const tests = deps.transpile(spec.tests);
    const props = deps.transpile(spec.properties);
    if (tests.error) throw new Error(`the spec's tests do not load (${tests.error})`);
    if (props.error) throw new Error(`the spec's properties do not load (${props.error})`);
    const pinned = decodePins(spec, true);
    const common = {
      name: spec.name,
      testsJs: tests.js,
      propertiesJs: props.js,
      seed,
      ...(pinned.length > 0 ? { pinned } : {}),
    };
    let baseline: Evidence | undefined;
    if (!artifact.evidence) {
      const all = await deps.execGates({ ...common, js: artifact.js, budgetMs: spec.budgetMs });
      if (sig.aborted) throw new Aborted();
      const bad = all.find((g) => g.status === 'fail');
      if (bad) throw new Error(`the committed function does not pass its own checks now (${bad.headline ?? bad.summary})`);
      baseline = evidenceOf(all);
    }
    const max = DEFAULT_MAX_MUTANTS;
    // Same seed and max as runMutants below, so the same mutants: only to know the total for the progress line.
    const { mutants } = await generateMutants(artifact.js, { seed, max });
    if (sig.aborted) throw new Aborted();
    const total = mutants.length;
    progress(0, total);
    const budgetMs = Math.min(spec.budgetMs, MUTANT_CALL_BUDGET_MS);
    const boxStart = performance.now();
    let done = 0;
    const runner: MutantRunner = async (js) => {
      if (sig.aborted) throw new Aborted();
      // run.ts checks the time box only between mutants: cap each run so one slow mutant cannot blow it. Hitting the
      // cap is an Invariants `bounded` failure, i.e. "stopped by the time limit" (killed-by-bound), never a pass.
      const left = mutCfg.timeBoxMs - (performance.now() - boxStart);
      const results = await deps.execGates({
        ...common,
        js,
        budgetMs,
        phases: ['tests', 'properties'],
        overallCapMs: Math.max(2 * budgetMs, Math.round(left)),
      });
      if (sig.aborted) throw new Aborted();
      const fate = classifyMutant(results);
      progress(++done, total);
      return fate;
    };
    const report = await runMutants({ js: artifact.js, seed, max, timeBoxMs: mutCfg.timeBoxMs, runner });
    return { report, ...(baseline ? { baseline } : {}) };
  }

  /**
   * Store `report` on every revision whose program holds this exact artifact (same revision, hashes and body): the
   * head and the revision it was committed (or re-certified) in. Synchronous up to the history swap; then persisted.
   */
  async function attachMutation(fn: string, artifact: Artifact, report: MutationReport, baseline?: Evidence): Promise<void> {
    if (!sameArtifact(headRev().program.functions[fn]?.artifact, artifact)) return;
    const changed: Revision[] = [];
    history = history.map((r) => {
      const rec = r.program.functions[fn];
      if (!rec || !sameArtifact(rec.artifact, artifact)) return r;
      const a = rec.artifact!;
      const base: Evidence = a.evidence ?? baseline ?? { compiled: true, unitTests: 0, pinnedTests: 0, properties: [], sampledCalls: 0 };
      const next: Revision = {
        ...r,
        program: { ...r.program, functions: { ...r.program.functions, [fn]: { ...rec, artifact: { ...a, evidence: { ...base, mutation: report } } } } },
      };
      changed.push(next);
      return next;
    });
    publishHistory();
    for (const r of changed) {
      if (deps.store.updateRevision) await deps.store.updateRevision(r);
      else await deps.store.appendRevision(r, head);
    }
  }

  /** The Repo tab's "Re-run mutation check": after queued operations, now, without waiting for idle. */
  async function runMutationPublic(fn: string): Promise<void> {
    await opTail;
    if (disposed) return;
    if (mutRun) {
      const running = mutRun;
      mutRun = null;
      running.ctrl.abort();
      if (running.fn !== fn && !mutQueue.includes(running.fn)) mutQueue.unshift(running.fn);
    }
    const at = mutQueue.indexOf(fn);
    if (at >= 0) mutQueue.splice(at, 1);
    if (mutTimer !== null) clearTimeout(mutTimer);
    mutTimer = null;
    await runMutationNow(fn);
  }

  // ───────────────────────── suggested checks: re-certify ─────────────────────────

  /**
   * Add a suggested property and re-check the COMMITTED artifact against the strengthened spec instead of letting the
   * hash change make it stale: its stored body is recompiled and run through tests, properties (with the new one),
   * pins and invariants with the new spec's seed. Pass → re-certified in place (hashes restamped, evidence
   * recomputed, still live, no restart, no regeneration). Fail → the spec change is applied, the artifact is stale
   * and the gate panel shows the re-check's verdict with its counterexample. Used for nothing else.
   */
  function addSuggestedProperty(fn: string, suggestionId: string): Promise<void> {
    return exclusive('add the check', async () => {
      try {
        const base = headRev().program;
        const rec = base.functions[fn];
        if (!rec) {
          notice('error', `No function named ${fn}`);
          return;
        }
        const suggestion = suggestProperties(rec.spec, base).find((x) => x.id === suggestionId);
        if (!suggestion) {
          notice('error', 'That suggested check no longer applies to the current spec; nothing was added.');
          return;
        }
        const next = appendProperty(rec.spec, suggestion);
        if (next === rec.spec) return;
        const reason = addedCheckReason(suggestion.title);
        if (!isLive(rec)) {
          await applySpec(next, { kind: 'spec-edit', title: `${reason} (no committed function to re-check)` });
          return;
        }
        const artifact = rec.artifact!;
        const { specHash, testsHash } = await hashesFor(next);
        const compiled = await deps.compile(next, artifact.body);
        const tests = deps.transpile(next.tests);
        const props = deps.transpile(next.properties);
        const loadError = tests.error ?? props.error;
        if (loadError) {
          notice('error', `The suggested check does not load (${loadError}); nothing was added.`);
          return;
        }
        let gates: GateResult[];
        if (compiled.gate.status === 'fail' || compiled.js === null) {
          gates = [compiled.gate, notReached('tests'), notReached('properties'), notReached('invariants')];
        } else {
          const pinned = decodePins(next);
          const results = await deps
            .execGates({
              name: fn,
              js: compiled.js,
              testsJs: tests.js,
              propertiesJs: props.js,
              budgetMs: next.budgetMs,
              seed: gateSeed(specHash, testsHash),
              ...(pinned.length > 0 ? { pinned } : {}),
            })
            .catch((e: unknown): GateResult[] => [
              {
                gate: 'tests',
                status: 'fail',
                ms: 0,
                summary: 'gate runner error',
                headline: `Rejected: gate runner error: ${errorText(e)}`,
                diagnostics: [{ kind: 'test', name: '(gate runner)', message: errorText(e), error: errorText(e) }],
              },
            ]);
          gates = [compiled.gate, ...GATE_ORDER.slice(1).map((g) => results.find((r) => r.gate === g) ?? notReached(g))];
        }
        const infra = gates.map(infraFailure).find((x) => x !== null);
        if (infra) {
          notice('error', `Could not re-check ${fn} against the new check (${infra}); nothing was added.`);
          return;
        }
        const failing = gates.find((g) => g.status === 'fail');
        if (!failing) {
          await recertify(fn, next, artifact, compiled, gates, reason, { specHash, testsHash, before: rec.testsHash });
          return;
        }
        // The committed function fails the new check: the spec change stands, the artifact is stale.
        await applySpec(next, { kind: 'spec-edit', title: `${reason}: the committed function fails it`, quiet: true });
        if (state.value.mutation?.fn === fn) setMutation(null);
        const accepted = artifact.candidates[artifact.candidates.length - 1];
        const candidate: Candidate = {
          id: id('c'),
          attempt: 1,
          body: artifact.body,
          notes: '',
          source: accepted?.source ?? 'replay',
          generationMs: 0,
          gates,
          verdict: 'rejected',
          rejectedBy: failing.gate,
          ...(failing.headline ? { headline: failing.headline } : {}),
        };
        set({
          generation: {
            id: id('g'),
            fn,
            signature: declarationLine(next),
            call: `${fn} (committed r${artifact.revision})`,
            phase: 'failed',
            attempt: 1,
            maxAttempts: 1,
            progress: [],
            attempts: [{ attempt: 1, status: 'rejected', shown: artifact.body, gates, candidate }],
            ungated: false,
            mode: generator?.mode ?? state.value.mode,
            kind: 'recheck',
            recheck: { reason },
          },
        });
        info(RECHECK_FAILED_INFO, 'warn');
        log({ kind: 'gate', fn, summary: failing.headline ?? `re-check rejected by ${failing.gate}`, detail: { gate: failing.gate, recheck: true } });
      } catch (e) {
        notice('error', `Adding the check failed: ${errorText(e)}`);
      }
    });
  }

  /** Must run inside `exclusive`: the passing branch of addSuggestedProperty. */
  async function recertify(
    fn: string,
    next: FunctionSpec,
    artifact: Artifact,
    compiled: CompileOutput,
    gates: GateResult[],
    reason: string,
    h: { specHash: Hash; testsHash: Hash; before: Hash },
  ): Promise<void> {
    // withSpec first (it recomputes the record's hashes), then the artifact restamped to those same hashes: live.
    const withRec = await withSpec(headRev().program, next);
    const env = await snapshotEnv();
    const revisionId = (history[history.length - 1]?.id ?? 0) + 1;
    const restamped: Artifact = {
      ...artifact,
      js: compiled.js!,
      source: compiled.source,
      returnType: compiled.returnType,
      specHash: h.specHash,
      testsHash: h.testsHash,
      // the tests changed, so the old mutation report no longer describes them: the check re-runs after idle
      evidence: evidenceOf(gates),
      recertified: [...(artifact.recertified ?? []), { at: deps.now(), revision: revisionId, reason }],
    };
    const rev = newRevision(history, {
      kind: 'recertify',
      title: `${reason}: committed function re-certified`,
      detail: `tests hash ${short(h.before)} → ${short(h.testsHash)} · the artifact committed at r${artifact.revision} passed the strengthened checks; no regeneration`,
      fn,
      program: withArtifact(withRec, fn, restamped),
      env,
      at: deps.now(),
    });
    await commitRevision(rev);
    // still live in the runtime: no restart; redefined only if the recompiled js differs
    if (restamped.js !== artifact.js) await runtime?.define(fn, restamped.js, next.budgetMs);
    info(`${fn}: ${reason}. The committed function passes it: re-certified at r${rev.id}, nothing regenerated.`, 'accent');
    log({ kind: 'spec-edit', fn, summary: rev.title, detail: { revision: rev.id } });
    enqueueMutation(fn);
  }

  // ───────────────────────── service ─────────────────────────

  async function recheckService(): Promise<void> {
    const previous = state.value.service;
    set({ service: { ...previous, state: 'checking' } });
    const status = await deps.probeService().catch((): ServiceStatus => ({ state: 'down' }));
    if (disposed) return;
    if ((status.state === 'up' || status.state === 'degraded') && state.value.mode !== 'live') {
      // Same rule as init: a degraded service is live mode with service.problem, so a failing generate shows the fix.
      generator = deps.createLiveGenerator();
      set({ mode: 'live', service: status, ...(status.state === 'up' ? { notice: { tone: 'info' as const, text: 'Live service connected' } } : {}) });
      return;
    }
    set({ service: status });
  }

  // ───────────────────────── images ─────────────────────────

  async function exportImage(): Promise<string> {
    return JSON.stringify(store.toImage(history, head, referencedContent()), null, 2);
  }

  function importImage(json: string): Promise<void> {
    return exclusive('import an image', () => importImageInner(json));
  }

  async function importImageInner(json: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      notice('error', `Import failed: the file is not JSON (${errorText(e)})`);
      return;
    }
    const checked = store.validateImage(raw);
    if (!checked.ok) {
      notice('error', `Import failed: ${checked.error}`);
      return;
    }
    try {
      const verified = await store.reverify(checked.image);
      // Imported js is never trusted: every live artifact is recompiled from its body (provenance and candidate
      // history are kept); an artifact whose body does not compile is dropped.
      const fresh = await recompileArtifacts(verified.revisions);
      const image = { ...verified, revisions: fresh.revisions };
      const importedHead = image.revisions.find((r) => r.id === image.head)!;
      const previousContent = new Map(content);
      replaceContent(image.datasets);
      const rev = newRevision(image.revisions, {
        kind: 'import',
        title: `Imported image (${plural(image.revisions.length, 'revision')})`,
        program: structuredClone(importedHead.program),
        env: structuredClone(importedHead.env),
        at: deps.now(),
      });
      let lost: string[];
      try {
        lost = await resetRuntime(jsFunctions(rev.program), rev.env);
      } catch (e) {
        content.clear();
        for (const [h, c] of previousContent) content.set(h, c);
        throw e;
      }
      history = [...image.revisions, rev];
      head = rev.id;
      clearMutations();
      publishHistory();
      set({ generation: null });
      await deps.store.clearAll();
      await persistDatasets(); // the rows before the revisions that refer to them
      for (const r of history) await deps.store.appendRevision(r, head);
      await persistFlags();
      await refreshEnv();
      info(`Imported image: ${plural(image.revisions.length, 'revision')}, head r${image.head} restored as r${rev.id}`);
      log({ kind: 'note', summary: `imported an image (${plural(image.revisions.length, 'revision')})`, detail: { revision: rev.id } });
      reportLost(lost);
      notice(fresh.dropped.length > 0 ? 'error' : 'info', `Imported image: ${recompileSummary(fresh)}.`);
    } catch (e) {
      notice('error', `Import failed: ${errorText(e)}`);
      if (runtime) await resetRuntime(jsFunctions(headRev().program), headRev().env).catch(() => undefined);
    }
  }

  function exportRecording(): Recording | null {
    const stamp = new Date(deps.now()).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
    const fns = [...sinkFns];
    const how = sink.sources;
    const title =
      how === 'live' ? `Live session: ${fns.join(', ')}` : how === 'replay' ? `Replayed session: ${fns.join(', ')}` : `Session: ${fns.join(', ')} (live and replayed)`;
    return sink.toRecording({ id: `${fns.join('-') || 'session'}-${stamp}`, title });
  }

  // ───────────────────────── shared recordings ─────────────────────────

  type Prepared = { ok: true; prepared: PreparedRecording } | { ok: false; error: string; hint?: string };

  /** The recording itself: parsed from text, or fetched from the URL the user gave (once; Load re-uses it). */
  async function obtainRecording(input: { text?: string; url?: string }): Promise<FetchResult> {
    if (typeof input.text === 'string') return parseRecordingText(input.text);
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (url !== '') {
      if (fetched && fetched.url === url) return fetched.result;
      const r = await fetchRecording(url, deps.fetchRecording ? { fetchImpl: deps.fetchRecording } : {});
      if (r.ok) fetched = { url, result: r };
      return r;
    }
    return { ok: false, error: 'Nothing to load: choose a recording file, or paste the link to one.' };
  }

  /** null when `encoded` really is rows of hash `hash` within the dataset limits; otherwise why not. */
  async function checkRows(hash: Hash, encoded: Json): Promise<string | null> {
    const canonical = canonicalJson(encoded);
    if (utf8Length(canonical) > DATASET_LIMITS.maxBytes) return `dataset ${short(hash)}: larger than the ${DATASET_LIMITS.maxBytes.toLocaleString('en-US')}-byte limit`;
    if ((await sha256Hex(canonical)) !== hash) return `dataset ${short(hash)}: its rows do not match their hash`;
    const rows = decodeRows(encoded);
    if (!Array.isArray(decodeValueSafe(encoded))) return `dataset ${short(hash)}: not a list of rows`;
    if (rows.length > DATASET_LIMITS.maxRows) return `dataset ${short(hash)}: more than ${DATASET_LIMITS.maxRows.toLocaleString('en-US')} rows`;
    if (!rows.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) return `dataset ${short(hash)}: its rows are not all objects`;
    return null;
  }

  const decodeValueSafe = (encoded: Json): unknown => {
    try {
      return decodeValue(encoded);
    } catch {
      return undefined;
    }
  };

  /** Pins equal (as canonical JSON). */
  const samePins = (a: FunctionSpec, b: FunctionSpec): boolean =>
    canonicalJson((a.pins ?? []) as unknown as Json) === canonicalJson((b.pins ?? []) as unknown as Json);

  /**
   * Check a recording against this program without changing anything: every session's spec must hash to what its
   * candidates were recorded under and have a name that can be grown; every dataset's rows must hash to their
   * content address and fit the limits, and are re-typed from the rows themselves. Never throws.
   */
  async function prepareRecording(input: { text?: string; url?: string; source?: string }): Promise<Prepared> {
    try {
      const got = await obtainRecording(input);
      if (!got.ok) return got.hint ? { ok: false, error: got.error, hint: got.hint } : { ok: false, error: got.error };
      const rec = got.recording;
      const source = recordingSourceName(input);
      const base = headRev().program;
      const skipped: string[] = [];

      const sessions: Recording['sessions'] = [];
      for (const session of rec.sessions) {
        if (session.spec) {
          const reason = notGrowableReason(session.spec.name);
          if (reason) {
            skipped.push(`${session.fn}: ${reason}`);
            continue;
          }
          const h = await hashesFor(session.spec);
          if (h.specHash !== session.specHash || h.testsHash !== session.testsHash) {
            skipped.push(`${session.fn} ("${session.label.slice(0, 60)}"): its spec does not match the hashes its candidates were recorded under`);
            continue;
          }
        }
        sessions.push(session);
      }
      const recording: Recording = { ...rec, sessions };
      const seed = seedFromRecording(recording);

      const verified: Record<Hash, Json> = {};
      for (const [hash, encoded] of Object.entries(seed.datasets)) {
        const problem = await checkRows(hash, encoded);
        if (problem) skipped.push(problem);
        else verified[hash] = encoded;
      }
      const fnNames = new Set([...Object.keys(base.functions), ...seed.specs.map((sp) => sp.name)]);
      const refs: DatasetRef[] = [];
      for (const ref of seed.datasetRefs) {
        const encoded = verified[ref.hash];
        if (encoded === undefined) continue; // already reported
        const bad = validateVariableName(ref.name);
        if (bad) {
          skipped.push(`dataset ${ref.name}: ${bad}`);
          continue;
        }
        if (fnNames.has(ref.name)) {
          skipped.push(`dataset ${ref.name}: a function has that name`);
          continue;
        }
        const built = await buildDataset(ref.name, decodeRows(encoded) as Array<Record<string, unknown>>, {
          source: ref.source,
          typeName: ref.typeName,
          ...(ref.filename !== undefined ? { filename: ref.filename } : {}),
        });
        if ('error' in built) {
          skipped.push(`dataset ${ref.name}: ${built.message}`);
          continue;
        }
        if (built.ref.hash !== ref.hash) {
          skipped.push(`dataset ${ref.name}: its rows do not round-trip to their hash`);
          continue;
        }
        refs.push(built.ref);
      }

      const functions: Extract<RecordingPreview, { ok: true }>['functions'] = [];
      const specs: FunctionSpec[] = [];
      // the session each loaded spec comes from: the first one with a spec, as seedFromRecording picks
      const hashesOf = new Map<string, Recording['sessions'][number]>();
      for (const x of recording.sessions) if (x.spec && !hashesOf.has(x.fn)) hashesOf.set(x.fn, x);
      for (const spec of seed.specs) {
        const names = testNamesOf(spec);
        const mine = base.functions[spec.name];
        const claimed = hashesOf.get(spec.name)!;
        const status =
          !mine ? 'new' : mine.specHash === claimed.specHash && mine.testsHash === claimed.testsHash && samePins(mine.spec, spec) ? 'same' : 'replaces';
        functions.push({ name: spec.name, tests: names.tests.length, properties: names.properties.length, status });
        specs.push(spec);
      }
      for (const session of recording.sessions) {
        if (functions.some((f) => f.name === session.fn)) continue;
        const mine = base.functions[session.fn];
        const names = mine ? testNamesOf(mine.spec) : { tests: [], properties: [] };
        functions.push({ name: session.fn, tests: names.tests.length, properties: names.properties.length, status: 'replay-only' });
      }

      // Sessions that can replay here: their spec comes with them, or the program already holds that exact spec.
      const matches = (session: Recording['sessions'][number]): boolean => {
        const mine = base.functions[session.fn];
        return !!mine && mine.specHash === session.specHash && mine.testsHash === session.testsHash;
      };
      const replayable = recording.sessions.filter((x) => x.spec !== undefined || matches(x)).length;
      let calls = seed.calls.slice(0, MAX_RECORDED_CALLS);
      if (calls.length === 0) {
        // an older recording lists no calls: offer the example call of a function it can replay, when there is one
        const fn = recording.sessions.find((x) => x.spec !== undefined || matches(x))?.fn;
        const ex = fn ? examples.find((e) => e.fn === fn) : undefined;
        if (ex) calls = [ex.call];
      }
      let blocked: string | undefined;
      if (replayable === 0) {
        blocked = seed.canSeed || recording.sessions.length === 0
          ? `Nothing in this recording can be loaded${skipped.length ? `: ${skipped.join('; ')}` : '.'}`
          : 'This is an older recording: it does not carry its specs, and none of its functions match a spec in your program, so it has nothing to replay here. Load the matching example first (if it is one), or ask for a recording saved by a newer version.';
      }
      const title = rec.title.trim() || rec.id.trim() || 'untitled recording';
      const preview: Extract<RecordingPreview, { ok: true }> = {
        ok: true,
        title,
        source,
        summary: seed.summary,
        functions,
        calls,
        datasets: refs.map((r) => ({ name: r.name, rows: r.rowCount, columns: r.columns.length })),
        model: rec.model,
        codexVersion: rec.codexVersion,
        effort: rec.effort,
        recordedAt: rec.recordedAt,
        canSeed: seed.canSeed,
        replayable,
        skipped,
        warning: RECORDING_WARNING,
        ...(blocked ? { blocked } : {}),
      };
      return { ok: true, prepared: { recording, title, source, specs, content: verified, refs, calls, preview } };
    } catch (e) {
      return { ok: false, error: `The recording could not be checked (${errorText(e)}).` };
    }
  }

  async function previewRecording(input: { text?: string; url?: string; source?: string }): Promise<RecordingPreview> {
    const p = await prepareRecording(input);
    return p.ok ? p.prepared.preview : p;
  }

  function loadRecording(input: { text?: string; url?: string; source?: string }): Promise<void> {
    return exclusive('load the recording', async () => {
      const p = await prepareRecording(input);
      if (!p.ok) {
        notice('error', `Could not load the recording: ${p.error}${p.hint ? ` ${p.hint}` : ''}`);
        return;
      }
      const r = p.prepared;
      if (r.preview.blocked) {
        notice('error', r.preview.blocked);
        return;
      }
      const base = headRev().program;
      const changedFns = r.specs.filter((sp) => r.preview.functions.find((f) => f.name === sp.name)?.status !== 'same');
      const changedRefs = r.refs.filter((ref) => base.datasets?.[ref.name]?.hash !== ref.hash);
      let revisionId: number | null = null;
      if (changedFns.length > 0 || changedRefs.length > 0) {
        const previousContent = new Map(content);
        try {
          let program = base;
          for (const spec of changedFns) {
            program = await withSpec(program, spec);
            const before = base.functions[spec.name];
            const after = program.functions[spec.name]!;
            // An artifact that becomes live again under the loaded text is recompiled from its body, never trusted.
            if (after.artifact && isLive(after) && !(before && isLive(before) && before.artifact === after.artifact)) {
              const c = await deps.compile(after.spec, after.artifact.body).catch(() => null);
              program =
                c && c.gate.status !== 'fail' && c.js !== null
                  ? withArtifact(program, spec.name, { ...after.artifact, js: c.js, returnType: c.returnType, source: c.source })
                  : { ...program, functions: { ...program.functions, [spec.name]: { ...after, artifact: null } } };
            }
          }
          for (const ref of changedRefs) program = withDataset(program, ref);
          for (const [h, enc] of Object.entries(r.content)) addContent(h, enc);
          // rows first, then the revision that refers to them
          await deps.store.saveDatasets?.({ ...referencedContent(), ...r.content });
          const fnsBefore = jsFunctions(base);
          const fnsAfter = jsFunctions(program);
          for (const name of Object.keys(fnsBefore)) if (!(name in fnsAfter)) await runtime!.undefine(name);
          for (const [name, f] of Object.entries(fnsAfter)) if (fnsBefore[name]?.js !== f.js) await runtime!.define(name, f.js, f.budgetMs);
          for (const ref of changedRefs) await runtime!.bindDataset(ref.name, ref.hash, decodeRows(r.content[ref.hash]!), ref.typeName);
          const env = await snapshotEnv();
          const parts = [
            changedFns.length > 0 ? `${plural(changedFns.length, 'spec')} (${changedFns.map((x) => x.name).join(', ')})` : null,
            changedRefs.length > 0 ? `${plural(changedRefs.length, 'dataset')} (${changedRefs.map((x) => x.name).join(', ')})` : null,
          ].filter((x): x is string => x !== null);
          const rev = newRevision(history, {
            kind: 'import',
            title: `Loaded recording: ${r.title}`,
            detail: `from ${r.source} · ${parts.join(' · ')} · ${r.recording.model || 'unknown model'}${r.recording.codexVersion ? ` via Codex ${r.recording.codexVersion}` : ''}`,
            program,
            env,
            at: deps.now(),
          });
          await commitRevision(rev);
          revisionId = rev.id;
          await persistDatasets();
          await refreshEnv();
        } catch (e) {
          content.clear();
          for (const [h, c] of previousContent) content.set(h, c);
          notice('error', `Could not load the recording: ${errorText(e)}`);
          if (runtime) await resetRuntime(jsFunctions(headRev().program), headRev().env).catch(() => undefined);
          return;
        }
      }
      // Its candidates replay by hash from now on, ahead of the live service (this page load only).
      loaded = [r.recording, ...loaded];
      loadedReplay = new ReplayGenerator(loaded, { maxMs: pacing.replayMaxMs, sleep: deps.sleep });
      const { recordingOffer: _offer, ...rest } = state.value;
      state.value = {
        ...rest,
        loadedRecording: { title: r.title, source: r.source, calls: r.calls, dismissed: false },
        replInput: r.calls[0] ?? rest.replInput,
        hints: { ...rest.hints, opener: false },
      };
      info(
        `Loaded "${r.title}" from ${r.source}${revisionId !== null ? ` as r${revisionId}` : ' (its specs were already in the program)'}: ${plural(r.preview.replayable, 'recorded session')} will replay${r.calls.length > 0 ? `, ${plural(r.calls.length, 'call')} to run` : ''}. Press Enter to run them one by one; the gates run live in your browser.`,
        'accent',
      );
      log({ kind: 'note', summary: `loaded a recording: ${r.title}`, detail: { source: r.source, sessions: r.recording.sessions.length, calls: r.calls.length, ...(revisionId !== null ? { revision: revisionId } : {}) } });
    });
  }

  function dismissRecordingBanner(): void {
    const lr = state.value.loadedRecording;
    if (lr && !lr.dismissed) set({ loadedRecording: { ...lr, dismissed: true } });
  }

  function dismissRecordingOffer(): void {
    if (!state.value.recordingOffer) return;
    const { recordingOffer: _gone, ...rest } = state.value;
    state.value = rest;
  }

  // ───────────────────────── session log ─────────────────────────

  async function setSessionLogEnabled(on: boolean): Promise<void> {
    try {
      if (!on) log({ kind: 'note', summary: 'session log turned off' });
      await slog.setEnabled(on);
      if (on) log({ kind: 'note', summary: 'session log turned on' });
    } finally {
      await refreshLogState();
    }
  }

  async function clearSessionLog(): Promise<void> {
    await slog.clear();
    await refreshLogState();
  }

  function resetImage(): Promise<void> {
    // Abort first, synchronously: an in-flight grow may only end on abort, and the reset waits for it in the queue.
    // Everything requested before this point is superseded (see `exclusive`).
    epoch++;
    growCtrl?.abort();
    growCtrl = null;
    contexts.clear();
    clearMutations();
    busyCount = 0;
    return exclusive(null, async () => {
      try {
        await deps.store.clearAll();
        const r1 = await seedProgram();
        history = [r1];
        head = 1;
        // the privacy choice (sample rows or the type only) survives a reset; nothing else does
        flags = { takeawayShown: false, openerDismissed: false, ...(flags.sendSamples !== undefined ? { sendSamples: flags.sendSamples } : {}) };
        await deps.store.appendRevision(r1, 1);
        await persistFlags();
        content.clear();
        await deps.store.saveDatasets?.({});
        await runtime?.reset({}, {}, {});
        loaded = [];
        loadedReplay = null;
        publishHistory();
        const { loadedRecording: _lr, recordingOffer: _ro, ...kept } = state.value;
        state.value = kept;
        set({
          repl: [],
          replInput: initialExample()?.call ?? '',
          generation: null,
          env: {},
          busy: busyCount > 0,
          hints: { opener: true, takeaway: false },
          notice: { tone: 'info', text: 'Image reset: r1 reseeded' },
        });
        await refreshEnv();
      } catch (e) {
        set({ busy: busyCount > 0 });
        notice('error', `Reset failed: ${errorText(e)}`);
      }
    });
  }

  function dispose(): void {
    disposed = true;
    epoch++;
    growCtrl?.abort();
    growCtrl = null;
    clearMutations();
    runtime?.dispose();
  }

  return {
    state: state as ReadonlySignal<EngineState>,
    init: () =>
      exclusive(null, async () => {
        try {
          await init();
        } catch (e) {
          // Never leave the UI on the loading screen: surface what failed and stay usable.
          notice('error', `Startup problem: ${errorText(e)}`);
          set({ ready: true });
        }
      }),
    setInput: (text) => set({ replInput: text }),
    submit,
    upsertSpec,
    editSpec,
    breakIt,
    loadExample,
    rollback,
    invokeRestart,
    recheckService,
    exportImage,
    importImage,
    exportRecording,
    resetImage,
    previewDataset,
    loadDataset,
    removeDataset,
    setSendSamples,
    pinResult,
    removePin,
    runMutation: runMutationPublic,
    addSuggestedProperty,
    previewRecording,
    loadRecording,
    dismissRecordingBanner,
    dismissRecordingOffer,
    setSessionLogEnabled,
    exportSessionLog: () => slog.exportJson(),
    clearSessionLog,
    dispose,
  };
}

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
  Candidate,
  Engine,
  EngineState,
  EvalOutcome,
  ExampleInfo,
  FunctionSpec,
  GateId,
  GateResult,
  GenerateError,
  GenerateRequest,
  GenerateResult,
  GenerationView,
  Generator,
  Json,
  Pacing,
  Program,
  Recording,
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
import { runExecutionGates, type ExecGateInput } from '../sandbox/gateRunner';
import { MASKED_NAMES } from '../sandbox/mask';
import { Runtime } from '../sandbox/runtime';
import { gateSeed, hashesFor } from '../shared/hash';
import { buildPrompt, declarationLine, type PromptInput } from '../shared/prompt';
import {
  GenerationFailure,
  LiveGenerator,
  loadBundledRecordings,
  probeService,
  realSleep,
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
  rollbackRevision,
  summarize,
  withArtifact,
  withSpec,
} from './program';
import * as store from './store';

// ───────────────────────── dependency injection ─────────────────────────

/** What the engine needs from an example (src/examples ExampleDef satisfies it structurally). */
export interface EngineExample extends ExampleInfo {
  spec: FunctionSpec;
  breakPatch: SpecPatch;
}

/** The part of sandbox/runtime.ts Runtime the engine uses. */
export type RuntimeLike = Pick<Runtime, 'define' | 'undefine' | 'evaluate' | 'snapshotEnv' | 'envShown' | 'reset' | 'dispose'>;

export interface EngineStore {
  loadPersisted(): Promise<store.Persisted | null>;
  appendRevision(rev: Revision, head: number): Promise<void>;
  saveFlags(flags: store.Persisted['flags']): Promise<void>;
  saveLiveEnv(env: Record<string, Json>): Promise<void>;
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
}

export const DEFAULT_PACING: Pacing = { typeCharMs: 6, gateDwellMs: 450, replayMaxMs: 5000 };

/** Growths allowed per submit (chained unknowns like `f(g(1))`). */
export const MAX_GROWTHS_PER_SUBMIT = 5;
/** Cap on the whole typewriter reveal of one candidate. */
const MAX_TYPING_MS = 2200;
const TYPE_TICK_MS = 30;
/** Uncharged retries per grow for TS7023/7024 (recursion without a declared return type). */
const MAX_FREE_RECURSION_RETRIES = 1;

export const TAKEAWAY_TEXT = "You didn't write this. The model wrote it. Your compiler and tests decided whether to keep it.";
export const RECURSION_HINT =
  'No return type is declared, so a directly recursive body cannot be typed (TS7023). Avoid direct recursion (use a loop), or give any recursive helper inside the body an explicit return type annotation.';

const RESTART: Record<'retryFault' | 'retryGrow' | 'rollback' | 'editSpec' | 'dismiss', RestartOption> = {
  retryFault: { id: 'retry', label: 'Retry with the error fed back', description: 'Ask the model again, showing it this error.' },
  retryGrow: { id: 'retry', label: 'Retry', description: 'Run the grow loop again with a fresh budget.' },
  rollback: { id: 'rollback', label: 'Roll back', description: 'Restore the revision before this function was committed.' },
  editSpec: { id: 'edit-spec', label: 'Edit the spec', description: 'Open the spec in the repo tab.' },
  dismiss: { id: 'dismiss', label: 'Dismiss', description: 'Leave the program as it is.' },
};

const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for function if ' +
    'import in instanceof new null return super switch this throw true try typeof var void while with yield let static ' +
    'implements interface package private protected public await arguments undefined NaN Infinity'
  ).split(' '),
);
const NOT_GROWABLE = new Set<string>([...MASKED_NAMES, 'eval', 'Function']);

function notGrowableReason(name: string): string | null {
  if (NOT_GROWABLE.has(name)) return `${name} is a masked global: programs cannot use it, so it is not generated either`;
  if (RESERVED.has(name) || name in Object.prototype) return `${name} is a reserved name, so it is not generated`;
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return `${name} is not a valid function name`;
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
      clearAll: store.clearAll,
    },
    now: () => Date.now(),
    sleep: realSleep,
    newId: (prefix) => `${prefix}${++idCounter}-${Math.random().toString(36).slice(2, 7)}`,
    pacing: DEFAULT_PACING,
    inputMemory: defaultInputMemory(),
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

/** Context kept per REPL error entry so a restart knows what to do. */
interface RestartContext {
  kind: 'fault' | 'timeout' | 'grow-failed';
  fn: string;
  call: string;
  input: string;
  spec?: FunctionSpec;
  callArgTypes?: string[];
  fault?: { errorName: string; message: string; previousBody: string };
  /** Revision the faulting artifact was committed in. */
  artifactRevision?: number;
}

interface GrowRequest {
  fn: string;
  call: string;
  spec: FunctionSpec;
  callArgTypes?: string[];
  runtimeFault?: PromptInput['runtimeFault'];
}

type GrowResult = { kind: 'committed'; revision: number } | { kind: 'failed' } | { kind: 'aborted' };

// ───────────────────────── engine ─────────────────────────

export type EngineHandle = Engine & {
  /** Abort any in-flight grow and stop the runtime. */
  dispose(): void;
};

export function createEngine(overrides: Partial<EngineDeps> = {}): EngineHandle {
  const deps: EngineDeps = { ...defaultDeps(), ...overrides };
  const pacing = deps.pacing;

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
    busy: false,
    examples: [],
    pacing,
  });

  let history: Revision[] = [];
  let head = 0;
  let flags: store.Persisted['flags'] = { takeawayShown: false, openerDismissed: false };
  let examples: EngineExample[] = [];
  let initialId = '';
  let runtime: RuntimeLike | null = null;
  let generator: Generator | null = null;
  let recordings: Recording[] = [];
  const sink = new RecordingSink();
  const sinkFns = new Set<string>();
  const contexts = new Map<string, RestartContext>();
  let growCtrl: AbortController | null = null;
  /** Bumped by reset/dispose so a superseded async flow stops touching state. */
  let epoch = 0;
  let focusNonce = 0;
  let disposed = false;

  // ── state plumbing ──

  const set = (patch: Partial<EngineState>): void => {
    state.value = { ...state.value, ...patch };
  };
  const pushRepl = (...entries: ReplEntry[]): void => {
    set({ repl: [...state.value.repl, ...entries] });
  };
  const id = (p: string): string => deps.newId(p);
  const notice = (tone: 'info' | 'error', text: string): void => set({ notice: { tone, text } });
  const headRev = (): Revision => history.find((r) => r.id === head) ?? history[history.length - 1]!;
  const rowsOf = (revs: Revision[]): EngineState['revisions'] =>
    revs.map(({ program, env: _env, ...rest }) => ({ ...rest, ...summarize(program) }));

  const publishHistory = (): void => {
    const h = headRev();
    set({ program: h.program, headRevision: h.id, revisions: rowsOf(history) });
  };

  const errorEntry = (name: string, message: string, restarts?: RestartOption[], ctx?: RestartContext): string => {
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

  const setGen = (fnOrPatch: Partial<GenerationView> | ((g: GenerationView) => GenerationView)): void => {
    const g = state.value.generation;
    if (!g) return;
    set({ generation: typeof fnOrPatch === 'function' ? fnOrPatch(g) : { ...g, ...fnOrPatch } });
  };
  const setAttempt = (index: number, patch: Partial<AttemptView>): void => {
    setGen((g) => ({ ...g, attempts: g.attempts.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));
  };

  const persistFlags = (): Promise<void> => deps.store.saveFlags({ ...flags });

  async function commitRevision(rev: Revision): Promise<void> {
    history = [...history, rev];
    head = rev.id;
    publishHistory();
    await deps.store.appendRevision(rev, head);
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

  const initialExample = (): EngineExample | undefined => examples.find((e) => e.id === initialId) ?? examples[0];

  async function seedProgram(): Promise<Revision> {
    const ex = initialExample();
    const program = ex ? await withSpec(emptyProgram(), ex.spec) : emptyProgram();
    const r1 = initialRevision(program);
    return { ...r1, at: deps.now(), title: ex ? `Initial image: ${ex.spec.name} spec, no artifact` : 'Initial image (empty program)' };
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
      history = image.revisions;
      head = image.head;
      flags = { ...persisted.flags };
      liveEnv = persisted.liveEnv;
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
      await runtime.reset(jsFunctions(headRev().program), liveEnv);
    } catch (e) {
      notice('error', `Could not restore the live program (${errorText(e)}); starting with no live functions.`);
      await runtime.reset({}, {}).catch(() => undefined);
    }
    await refreshEnv();

    const ex = initialExample();
    const remembered = persisted ? deps.inputMemory.load() : null;
    set({
      replInput: remembered ?? ex?.call ?? '',
      hints: { opener: !flags.openerDismissed, takeaway: flags.takeawayShown },
      ready: true,
    });
  }

  // ───────────────────────── submit ─────────────────────────

  async function submit(): Promise<void> {
    const s = state.value;
    const text = s.replInput.trim();
    if (!s.ready || s.busy || text === '' || !runtime) return;
    const myEpoch = epoch;
    set({ busy: true, replInput: '' });
    pushRepl({ kind: 'input', id: id('in'), text });
    deps.inputMemory.save(text);
    if (!flags.openerDismissed) {
      flags = { ...flags, openerDismissed: true };
      set({ hints: { ...state.value.hints, opener: false } });
      void persistFlags();
    }
    try {
      await runInput(text, false, myEpoch);
    } catch (e) {
      if (!(e instanceof Aborted) && myEpoch === epoch) errorEntry('InternalError', errorText(e));
    } finally {
      if (myEpoch === epoch) {
        await refreshEnv();
        set({ busy: false });
      }
    }
  }

  /** Evaluate `input`, growing undefined functions (up to MAX_GROWTHS_PER_SUBMIT) and re-evaluating. */
  async function runInput(input: string, grewAlready: boolean, myEpoch: number, lastRevision?: number): Promise<void> {
    let grew = grewAlready;
    let revision = lastRevision;
    let growths = 0;
    for (;;) {
      const outcome = await runtime!.evaluate(input);
      if (myEpoch !== epoch) return;
      if (outcome.kind !== 'undefined-call') {
        reportOutcome(outcome, input, grew, revision);
        return;
      }
      const reason = notGrowableReason(outcome.name);
      if (reason) {
        errorEntry('ReferenceError', `${outcome.name} is not defined (${reason})`);
        return;
      }
      if (growths >= MAX_GROWTHS_PER_SUBMIT) {
        errorEntry('ReferenceError', `${outcome.name} is not defined (stopped after growing ${MAX_GROWTHS_PER_SUBMIT} functions for one input)`);
        return;
      }
      errorEntry('ReferenceError', `${outcome.name} is not defined`);
      info('Generating…', 'accent');
      const rec = state.value.program.functions[outcome.name];
      const spec = rec?.spec ?? specFromCall(outcome.name, outcome.argTypes);
      const result = await grow(
        {
          fn: outcome.name,
          call: outcome.call,
          spec,
          ...(spec.origin === 'call' ? { callArgTypes: outcome.argTypes } : {}),
        },
        input,
        myEpoch,
      );
      if (result.kind !== 'committed') return;
      grew = true;
      revision = result.revision;
      growths++;
    }
  }

  function reportOutcome(outcome: Exclude<EvalOutcome, { kind: 'undefined-call' }>, input: string, grew: boolean, revision?: number): void {
    switch (outcome.kind) {
      case 'value': {
        const cached = !grew && outcome.calls.length > 0;
        const entry: ReplEntry = {
          kind: 'output',
          id: id('out'),
          value: outcome.shown,
          ms: outcome.ms,
          label: grew ? 'generated' : cached ? 'cached artifact' : null,
        };
        if (grew && revision !== undefined) entry.detail = `revision ${revision}`;
        if (cached) {
          const rec = state.value.program.functions[outcome.calls[0]!];
          if (rec?.artifact) entry.detail = `certified r${rec.artifact.revision}`;
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
        const message = `${outcome.call ?? 'call'} exceeded ${n} ms and was terminated; the program was restored`;
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
    const mode = generator?.mode ?? state.value.mode;
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
      ungated: !spec.tests.trim() && !spec.properties.trim(),
      mode,
    };
    set({ generation: view });

    const rejected: PromptInput['history'] = [];
    const candidates: Candidate[] = [];
    let charged = 0;
    let freeRetries = 0;
    let model = '';
    let codexVersion = '';
    const growCtx: RestartContext = { kind: 'grow-failed', fn, call: req.call, input, spec, ...(req.callArgTypes ? { callArgTypes: req.callArgTypes } : {}) };
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
      const genReq: GenerateRequest = { fn, specHash, testsHash, attempt: index, prompt: buildPrompt(promptInput) };

      let result: GenerateResult;
      const t0 = deps.now();
      try {
        if (!generator) throw new GenerationFailure({ code: 'service_unreachable', message: 'No generator is available' });
        result = await generator.generate(
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
      if (state.value.mode === 'live' && result.source === 'live') {
        sink.add(genReq, result, `${fn} — ${spec.doc.trim().slice(0, 40) || 'inferred from a call'}`);
        sinkFns.add(fn);
      }

      // typewriter
      const body = result.body;
      setAttempt(index, { status: 'typing', shown: '' });
      await typeOut(index, body, sig);
      setAttempt(index, { shown: body });

      // gates
      setGen({ phase: 'gating' });
      const gated = await runGates(index, spec, body, specHash, testsHash, sig);
      // TS7023/7024: with no declared return type a directly recursive body cannot be typed. The note travels to
      // the model (formatDiagnosticsForModel prints a failing gate's note) and is shown on the gate row.
      const recursion =
        spec.returns === null &&
        gated.gates[0]!.status === 'fail' &&
        gated.gates[0]!.diagnostics.some((d) => d.kind === 'compile' && (d.code === 7023 || d.code === 7024));
      if (recursion) gated.gates[0] = { ...gated.gates[0]!, note: RECURSION_HINT };
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
        const revision = await commit(req, body, gated.compile, specHash, testsHash, model, codexVersion, candidates, maxAttempts);
        setGen({ phase: 'committed', revision });
        return { kind: 'committed', revision };
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
  ): Promise<number> {
    const { fn, spec } = req;
    const base = headRev().program;
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
    };
    const existing = base.functions[fn];
    const withRec: Program =
      existing && existing.specHash === specHash && existing.testsHash === testsHash && sameSpec(existing.spec, spec)
        ? base
        : await withSpec(base, spec);
    const program = withArtifact(withRec, fn, artifact);
    const env = await snapshotEnv();
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

  function refuseWhileBusy(what: string): boolean {
    if (state.value.busy) {
      notice('error', `Wait for the current call to finish before you ${what}.`);
      return true;
    }
    return false;
  }

  async function applySpec(next: FunctionSpec, opts: { kind: Revision['kind']; title?: string }): Promise<void> {
    const base = headRev().program;
    const before = base.functions[next.name];
    const program = await withSpec(base, next);
    const after = program.functions[next.name]!;
    const specChanged = !before || before.specHash !== after.specHash;
    const testsChanged = !before || before.testsHash !== after.testsHash;
    const hadLive = before ? isLive(before) : false;
    const invalidates = hadLive && !isLive(after);
    if (invalidates) await runtime?.undefine(next.name).catch(() => undefined);
    const env = await snapshotEnv();
    const title =
      opts.title ??
      (before
        ? !specChanged && !testsChanged
          ? `Spec edited: ${next.name} — artifact unaffected`
          : invalidates || (before.artifact && !isLive(after))
            ? `Spec edited: ${next.name} — artifact invalidated`
            : `Spec edited: ${next.name} — no artifact yet`
        : `Spec added: ${next.name} — no artifact yet`);
    const changes: string[] = [];
    if (before && specChanged) changes.push(`spec hash ${short(before.specHash)} → ${short(after.specHash)}`);
    if (before && testsChanged) changes.push(`tests hash ${short(before.testsHash)} → ${short(after.testsHash)}`);
    const rev = newRevision(history, {
      kind: opts.kind,
      title,
      fn: next.name,
      program,
      env,
      at: deps.now(),
      ...(changes.length ? { detail: changes.join(' · ') } : {}),
    });
    await commitRevision(rev);
    if (before) {
      const tail = invalidates
        ? 'artifact invalidated; the next call regenerates'
        : !specChanged && !testsChanged
          ? before.artifact
            ? 'hashes unchanged; the artifact is still valid'
            : 'hashes unchanged'
          : 'no live artifact; the next call generates';
      info(`${next.name}: ${changes.length ? `${changes.join(' · ')} · ` : ''}${tail}`, invalidates ? 'warn' : 'muted');
    }
  }

  async function editSpec(fn: string, patch: SpecPatch): Promise<void> {
    if (refuseWhileBusy('edit a spec')) return;
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

  async function upsertSpec(spec: FunctionSpec): Promise<void> {
    if (refuseWhileBusy('change a spec')) return;
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
  }

  async function loadExample(exampleId: string): Promise<void> {
    const ex = examples.find((e) => e.id === exampleId);
    if (!ex) {
      notice('error', `Unknown example: ${exampleId}`);
      return;
    }
    if (!headRev().program.functions[ex.fn]) {
      if (refuseWhileBusy('load an example')) return;
      try {
        await applySpec(ex.spec, { kind: 'example', title: `Loaded example: ${ex.title}` });
      } catch (e) {
        notice('error', `Loading the example failed: ${errorText(e)}`);
        return;
      }
    }
    set({ replInput: ex.call });
  }

  async function breakIt(exampleId: string): Promise<void> {
    const ex = examples.find((e) => e.id === exampleId);
    if (!ex) {
      notice('error', `Unknown example: ${exampleId}`);
      return;
    }
    if (refuseWhileBusy('break the spec')) return;
    if (!headRev().program.functions[ex.fn]) await loadExample(exampleId);
    await editSpec(ex.fn, ex.breakPatch);
    set({ replInput: ex.call });
  }

  // ───────────────────────── history ─────────────────────────

  async function rollback(target: number): Promise<void> {
    if (refuseWhileBusy('roll back')) return;
    if (!history.some((r) => r.id === target)) {
      notice('error', `There is no revision r${target}`);
      return;
    }
    try {
      const rev = { ...rollbackRevision(history, target), at: deps.now() };
      const fns = jsFunctions(rev.program);
      await runtime!.reset(fns, rev.env);
      await commitRevision(rev);
      set({ generation: null });
      await refreshEnv();
      info(
        `Rolled back to r${target} — restored ${plural(Object.keys(fns).length, 'function')} and ${plural(Object.keys(rev.env).length, 'variable')}`,
      );
    } catch (e) {
      notice('error', `Rollback failed: ${errorText(e)}`);
      await runtime?.reset(jsFunctions(headRev().program), headRev().env).catch(() => undefined);
    }
  }

  async function invokeRestart(entryId: string, restart: RestartId): Promise<void> {
    const entry = state.value.repl.find((e) => e.id === entryId);
    if (!entry || entry.kind !== 'error' || entry.resolved) return;
    const ctx = contexts.get(entryId);
    if (restart !== 'dismiss' && !ctx) return;
    if (restart === 'retry' || restart === 'rollback') {
      if (refuseWhileBusy(restart === 'retry' ? 'retry' : 'roll back')) return;
    }
    const resolve = (): void =>
      set({ repl: state.value.repl.map((e) => (e.id === entryId && e.kind === 'error' ? { ...e, resolved: true } : e)) });
    resolve();
    if (restart === 'dismiss' || !ctx) return;

    if (restart === 'edit-spec') {
      set({ focusSpec: { fn: ctx.fn, nonce: ++focusNonce } });
      return;
    }
    if (restart === 'rollback') {
      const before = ctx.artifactRevision !== undefined ? [...history].reverse().find((r) => r.id < ctx.artifactRevision!) : undefined;
      await rollback(before?.id ?? 1);
      return;
    }
    // retry
    const myEpoch = epoch;
    set({ busy: true });
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
      // A fault/timeout retry feeds the error back; so does re-running a grow that was itself such a retry.
      if (ctx.fault) {
        growReq.runtimeFault = { call: ctx.call, errorName: ctx.fault.errorName, message: ctx.fault.message, previousBody: ctx.fault.previousBody };
      }
      const result = await grow(growReq, ctx.input, myEpoch);
      if (result.kind === 'committed' && myEpoch === epoch) await runInput(ctx.input, true, myEpoch, result.revision);
    } catch (e) {
      if (!(e instanceof Aborted) && myEpoch === epoch) errorEntry('InternalError', errorText(e));
    } finally {
      if (myEpoch === epoch) {
        await refreshEnv();
        set({ busy: false });
      }
    }
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
    return JSON.stringify(store.toImage(history, head), null, 2);
  }

  async function importImage(json: string): Promise<void> {
    if (refuseWhileBusy('import an image')) return;
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
      const image = await store.reverify(checked.image);
      const importedHead = image.revisions.find((r) => r.id === image.head)!;
      const rev = newRevision(image.revisions, {
        kind: 'import',
        title: `Imported image (${plural(image.revisions.length, 'revision')})`,
        program: structuredClone(importedHead.program),
        env: structuredClone(importedHead.env),
        at: deps.now(),
      });
      await runtime!.reset(jsFunctions(rev.program), rev.env);
      history = [...image.revisions, rev];
      head = rev.id;
      publishHistory();
      set({ generation: null });
      await deps.store.clearAll();
      for (const r of history) await deps.store.appendRevision(r, head);
      await persistFlags();
      await refreshEnv();
      info(`Imported image: ${plural(image.revisions.length, 'revision')}, head r${image.head} restored as r${rev.id}`);
    } catch (e) {
      notice('error', `Import failed: ${errorText(e)}`);
      await runtime?.reset(jsFunctions(headRev().program), headRev().env).catch(() => undefined);
    }
  }

  function exportRecording(): Recording | null {
    const stamp = new Date(deps.now()).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
    const fns = [...sinkFns];
    return sink.toRecording({ id: `${fns.join('-') || 'session'}-${stamp}`, title: `Live session: ${fns.join(', ')}` });
  }

  async function resetImage(): Promise<void> {
    epoch++;
    growCtrl?.abort();
    growCtrl = null;
    contexts.clear();
    try {
      await deps.store.clearAll();
      const r1 = await seedProgram();
      history = [r1];
      head = 1;
      flags = { takeawayShown: false, openerDismissed: false };
      await deps.store.appendRevision(r1, 1);
      await persistFlags();
      await runtime?.reset({}, {});
      publishHistory();
      set({
        repl: [],
        replInput: initialExample()?.call ?? '',
        generation: null,
        env: {},
        busy: false,
        hints: { opener: true, takeaway: false },
        notice: { tone: 'info', text: 'Image reset: r1 reseeded' },
      });
      await refreshEnv();
    } catch (e) {
      set({ busy: false });
      notice('error', `Reset failed: ${errorText(e)}`);
    }
  }

  function dispose(): void {
    disposed = true;
    epoch++;
    growCtrl?.abort();
    growCtrl = null;
    runtime?.dispose();
  }

  return {
    state: state as ReadonlySignal<EngineState>,
    init: async () => {
      try {
        await init();
      } catch (e) {
        // Never leave the UI on the loading screen: surface what failed and stay usable.
        notice('error', `Startup problem: ${errorText(e)}`);
        set({ ready: true });
      }
    },
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
    dispose,
  };
}

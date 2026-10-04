/**
 * Shared contract for Undefined. Every module codes against these types.
 * Type-only except the GATE_ORDER constant.
 * See docs/DESIGN.md for what each module owns.
 */
import type { ReadonlySignal } from '@preact/signals';

// ───────────────────────── primitives ─────────────────────────

/** JSON-safe value. Runtime values (bigint, NaN, undefined, Map, Set…) are tagged via shared/serialize.ts. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Lowercase hex SHA-256. */
export type Hash = string;

// ───────────────────────── program model ─────────────────────────

export interface ParamSpec {
  name: string;
  /** TypeScript type text, e.g. `number[]`, `{ id: number; tags: string[] }`. */
  type: string;
}

/** Everything the user (or the runtime, for a never-seen call) says about a function. */
export interface FunctionSpec {
  name: string;
  params: ParamSpec[];
  /** TS return type text. null = no annotation; the compiler infers it and the inferred type is recorded. */
  returns: string | null;
  /** Natural-language contract. The model reads this. */
  doc: string;
  /** TS source for unit tests (see docs/DESIGN.md §Test API). '' = none. */
  tests: string;
  /** TS source for fast-check property tests. '' = none. */
  properties: string;
  /** Bounded invariant: hard wall-clock limit (ms) for ONE call of the candidate. */
  budgetMs: number;
  /** Retry budget: max candidates generated per grow attempt. */
  maxAttempts: number;
  origin: 'call' | 'user' | 'example';
  exampleId?: string;
  /**
   * Tests pinned from real results ("Pin as test"). NOT part of specHash/testsHash: pinning invalidates nothing; pins
   * run against the committed artifact when pinned and make the gate stricter at the next regeneration.
   */
  pins?: Pin[];
  /** Type declarations the signature depends on, e.g. a dataset's `type Row = {…}`. Hashed with the spec. */
  typeDecls?: string;
}

/** A call and its result captured from the REPL, turned into a unit test. */
export interface Pin {
  id: string;
  /** e.g. `topCustomersByRevenue(rows)` */
  label: string;
  args: PinArg[];
  /** Expected result, encoded with shared/serialize.ts. */
  expected: Json;
  pinnedAt: number;
}
export type PinArg = { kind: 'dataset'; name: string; hash: Hash } | { kind: 'value'; encoded: Json };

// ───────────────────────── datasets ─────────────────────────

export interface ColumnInfo {
  name: string;
  /** TypeScript type text for the column, e.g. `number`, `string | null`. */
  type: string;
}

/** A dataset bound to a REPL variable. Rows live once, content-addressed, in Image.datasets[hash]. */
export interface DatasetRef {
  /** REPL variable name, `rows` by default. */
  name: string;
  hash: Hash;
  /** e.g. `Row` */
  typeName: string;
  /** e.g. `type Row = { id: number; customer: string; total: number }` */
  typeDecl: string;
  rowCount: number;
  columns: ColumnInfo[];
  source: 'paste' | 'file' | 'bundled';
  filename?: string;
  /** Size of the encoded rows. */
  bytes: number;
}

/** A spec plus the cached hashes of its current text, plus the certified artifact (if any). */
export interface FunctionRecord {
  spec: FunctionSpec;
  /** sha256 over name, params, returns, doc, budgetMs (shared/hash.ts: specHash). */
  specHash: Hash;
  /** sha256 over tests + properties (shared/hash.ts: testsHash). */
  testsHash: Hash;
  /** null until a candidate has been accepted. Stale iff its hashes differ from the record's. */
  artifact: Artifact | null;
}

export interface Program {
  functions: Record<string, FunctionRecord>;
  /** Datasets bound to REPL variables, by variable name. Absent = none. */
  datasets?: Record<string, DatasetRef>;
}

/** A candidate that passed every gate and was committed. Read-only in the UI; marked generated. */
export interface Artifact {
  /** Function body exactly as returned by the model. */
  body: string;
  /** Full TypeScript that was compiled (wrapper + body). */
  source: string;
  /** Strict-mode JS emitted by the TypeScript compiler; this is what runs in the sandbox. */
  js: string;
  /** Declared return type, or the checker-inferred one when the spec had none. */
  returnType: string;
  // provenance — not reproducibility
  specHash: Hash;
  testsHash: Hash;
  model: string;
  codexVersion: string;
  committedAt: number;
  /** Full candidate history of the grow attempt that produced this artifact, accepted one last. */
  candidates: Candidate[];
  /** Revision id this artifact was committed in. */
  revision: number;
  /** Facts about what actually ran against this artifact (never a score). */
  evidence?: Evidence;
  /** Times the committed artifact was re-run against a strengthened spec and stayed certified. */
  recertified?: Array<{ at: number; revision: number; reason: string }>;
}

export interface Evidence {
  compiled: boolean;
  unitTests: number;
  pinnedTests: number;
  properties: Array<{ name: string; runs: number }>;
  /** Calls replayed on frozen arguments by the Invariants gate. */
  sampledCalls: number;
  mutation?: MutationReport;
}

/** Four buckets, never folded together. Survivors may be equivalent mutants. */
export interface MutationReport {
  total: number;
  /** Failed a unit test or property. */
  killed: number;
  /** Did not return within the bound (an infinite loop is a kill, reported separately). */
  killedByBound: number;
  survived: number;
  /** Mutants that did not compile/parse: not counted as killed. */
  stillborn: number;
  survivors: MutantInfo[];
  ms: number;
  at: number;
  /** Set when mutation testing did not run, e.g. "no tests yet: nothing could kill a mutant". */
  skipped?: string;
}
export interface MutantInfo {
  id: string;
  kind: string;
  /** 1-based line in the artifact source body. */
  line: number;
  original: string;
  mutated: string;
}

export type RevisionKind = 'init' | 'commit' | 'spec-edit' | 'rollback' | 'import' | 'example' | 'delete' | 'recertify' | 'pin' | 'dataset';

/** One numbered, immutable snapshot of the whole program AND its live state. */
export interface Revision {
  id: number;
  at: number;
  kind: RevisionKind;
  /** One-line log title, e.g. "median certified (attempt 2 of 3, rejected by properties first)". */
  title: string;
  detail?: string;
  /** Function the change is about, if any. */
  fn?: string;
  program: Program;
  /** Live state (REPL variables) at this revision, encoded with shared/serialize.ts. */
  env: Record<string, Json>;
  /** For kind 'rollback': the revision whose contents were restored. */
  restoredFrom?: number;
}

/** The exportable/importable whole-program file. */
export interface Image {
  format: 'undefined-image';
  version: 1;
  exportedAt: string;
  head: number;
  revisions: Revision[];
  /** Dataset rows, encoded, content-addressed by hash (Program.datasets refers to them). */
  datasets?: Record<Hash, Json>;
}

// ───────────────────────── gates ─────────────────────────

export type GateId = 'compile' | 'tests' | 'properties' | 'invariants';
export const GATE_ORDER: readonly GateId[] = ['compile', 'tests', 'properties', 'invariants'] as const;
export type GateStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped';

/**
 * Structured diagnostics. These are shown to the human AND serialised for the model
 * (shared/prompt.ts: formatDiagnosticsForModel). All line/col numbers are 1-based and
 * relative to the candidate BODY, not the wrapper (gates/source.ts maps them).
 */
export type Diagnostic =
  | {
      kind: 'compile';
      code: number; // TS diagnostic code, e.g. 2322
      message: string;
      category: 'error' | 'warning';
      line: number;
      col: number;
      endLine: number;
      endCol: number;
      /** The offending source line (trimmed of trailing whitespace). */
      snippet: string;
    }
  | {
      kind: 'test';
      name: string;
      message: string;
      /** Set when the failing check declared that the spec was silent on this: what the spec didn't say. */
      silentOn?: string;
      /** The check author's note on why the candidate's choice was defensible. */
      reasonable?: string;
      /** e.g. `slugify("Crème Brûlée")` — the call that was last made on the candidate. */
      call?: string;
      expected?: string;
      actual?: string;
      /** Thrown error text when the failure was an exception. */
      error?: string;
    }
  | {
      kind: 'property';
      name: string;
      silentOn?: string;
      reasonable?: string;
      /** Call made on the SHRUNK counterexample, e.g. `median([1, 2])`. */
      call?: string;
      /** Shrunk counterexample arguments, shown. e.g. `[[1, 2]]`. */
      counterexample: string;
      expected?: string;
      actual?: string;
      error?: string;
      /** fast-check shrink steps / runs executed / seed — for reproduction. */
      shrinks: number;
      runs: number;
      seed: number;
    }
  | {
      kind: 'invariant';
      invariant: 'pure' | 'bounded';
      message: string;
      call?: string;
      /** which phase was executing: 'tests' | 'properties' | 'invariants' */
      phase?: string;
      budgetMs?: number;
      elapsedMs?: number;
      detail?: string;
    };

export interface GateResult {
  gate: GateId;
  status: GateStatus;
  ms: number;
  /** One line for the gate row: "7/7 tests passed", "3 errors", "no tests yet". */
  summary: string;
  /**
   * On fail: the large, unmissable sentence. e.g. "Rejected: median([1, 2]) returned 1, expected 1.5".
   * Built by the gate that rejected, from its first diagnostic.
   */
  headline?: string;
  diagnostics: Diagnostic[];
  /** Plain explanation for non-pass/fail states, e.g. "no tests yet — add one to make the gate stricter". */
  note?: string;
  /** For gates that count things. */
  counts?: { passed: number; total: number };
}

export type CandidateVerdict = 'accepted' | 'rejected' | 'aborted';

export interface Candidate {
  id: string;
  /** 1-based attempt number within the grow attempt. */
  attempt: number;
  body: string;
  /** The model's one-line notes (schema field `notes`). */
  notes: string;
  source: 'live' | 'replay';
  generationMs: number;
  /** Always 4 entries in GATE_ORDER. Gates after the rejecting one are 'skipped'. */
  gates: GateResult[];
  verdict: CandidateVerdict;
  rejectedBy?: GateId;
  /** The rejecting gate's headline, copied up for the retry strip. */
  headline?: string;
  /** The exact prompt sent to the model for this candidate ("what the model saw"). */
  prompt?: string;
  /** Set when the model declined instead of faking: the candidate body is the decline sentinel, no gate was run. */
  declined?: Declined;
}

/** The model said it cannot honestly write this function (it did not fail a gate). */
export interface Declined {
  /** 'cannot-be-pure': needs randomness, the clock, network, files, or hidden state. 'needs-spec': name and types say too little. */
  reason: 'cannot-be-pure' | 'needs-spec';
  /** The model's one sentence: what it would need / the question it needs answered. */
  message: string;
}

// ───────────────────────── generation ─────────────────────────

export interface ProgressLine {
  /** ms since the request started. */
  t: number;
  text: string;
  channel: 'stderr' | 'event' | 'system';
}

export interface GenerateRequest {
  fn: string;
  specHash: Hash;
  testsHash: Hash;
  /** 0-based attempt index within this grow attempt (replay uses it to pick the recorded candidate). */
  attempt: number;
  /** Full prompt text (shared/prompt.ts builds it in the browser). */
  prompt: string;
}

export interface GenerateResult {
  body: string;
  notes: string;
  model: string;
  codexVersion: string;
  durationMs: number;
  source: 'live' | 'replay';
  progress: ProgressLine[];
}

export type GenerateErrorCode =
  | 'codex_missing'
  | 'not_logged_in'
  | 'timeout'
  | 'bad_output'
  | 'codex_failed'
  | 'service_unreachable'
  | 'no_recording'
  | 'recording_exhausted'
  | 'aborted';

export interface GenerateError {
  code: GenerateErrorCode;
  message: string;
  /** Shell commands / steps the user can run, shown verbatim by the gate panel. */
  fix?: string[];
}

export interface Generator {
  readonly mode: 'live' | 'replay';
  generate(req: GenerateRequest, onProgress: (p: ProgressLine) => void, signal?: AbortSignal): Promise<GenerateResult>;
}

export interface ServiceStatus {
  state: 'checking' | 'up' | 'down' | 'degraded';
  /** Set when state is 'degraded' (service up, codex unusable). */
  problem?: GenerateError;
  codexVersion?: string;
  model?: string;
  effort?: string;
}

// Wire format of the local generation service (server/codexService.ts ⇄ core/generator.ts)
//   GET  /generate/health → ServiceHealth (JSON)
//   POST /generate        body: { prompt: string }  → text/event-stream with events:
//        event: progress  data: ProgressLine
//        event: result    data: GenerateResult (source:'live')
//        event: error     data: GenerateError
export interface ServiceHealth {
  ok: boolean;
  codexVersion?: string;
  model: string;
  effort: string;
  problem?: GenerateError;
}

// Recordings: a live session saved as JSON; replayed with the gates running live.
export interface RecordedAttempt {
  prompt: string;
  body: string;
  notes: string;
  durationMs: number;
  progress: ProgressLine[];
}
export interface RecordedSession {
  fn: string;
  specHash: Hash;
  testsHash: Hash;
  /** v2: the full spec this session was generated against, so a recording can be loaded by someone who lacks it. */
  spec?: FunctionSpec;
  /** v2: dataset rows the session's calls ran over, encoded, by hash. */
  datasets?: Record<Hash, Json>;
  /** v2: dataset bindings (variable name → ref) needed to re-run the calls. */
  datasetRefs?: DatasetRef[];
  /** v2: the REPL inputs that triggered/followed this session, in order. */
  calls?: string[];
  /** Human label, e.g. "median — original spec", "median — after 'break it'". */
  label: string;
  /** Candidates in the order they were generated (index = GenerateRequest.attempt). */
  attempts: RecordedAttempt[];
}
export interface Recording {
  format: 'undefined-recording';
  version: 1 | 2;
  id: string;
  title: string;
  recordedAt: string;
  model: string;
  codexVersion: string;
  effort: string;
  sessions: RecordedSession[];
}

// ───────────────────────── sandbox / runtime ─────────────────────────

/** What a REPL evaluation in the runtime worker produced. */
export type EvalOutcome =
  | {
      kind: 'value';
      /** shared/show.ts rendering of the result. */
      shown: string;
      ms: number;
      /** Committed functions that were called, in order (for the "cached artifact" label). */
      calls: string[];
      /** The real value, encoded; omitted when over the size cap. `shown` is display text and not parseable. */
      encoded?: Json;
      /** Set when the value is an array of plain objects: rendered as a table. */
      table?: TablePreview;
      /** Top-level calls to committed functions, with the real arguments and result (for "Pin as test"). */
      callRecords?: CallRecord[];
    }
  | {
      /** A name in call position that is not defined. The caller grows it, hot-swaps it, and re-evaluates. */
      kind: 'undefined-call';
      name: string;
      /** Real argument values' TS types (shared/inferType.ts) and rendered values. */
      argTypes: string[];
      argShown: string[];
      /** Set when the arguments were reduced to the first one because the call looks like an Array callback (value, index, array). */
      argsTrimmed?: string;
      /** The evaluated argument values, encoded with shared/serialize.ts, so the gates can replay the real call. */
      args: Json[];
      call: string;
    }
  | {
      /** A committed function threw. */
      kind: 'fault';
      fn: string;
      call: string;
      errorName: string;
      message: string;
      stack?: string;
    }
  | { kind: 'error'; errorName: string; message: string }
  /** `lost`: REPL variables that could not be restored after the worker was rebuilt (unserializable values). */
  | { kind: 'timeout'; ms: number; fn?: string; call?: string; lost?: string[] };

export interface TablePreview {
  columns: string[];
  /** Cells rendered with show(); at most 100 rows. */
  rows: string[][];
  total: number;
}

/** One call of a committed function made while evaluating a REPL line. */
export interface CallRecord {
  fn: string;
  call: string;
  /** Datasets appear as PinArg-style references, never as inlined rows. */
  args: PinArg[];
  /** Encoded result; null when it was over the size cap (then the call cannot be pinned). */
  result: Json | null;
}

// ───────────────────────── engine (UI-facing) ─────────────────────────

export interface Pacing {
  /** ms per character when typing a candidate into the code pane. */
  typeCharMs: number;
  /** Minimum time each gate stays "running" so its light is legible. */
  gateDwellMs: number;
  /** Cap on replayed model latency per candidate. */
  replayMaxMs: number;
}

export type RestartId = 'retry' | 'rollback' | 'edit-spec' | 'dismiss';
export interface RestartOption {
  id: RestartId;
  label: string;
  description: string;
}

export type ReplEntry =
  | { kind: 'input'; id: string; text: string }
  | {
      kind: 'output';
      id: string;
      value: string;
      ms: number;
      /** 'cached artifact' (no generation needed) | 'generated' (this call grew the function). */
      label: 'cached artifact' | 'generated' | null;
      /** e.g. "revision 2". */
      detail?: string;
      /** Array-of-objects results render as a table. */
      table?: TablePreview;
      /** The model's one-line note about the function this call just grew (spec-less calls: the only thing that says what it assumed). */
      note?: string;
      /** Present when the call can be pinned as a unit test. */
      pinnable?: { fn: string; call: string; args: PinArg[]; expected: Json };
      /** Set once the pin was made. */
      pinned?: boolean;
    }
  | { kind: 'error'; id: string; name: string; message: string; restarts?: RestartOption[]; resolved?: boolean }
  | { kind: 'info'; id: string; text: string; tone?: 'muted' | 'accent' | 'warn' }
  /** The one-time line shown under the first cached result. */
  | { kind: 'takeaway'; id: string; text: string };

export type AttemptStatus = 'generating' | 'typing' | 'gating' | 'rejected' | 'accepted' | 'aborted';

export interface AttemptView {
  attempt: number;
  status: AttemptStatus;
  /** Body revealed so far (typewriter); equals candidate.body when typing is done. */
  shown: string;
  /** Always 4 entries in GATE_ORDER once gating starts; empty before that. */
  gates: GateResult[];
  candidate?: Candidate;
}

export interface GenerationView {
  id: string;
  fn: string;
  /** TS declaration line, e.g. `function median(numbers: number[]): number`. */
  signature: string;
  /** The call that triggered it, as typed. */
  call: string;
  phase: 'generating' | 'gating' | 'committed' | 'failed';
  attempt: number;
  maxAttempts: number;
  progress: ProgressLine[];
  attempts: AttemptView[];
  /** True when the spec has neither tests nor properties: the UI says so plainly. */
  ungated: boolean;
  /** Set when generation itself failed (codex missing, timeout…) — gate panel shows message + fix. */
  error?: GenerateError;
  /** Set when the model declined to write the function (see Declined). The program is unchanged. */
  declined?: Declined;
  /** Set on commit. */
  revision?: number;
  mode: 'live' | 'replay';
}

export interface ExampleInfo {
  id: string;
  title: string;
  blurb: string;
  /** Pre-typed REPL call. */
  call: string;
  fn: string;
  breakIt: { label: string; description: string };
}

export interface EngineState {
  ready: boolean;
  mode: 'live' | 'replay';
  service: ServiceStatus;
  program: Program;
  headRevision: number;
  /** Newest last. */
  revisions: Array<Omit<Revision, 'program' | 'env'> & { fns: number; artifacts: number }>;
  repl: ReplEntry[];
  /** Current text of the REPL input (pre-typed on load). */
  replInput: string;
  /** Last or in-flight grow attempt, shown in code pane / gate panel / retry strip. */
  generation: GenerationView | null;
  /** The REPL variables right now (shown values). */
  env: Record<string, string>;
  hints: { opener: boolean; takeaway: boolean };
  busy: boolean;
  examples: ExampleInfo[];
  pacing: Pacing;
  /** Set by the 'edit-spec' restart: the UI switches to the Repo tab and focuses this function's spec. */
  focusSpec?: { fn: string; nonce: number };
  /** Transient message for the UI (import failed, etc.). */
  notice?: { tone: 'info' | 'error'; text: string };
}

export interface SpecPatch {
  params?: ParamSpec[];
  returns?: string | null;
  doc?: string;
  tests?: string;
  properties?: string;
  budgetMs?: number;
  maxAttempts?: number;
}

export interface Engine {
  readonly state: ReadonlySignal<EngineState>;
  /** Load persisted image (or seed r1), probe the service, choose live/replay, pre-type the opener. */
  init(): Promise<void>;
  setInput(text: string): void;
  /** REPL Enter. */
  submit(): Promise<void>;
  /** Create (or replace) a function spec from the user; counts as a revision. */
  upsertSpec(spec: FunctionSpec): Promise<void>;
  editSpec(fn: string, patch: SpecPatch): Promise<void>;
  /** Apply an example's "break it" edit. */
  breakIt(exampleId: string): Promise<void>;
  loadExample(exampleId: string): Promise<void>;
  /** Restore revision `id` (functions + live state) as a NEW head revision. */
  rollback(id: number): Promise<void>;
  invokeRestart(entryId: string, restart: RestartId): Promise<void>;
  /** Re-probe the generation service (the "run live" button). */
  recheckService(): Promise<void>;
  exportImage(): Promise<string>;
  importImage(json: string): Promise<void>;
  /** Everything generated live this session as a Recording (null when nothing was generated live). */
  exportRecording(): Recording | null;
  /** Discard persisted state and reseed r1. */
  resetImage(): Promise<void>;
}

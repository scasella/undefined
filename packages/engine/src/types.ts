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
  /**
   * Rulings the user made where a check said the spec was silent ("Decide", docs/DECIDE-DESIGN.md). Each adds a
   * generated test (and may waive the check it answers on its silent domain). Part of testsHash ONLY when non-empty;
   * an empty list is never stored (the field is removed), so a spec without decisions hashes exactly as before.
   */
  decisions?: Decision[];
}

// ───────────────────────── decisions (spec gaps the user ruled on) ─────────────────────────

/** What kind of input the spec was silent on, worked out from the counterexample (decide/gaps.ts classifyGap). */
export type GapKind = 'empty' | 'non-finite' | 'negative' | 'non-integer' | 'duplicates' | 'non-ascii' | 'symbols' | 'other';

/** One outcome of a call; `returns` holds the shared/serialize.ts ENCODED value (so NaN, -0, undefined survive JSON). */
export type Outcome = { returns: Json } | { throws: true };

/** Which check a decision answers, and what the check said the spec was silent on. */
export interface DecisionAnswers {
  check: string;
  checkKind: 'test' | 'property';
  silentOn: string;
  gate: 'tests' | 'properties';
}

export type DecisionRuling =
  /** A value or "throws": picked from the alternatives, or a typed expression whose value encoded cleanly. */
  | { kind: 'outcome'; outcome: Outcome; label: string }
  /** A typed expression kept as source (relational, or a value that does not encode): always waiving, never replays. */
  | { kind: 'expr'; expr: string; label: string };

export interface Decision {
  /** Content-derived, unique within the spec. */
  id: string;
  kind: GapKind;
  /** Display text of the call, e.g. `median([])`. */
  call: string;
  /** ENCODED arguments of that exact call (the generated test is built from these, never from `call`). */
  args: Json[];
  ruling: DecisionRuling;
  /** Where the generated source goes. Hashed. */
  placement: 'tests' | 'properties';
  /** Set for a rule ruling (placement 'properties'): its domain in words and the parameter, e.g. `every negative n`. */
  rule?: { phrase: string; param: string };
  answers: DecisionAnswers;
  /** The ruling disagrees with what the answered check expects: that check is waived on its silent domain. Hashed. */
  waives: boolean;
  /** The generated test source, stored verbatim and hashed verbatim (never regenerated from the other fields). */
  test: string;
  /** ms since epoch. NOT hashed. */
  decidedAt: number;
  /** Free text. NOT hashed, never sent to the model. */
  reason?: string;
}

/** A check switched off on its silent domain by a disagreeing decision (decide/decisions.ts effectiveChecks). */
export interface WaivedCheck {
  kind: 'test' | 'property';
  name: string;
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
  /**
   * Other generated functions this body calls (docs/COMPOSE-DESIGN.md §A3), each stamped with the implementation it
   * was certified against: compose/graph.ts closureHash of that function's artifact (its implHash, combined with its own
   * stamps when it calls others) and the revision it was committed in.
   * Direct dependencies only (the closure is derived). ABSENT when the body calls no other function, so an artifact
   * of a program without dependencies is byte-identical to one written before composition existed.
   */
  deps?: Record<string, DepStamp>;
}

/** What a dependent was certified against: the callee's closureHash (source + return type + its own stamps) and its commit revision. */
export interface DepStamp {
  hash: Hash;
  revision: number;
}

export interface Evidence {
  compiled: boolean;
  unitTests: number;
  pinnedTests: number;
  properties: Array<{ name: string; runs: number }>;
  /** Calls replayed on frozen arguments by the Invariants gate. */
  sampledCalls: number;
  mutation?: MutationReport;
  /** Unit tests (included in unitTests) that came from the user's decisions. Absent when 0. */
  decisions?: number;
  /** Properties (included in properties) that came from the user's rule decisions. Absent when 0. */
  decisionProperties?: number;
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
  /**
   * 1-based line in the COMPILED JS function body (mutation/mutate.ts), not in the TypeScript the model wrote: the
   * emitter reflows code, so show it as "compiled line N".
   */
  line: number;
  original: string;
  mutated: string;
}

export type RevisionKind = 'init' | 'commit' | 'spec-edit' | 'rollback' | 'import' | 'example' | 'delete' | 'recertify' | 'pin' | 'dataset' | 'decision';

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
  /**
   * 3 when some artifact calls another generated function (Artifact.deps: an older build could not link it); else 2
   * when some revision holds decisions (older builds reject it instead of silently dropping them); else 1.
   */
  version: 1 | 2 | 3;
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
  | ({
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
    } & DecideFields)
  | ({
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
    } & DecideFields)
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

/**
 * Optional facts on a failing test/property diagnostic that let the user rule on a spec gap ("Decide"). Set by the
 * gate executor ONLY when the check carries an applying silentOn marker and the failure is about one exact call
 * (it returned the wrong value, or it threw). All ENCODED (shared/serialize.ts), so they survive JSON storage. They
 * never reach the model (prompt.ts prints named display fields only) and are not hashed.
 */
export interface DecideFields {
  /** Encoded arguments of `call`, cloned before the call (the candidate could mutate them). */
  args?: Json[];
  /** What the check wanted at that call. */
  expectedOutcome?: Outcome;
  /** What the candidate did at that call. */
  actualOutcome?: Outcome;
  /** Alternatives the check itself declared (opt-in marker option `alternatives`), already evaluated and encoded. */
  alternatives?: Array<{ label: string; outcome: Outcome }>;
  /**
   * Set on a marked PROPERTY whose marker has no `when`: it claims silence on every input, so a waiver would switch
   * the whole property off. Such a check can only be ruled on with an answer that agrees with it (gapQuestion, decide).
   */
  everyInput?: true;
  /** Encoded raw values of an eq() failure, independent of the call (the "type your own" probe reads these). */
  actualValue?: Json;
  expectedValue?: Json;
}

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
  /**
   * Set only when the spec has decisions and every one of them agrees with the checks it answers ("implied"): the
   * testsHash of the same spec without its decisions. Replay tries the exact key first, then this one, so an implied
   * ruling still replays the session recorded before the decision existed. The live generator ignores it.
   */
  fallbackTestsHash?: Hash;
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
  /**
   * v2, optional: who generated THIS session's candidates, when it differs from the recording's top-level fields (a
   * shared session that mixes candidates replayed from someone else's recording with ones generated live here).
   * Replay uses them in place of the top-level model/codexVersion/effort.
   */
  model?: string;
  codexVersion?: string;
  effort?: string;
  /** Human label, e.g. "median — original spec", "median — after 'break it'". */
  label: string;
  /** Candidates in the order they were generated (index = GenerateRequest.attempt). */
  attempts: RecordedAttempt[];
}
export interface Recording {
  format: 'undefined-recording';
  /** 3 only when some session's spec carries decisions; 2 when any session carries a v2 field; else 1. */
  version: 1 | 2 | 3;
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
      /** Per argument: the name of the dataset variable it IS (identity), or null. The engine types it as `<typeName>[]`. */
      argDatasets?: Array<string | null>;
      /** The evaluated argument values, encoded with shared/serialize.ts, so the gates can replay the real call. */
      args: Json[];
      call: string;
      /**
       * Set when the call came from inside a committed function (a dependency with no runnable code: the dependent is
       * "waiting" for it). `call` is still the dependency's own call with its real arguments.
       */
      calledBy?: string;
    }
  | {
      /** A committed function threw. */
      kind: 'fault';
      fn: string;
      call: string;
      errorName: string;
      message: string;
      stack?: string;
      /** Set when `fn` was called by another committed function (blame is shared; the message names both). */
      calledBy?: string;
    }
  | {
      kind: 'error';
      errorName: string;
      message: string;
      /**
       * Set only when the unit did not compile (the runtime's own SyntaxError, raised before any of it ran). Never set
       * for an error the code threw, whatever its name or message: the engine re-splits a line only on this flag.
       */
      parse?: true;
    }
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

// ───────────────────────── composition (UI-facing) ─────────────────────────

/** One direct dependency of a committed function, as the Repo shows it (compose/graph.ts dependencyStatus). */
export interface DependencyView {
  name: string;
  /** Revision of the callee's artifact the dependent was certified against, and its closureHash then. */
  certifiedRevision: number;
  certifiedHash: Hash;
  /** The callee's current artifact (null: no artifact, or it is out of date with its own spec). */
  nowRevision: number | null;
  nowHash: Hash | null;
  /**
   * 'current': same implementation and runnable; 'changed': a different implementation is certified now; 'missing':
   * no runnable code (spec edited, never grown, removed); 'waiting': same implementation, but it waits on its own deps.
   */
  state: 'current' | 'changed' | 'missing' | 'waiting';
  /** For 'missing': why, in words (e.g. "its spec changed at r9"). */
  why?: string;
}

/**
 * Derived (never stored) dependency status of a committed, own-live function:
 * - 'none': it calls no other generated function (or has no live artifact: own staleness says the rest);
 * - 'current': every callee is runnable and is the implementation it was certified against;
 * - 'changed': some callee's implementation changed since certification: it is NOT run until it is re-checked;
 * - 'waiting': some callee (directly or further down) has no runnable code: it runs, and reaching that callee grows it.
 */
export type DependencyStatus =
  | { kind: 'none' }
  | { kind: 'current'; calls: DependencyView[] }
  | { kind: 'changed'; calls: DependencyView[] }
  | { kind: 'waiting'; calls: DependencyView[]; waitingFor: string[] };

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
  /**
   * Other generated functions this draft calls, as the compile gate found them (CompileOutput.deps). UI-only (not
   * persisted with the candidate); absent when it calls none.
   */
  uses?: string[];
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
  /**
   * 'recheck': no model was asked; a COMMITTED artifact was re-run against a strengthened spec (a check added after
   * the commit) and failed it. One attempt holding the four gate results of that re-check. Absent = 'grow'.
   */
  kind?: 'grow' | 'recheck';
  /**
   * Set when kind is 'recheck'. `decision`: the re-check was of a decision the user made after the commit (the UI
   * says so instead of the added-check line); absent for an added suggested check.
   */
  recheck?: {
    reason: string;
    decision?: { id: string; call: string };
    /**
     * Set when the re-check was because functions it calls changed since it was certified (composition): their names,
     * and `what` in words ("slugify changed r4 → r7"). The UI says that instead of the added-check line.
     */
    callees?: { names: string[]; what: string };
  };
  /** Set on a grow started because the committed function failed a decision ("re-growing against your decision"). */
  decision?: { id: string; call: string };
  /**
   * Replay mode, a call on the user's own data with no recorded draft for it (error.code 'no_recording'): the gate
   * panel says writing it needs live mode and offers the recorded orders example instead. No attempt was made.
   */
  needsLive?: { reason: 'data'; datasets: string[] };
}

// ───────────────────────── deciding a spec gap (UI-facing) ─────────────────────────

/**
 * Where a "spec was silent" diagnostic lives. The first form points into PERSISTED state (an artifact's candidate
 * history in revision `revision`), so it survives reloads, imports and rollbacks; the second carries the diagnostic
 * of a grow that committed nothing (its candidates are only in the GenerationView).
 */
export type GapRef =
  | { fn: string; revision: number; candidate: number; gate: GateId; index: number }
  | { fn: string; diagnostic: Diagnostic };

/** Where an alternative comes from (shown as a small tag). Never the model as a proposer. */
export type AlternativeSource = 'tests' | 'candidate' | 'common' | 'declared';

export interface GapAlternative {
  /** Stable within the question: 'tests', 'candidate', 'throws', 'nan', 'zero', 'undefined', 'declared-0', … */
  id: string;
  /** Shown text of the ruling: `NaN`, `throws`, `"dont-stop"`. */
  label: string;
  source: AlternativeSource;
  /** Absent for a relational (rule) alternative. */
  outcome?: Outcome;
  /** Relational alternatives: `same as median([2])` (unit test eq(f(x), f(floor x))). */
  relational?: { args: Json[]; label: string };
  /** Set when shown but not selectable, with the reason. */
  disabled?: string;
  /** True when choosing it agrees with what the failing check expects (adds a test, waives nothing). */
  agrees: boolean;
}

/** Everything the Decide card shows for one gap (decide/gaps.ts gapQuestion; never model-written). */
export interface GapQuestion {
  fn: string;
  kind: GapKind;
  /** `median([])` */
  call: string;
  /** Encoded args of the call. */
  args: Json[];
  silentOn: string;
  reasonable?: string;
  check: { name: string; kind: 'test' | 'property'; gate: 'tests' | 'properties' };
  /** What your check expected / what the candidate did, as shown text (`NaN`, `threw Error: …`). */
  expectedShown: string;
  actualShown: string;
  alternatives: GapAlternative[];
  /** Rule scope is offered (single number/bigint parameter and a rule kind): `for every negative n`. */
  ruleScope?: { label: string };
  /** A decision already ruled on this exact call (deciding again replaces it). */
  existing?: string;
  /**
   * Set when only a ruling that agrees with the check can be taken (a property marked silent on EVERY input: replacing
   * it for one call would switch it off everywhere). The text says why; disagreeing alternatives are disabled.
   */
  onlyAgreeing?: string;
}

export type DecideChoice = { alternative: string } | { expr: string } | { throws: true };

export interface DecideOptions {
  /** 'rule' places a property for every input of the gap's kind (only when GapQuestion.ruleScope is set). */
  scope?: 'call' | 'rule';
  reason?: string;
}

/** What the "type your own" line shows before Confirm (Engine.previewExpectation). */
export type ExpectationPreview =
  | { ok: true; shown: string; outcome?: Outcome; mentionsFn: boolean }
  | { ok: false; error: string };

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
  /**
   * What the first screen leads with. 'data' (live mode, a fresh or untouched browser, no `?opener=`, and the user has
   * not chosen examples): the data drop card is primary, examples sit under it and the console starts empty.
   * 'examples' otherwise (always in replay mode): the example-first opening with the median call pre-typed.
   */
  start: 'examples' | 'data';
  /** Datasets bound to REPL variables (data drawer). */
  datasets: DatasetRef[];
  /** What leaves the browser. `samples` = type + a few sample rows go to Codex (live mode only); false = type only. */
  send: { samples: boolean; sampleRows: number };
  busy: boolean;
  examples: ExampleInfo[];
  pacing: Pacing;
  /** Set by the 'edit-spec' restart: the UI switches to the Repo tab and focuses this function's spec. */
  focusSpec?: { fn: string; nonce: number };
  /** Transient message for the UI (import failed, etc.). */
  notice?: { tone: 'info' | 'error'; text: string };
  /**
   * The lazy mutation check of a committed function: 'waiting' for the program to be idle, 'running' (done of total
   * broken copies checked), 'done' (the report is on the artifact's evidence). Absent when nothing is scheduled.
   */
  mutation?: { fn: string; phase: 'waiting' | 'running' | 'done'; done: number; total: number };
  /**
   * A recording the user loaded (Load a recording / drop / `?recording=`): its candidates are replayed by hash, even
   * when the live service is up. `calls` are its REPL inputs; `dismissed` hides the banner (the recording stays loaded).
   */
  loadedRecording?: { title: string; source: string; calls: string[]; dismissed: boolean };
  /**
   * A recording named by `?recording=<url>` at boot, fetched and validated but NOT loaded: the UI asks first
   * (loadRecording to accept, dismissRecordingOffer to decline). Nothing ever runs without that click.
   */
  recordingOffer?: { url: string; source: string; preview: RecordingPreview };
  /** The opt-in local session log (off by default; never transmitted). */
  sessionLog?: { enabled: boolean; count: number; status: 'memory' | 'indexeddb' | 'failed' };
  /**
   * Another tab of this app (same origin, same stored program) answered on the tabs channel: edits in two tabs
   * overwrite each other. `dismissed` hides the banner for this page load.
   */
  otherTab?: { dismissed: boolean };
}

/** What loading a recording would do, shown before anything is loaded (Engine.previewRecording). */
export type RecordingPreview =
  | {
      ok: true;
      title: string;
      /** Where it came from: a file name or the URL's host. */
      source: string;
      /** One plain sentence (share/source.ts seedFromRecording). */
      summary: string;
      /**
       * Functions it carries. `status`: 'new' (added), 'same' (your spec is identical), 'replaces' (your spec of that
       * name is replaced, its artifact goes stale), 'replay-only' (no spec in the recording: replays only if you
       * already have the exact spec).
       */
      functions: Array<{ name: string; tests: number; properties: number; status?: 'new' | 'same' | 'replaces' | 'replay-only' }>;
      /** The recorded REPL inputs, in order (pre-typed one at a time; never run without Enter). */
      calls: string[];
      datasets: Array<{ name: string; rows: number; columns: number }>;
      model: string;
      codexVersion: string;
      effort: string;
      recordedAt: string;
      /** The recording carries specs (version 2), so it can seed an empty program. */
      canSeed: boolean;
      /** Recorded sessions whose spec matches (or will match after loading) what the program holds. */
      replayable: number;
      /** Sessions or datasets that will not be loaded, each with the reason. */
      skipped: string[];
      /** Set when nothing in it can be used here; Load is not offered. */
      blocked?: string;
      /** "This recording contains code written by someone else: …" (engine RECORDING_WARNING). */
      warning: string;
    }
  | { ok: false; error: string; hint?: string };

/**
 * What importing a program image would do, worked out without changing anything (Engine.previewImage). Importing
 * REPLACES the current program: `current` is what would be replaced.
 */
export type ImagePreview =
  | {
      ok: true;
      /** Revisions in the file, and functions / bound datasets at its head. */
      revisions: number;
      functions: number;
      datasets: number;
      /** The file's own `exportedAt` (as written; not checked to be a date). */
      exportedAt: string;
      /** The program it would replace. */
      current: { revisions: number; functions: number };
    }
  | { ok: false; error: string };

/** Result of parsing pasted/dropped data before it is loaded (drives the data drawer preview). */
export type DatasetPreview =
  | {
      ok: true;
      name: string;
      rowCount: number;
      columns: ColumnInfo[];
      typeName: string;
      typeDecl: string;
      bytes: number;
      warnings: string[];
      /** Exactly the text that would be sent to Codex as sample rows (live mode, samples on). */
      sampleText: string;
      /** Plain-English sentence: what leaves the browser. */
      sendDescription: string;
      /** First rows rendered as a table. */
      table: TablePreview;
      /** Up to three first calls to try on it, from its column types (apps/site/src/data/suggest.ts; no model asked). */
      suggestions?: DataSuggestion[];
    }
  | { ok: false; error: string };

/** A suggested first call on a loaded dataset, e.g. `countByStatus(sales)`: a function whose name says what it returns. */
export interface DataSuggestion {
  fn: string;
  call: string;
  /** What it returns, in words ("how many rows per status"). */
  what: string;
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
  /** Check an image file and say what importing it would replace. Changes nothing. Never throws. */
  previewImage(json: string): Promise<ImagePreview>;
  /** Replace the whole program with the image (the UI asks first: previewImage). */
  importImage(json: string): Promise<void>;
  /**
   * Every generation this session as a Recording: candidates generated live, and candidates replayed from a
   * recording (kept verbatim, with that recording's model/codexVersion/effort). null when nothing was generated.
   */
  exportRecording(): Recording | null;
  /** Discard persisted state and reseed r1. */
  resetImage(): Promise<void>;
  /** Parse data without loading it (CSV or JSON/JSONL text). Never throws. */
  previewDataset(input: { text: string; filename?: string; name?: string }): Promise<DatasetPreview>;
  /** Bind a dataset to a REPL variable (default name `rows`); a revision of kind 'dataset'. Errors become a notice. */
  loadDataset(input: { text: string; filename?: string; name?: string; source?: DatasetRef['source'] }): Promise<void>;
  removeDataset(name: string): Promise<void>;
  /** Whether sample rows (not just the type) are sent to Codex in live mode. */
  setSendSamples(on: boolean): void;
  /** Switch what the first screen leads with, and remember the choice (flags.start). */
  setStart(start: 'examples' | 'data'): void;
  /** Turn the call and result of a REPL output entry into a pinned unit test on that function. */
  pinResult(entryId: string): Promise<void>;
  removePin(fn: string, pinId: string): Promise<void>;
  /** Run the mutation check of `fn`'s committed artifact now (the Repo tab's "Re-run" button). */
  runMutation(fn: string): Promise<void>;
  /**
   * Append a suggested property (suggest/suggest.ts id) to `fn`'s spec and re-check the COMMITTED artifact against
   * it: passing re-certifies it in place (no regeneration); failing leaves it stale and shows the counterexample.
   */
  addSuggestedProperty(fn: string, suggestionId: string): Promise<void>;
  /**
   * The Decide card's content for a "spec was silent" diagnostic: the call, what the check expected, what the
   * candidate did, and the alternatives (fixed table + the check's own answer + the candidate's observed answer +
   * whatever the check declared). null when the diagnostic cannot be decided (no marker, no exact call, an argument
   * that cannot be serialised, or the function is gone). Pure; changes nothing.
   */
  gapQuestion(ref: GapRef): GapQuestion | null;
  /**
   * Rule on the gap: the ruling becomes a generated test (and, when it disagrees with the check, a waiver of that
   * check on its silent domain), the spec's tests hash changes, and the committed function is re-checked in place:
   * re-certified when it already satisfies the ruling, otherwise re-grown with the ruling in the prompt (in replay
   * mode a ruling the recorded checks did not imply says it needs live mode). Problems become a notice.
   */
  decide(ref: GapRef, choice: DecideChoice, opts?: DecideOptions): Promise<void>;
  /** Remove a decision; the committed function is re-checked against the weaker spec (or revalidated if stale). */
  removeDecision(fn: string, decisionId: string): Promise<void>;
  /** Evaluate a typed expectation in the gate worker (same mask as tests). Never throws. */
  previewExpectation(fn: string, expr: string): Promise<ExpectationPreview>;
  /**
   * Re-check a committed function whose dependency changed ("out of date", compose/graph.ts dependencyStatus kind
   * 'changed'): its unchanged body is compiled and gated against the dependencies as they are now. Pass → re-certified
   * in place (no model asked); fail → it stays out of date and the gate panel shows why; the next call regrows it.
   * A function that is not out of date is left alone (a notice says so).
   */
  recheck(fn: string): Promise<void>;
  /** Fetch (a user-supplied URL) or parse (dropped/picked text) a recording and say what loading it would do. Never throws. */
  previewRecording(input: { text?: string; url?: string; source?: string }): Promise<RecordingPreview>;
  /**
   * Load it: its specs and datasets become ONE revision of kind 'import', its candidates replay by hash (ahead of the
   * live service), its first call is pre-typed. Runs nothing. Problems become a notice; the program is unchanged.
   */
  loadRecording(input: { text?: string; url?: string; source?: string }): Promise<void>;
  /** Hide the "Replaying a recorded session" banner (the recording stays loaded). */
  dismissRecordingBanner(): void;
  /** Decline the `?recording=` offer (nothing is loaded). */
  dismissRecordingOffer(): void;
  /** Hide the "open in another tab" banner for this page load. */
  dismissOtherTabBanner(): void;
  /** Turn the local session log on or off (off keeps the entries until clearSessionLog). */
  setSessionLogEnabled(on: boolean): Promise<void>;
  /** The log as JSON (format 'undefined-session-log'), for the user to download. */
  exportSessionLog(): Promise<string>;
  clearSessionLog(): Promise<void>;
}

/**
 * Pure view-models of the first run (`#/start`), derived from REAL engine state plus the session's own record of the
 * run it started (docs/FRONT-DOOR.md honesty rule 1: nothing here is scripted). No DOM, no engine calls, no timers.
 *
 *   matchRun(state, run)          which generation / REPL entries belong to the run the page started
 *   outcomeOf(state, run, match)  what happened: running, committed, cached, thrown out, stopped (a question only you
 *                                 can answer), it said no, no recording (replay), service problem, runtime error
 *   traceView(...)                CheckTrace props (model/lanes.ts, used exactly as it documents)
 *   answerView(...)               AnswerCard props (model/answer.ts + model/assumptions.ts)
 *   lockInfo / pinFor             is the shown answer locked (ReplEntry.pinned), and which pin unlocks it
 *   agreementFor(...)             "Your agreement" (model/agreement.ts agreementOf), seeded or real
 *   telemetryOf(...)              how many check lanes really ran and the real gate time (state.ts recordChecks)
 *   versionLine(state)            the honesty bar's `Version N · 5 Oct 2026`
 */
import type {
  Artifact,
  AttemptView,
  Candidate,
  Diagnostic,
  EngineState,
  FunctionRecord,
  FunctionSpec,
  GapRef,
  GenerateError,
  GenerationView,
  Json,
  Pin,
  Program,
  ReplEntry,
} from '@scasella/undefined-engine/types';
import { DECIDED_PREFIX, decisionsOf } from '@scasella/undefined-engine/decide/decisions';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { canonicalJson } from '../../data/dataset';
import { leadSummary, shapeAnswer, type AnswerView, type OutputEntry } from '../model/answer';
import {
  assumptionsFromNote,
  checkedList,
  checkFactsFrom,
  dataFacts,
  hasAgreement,
  noteFor,
  notCheckedList,
  ruleTexts,
  type AssumptionList,
  type CheckFacts,
  type DataFacts,
} from '../model/assumptions';
import { agreementOf, emptyAgreement, lockedHelp, type AgreementView, type CheckMode } from '../model/agreement';
import { HOUSE_RULES } from '../model/agreements';
import {
  factsFromSpec,
  footerFor,
  ghostFromAttempts,
  headerFor,
  liveLanes,
  liveTextFor,
  type GhostView,
  type HeaderView,
  type LaneFacts,
  type LaneView,
  type RunFlag,
} from '../model/lanes';
import { headVersion } from '../state';

export type ErrorEntry = Extract<ReplEntry, { kind: 'error' }>;

// ───────────────────────── the run ─────────────────────────

/** What the session remembers about one ask (or one decide), taken just before it reached the engine. */
export interface RunRef {
  /** Increments per run of this session. */
  id: number;
  origin: 'ask' | 'decide';
  questionId: string;
  fn: string;
  /** The REPL call, e.g. `topCustomersByRevenue(orders)`. */
  call: string;
  /** state.generation?.id before the run: a generation with another id is this run's. */
  genBefore: string | null;
  /** state.repl.length before the run: this run's entries come after it. */
  replBefore: number;
  /** True until engine.submit()/decide() resolved (covers the moment before the engine has published anything). */
  pending: boolean;
}

export interface RunMatch {
  /** This run's generation (a new id, same function), or null (none started: cached, failed early, or not yet). */
  generation: GenerationView | null;
  /** The answer: the last output entry of this run. */
  output: OutputEntry | null;
  /** The last error entry of this run (a fault, a syntax error, the grow's failure line). */
  error: ErrorEntry | null;
}

/** This run's generation and entries. Entries pushed before the run (replBefore) are never this run's. */
export function matchRun(state: Pick<EngineState, 'generation' | 'repl'>, run: RunRef | null): RunMatch {
  if (!run) return { generation: null, output: null, error: null };
  const g = state.generation;
  const generation = g && g.id !== run.genBefore && g.fn === run.fn ? g : null;
  let output: OutputEntry | null = null;
  let error: ErrorEntry | null = null;
  // a reset empties the REPL: nothing of this run is left
  const entries = state.repl.length >= run.replBefore ? state.repl.slice(run.replBefore) : [];
  let inputSeen = run.origin === 'decide';
  for (const e of entries) {
    if (e.kind === 'input') {
      // a second input (the decide's follow-up ask, or a later run) starts after this one's answer
      if (inputSeen && output) break;
      inputSeen = true;
      continue;
    }
    if (e.kind === 'output') output = e;
    else if (e.kind === 'error') error = e;
  }
  return { generation, output, error };
}

export type RunOutcome =
  | { kind: 'idle' }
  | { kind: 'running' }
  /** A new answer: the function was written and passed every check this run. */
  | { kind: 'committed' }
  /** Answered by a function already certified: nothing was written or checked again. */
  | { kind: 'cached' }
  /** Every draft was thrown out. `recordedOut`: replay ran out of recorded drafts before one passed. */
  | { kind: 'thrown-out'; recordedOut: boolean }
  /** The last draft failed a check that says your rules are silent there: a question only you can answer. */
  | { kind: 'stopped'; ref: GapRef; diagnostic: Diagnostic }
  /** It says no (GenerationView.declined): the model would not fake it. */
  | { kind: 'declined'; reason: 'cannot-be-pure' | 'needs-spec'; message: string }
  /**
   * Replay mode: nothing recorded for this exact question (GenerationView.needsLive / error no_recording). `onData`:
   * the engine's needsLive 'data' (the call ran on a bound dataset, sample or not; whether it is the user's own file
   * is the session's to say). `message` is the engine's own sentence.
   */
  | { kind: 'no-recording'; onData: boolean; message: string }
  /** Live mode: the writing service failed (codex missing, not logged in, timeout…): `error.fix` are commands to run. */
  | { kind: 'service'; error: GenerateError }
  /** The call itself failed (a fault in the function, a timeout, a syntax error): the error entry. */
  | { kind: 'error'; name: string; message: string };

const SERVICE_CODES = new Set(['codex_missing', 'not_logged_in', 'service_unreachable', 'codex_failed', 'timeout', 'bad_output', 'aborted']);

/** The rejecting diagnostic of the last draft that carries `silentOn` (the very object in state: GapRef needs identity). */
export function silentDiagnostic(gen: GenerationView | null): Diagnostic | null {
  const a = gen?.attempts[gen.attempts.length - 1];
  if (!a || a.status !== 'rejected') return null;
  for (const g of a.gates) {
    if (g.status !== 'fail') continue;
    for (const d of g.diagnostics) if ((d.kind === 'test' || d.kind === 'property') && d.silentOn !== undefined) return d;
  }
  return null;
}

/**
 * What happened to the run. `canDecide(ref)` is engine.gapQuestion(ref) !== null (the controller passes it in): a
 * silent check that cannot be ruled on (no exact call) reads as thrown out, not as a question.
 */
export function outcomeOf(state: Pick<EngineState, 'busy'>, run: RunRef | null, m: RunMatch, canDecide: (ref: GapRef) => boolean = () => true): RunOutcome {
  if (!run) return { kind: 'idle' };
  const gen = m.generation;
  if (m.output) {
    // a decide's re-grow is followed by a plain ask that hits the new artifact: that is still this run's new answer
    if (gen && gen.phase === 'committed') return { kind: 'committed' };
    if (!gen && m.output.label === 'cached artifact') return { kind: 'cached' };
    if (!gen) return { kind: 'cached' };
  }
  if (gen && (gen.phase === 'generating' || gen.phase === 'gating')) return { kind: 'running' };
  if (gen && gen.phase === 'failed') {
    if (gen.declined) return { kind: 'declined', reason: gen.declined.reason, message: gen.declined.message };
    const err = gen.error;
    if (gen.needsLive || err?.code === 'no_recording') {
      return { kind: 'no-recording', onData: !!gen.needsLive && gen.needsLive.reason === 'data', message: err?.message ?? '' };
    }
    const d = silentDiagnostic(gen);
    if (d) {
      const ref: GapRef = { fn: gen.fn, diagnostic: d };
      if (canDecide(ref)) return { kind: 'stopped', ref, diagnostic: d };
    }
    if (err?.code === 'recording_exhausted') return { kind: 'thrown-out', recordedOut: true };
    if (err && SERVICE_CODES.has(err.code)) return { kind: 'service', error: err };
    if (err) return { kind: 'service', error: err };
    return { kind: 'thrown-out', recordedOut: false };
  }
  if (run.pending || state.busy) return { kind: 'running' };
  if (gen && gen.phase === 'committed') return { kind: 'committed' };
  if (m.error) return { kind: 'error', name: m.error.name, message: m.error.message };
  return { kind: 'idle' };
}

export const SETTLED_KINDS: ReadonlySet<RunOutcome['kind']> = new Set(['committed', 'cached', 'thrown-out', 'stopped', 'declined', 'no-recording', 'service', 'error']);

/** The CheckTrace run flag for an outcome. */
export function runFlag(o: RunOutcome): RunFlag {
  if (o.kind === 'idle') return 'idle';
  if (o.kind === 'running') return 'running';
  if (o.kind === 'stopped') return 'held';
  return 'done';
}

// ───────────────────────── the certified function (cached answers) ─────────────────────────

export function acceptedOf(artifact: Artifact | null | undefined): Candidate | null {
  if (!artifact) return null;
  for (let i = artifact.candidates.length - 1; i >= 0; i--) if (artifact.candidates[i]!.verdict === 'accepted') return artifact.candidates[i]!;
  return null;
}

/**
 * A cached answer ran no check this time. The trace shows what the function was certified with: its accepted draft's
 * real gate results, as a committed one-draft generation (no ghosts: nothing was drafted now).
 */
export function certifiedGeneration(rec: FunctionRecord, call: string, mode: 'live' | 'replay'): { generation: GenerationView; attempt: AttemptView } | null {
  const art = rec.artifact;
  const cand = acceptedOf(art);
  if (!art || !cand) return null;
  const attempt: AttemptView = { attempt: cand.attempt, status: 'accepted', shown: cand.body, gates: cand.gates, candidate: cand };
  const generation: GenerationView = {
    id: `certified:${art.revision}`,
    fn: rec.spec.name,
    signature: '',
    call,
    phase: 'committed',
    attempt: cand.attempt,
    maxAttempts: rec.spec.maxAttempts,
    progress: [],
    attempts: [attempt],
    ungated: rec.spec.tests.trim() === '' && rec.spec.properties.trim() === '',
    mode,
    revision: art.revision,
  };
  return { generation, attempt };
}

// ───────────────────────── the check trace ─────────────────────────

/** The spec the trace / agreement is about: the program's, else the seed about to be installed, else none. */
export function effectiveSpec(program: Pick<Program, 'functions'>, fn: string | null, pendingSeed: FunctionSpec | null): FunctionSpec | null {
  if (!fn) return null;
  return program.functions[fn]?.spec ?? (pendingSeed && pendingSeed.name === fn ? pendingSeed : null);
}

const NO_SPEC: Pick<FunctionSpec, 'tests' | 'properties' | 'pins' | 'decisions'> = { tests: '', properties: '', pins: [] };

/**
 * Lane facts: from the spec, with the committed function's evidence once it has answered. Before any evidence the
 * counts lanes.ts leaves unknown are read from the spec's own source (the names of its tests and properties, as
 * model/agreement.ts lists them), so the ready trace says 'Matches your 6 examples' like the rail does.
 */
export function laneFacts(spec: FunctionSpec | null, artifact: Artifact | null, question: string): LaneFacts {
  const pins = spec?.pins ?? [];
  const pinLabel = pins.length === 1 ? (leadSummary(pins[0]!.expected, question) ?? undefined) : undefined;
  const f = factsFromSpec(spec ?? NO_SPEC, artifact?.evidence ?? null, pinLabel);
  if (!spec || artifact?.evidence) return f;
  const authored = (src: string): number => listTestNames(src).filter((n) => !n.startsWith(DECIDED_PREFIX)).length;
  return {
    ...f,
    examples: f.examples ?? authored(spec.tests),
    houseRules: f.houseRules ?? authored(spec.properties) + decisionsOf(spec).length,
  };
}

/** The function's artifact is live for its current spec (engine isLive): a call is answered from it, nothing re-run. */
function isOnFile(rec: FunctionRecord): boolean {
  return rec.artifact !== null && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash;
}

/** The run ended before any draft existed (no recording, it said no, the service failed): nothing was checked. */
const NOTHING_DRAFTED: ReadonlySet<RunOutcome['kind']> = new Set(['no-recording', 'declined', 'service']);
export const FOOTER_NOTHING_DRAFTED = 'Nothing was checked: there was no draft to check, so no answer is shown.';
export const LIVE_NOTHING_DRAFTED = 'Not run: there was no draft to check. No answer is shown.';
export const LIVE_DECLINED = 'It said no. Nothing was checked. No answer is shown.';
/** A cached answer: the lanes are the function's certificate; nothing ran now. */
export const cachedMeta = (secs: string): string => `checked when it was written${secs ? ` · ${secs}` : ''} · nothing re-run`;
export const LIVE_CACHED = 'Answered by a version that already passed these checks. Showing the answer.';

export interface TraceInput {
  state: Pick<EngineState, 'program' | 'mutation' | 'mode'>;
  run: RunRef | null;
  match: RunMatch;
  outcome: RunOutcome;
  /** Short label (`Top 5 customers by revenue`) and the question in words. */
  label: string;
  question: string;
  file: string;
  rows: number;
  fn: string | null;
  pendingSeed: FunctionSpec | null;
}

export interface TraceView {
  lanes: LaneView[];
  ghost: GhostView[];
  header: HeaderView;
  footer: { text: string; meta: string };
  liveText: string;
  run: RunFlag;
  /** The answer came from a function certified earlier: these lanes are its certificate, nothing ran now. */
  cached: boolean;
  facts: LaneFacts;
}

/** CheckTrace props from real state (model/lanes.ts, as documented there). */
export function traceView(t: TraceInput): TraceView {
  const { outcome } = t;
  const rec = t.fn ? (t.state.program.functions[t.fn] ?? null) : null;
  const spec = effectiveSpec(t.state.program, t.fn, t.pendingSeed);
  const run = runFlag(outcome);
  const cached = outcome.kind === 'cached';
  let generation = t.match.generation;
  let attempt: AttemptView | null = null;
  if (cached && rec) {
    const c = certifiedGeneration(rec, t.run?.call ?? '', t.state.mode);
    if (c) {
      generation = c.generation;
      attempt = c.attempt;
    }
  }
  // evidence only for an answer the function gave (committed now, or certified earlier)
  const answered = outcome.kind === 'committed' || cached;
  const artifact = answered ? (rec?.artifact ?? null) : null;
  // the answer a call would get without writing anything: it was checked with the locks that existed then, not with
  // one set afterwards (pins are outside the hashes), so the idle lanes must not promise to run it
  const onFile = rec && isOnFile(rec) ? rec.artifact : null;
  const base = laneFacts(spec, artifact, t.question);
  const facts: LaneFacts = onFile?.evidence ? { ...base, pinsChecked: onFile.evidence.pinnedTests } : base;
  const mutationReport = artifact?.evidence?.mutation ?? null;
  const lanes = liveLanes({
    generation,
    ...(attempt ? { attempt } : {}),
    facts,
    mutation: t.state.mutation,
    mutationReport,
    ...(t.fn ? { fn: t.fn } : {}),
    run,
  });
  const ghost = cached ? [] : ghostFromAttempts(run === 'idle' ? null : generation, facts, attempt);
  const header = headerFor({ question: t.label, file: t.file, rows: t.rows, generation, ...(attempt ? { attempt } : {}), lanes, run });
  let footer = footerFor(lanes, header);
  let liveText = liveTextFor(header, lanes);
  // lanes.ts words these as a thrown-out run ('real run nothing checked'); no draft was ever written
  if (NOTHING_DRAFTED.has(outcome.kind) && (generation?.attempts.every((a) => a.gates.every((g) => g.status === 'skipped' || g.status === 'pending')) ?? true)) {
    footer = { text: FOOTER_NOTHING_DRAFTED, meta: '' };
    liveText = outcome.kind === 'declined' ? LIVE_DECLINED : LIVE_NOTHING_DRAFTED;
  }
  if (cached) {
    footer = { ...footer, meta: cachedMeta(header.right) };
    liveText = LIVE_CACHED;
  }
  return { lanes, ghost, header, footer, liveText, run, cached, facts };
}

// ───────────────────────── telemetry ─────────────────────────

const RAN = new Set(['passed', 'failed', 'stopped']);

/**
 * The checks that really ran in a generation: lanes 01–05 that reached a result, summed over every draft (each
 * draft's gates really ran), and the real gate time (sum of GateResult.ms). Lane 06 (the stress test) runs later,
 * on its own: the controller adds it when state.mutation reports done.
 */
export function telemetryOf(gen: GenerationView | null, facts: LaneFacts): { checks: number; ms: number } {
  if (!gen) return { checks: 0, ms: 0 };
  let checks = 0;
  let ms = 0;
  for (const a of gen.attempts) {
    if (a.gates.length === 0) continue;
    const lanes = liveLanes({ generation: gen, attempt: a, facts, run: 'done' }).slice(0, 5);
    checks += lanes.filter((l) => RAN.has(l.state)).length;
    ms += a.gates.reduce((s, g) => s + (Number.isFinite(g.ms) ? g.ms : 0), 0);
  }
  return { checks, ms };
}

// ───────────────────────── the answer card ─────────────────────────

/** AnswerCard's held captions (the strings are AnswerCard.tsx's; not imported: that module pulls in CSS). */
export const HELD_START = 'Held until every check passes. Ask to start the checks.';
export const HELD_RUNNING = 'Held until every check passes.';
export const HELD_WAITING = 'Waiting on you. No new answer is shown until you decide.';
export const HELD_THROWN_OUT = 'No draft passed every check, so no answer is shown.';
export const HELD_DECLINED = 'It said no, so no answer is shown.';
export const HELD_NOTHING_RAN = 'Nothing was checked, so no answer is shown.';

/** The board's honest message for a question with no recorded answer (V3-Door-FirstRun 101). */
export const NO_RECORDING_OWN =
  'In this demo, answers are recorded, so questions about your own file need the version on your computer. Try a sample file for now.';

/**
 * The no-recording sentence. Own file: the board's words. A sample question with no recording for these checks: say
 * that, and name a question that does have an answer here (or say it needs the version on your computer).
 */
export function noRecordingText(ownData: boolean, other: { label: string } | null): string {
  if (ownData && !other) return NO_RECORDING_OWN;
  const head = ownData
    ? 'In this demo, answers are recorded, so questions about your own file need the version on your computer.'
    : 'In this demo, answers are recorded, and this question has no recorded answer with these checks, so it needs the version on your computer.';
  return other ? `${head} “${other.label}” has one: try it.` : head;
}

/** What was counted, in the design's words, only when the house rules say so (the seeded agreement's two rules). */
export function countedFor(spec: FunctionSpec | null): string | undefined {
  if (!spec) return undefined;
  const text = spec.properties + '\n' + (spec.decisions ?? []).map((d) => d.ruling.label).join('\n');
  return HOUSE_RULES.every((r) => text.includes(JSON.stringify(r.name))) ? 'paid orders only, each order number once' : undefined;
}

export interface AnswerInput {
  state: Pick<EngineState, 'program' | 'mutation' | 'busy'>;
  match: RunMatch;
  outcome: RunOutcome;
  fn: string | null;
  question: string;
  fileName: string;
  rowCount: number | null;
  data: DataFacts | null;
  /** The no-recording sentence (noRecordingText), when the outcome is no-recording. */
  noRecording?: string;
  /** state.mode: what a lock can promise (a new version is only written, and so checked against it, in live mode). */
  mode?: CheckMode;
}

export interface AnswerProps {
  view: AnswerView | null;
  held: boolean;
  heldCaption: string;
  /** 'full' when the answer was checked against an agreement (examples, a locked answer or house rules RAN); else 'basic'. */
  level: 'full' | 'basic';
  locked: boolean;
  /**
   * The lock button's confirmation when the answer is locked and either was checked with basic checks only, or this is
   * replay ('' otherwise: the card's own words). Replay says plainly that the demo cannot re-run with the lock or write
   * a later version (model/agreement.ts lockedHelp); live full checks keep the card's "Every later version…".
   */
  lockHelp: string;
  /** The answer can be locked / unlocked now (a pinnable result, engine idle). */
  canLock: boolean;
  assumptions: AssumptionList;
  checked: string[];
  notChecked: string[];
  facts: CheckFacts;
}

export function heldCaptionFor(o: RunOutcome, noRecording?: string): string {
  switch (o.kind) {
    case 'idle':
      return HELD_START;
    case 'running':
      return HELD_RUNNING;
    case 'stopped':
      return HELD_WAITING;
    case 'thrown-out':
      return HELD_THROWN_OUT;
    case 'declined':
      return HELD_DECLINED;
    case 'no-recording':
      return noRecording || o.message || HELD_NOTHING_RAN;
    case 'service':
    case 'error':
      return HELD_NOTHING_RAN;
    default:
      return HELD_RUNNING;
  }
}

export function answerView(a: AnswerInput): AnswerProps {
  const rec = a.fn ? (a.state.program.functions[a.fn] ?? null) : null;
  const shown = (a.outcome.kind === 'committed' || a.outcome.kind === 'cached') && a.match.output !== null;
  const out = shown ? a.match.output : null;
  const artifact = shown ? (rec?.artifact ?? null) : null;
  const spec = rec?.spec ?? null;
  const mutationDone = !(a.state.mutation && a.fn && a.state.mutation.fn === a.fn && a.state.mutation.phase !== 'done');
  const facts = checkFactsFrom({ artifact, spec, question: a.question, mutationDone });
  const view = out
    ? shapeAnswer(out, {
        question: a.question,
        fileName: a.fileName,
        rowCount: a.rowCount,
        revision: artifact?.revision ?? null,
        ...(a.fn ? { callName: a.fn } : {}),
        ...(countedFor(spec) ? { counted: countedFor(spec)! } : {}),
      })
    : null;
  const level = hasAgreement(facts) ? 'full' : 'basic';
  const locked = !!out?.pinned;
  return {
    view,
    held: !out,
    heldCaption: heldCaptionFor(a.outcome, a.noRecording),
    level,
    locked,
    lockHelp: lockedHelp({ locked, level, mode: a.mode ?? 'live', noun: view?.kind === 'ranked' ? 'list' : 'answer' }),
    canLock: !!out?.pinnable && !a.state.busy,
    assumptions: assumptionsFromNote(noteFor(out?.note, artifact)),
    checked: out ? checkedList(facts) : [],
    notChecked: notCheckedList({
      fileName: a.fileName,
      question: a.question,
      facts,
      data: a.data,
      decisions: spec?.decisions ?? [],
      rules: ruleTexts(spec),
      // what the user has set now: a lock added after this answer was checked is not "nothing set"
      ...(a.fn && rec ? { set: agreementOf(a.state.program, a.fn).n } : {}),
    }),
    facts,
  };
}

// ───────────────────────── locking ─────────────────────────

/** The pin on `fn` that holds exactly this result (label, args and expected compared canonically), if any. */
export function pinFor(program: Pick<Program, 'functions'>, entry: OutputEntry | null): Pin | null {
  const p = entry?.pinnable;
  if (!p) return null;
  const pins = program.functions[p.fn]?.spec.pins ?? [];
  const args = canonicalJson(p.args as unknown as Json);
  const expected = canonicalJson(p.expected);
  return pins.find((x) => x.label === p.call && canonicalJson(x.args as unknown as Json) === args && canonicalJson(x.expected) === expected) ?? null;
}

export interface LockInfo {
  locked: boolean;
  /** engine.pinResult(entryId) locks it. */
  entryId: string | null;
  /** engine.removePin(fn, pinId) unlocks it. */
  pin: { fn: string; id: string } | null;
}

export function lockInfo(program: Pick<Program, 'functions'>, entry: OutputEntry | null): LockInfo {
  const pin = pinFor(program, entry);
  return {
    locked: !!entry?.pinned || pin !== null,
    entryId: entry?.pinnable ? entry.id : null,
    pin: pin && entry?.pinnable ? { fn: entry.pinnable.fn, id: pin.id } : null,
  };
}

// ───────────────────────── agreement, version ─────────────────────────

/**
 * "Your agreement" for the selected question's function: the program's real spec, or the seed that is being
 * installed (shown at once, 'Saved with this demo file…'), or empty for a spec-less question.
 */
export function agreementFor(program: Program, fn: string | null, pendingSeed: FunctionSpec | null, seeded: boolean): AgreementView {
  if (!fn) return emptyAgreement();
  if (program.functions[fn]) return agreementOf(program, fn, { seeded });
  if (pendingSeed && pendingSeed.name === fn) {
    const preview: Program = { ...program, functions: { ...program.functions, [fn]: { spec: pendingSeed, specHash: '', testsHash: '', artifact: null } } };
    return agreementOf(preview, fn, { seeded: true });
  }
  return emptyAgreement();
}

/** `Version 4 · 5 Oct 2026`: the head revision and its day, from real state. */
export function versionLine(state: Pick<EngineState, 'headRevision' | 'revisions'>, now?: number): string {
  const v = headVersion(state, now);
  return `Version ${v.version} · ${v.date}`;
}

/** DataFacts of the bound rows (memo-free; the controller caches it per dataset). */
export function factsOfRows(rows: ReadonlyArray<Record<string, unknown>> | null): DataFacts | null {
  return rows ? dataFacts(rows) : null;
}

/** The latest REPL output of `fn` anywhere in the transcript (e.g. to restore the answer after a reload). */
export function lastOutputOf(repl: readonly ReplEntry[], fn: string): OutputEntry | null {
  for (let i = repl.length - 1; i >= 0; i--) {
    const e = repl[i]!;
    if (e.kind === 'output' && e.pinnable?.fn === fn) return e;
  }
  return null;
}


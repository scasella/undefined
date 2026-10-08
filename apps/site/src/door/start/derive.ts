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
import { signal } from '@preact/signals';
import { DECIDED_PREFIX, decisionsOf } from '@scasella/undefined-engine/decide/decisions';
import { listTestNames } from '@scasella/undefined-engine/shared/specInfo';
import { canonicalJson } from '../../data/dataset';
import { leadSummary, shapeAnswer, type AnswerView, type OutputEntry } from '../model/answer';
import {
  assumptionsFromNote,
  checkedAsk,
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
import { agreementOf, emptyAgreement, lockedHelp, SEEDED_LOCK_NOTE, type AgreementView, type CheckMode } from '../model/agreement';
import { HOUSE_RULES, SEEDED_PIN_ID } from '../model/agreements';
import { sampleOpeningQuestion } from '../model/questions';
import type { SampleId } from '../model/samples';
import {
  factsFromSpec,
  footerFor,
  ghostFromAttempts,
  headerFor,
  liveLanes,
  liveTextFor,
  sealWords,
  type GhostView,
  type HeaderView,
  type LaneFacts,
  type LaneView,
  type RunFlag,
} from '../model/lanes';
import { headVersion } from '../state';
import { RECORDED_SAMPLE_FILE } from './startView';

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
  /**
   * Checking. `stress` is set when only the stress test is left: the other checks passed (or the answer was certified
   * earlier) but the stress test is still to come, so the answer, its seal and its lists are held until it has finished.
   */
  | { kind: 'running'; stress?: StressWait }
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

/** The stress test the run is waiting for: where it is, and whether the answer itself was certified earlier (nothing re-ran). */
export interface StressWait {
  phase: 'waiting' | 'running';
  cached: boolean;
}

/**
 * How long a run waits for its stress test before it stops waiting and says plainly that the stress test didn't run.
 * The engine finishes in a few seconds (it starts after a short idle, runs for at most six seconds); this is only the
 * valve so an answer is never held for good.
 */
export const STRESS_PATIENCE_MS = 60_000;

/**
 * Answers (their output entry ids) whose run stopped waiting for the stress test (RunPanel.tsx, after STRESS_PATIENCE_MS):
 * they release with the stress test marked "didn't run", and nothing that arrives later changes them. A signal, so the
 * session's computed views recompute when it changes.
 */
export const stressGaveUp = signal<ReadonlySet<string>>(new Set());
export function giveUpOnStress(outputId: string): void {
  if (!stressGaveUp.peek().has(outputId)) stressGaveUp.value = new Set([...stressGaveUp.peek(), outputId]);
}
const gaveUpOn = (output: OutputEntry | null): boolean => !!output && stressGaveUp.value.has(output.id);

/** The stress test of this run's function is still waiting or running in the engine (state.mutation): hold the answer. */
function stressWait(state: Pick<EngineState, 'mutation'>, run: RunRef, output: OutputEntry | null, cached: boolean): StressWait | null {
  const m = state.mutation;
  if (!m || m.fn !== run.fn || m.phase === 'done' || gaveUpOn(output)) return null;
  return { phase: m.phase, cached };
}

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
export function outcomeOf(state: Pick<EngineState, 'busy' | 'mutation'>, run: RunRef | null, m: RunMatch, canDecide: (ref: GapRef) => boolean = () => true): RunOutcome {
  if (!run) return { kind: 'idle' };
  const gen = m.generation;
  if (m.output) {
    // The answer is only released once every check that will run has finished. The stress test runs last, after the
    // commit, so while the engine still has it waiting or running for this function the run is still running: the
    // answer stays veiled and the trace says nothing is passed yet. An answer certified earlier whose stress test is
    // not queued (a second ask) is not held: nothing re-runs.
    const wait = gen?.phase === 'committed' || !gen ? stressWait(state, run, m.output, !gen) : null;
    if (wait) return { kind: 'running', stress: wait };
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
  /** The question's label (its own words, e.g. `Who are our top customers by revenue?`: the chip's) and the question in words. */
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
  // only the stress test is left: the answer on screen is held, but its other checks (this run's, or a certificate) are in
  const waiting = outcome.kind === 'running' ? (outcome.stress ?? null) : null;
  const cached = outcome.kind === 'cached' || !!waiting?.cached;
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
  const answered = outcome.kind === 'committed' || cached || waiting !== null;
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
    ...(gaveUpOn(t.match.output) ? { stressGaveUp: true } : {}),
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
  if (cached && !waiting) {
    footer = { ...footer, meta: cachedMeta(header.right) };
    liveText = LIVE_CACHED;
  }
  return { lanes, ghost, header, footer, liveText, run, cached, facts };
}

/**
 * One line for a run that passed and is over: the verdict's words (the seal for Full checks, "Passed 2 basic checks"
 * for Basic; the trace's "see the list" pointer left off) and the footer's own meta (`real run 0.08 s`; for an answer
 * certified earlier, what that says). It is cut from the very view the trace is drawn from, so it can never disagree
 * with it. null unless the run passed. Step by step uses it in three places, all the same words: the line above the collapsed
 * trace on the answer pane (zen/ZenProof.tsx), the verdict line on the finished "Checking" pane (zen/Zen.tsx), and what the
 * trace says aloud once that run is over (start/RunPanel.tsx settledLiveText).
 */
export function traceSummary(t: Pick<TraceView, 'header' | 'footer'>): string | null {
  const h = t.header;
  if (!h.done || h.tone !== 'pass' || !h.verdict) return null;
  const words = h.verdict.replace(/\s*\u2193.*$/u, '');
  return t.footer.meta ? `${words} · ${t.footer.meta}` : words;
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

/**
 * The first half of every no-recording sentence for your own file: what the demo cannot do. (The board's words
 * (V3-Door-FirstRun 101) ended "Try a sample file for now.", a way out nothing on panes 2 and 3 could act on: the sentence now names
 * one and the page draws it as a button, see `SampleOffer`.)
 */
export const NO_RECORDING_OWN = 'In this demo, answers are recorded, so questions about your own file need the version on your computer.';
/** The first half when a sample's question has none: the same, for a question rather than a file. */
const NO_RECORDING_QUESTION =
  'In this demo, answers are recorded, and this question has no recorded answer with these checks, so it needs the version on your computer.';

/** The words of the invitation to try the question that has a recorded answer (the page makes them a button). */
export const TRY_IT = 'try it';

/**
 * The sample file that has a recorded answer, and the question it opens on: where `switch to orders.csv` leads. Typed once, in
 * the places that already name it (start/startView.ts RECORDED_SAMPLE_FILE, model/questions.ts DEFAULT_QUESTION_ID); a test
 * (start/ownFileCaveat.test.ts) opens the sample against the real recordings and fails if that question has none.
 */
const RECORDED_SAMPLE: SampleId = 'orders';

export interface SampleOffer {
  sample: SampleId;
  /** `orders.csv` */
  file: string;
  /** The words of the question that binding it selects (session.useSample opens on DEFAULT_QUESTION_ID): what the sentence says has a recorded answer. */
  question: string;
}

/**
 * What to offer a viewer who is looking at a question the demo cannot answer: the recorded sample, unless it is already the file
 * bound (then the other question that has an answer is the way out, `recordedOther`). `bound` is the session's `sampleId`: null
 * for a file of your own.
 */
export function sampleOffer(bound: SampleId | null): SampleOffer | null {
  if (bound === RECORDED_SAMPLE) return null;
  const q = sampleOpeningQuestion(RECORDED_SAMPLE);
  return { sample: RECORDED_SAMPLE, file: RECORDED_SAMPLE_FILE, question: q.text };
}

/** The words of the button that binds the recorded sample: it says what it does and to what (it replaces the file on screen). */
export const switchToSample = (file: string): string => `switch to ${file}`;

/**
 * The no-recording sentence, in the pieces a page needs to draw its action as a real button: `before` + `action.text` + `after`
 * is exactly noRecordingText. `action` is null when nothing here can be tried (the sentence is whole): a `question` (another
 * question that has a recorded answer: select it) or a `sample` (the recorded sample file: bind it).
 */
export type NoRecordingAction =
  | { kind: 'question'; id: string; text: typeof TRY_IT }
  | { kind: 'sample'; sample: SampleId; text: string };

export interface NoRecordingView {
  before: string;
  action: NoRecordingAction | null;
  after: string;
}

/**
 * `other`: another question on this file that has a recorded answer (the way out, when there is one). `offer`: the recorded sample
 * file, for a viewer whose file is not it. With neither, the sentence is whole and has no action.
 */
export function noRecordingView(ownData: boolean, other: { id?: string; label: string } | null, offer: SampleOffer | null = null): NoRecordingView {
  const head = ownData ? NO_RECORDING_OWN : NO_RECORDING_QUESTION;
  if (other) return { before: `${head} “${other.label}” has one: `, action: { kind: 'question', id: other.id ?? '', text: TRY_IT }, after: '.' };
  if (offer) {
    return {
      before: `${head} “${offer.question}” has a recorded answer on one sample file: `,
      action: { kind: 'sample', sample: offer.sample, text: switchToSample(offer.file) },
      after: '.',
    };
  }
  return { before: head, action: null, after: '' };
}

/**
 * The no-recording sentence. Own file: the board's words. A sample question with no recording for these checks: say that, and
 * name a question that does have an answer here (or the sample that has one).
 */
export function noRecordingText(ownData: boolean, other: { id?: string; label: string } | null, offer: SampleOffer | null = null): string {
  const v = noRecordingView(ownData, other, offer);
  return v.before + (v.action?.text ?? '') + v.after;
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
  /** Said next to the lock button when the lock came with the demo file ('' otherwise). */
  lockNote: string;
  assumptions: AssumptionList;
  checked: string[];
  /** The items of `checked` that take the amber glyph (a stress test that missed something or did not finish). */
  checkedAsk: string[];
  notChecked: string[];
  /** The seal in words, for a Full-checks answer (null for basic checks: the card's own words). */
  seal: AnswerSeal | null;
  facts: CheckFacts;
}

/** The answer's seal when every check that applies passed: the words, and how much of the work they cover. */
export interface AnswerSeal {
  /** 'Passed every check · stress test caught 11 of 12' (sentence case; the card sets it in capitals). */
  text: string;
  /** The checks that applied (every check that ran, plus the stress test) and how many of them passed. */
  ran: number;
  of: number;
  /** The stress test finished: the green disc. Otherwise a partial ring, never green. */
  complete: boolean;
}

/** The seal of a Full-checks answer, from its facts (the trace's header says the same from its lanes). */
export function sealOf(f: CheckFacts): AnswerSeal | null {
  if (!hasAgreement(f)) return null;
  // runs without errors and never changes your data always apply; examples, locked answers and house rules when they ran
  const ran = 2 + (f.examples > 0 ? 1 : 0) + (f.locked > 0 ? 1 : 0) + (f.houseRules > 0 ? 1 : 0);
  return { text: sealWords({ stress: f.stress, ran, of: ran + 1 }), ran, of: ran + 1, complete: f.stress.kind === 'done' };
}

export function heldCaptionFor(o: RunOutcome): string {
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
    // the card beside the veil already says why and what to do (and offers it once, as a button): the veil only says what is held
    case 'no-recording':
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
  const facts = checkFactsFrom({ artifact, spec, question: a.question, mutation: a.state.mutation, gaveUp: gaveUpOn(out) });
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
  // a lock that came with the demo file says so (the rail says the same of the whole agreement)
  const seededLock = locked && pinFor(a.state.program, out)?.id === SEEDED_PIN_ID;
  return {
    view,
    held: !out,
    heldCaption: heldCaptionFor(a.outcome),
    level,
    locked,
    lockHelp: lockedHelp({ locked, level, mode: a.mode ?? 'live', noun: view?.kind === 'ranked' ? 'list' : 'answer', seeded: seededLock }),
    canLock: !!out?.pinnable && !a.state.busy,
    lockNote: seededLock ? SEEDED_LOCK_NOTE : '',
    assumptions: assumptionsFromNote(noteFor(out?.note, artifact)),
    checked: out ? checkedList(facts) : [],
    checkedAsk: out ? checkedAsk(facts) : [],
    // nothing is listed while the answer is held: the receipt arrives with the answer, whole
    notChecked: !out ? [] : notCheckedList({
      fileName: a.fileName,
      question: a.question,
      facts,
      data: a.data,
      decisions: spec?.decisions ?? [],
      rules: ruleTexts(spec),
      // what the user has set now: a lock added after this answer was checked is not "nothing set"
      ...(a.fn && rec ? { set: agreementOf(a.state.program, a.fn).n } : {}),
    }),
    seal: out ? sealOf(facts) : null,
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
 * installed (shown at once, 'This agreement comes with the demo file.'), or empty for a spec-less question.
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


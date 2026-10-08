/**
 * The six lanes of the check trace, in the design's words, from REAL engine state (docs/FRONT-DOOR.md, vocabulary map):
 *
 *   01 Runs without errors                        Compile gate
 *   02 Matches your N examples                    Tests gate, the user's unit tests (not pins, not decision tests)
 *   03 Matches your locked answer                 Tests gate, the pinned results (diagnostic names start `pinned: `)
 *   04 Follows your N house rules on T tables     Properties gate (+ decision tests, names start `decided: `)
 *   05 Never changes your data · finishes fast    Invariants gate (pure + bounded)
 *   06 Stress test: N deliberate breaks          The lazy mutation check (state.mutation, Evidence.mutation)
 *
 * Pure (no DOM). Every count comes from a gate result, the spec, the evidence or the mutation report: when the engine
 * has not reported a number the label drops it ("Matches your examples") instead of guessing.
 */
import type {
  AttemptView,
  Diagnostic,
  EngineState,
  Evidence,
  FunctionSpec,
  GateId,
  GateResult,
  GenerationView,
  MutationReport,
} from '@scasella/undefined-engine/types';
import { DECIDED_PREFIX, decisionsOf } from '@scasella/undefined-engine/decide/decisions';

// ───────────────────────── view types ─────────────────────────

export type LaneNum = '01' | '02' | '03' | '04' | '05' | '06';
export type LaneKind = 'ticks' | 'grid' | 'stress';
/** Which agreement-rail chip a lane is about (the landing's outline ring). */
export type LaneLink = 'ex' | 'lock' | 'rules';
/**
 * off: nothing to check yet (dashed note) · ready: will run when you ask · waiting: queued in this run ·
 * running: checking now · passed · failed: thrown out · stopped: a question only you can answer (amber) ·
 * skipped: not reached (a draft stops at its first failure).
 */
export type LaneState = 'off' | 'ready' | 'waiting' | 'running' | 'passed' | 'failed' | 'stopped' | 'skipped';

export interface LaneView {
  num: string;
  label: string;
  lock?: boolean;
  link?: LaneLink;
  kind: LaneKind;
  /** Cells to draw (0 = none). Capped for very large counts; the text always carries the real number. */
  cells: number;
  state: LaneState;
  /** Count-box text while the lane has no result: 'Not checked' | 'Ready' | 'Waiting' | 'Not run'. */
  idle?: string;
  /** Running progress the engine reports (the mutation check counts broken copies). */
  progress?: { done: number; total: number };
  /** Result line: '6/6', '11 of 12 caught'. */
  done?: string;
  /** 'Passed' | 'Thrown out' | 'Stopped' | ''. */
  word?: string;
  glyph?: 'pass' | 'fail' | 'ask';
  /** Second result line: '1 missed', 'on made-up table 47 of 100'. */
  line2?: string;
  line2Tone?: 'ask' | 'pass' | 'fail';
  /** Draw the outline ask diamond before line2 (first-run style). */
  line2Glyph?: boolean;
  /** Off lanes: the dashed note ('No examples yet', OFF_NOTES). */
  offNote?: string;
  /** Stress lanes: how many of the cells (the last ones) are amber '?' cells. */
  missed?: number;
  /** Lane 06 only: what the stress test came to (the one definition the lane, the seal and the answer's lists share). */
  stress?: StressStatus;
  /** Stopped grid lanes: the 1-based made-up table it stopped on (cells after it stay dark). */
  stopAt?: number;
  aria: string;
}

// ───────────────────────── input ─────────────────────────

/** What the spec / last evidence says will be checked. `null` = the engine has not reported that number yet. */
export interface LaneFacts {
  /** Authored unit tests ("examples"), excluding pins and decision tests. */
  examples: number | null;
  /** Pinned results ("locked answers"). */
  pins: number;
  /**
   * How many of those pins the answer on file was checked with (its evidence), when a certified function holds one.
   * Pins are outside the hashes, so a lock set after the check leaves the function live: asking again runs none of it.
   * Absent: nothing is on file, so every pin will run.
   */
  pinsChecked?: number;
  /** "Chef Ravioli Starbright = $2,252.07": shown after the lane-03 label when there is exactly one pin. */
  pinLabel?: string;
  /** House rules: authored properties + the user's decisions. */
  houseRules: number | null;
  /** Decisions placed as unit tests (they run in the Tests gate but count as house rules). */
  decisionTests: number;
  /** Made-up tables per house rule (fast-check runs), when reported. */
  tables: number | null;
}

export type RunFlag = 'idle' | 'running' | 'done' | 'held';

export interface LiveLanesInput {
  /** The attempt shown is `attempt` when given, else the generation's last attempt. */
  generation: GenerationView | null;
  attempt?: AttemptView | null;
  facts: LaneFacts;
  /** EngineState.mutation (only used when its fn is the generation's fn, or `fn` below). */
  mutation?: EngineState['mutation'];
  /** Artifact.evidence.mutation of the committed function, when there is one. */
  mutationReport?: MutationReport | null;
  /** The function the lanes are about, when there is no generation. */
  fn?: string;
  /** 'idle': nothing asked (lanes ready/off); 'held': the run waits on a question only the user can answer. */
  run: RunFlag;
  /** The page stopped waiting for the stress test (derive.ts stressGaveUp): lane 06 says it didn't run, whatever arrives later. */
  stressGaveUp?: boolean;
}

// ───────────────────────── the stress test, in one place ─────────────────────────

/**
 * What the stress test (the lazy mutation check) came to. ONE definition, used by lane 06, the trace's header and footer,
 * the answer's seal, its Checked against / Not checked lists and the landing's illustration, so they can never disagree:
 *   total  = report.total (the copies that really ran; copies that did not compile are not in it)
 *   caught = report.killed + report.killedByBound
 *   missed = report.survived
 * none: nothing for it to run against (no example, locked answer or house rule ran) · pending: it will run and has not
 * finished (the answer is held) · done: it ran every break it had · partial: it ran out of time · not-run: it was
 * expected and gave no result (it failed, had nothing to break, or the page stopped waiting).
 */
export type StressStatus =
  | { kind: 'none' }
  | { kind: 'pending'; phase: 'waiting' | 'running'; done: number; total: number }
  | { kind: 'done'; total: number; caught: number; missed: number }
  | { kind: 'partial'; total: number; caught: number; missed: number; planned: number | null }
  | { kind: 'not-run' };

/** The engine's time-box note ("time box reached after 7 of 12 mutants"): how many breaks it planned, when it says. */
function plannedBreaks(skipped: string | undefined): number | null {
  const m = skipped ? /\bafter \d+ of (\d+) /.exec(skipped) : null;
  return m ? Number(m[1]) : null;
}

export interface StressInput {
  /** Something ran that the stress test could be held against (a Full-checks answer). */
  expected: boolean;
  /** Artifact.evidence.mutation of the answer. */
  report?: MutationReport | null | undefined;
  /** EngineState.mutation and the function it must be about. */
  mutation?: EngineState['mutation'] | undefined;
  fn?: string | undefined;
  /** The page stopped waiting: the answer shows "didn't run" for good. */
  gaveUp?: boolean | undefined;
}

export function stressStatus(i: StressInput): StressStatus {
  if (!i.expected) return { kind: 'none' };
  if (i.gaveUp) return { kind: 'not-run' };
  const m = i.mutation && i.fn !== undefined && i.mutation.fn === i.fn ? i.mutation : undefined;
  // a report that is still being (re)made for this function is not this answer's result yet, whatever the artifact holds
  if (m && m.phase !== 'done') return { kind: 'pending', phase: m.phase, done: m.done, total: m.total };
  const r = i.report;
  if (!r || r.total <= 0) return { kind: 'not-run' };
  const base = { total: r.total, caught: r.killed + r.killedByBound, missed: r.survived };
  return r.skipped !== undefined ? { kind: 'partial', ...base, planned: plannedBreaks(r.skipped) } : { kind: 'done', ...base };
}

/** The stress test is still to come: the answer (and the seal) wait for it. */
export const stressPending = (s: StressStatus): boolean => s.kind === 'pending';

/** 'break' for one, 'breaks' otherwise: the unit every surface that counts the stress test's deliberate breaks agrees on (`deliberateBreaks`, the verdict line). */
export const breaksWord = (n: number): string => (n === 1 ? 'break' : 'breaks');

/**
 * The seal in words (sentence case; the card sets it in capitals). `ran` of `of` are the checks that apply: every one
 * that has something to run, plus the stress test. "Every check" is only ever said when the stress test finished.
 */
export function sealWords(s: { stress: StressStatus; ran: number; of: number }): string {
  const words = stressWords(s.stress);
  return words ? `${sealHead(s)} · ${words}` : sealHead(s);
}

/** The first half of the seal: "Passed every check", or, when the stress test did not finish, how many of the checks passed. Never "every" then. */
export function sealHead(s: { stress: StressStatus; ran: number; of: number }): string {
  return s.stress.kind === 'partial' || s.stress.kind === 'not-run' ? `Passed ${s.ran} of ${s.of} checks` : 'Passed every check';
}

/**
 * The second half of the seal, the stress test's own result in words: "stress test caught 8 of 12", "stress test ran out of
 * time", "stress test didn't run"; null when there is nothing to say (none, or still to come). The seal and the answer's
 * verdict line both say it with these words.
 */
export function stressWords(st: StressStatus): string | null {
  if (st.kind === 'done') return `stress test caught ${st.caught} of ${st.total}`;
  if (st.kind === 'partial') return 'stress test ran out of time';
  if (st.kind === 'not-run') return "stress test didn't run";
  return null;
}

/**
 * "N deliberate breaks": the stress test is the check, and the things it does are deliberate breaks. Every surface that counts them
 * (the lane's label, the ledger, the Not checked list, the footer, the landing) says it this way and no other.
 */
export const deliberateBreaks = (n: number): string => `${n} deliberate ${breaksWord(n)}`;

/**
 * The stress test's line in "Checked against", with whether it takes the amber glyph (anything missed or unfinished):
 * "stress test (caught 8 of 12 deliberate breaks)". `unit` false leaves "deliberate breaks" off ("stress test (caught 8 of 12)"):
 * the trace's footer, a tight line directly under lane 06 ("Stress test: 12 deliberate breaks"), which has already named them. The
 * numbers are the same function's either way, so the two can never disagree.
 */
export function stressChecked(st: StressStatus, unit = true): { text: string; ask: boolean } | null {
  const of = (total: number): string => (unit ? deliberateBreaks(total) : String(total));
  if (st.kind === 'done') return { text: `stress test (caught ${st.caught} of ${of(st.total)})`, ask: st.missed > 0 };
  if (st.kind === 'partial') return { text: `stress test (caught ${st.caught} of ${of(st.total)}, ran out of time)`, ask: true };
  return null;
}

/** What the stress test leaves unsaid, for "Not checked" (plain words: never "mutant"); null when it left nothing. */
export function stressNotChecked(st: StressStatus): string | null {
  if (st.kind === 'done' && st.missed > 0) return `${st.missed} of ${st.total} deliberate ${breaksWord(st.total)} went unnoticed by your checks`;
  if (st.kind === 'partial') {
    const tried = st.planned !== null && st.planned > st.total ? `${st.total} of ${deliberateBreaks(st.planned)}` : deliberateBreaks(st.total);
    const missed = st.missed > 0 ? `, and ${st.missed} of those went unnoticed by your checks` : '';
    return `the stress test ran out of time: it tried ${tried}${missed}`;
  }
  if (st.kind === 'not-run') return "whether your checks would notice a broken calculation: the stress test didn't run";
  return null;
}

// ───────────────────────── facts ─────────────────────────

/**
 * Lane facts from a spec and, when the function is committed, its evidence (what actually ran). Without evidence the
 * number of examples / properties is unknown unless the spec has none (then it is 0).
 */
export function factsFromSpec(spec: Pick<FunctionSpec, 'tests' | 'properties' | 'pins' | 'decisions'>, evidence?: Evidence | null, pinLabel?: string): LaneFacts {
  const ds = decisionsOf(spec);
  const decisionTests = ds.filter((d) => d.placement === 'tests').length;
  const examples = evidence ? Math.max(0, evidence.unitTests - (evidence.decisions ?? 0)) : spec.tests.trim() === '' ? 0 : null;
  const authoredProps = evidence ? Math.max(0, evidence.properties.length - (evidence.decisionProperties ?? 0)) : spec.properties.trim() === '' ? 0 : null;
  const runs = evidence ? evidence.properties.map((p) => p.runs) : [];
  return {
    examples,
    pins: spec.pins?.length ?? 0,
    ...(pinLabel ? { pinLabel } : {}),
    houseRules: authoredProps === null ? null : authoredProps + ds.length,
    decisionTests,
    tables: runs.length > 0 ? Math.max(...runs) : null,
  };
}

// ───────────────────────── gate parsing (formats documented in sandbox/gateExecutor.ts) ─────────────────────────

/** gateExecutor.ts PINNED_PREFIX (not imported: that module pulls fast-check into the bundle). */
export const PINNED_PREFIX = 'pinned: ';

/** Unit / pinned split of a Tests-gate summary (same formats as gateRunner.ts parseTestsSummary). */
export function parseTestsSummary(summary: string): { unit: number; pinned: number } | null {
  let m = /^(\d+) unit tests? \+ (\d+) pinned passed$/.exec(summary);
  if (m) return { unit: Number(m[1]), pinned: Number(m[2]) };
  m = /^(\d+) pinned passed$/.exec(summary);
  if (m) return { unit: 0, pinned: Number(m[1]) };
  m = /^\d+\/\d+ tests? passed \((\d+) unit \+ (\d+) pinned\)$/.exec(summary);
  if (m) return { unit: Number(m[1]), pinned: Number(m[2]) };
  m = /^\d+\/(\d+) tests? passed$/.exec(summary);
  if (m) return { unit: Number(m[1]), pinned: 0 };
  return null;
}

/** Properties-gate summary: how many properties and the per-property runs. */
export function parsePropertiesSummary(summary: string): { total: number; runs: number[] } | null {
  const m = /^\d+\/(\d+) propert(?:y|ies) (?:held|failed)/.exec(summary);
  if (!m) return null;
  const runs: number[] = [];
  const at = summary.indexOf(' runs: ');
  if (at >= 0 && summary.endsWith(')')) {
    const item = /"(?:[^"\\]|\\.)*" (\d+)/g;
    let r: RegExpExecArray | null;
    while ((r = item.exec(summary.slice(at))) !== null) runs.push(Number(r[1]));
  }
  return { total: Number(m[1]), runs };
}

const NOTHING_TO_RUN = new Set(['no tests yet', 'no properties yet']);

type Route = 'ex' | 'lock' | 'rules';
function routeOf(d: Diagnostic): Route {
  if (d.kind === 'test' && d.name.startsWith(PINNED_PREFIX)) return 'lock';
  if ((d.kind === 'test' || d.kind === 'property') && d.name.startsWith(DECIDED_PREFIX)) return 'rules';
  return 'ex';
}

// ───────────────────────── labels ─────────────────────────

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function examplesLabel(n: number | null): string {
  return n === null || n === 0 ? 'Matches your examples' : `Matches your ${plural(n, 'example', 'examples')}`;
}
function lockLabel(pins: number, pinLabel?: string): string {
  if (pins === 1) return pinLabel ? `Matches your locked answer · ${pinLabel}` : 'Matches your locked answer';
  return pins === 0 ? 'Matches your locked answers' : `Matches your ${pins} locked answers`;
}
function rulesLabel(n: number | null, tables: number | null, propertiesRan: boolean): string {
  const who = n === null || n === 0 ? 'your house rules' : `your ${plural(n, 'house rule', 'house rules')}`;
  if (!propertiesRan && n !== null && n > 0) return `Follows ${who}`;
  return `Follows ${who} on ${tables === null ? '' : `${tables} `}made-up tables`;
}
const SAFE_LABEL = 'Never changes your data · finishes fast';
/** The sixth lane's label: the check, then what it does ("Stress test: 12 deliberate breaks"; the number is the run's own count, when it has one). */
export function stressLabel(total: number | null): string {
  return total === null || total === 0 ? 'Stress test: deliberate breaks' : `Stress test: ${deliberateBreaks(total)}`;
}

const OFF_ARIA = ': not checked yet. Add an example, a locked answer or a house rule to switch it on.';

/**
 * The words for a check with nothing to run: the dashed note in the trace AND the tag in zen's checklist (zen/flow.ts
 * imports them), so the same state is never worded two ways.
 */
export const OFF_NOTES = {
  examples: 'No examples yet',
  locks: 'Nothing locked yet',
  rules: 'No house rules yet',
  stress: 'Needs your rules first',
  /** A locked answer exists, but it was set after the answer on file was checked: that check never saw it. */
  locksLate: 'Locked after this answer',
  /** The stress test did not run on this answer because nothing was set when it was checked (a lock came later). */
  stressLate: 'Not run on this answer',
  /** The stress test was expected on this answer and gave no result (it failed, had nothing to break, or the page stopped waiting). */
  stressNotRun: "Didn't run",
} as const;
const LATE_LOCK_ARIA = ': not checked on this answer, you locked it afterwards.';
const LATE_STRESS_ARIA = ': not run on this answer, nothing was set when it was checked.';
const NOT_RUN_STRESS_ARIA = ": didn't run, so this answer was not stress-tested.";
const GRID_MAX = 100;
const ROW_MAX = 48;

// ───────────────────────── lane builders ─────────────────────────

interface Base {
  num: LaneNum;
  label: string;
  kind: LaneKind;
  lock?: boolean;
  link?: LaneLink;
}

function cellsFor(kind: LaneKind, n: number): number {
  return Math.max(0, Math.min(n, kind === 'grid' ? GRID_MAX : ROW_MAX));
}

function off(b: Base, note: string, aria: string = OFF_ARIA): LaneView {
  return { ...b, cells: 0, state: 'off', idle: 'Not checked', offNote: note, aria: b.label + aria };
}
function idle(b: Base, n: number, state: 'ready' | 'waiting' | 'skipped'): LaneView {
  const text = state === 'ready' ? 'Ready' : state === 'waiting' ? 'Waiting' : 'Not run';
  const aria = state === 'ready' ? ': ready' : state === 'waiting' ? ': waiting' : ': not reached, a draft stops at its first failure';
  return { ...b, cells: cellsFor(b.kind, n), state, idle: text, aria: b.label + aria };
}
function running(b: Base, n: number, progress?: { done: number; total: number }): LaneView {
  return {
    ...b,
    cells: cellsFor(b.kind, n),
    state: 'running',
    ...(progress ? { progress } : {}),
    aria: b.label + (progress ? `: checking, ${progress.done} of ${progress.total}` : ': checking'),
  };
}
function passed(b: Base, n: number): LaneView {
  return { ...b, cells: cellsFor(b.kind, n), state: 'passed', done: `${n}/${n}`, word: 'Passed', glyph: 'pass', aria: `${b.label}: ${n} of ${n} passed` };
}
function failed(b: Base, n: number): LaneView {
  return { ...b, cells: cellsFor(b.kind, Math.max(1, n)), state: 'failed', word: 'Thrown out', glyph: 'fail', aria: `${b.label}: thrown out` };
}
function stopped(b: Base, n: number, at: number | null, of: number | null): LaneView {
  const line2 = at === null ? undefined : `on made-up table ${at}${of === null ? '' : ` of ${of}`}`;
  return {
    ...b,
    cells: cellsFor(b.kind, Math.max(1, n)),
    state: 'stopped',
    word: 'Stopped',
    glyph: 'ask',
    ...(line2 ? { line2, line2Tone: 'ask' as const } : {}),
    ...(at !== null && b.kind === 'grid' ? { stopAt: Math.min(at, GRID_MAX) } : {}),
    aria: `${b.label}: stopped${line2 ? ` ${line2}` : ''}, a question only you can answer`,
  };
}

/** The attempt the lanes show. */
export function shownAttempt(gen: GenerationView | null, attempt?: AttemptView | null): AttemptView | null {
  if (attempt) return attempt;
  if (!gen || gen.attempts.length === 0) return null;
  return gen.attempts[gen.attempts.length - 1] ?? null;
}

function gateOf(a: AttemptView | null, id: GateId): GateResult | undefined {
  return a?.gates.find((g) => g.gate === id);
}

/** Whether the generation as a whole is still working (drafting or checking). */
function inFlight(gen: GenerationView | null): boolean {
  return !!gen && (gen.phase === 'generating' || gen.phase === 'gating');
}

/**
 * The six lanes for the attempt shown. Lanes 01–05 follow its four gates; lane 06 follows the lazy mutation check,
 * which only ever runs after a commit and never changes lanes 01–05.
 */
export function liveLanes(input: LiveLanesInput): LaneView[] {
  const { facts } = input;
  const gen = input.run === 'idle' ? null : input.generation;
  const a = input.run === 'idle' ? null : shownAttempt(gen, input.attempt);
  const busy = inFlight(gen);
  const held = input.run === 'held';
  /** A gate with no result yet: queued while something is in flight, else ready. */
  const pending = (b: Base, n: number): LaneView => idle(b, n, busy || input.run === 'running' ? 'waiting' : 'ready');

  const compile = gateOf(a, 'compile');
  const tests = gateOf(a, 'tests');
  const props = gateOf(a, 'properties');
  const inv = gateOf(a, 'invariants');

  // tests gate split: examples / pins / decision tests
  const split = tests && (tests.status === 'pass' || tests.status === 'fail') ? parseTestsSummary(tests.summary) : null;
  const noTests = !!tests && tests.status === 'skipped' && NOTHING_TO_RUN.has(tests.summary);
  const pinsRan = split ? split.pinned : noTests ? 0 : (facts.pinsChecked ?? facts.pins);
  const unitRan = split ? split.unit : noTests ? 0 : null;
  const examplesN = unitRan !== null ? Math.max(0, unitRan - facts.decisionTests) : facts.examples;
  const fails = { ex: [] as Diagnostic[], lock: [] as Diagnostic[], rules: [] as Diagnostic[] };
  if (tests?.status === 'fail') for (const d of tests.diagnostics) fails[routeOf(d)].push(d);
  if (props?.status === 'fail') for (const d of props.diagnostics) fails.rules.push(d);

  const propsParsed = props && (props.status === 'pass' || props.status === 'fail') ? parsePropertiesSummary(props.summary) : null;
  const propRuns = propsParsed && propsParsed.runs.length > 0 ? Math.max(...propsParsed.runs) : null;
  const tables = propRuns ?? facts.tables;
  const propertiesRan = !!propsParsed || !(props && NOTHING_TO_RUN.has(props.summary));
  const noProps = !!props && props.status === 'skipped' && NOTHING_TO_RUN.has(props.summary);
  const rulesN = propsParsed ? propsParsed.total + facts.decisionTests : noProps ? facts.decisionTests : facts.houseRules;

  const silent = (d: Diagnostic): boolean => (d.kind === 'test' || d.kind === 'property') && d.silentOn !== undefined;
  const anySilent = [...fails.ex, ...fails.lock, ...fails.rules].some(silent);
  /** A failing check: thrown out, or (held) the question only the user can answer: the silent check, else any failure. */
  const failOrStop = (b: Base, n: number, ds: Diagnostic[]): LaneView => {
    if (held && (!anySilent || ds.some(silent))) {
      const d = ds.find(silent) ?? ds[0];
      const at = d && d.kind === 'property' ? d.runs : null;
      return stopped(b, n, at, at !== null ? facts.tables : null);
    }
    return failed(b, n);
  };

  // 01 compile
  const b1: Base = { num: '01', label: 'Runs without errors', kind: 'ticks' };
  const l1 = laneFromGate(b1, 1, compile, pending, (b, n) => failed(b, n));

  // 02 examples
  const b2: Base = { num: '02', label: examplesLabel(examplesN), kind: 'ticks', link: 'ex' };
  let l2: LaneView;
  if (examplesN === 0) l2 = off(b2, OFF_NOTES.examples);
  else if (tests?.status === 'fail' && fails.ex.length === 0) l2 = passed(b2, examplesN ?? 0);
  else l2 = laneFromGate(b2, examplesN ?? 0, tests, pending, (b, n) => failOrStop(b, n, fails.ex));

  // 03 locked answers
  // (a lock set after the check is still named: the rail lists it, so the lane must too)
  const b3: Base = { num: '03', label: lockLabel(pinsRan === 0 ? facts.pins : pinsRan, facts.pinLabel), kind: 'ticks', lock: true, link: 'lock' };
  let l3: LaneView;
  // set but never checked: a lock added after this answer was checked (pins are outside the hashes)
  if (pinsRan === 0) l3 = facts.pins > 0 ? off(b3, OFF_NOTES.locksLate, LATE_LOCK_ARIA) : off(b3, OFF_NOTES.locks);
  else if (tests?.status === 'fail' && fails.lock.length === 0) l3 = passed(b3, pinsRan);
  else l3 = laneFromGate(b3, pinsRan, tests, pending, (b, n) => failOrStop(b, n, fails.lock));

  // 04 house rules: the properties gate, plus decision tests that run in the tests gate
  const b4: Base = { num: '04', label: rulesLabel(rulesN, tables, propertiesRan), kind: propertiesRan ? 'grid' : 'ticks', link: 'rules' };
  const n4 = propertiesRan ? (tables ?? GRID_MAX) : (rulesN ?? 0);
  let l4: LaneView;
  if (rulesN === 0) l4 = off(b4, OFF_NOTES.rules);
  else if (fails.rules.length > 0) l4 = failOrStop(b4, n4, fails.rules);
  else if (noProps) {
    // only decision tests: they ran (and passed) in the tests gate
    l4 = laneFromGate(b4, n4, tests, pending, (b, n) => failed(b, n));
  } else l4 = laneFromGate(b4, n4, props, pending, (b, n) => failOrStop(b, n, fails.rules));

  // 05 pure + bounded: passes only when the invariants gate passed
  const b5: Base = { num: '05', label: SAFE_LABEL, kind: 'ticks' };
  const l5 = laneFromGate(b5, 2, inv, pending, (b, n) => failed(b, n));

  const l6 = stressLane(input, a, gen, examplesN === 0 && pinsRan === 0 && rulesN === 0);
  return [l1, l2, l3, l4, l5, l6];
}

/** The lane's label and cells for a finished (or time-boxed) stress test, as the trace draws it. */
function stressResult(b: Base, st: Extract<StressStatus, { kind: 'done' | 'partial' }>): LaneView {
  const { caught, missed, total } = st;
  const cells = cellsFor('stress', total);
  const unfinished = st.kind === 'partial';
  const line2 = unfinished ? `${missed > 0 ? `${missed} missed · ` : ''}ran out of time` : missed > 0 ? `${missed} missed` : undefined;
  return {
    ...b,
    cells,
    state: 'passed',
    done: `${caught} of ${total} caught`,
    word: '',
    ...(line2 ? { line2, line2Tone: 'ask' as const, line2Glyph: true, missed: Math.min(missed, cells) } : { glyph: 'pass' as const }),
    stress: st,
    aria: `${b.label}: ${caught} of ${total} caught${missed > 0 ? `, ${missed} missed` : ''}${unfinished ? ', ran out of time' : ''}`,
  };
}

/** One lane from one gate result. A gate that had nothing to run reads as not reached here; the callers handle 'off'. */
function laneFromGate(
  b: Base,
  n: number,
  g: GateResult | undefined,
  pending: (b: Base, n: number) => LaneView,
  onFail: (b: Base, n: number) => LaneView,
): LaneView {
  if (!g || g.status === 'pending') return pending(b, n);
  if (g.status === 'running') return running(b, n);
  if (g.status === 'pass') return passed(b, n);
  if (g.status === 'fail') return onFail(b, n);
  return idle(b, n, 'skipped');
}

function stressLane(input: LiveLanesInput, a: AttemptView | null, gen: GenerationView | null, nothingToKill: boolean): LaneView {
  const fn = gen?.fn ?? input.fn;
  const m = input.mutation && fn !== undefined && input.mutation.fn === fn ? input.mutation : undefined;
  const label = (total: number | null): Base => ({ num: '06', label: stressLabel(total), kind: 'stress' });
  if (nothingToKill) return input.facts.pins > 0 ? off(label(null), OFF_NOTES.stressLate, LATE_STRESS_ARIA) : off(label(null), OFF_NOTES.stress);
  // a draft that was thrown out is never stress-tested
  if (a && (a.status === 'rejected' || a.status === 'aborted') && input.run !== 'idle') return idle(label(null), 0, 'skipped');
  // it runs after the answer is committed: until then it is ready, never blocking 01–05
  const committed = gen?.phase === 'committed' && input.run !== 'idle';
  if (!committed) return idle(label(null), 0, 'ready');
  const st = stressStatus({ expected: true, report: input.mutationReport, mutation: input.mutation, fn, gaveUp: input.stressGaveUp });
  if (st.kind === 'pending') {
    const b = label(st.total > 0 ? st.total : null);
    const lane = st.phase === 'running' ? running(b, st.total, { done: st.done, total: st.total }) : idle(b, st.total, 'waiting');
    return { ...lane, stress: st };
  }
  if (st.kind === 'done' || st.kind === 'partial') return stressResult(label(st.total), st);
  return { ...off(label(m && m.total > 0 ? m.total : null), OFF_NOTES.stressNotRun, NOT_RUN_STRESS_ARIA), stress: st };
}

// ───────────────────────── the faded earlier drafts ─────────────────────────

export interface GhostView {
  /** 'DRAFT 1' */
  title: string;
  /** The lanes up to (and including) the one that threw it out. Off lanes are left out: they never ran. */
  lanes: LaneView[];
  /** The sentence under it, as text segments (mono = a figure). */
  note: Array<{ text: string; mono?: boolean }>;
}

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

const REASON: Record<string, string> = {
  '01': "it didn't run without errors",
  '02': "it didn't match one of your examples",
  '03': "it didn't match an answer you locked",
  '04': 'it broke one of your house rules',
  '05': "it changed your data or didn't finish fast",
};

type Seg = { text: string; mono?: boolean };

/** One line of engine text, without a trailing full stop or whitespace (the caller adds its own '. '). */
const oneLine = (t: string): string => t.split('\n')[0]!.trim().replace(/[.\s]+$/, '');

/**
 * Plain detail of the rejecting diagnostic, built from the diagnostic itself (never from a gate headline that may describe
 * another failure): "<call>: expected X, got Y", "<call> threw E (expected X)", "<rule> was false for <call>",
 * "Line N: <compiler message>", or the invariant in words. Figures are mono segments. Only with no diagnostic at all does
 * it fall back to the gate's headline without "Rejected: ".
 */
export function detailOf(gate: GateResult | undefined, headline: string | undefined, link?: LaneLink): Seg[] {
  const d = (link ? gate?.diagnostics.find((x) => routeOf(x) === link) : undefined) ?? gate?.diagnostics[0];
  if (d && d.kind === 'test' && d.name === '(spec error)') return [{ text: `Your checks did not load: ${oneLine(d.error ?? d.message)}. ` }];
  if (d && (d.kind === 'test' || d.kind === 'property')) {
    const name = d.kind === 'test' ? d.name.replace(PINNED_PREFIX, '').replace(DECIDED_PREFIX, '') : d.name;
    const who = d.call ?? name;
    if (d.expected !== undefined && d.actual !== undefined) {
      return [{ text: `${who}: expected ` }, { text: d.expected, mono: true }, { text: ', got ' }, { text: d.actual, mono: true }, { text: '. ' }];
    }
    if (d.error !== undefined) {
      const tail: Seg[] = d.expected !== undefined ? [{ text: ' (expected ' }, { text: d.expected, mono: true }, { text: ')' }] : [];
      return [{ text: `${who} threw ` }, { text: oneLine(d.error), mono: true }, ...tail, { text: '. ' }];
    }
    if (d.kind === 'property') {
      const at = d.call ?? (d.counterexample && d.counterexample !== '(none)' ? d.counterexample : null);
      return at ? [{ text: `"${name}" was false for ` }, { text: at, mono: true }, { text: '. ' }] : [{ text: `"${name}" was false. ` }];
    }
    const msg = oneLine(d.message);
    return [{ text: msg ? `${who}: ${msg}. ` : `${who} failed. ` }];
  }
  if (d && d.kind === 'invariant') {
    const what = d.invariant === 'pure' ? 'It changed the data it was given' : "It didn't finish in time";
    return d.call ? [{ text: `${what} (` }, { text: d.call, mono: true }, { text: '). ' }] : [{ text: `${what}. ` }];
  }
  if (d && d.kind === 'compile') {
    const msg = oneLine(d.message);
    return [{ text: msg ? `Line ${d.line}: ${msg}. ` : `It did not compile (line ${d.line}). ` }];
  }
  const h = oneLine((headline ?? gate?.headline ?? '').replace(/^(Rejected|Spec error):\s*/, ''));
  return h ? [{ text: `${h}. ` }] : [];
}

/**
 * The rejected attempts before the one shown, oldest first, as faded DRAFT blocks. Uses the same lane mapping as the
 * live trace (so counts are real), cut at the first lane that failed.
 */
export function ghostFromAttempts(gen: GenerationView | null, facts: LaneFacts, shown?: AttemptView | null): GhostView[] {
  if (!gen || gen.kind === 'recheck') return [];
  const current = shownAttempt(gen, shown);
  const out: GhostView[] = [];
  for (const a of gen.attempts) {
    if (a === current || a.status !== 'rejected') continue;
    const lanes = liveLanes({ generation: gen, attempt: a, facts, run: 'done' }).slice(0, 5);
    const at = lanes.findIndex((l) => l.state === 'failed' || l.state === 'stopped');
    if (at < 0) continue;
    const kept = lanes.slice(0, at + 1).filter((l) => l.state !== 'off');
    const failing = lanes[at]!;
    const stressOn = !(facts.examples === 0 && facts.pins === 0 && facts.houseRules === 0);
    const later = [...lanes.slice(at + 1).filter((l) => l.state !== 'off').map((l) => l.num), ...(stressOn ? ['06'] : [])];
    const who = ORDINAL[a.attempt - 1] ? `${ORDINAL[a.attempt - 1]} draft` : `Draft ${a.attempt}`;
    const gateId: GateId = failing.num === '01' ? 'compile' : failing.num === '05' ? 'invariants' : failing.num === '04' && gateOf(a, 'properties')?.status === 'fail' ? 'properties' : 'tests';
    const note: GhostView['note'] = [
      { text: `${who} thrown out: ${REASON[failing.num] ?? 'it failed a check'}. ` },
      ...detailOf(gateOf(a, gateId), a.candidate?.headline, failing.link),
    ];
    const first = later[0];
    const last = later[later.length - 1];
    if (first && last) {
      note.push({ text: later.length === 1 ? `Check ${first} never ran: a draft stops at its first failure.` : `Checks ${first} to ${last} never ran: a draft stops at its first failure.` });
    }
    const tail = note[note.length - 1]!;
    tail.text = tail.text.trimEnd();
    out.push({ title: `DRAFT ${a.attempt}`, lanes: kept.map((l) => (l.num === '03' ? { ...l, label: lockLabel(facts.pins) } : l)), note });
  }
  return out;
}

// ───────────────────────── header, footer, live text ─────────────────────────

export interface HeaderView {
  /** 'CHECK TRACE · DRAFT 2 · Who are our top customers by revenue? · orders.csv · 332 rows' */
  left: string;
  /** Right-hand timer text when not checking: '0.41 s', 'paused · waiting on you', 'waiting for your question'. */
  right: string;
  /** Replaces `left` once the run is over: 'Passed every check ↓ see the list'. */
  verdict?: string;
  tone?: 'pass' | 'ask' | 'fail';
  /** The run is over (verdict shown). */
  done?: boolean;
  /** Checking now: the timer reads 'checking…'. */
  running?: boolean;
  /** Only the stress test is left (the other checks passed): the answer waits for it. `right` says which part it is in. */
  stress?: 'waiting' | 'running';
}

export interface HeaderInput {
  /** The question in its own words, e.g. 'Who are our top customers by revenue?' (the chip's label is the same string). */
  question: string;
  file: string;
  rows: number;
  generation: GenerationView | null;
  attempt?: AttemptView | null;
  lanes: LaneView[];
  run: RunFlag;
}

/** Seconds the checks of an attempt took, from the gates' own timings ('0.41 s'). */
export function checkSeconds(a: AttemptView | null): string | null {
  if (!a || a.gates.length === 0) return null;
  const ms = a.gates.reduce((s, g) => s + (Number.isFinite(g.ms) ? g.ms : 0), 0);
  return `${(ms / 1000).toFixed(2)} s`;
}

const isFull = (lanes: LaneView[]): boolean => lanes.some((l) => (l.num === '02' || l.num === '03' || l.num === '04') && l.state !== 'off');

/** The checks that apply to this answer (every lane that has something to run, plus the stress test) and how many passed. */
function checkCounts(lanes: LaneView[]): { ran: number; of: number } {
  const core = lanes.filter((l) => l.num !== '06' && l.state !== 'off');
  return { ran: core.filter((l) => l.state === 'passed').length, of: core.length + 1 };
}

/** The seal in words for a Full-checks run, from the lanes themselves (the answer card says the same from its own facts). */
export function sealOfLanes(lanes: LaneView[]): string {
  const stress = lanes.find((l) => l.num === '06')?.stress ?? { kind: 'none' as const };
  return sealWords({ stress, ...checkCounts(lanes) });
}

export function headerFor(h: HeaderInput): HeaderView {
  const gen = h.run === 'idle' ? null : h.generation;
  const a = gen ? shownAttempt(gen, h.attempt) : null;
  const draft = gen && a ? (gen.kind === 'recheck' ? 'RE-CHECK' : `DRAFT ${a.attempt}`) : 'READY';
  const left = `CHECK TRACE · ${draft} · ${h.question} · ${h.file} · ${h.rows} ${h.rows === 1 ? 'row' : 'rows'}`;
  if (!gen) return { left, right: 'waiting for your question' };
  const core = h.lanes.filter((l) => l.num !== '06');
  if (h.run === 'held' || core.some((l) => l.state === 'stopped')) {
    return { left, right: 'paused · waiting on you', verdict: 'Stopped · a question only you can answer', tone: 'ask', done: true };
  }
  if (gen.declined) return { left, right: 'nothing checked', verdict: 'It said no · nothing was checked', tone: 'fail', done: true };
  if (gen.phase === 'generating' || gen.phase === 'gating') return { left, right: 'checking…', running: true };
  // the other checks passed and the stress test is still to come: no verdict yet, the answer waits for it
  const stress = h.lanes.find((l) => l.num === '06')?.stress;
  if (gen.phase === 'committed' && isFull(h.lanes) && stress?.kind === 'pending') {
    return { left, right: stress.phase === 'running' ? 'stress test running…' : 'stress test next…', running: true, stress: stress.phase };
  }
  if (h.run === 'running') return { left, right: 'checking…', running: true };
  const secs = checkSeconds(a) ?? '';
  if (gen.phase === 'committed') {
    const verdict = isFull(h.lanes)
      ? `${sealOfLanes(h.lanes)} ↓ see ${stress?.kind === 'done' ? 'the list' : "what wasn't checked"}`
      : `Passed ${core.filter((l) => l.state === 'passed').length} basic checks ↓ see what wasn't checked`;
    return { left, right: secs, verdict, tone: 'pass', done: true };
  }
  if (gen.error && gen.attempts.length === 0) return { left, right: 'nothing checked', verdict: 'Not run · no draft to check', tone: 'fail', done: true };
  return { left, right: secs, verdict: 'Thrown out · no draft passed every check', tone: 'fail', done: true };
}

/** The footer line and meta under the lanes, built from the lanes themselves (live trace: nothing is slowed down). */
export function footerFor(lanes: LaneView[], header: HeaderView): { text: string; meta: string } {
  const get = (num: string): LaneView | undefined => lanes.find((l) => l.num === num);
  const on = lanes.filter((l) => l.state !== 'off');
  const offN = lanes.length - on.length;
  const full = isFull(lanes);
  // a lock set after the answer on file was checked: it is in the agreement, and it is not part of this run
  const lateLock = get('03')?.offNote === OFF_NOTES.locksLate;
  if (!header.done && !header.running) {
    const text = full
      ? `When you ask, ${on.length === 6 ? 'all six' : on.length} checks run before you see anything. A draft that fails any of them is thrown out and the AI tries again.`
      : lateLock
        ? 'When you ask, the two basic checks run before you see anything. Your locked answer was set after the answer on file was checked, so asking again does not re-run it.'
        : 'When you ask, the two basic checks run before you see anything. The other four switch on once you lock an answer or add a house rule.';
    return { text, meta: `${on.length} checks ready${offN > 0 ? ` · ${offN} ${lateLock ? 'not run on this answer' : 'not set up'}` : ''}` };
  }
  if (header.stress) {
    return {
      text: `The other checks passed. Last is the stress test: it makes deliberate breaks in the calculation, to see whether your checks notice. The answer appears when it finishes.`,
      meta: header.stress === 'running' ? 'stress test running…' : 'stress test next…',
    };
  }
  if (header.running) return { text: 'Checking the draft before you see anything.', meta: 'checking…' };
  const parts: string[] = [];
  const ex = get('02');
  const lock = get('03');
  const rules = get('04');
  const nOf = (l: LaneView | undefined): number | null => {
    const m = l ? /(\d+)/.exec(l.label) : null;
    return m ? Number(m[1]) : null;
  };
  if (ex && ex.state !== 'off') parts.push(nOf(ex) !== null ? plural(nOf(ex)!, 'example', 'examples') : 'your examples');
  if (lock && lock.state !== 'off') {
    const n = /Matches your (\d+) locked/.exec(lock.label);
    parts.push(n ? `${n[1]} locked answers` : '1 locked answer');
  }
  if (rules && rules.state !== 'off') parts.push(rules.label.replace(/^Follows your /, ''));
  if (header.tone === 'ask') {
    const st = lanes.find((l) => l.state === 'stopped');
    const at = st?.stopAt;
    return {
      text: `Checked so far: ${parts.join(' · ')}.${at ? ` Stopped on table ${at}: your rules don't say what happens there.` : " Stopped: your rules don't say what happens here."}`,
      meta: 'Nothing is shown until you decide',
    };
  }
  if (header.tone === 'pass') {
    if (!full) {
      const rest = lateLock ? 'Nothing else yet: your locked answer was set after this answer was checked.' : 'Nothing else yet.';
      return { text: `Checked against: runs without errors · never changes your data · finishes fast. ${rest}`, meta: `real run ${header.right}` };
    }
    // the same numbers as lane 06 and the seal; a stress test that gave no result is said so
    const st = get('06')?.stress;
    // (the unit is lane 06's, a line above: this line is tight, and a third line here made the Checking pane taller than 900px at 1440)
    const stress = st ? stressChecked(st, false) : null;
    if (stress) parts.push(stress.text);
    parts.push('your data untouched');
    const missing = st && st.kind === 'not-run' ? " The stress test didn't run." : '';
    return { text: `Checked against: ${parts.join(' · ')}.${missing}`, meta: `real run ${header.right}` };
  }
  return { text: 'No draft passed every check, so no answer is shown.', meta: header.right ? `real run ${header.right}` : '' };
}

/** The aria-live sentence for the trace. */
export function liveTextFor(header: HeaderView, lanes: LaneView[]): string {
  if (!header.done) {
    if (header.stress) return 'The other checks passed. Running the stress test before showing the answer.';
    return header.running ? 'Checking the draft.' : '';
  }
  if (header.tone === 'ask') return 'Stopped: a question only you can answer.';
  if (header.tone === 'pass') {
    return isFull(lanes) ? `${sealOfLanes(lanes)}. Showing the answer.` : `Passed ${lanes.filter((l) => l.num !== '06' && l.state === 'passed').length} basic checks. Showing the answer.`;
  }
  return 'Thrown out: no draft passed every check. No answer is shown.';
}

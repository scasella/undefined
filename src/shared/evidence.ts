/**
 * The honest confidence line for a committed function: what actually ran against it, as facts. Never a score, a
 * grade or a percentage. Pure (types + mutation/classify only), so the UI and the tests share one wording.
 *
 * e.g. "Compiled. 3 unit tests and 2 pinned. 2 properties, 200 runs each. 26 calls replayed for purity.
 *       Tests killed 9 of 12 mutants (3 survived, which may be equivalent)."
 *
 * Evidence is metadata attached to an artifact after the fact: it is not part of any hash.
 */
import type { EngineState, Evidence, MutantInfo, MutationReport } from '../types';
import { describeReport, NO_TESTS_REASON } from '../mutation/classify';

/** Prefix of `MutationReport.skipped` when the check itself failed (never counted as a kill). */
export const MUTATION_FAILED_PREFIX = 'mutation check could not run: ';
/** `MutationReport.skipped` when the unmutated function already fails its own checks: no kill is counted. */
/** Reason prefix when the unmutated function itself hit the mutation check's per-call time limit: slow, not wrong. */
export const MUTATION_BASELINE_SLOW_PREFIX = 'the committed function is too slow for the mutation check';
export const MUTATION_BASELINE_FAILED = 'the committed function fails its own checks, so mutation results would mean nothing';
export const MUTATION_NOT_RUN = 'Mutation check: not run yet.';
export const NO_TESTS_ADVICE = 'No tests yet: nothing could kill a mutant. Add one to make the gate stricter.';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** First letter upper-cased, a full stop added when the text does not already end a sentence. */
export function sentence(text: string): string {
  const t = text.trim();
  if (t === '') return t;
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/**
 * "No unit tests." / "1 unit test." / "3 unit tests and 2 pinned." / "2 pinned tests and no unit tests.";
 * with decisions (unit tests generated from the user's rulings, counted in `unit`): "6 unit tests, including 2
 * decisions." / "1 unit test, your decision." / "6 unit tests (including 2 decisions) and 1 pinned."
 */
export function describeTests(unit: number, pinned: number, decisions = 0): string {
  if (unit === 0 && pinned === 0) return 'No unit tests.';
  if (unit === 0) return `${count(pinned, 'pinned test', 'pinned tests')} and no unit tests.`;
  const u = count(unit, 'unit test', 'unit tests');
  const d = Math.min(decisions, unit);
  if (d === 0) return pinned === 0 ? `${u}.` : `${u} and ${pinned} pinned.`;
  const incl = unit === 1 ? 'your decision' : d === unit ? 'all your decisions' : `including ${count(d, 'decision', 'decisions')}`;
  return pinned === 0 ? `${u}, ${incl}.` : `${u} (${incl}) and ${pinned} pinned.`;
}

/**
 * "No properties." / "1 property, 100 runs." / "2 properties, 200 runs each." / "3 properties (100, 50 and 300 runs).";
 * with rule decisions (properties generated from the user's rulings): "… each, including 1 decision."
 */
export function describeProperties(props: ReadonlyArray<{ name: string; runs: number }>, decisions = 0): string {
  const base = ((): string => {
    if (props.length === 0) return 'No properties.';
    if (props.length === 1) return `1 property, ${count(props[0]!.runs, 'run', 'runs')}.`;
    const runs = props.map((p) => p.runs);
    if (runs.every((r) => r === runs[0])) return `${props.length} properties, ${count(runs[0]!, 'run', 'runs')} each.`;
    const list = `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}`;
    return `${props.length} properties (${list} runs).`;
  })();
  const d = Math.min(decisions, props.length);
  return d === 0 ? base : `${base.slice(0, -1)}, including ${count(d, 'decision', 'decisions')}.`;
}

/** "No calls were replayed for purity." / "1 call replayed for purity." / "26 calls replayed for purity." */
export function describeSampledCalls(n: number): string {
  if (n === 0) return 'No calls were replayed for purity.';
  return `${count(n, 'call', 'calls')} replayed for purity.`;
}

/** The mutation sentence: not run yet, the skipped/failed reason, or describeReport's counts. */
export function describeMutation(r: MutationReport | undefined): string {
  if (!r) return MUTATION_NOT_RUN;
  return sentence(describeReport(r));
}

export function describeEvidence(ev: Evidence): string {
  return [
    ev.compiled ? 'Compiled.' : 'Did not compile.',
    describeTests(ev.unitTests, ev.pinnedTests, ev.decisions ?? 0),
    describeProperties(ev.properties, ev.decisionProperties ?? 0),
    describeSampledCalls(ev.sampledCalls),
    describeMutation(ev.mutation),
  ].join(' ');
}

/** True when the mutation check itself failed (load error, spec error, infrastructure). */
export function mutationFailed(r: MutationReport | undefined): boolean {
  return !!r?.skipped && r.skipped.startsWith(MUTATION_FAILED_PREFIX);
}

/** A plain extra line for a report that did not run mutants (null when the confidence line already says it all). */
export function mutationAdvice(r: MutationReport | undefined): string | null {
  if (!r) return null;
  if (r.skipped === NO_TESTS_REASON) return NO_TESTS_ADVICE;
  return null;
}

/** `compiled line 3: < → <= (may be an equivalent mutant)`; the line is in the COMPILED JS body, not the TS. */
export function survivorLine(s: MutantInfo): string {
  return `compiled line ${s.line}: ${s.original} → ${s.mutated} (may be an equivalent mutant)`;
}

/** The reason recorded when the user decides a gap (artifact.recertified[].reason, revision titles). */
export function decidedReason(summary: string): string {
  return `Decided: ${summary}`;
}

/** The reason recorded when a decision is removed. */
export function removedDecisionReason(summary: string): string {
  return `Removed decision: ${summary}`;
}

/** The reason recorded when a suggested check is added (artifact.recertified[].reason, GenerationView.recheck.reason). */
export function addedCheckReason(title: string): string {
  return `Added check “${title}”`;
}

/** Progress text for EngineState.mutation; null when there is nothing in flight. */
export function mutationProgress(m: EngineState['mutation'] | undefined, fn?: string): string | null {
  if (!m || (fn !== undefined && m.fn !== fn)) return null;
  if (m.phase === 'waiting') return 'Mutation check: waits until the program has been idle for a few seconds.';
  if (m.phase === 'running') {
    return m.total > 0
      ? `Checking the tests against ${count(m.total, 'broken copy', 'broken copies')}… ${m.done}/${m.total}`
      : 'Checking the tests against broken copies…';
  }
  return null;
}

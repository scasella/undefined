/** Pure view selectors for evidence, the mutation check and added checks (no business logic). */
import type { Artifact, EngineState, Evidence, FunctionRecord, GenerationView, MutantInfo, MutationReport } from '../types';
import { addedCheckReason, MUTATION_FAILED_PREFIX } from '../shared/evidence';
import { NO_TESTS_REASON } from '../mutation/classify';
import { hasMarker } from '../suggest/suggest';

/**
 * The committed artifact a generation view is about: the function's artifact when it is the one committed in that
 * generation (same revision) and still live. undefined otherwise (regrown, edited, rolled away).
 */
export function committedArtifact(gen: GenerationView | null, program: EngineState['program']): Artifact | undefined {
  if (!gen || gen.phase !== 'committed' || gen.kind === 'recheck' || gen.revision === undefined) return undefined;
  const rec = program.functions[gen.fn];
  const a = rec?.artifact;
  if (!rec || !a || a.revision !== gen.revision) return undefined;
  if (a.specHash !== rec.specHash || a.testsHash !== rec.testsHash) return undefined;
  return a;
}

export type AddedOutcome = 'pending' | 'recertified' | 'fails' | 'added';

/**
 * How an added suggestion went: re-certified (the committed function passed it), fails (the re-check rejected the
 * committed function), added (in the spec, nothing committed to re-check), or pending (the engine is on it).
 */
export function addedOutcome(rec: FunctionRecord | undefined, gen: GenerationView | null, check: { id: string; title: string }): AddedOutcome {
  if (!rec) return 'pending';
  const reason = addedCheckReason(check.title);
  if (rec.artifact?.recertified?.some((r) => r.reason === reason)) return 'recertified';
  if (gen?.kind === 'recheck' && gen.fn === rec.spec.name && gen.recheck?.reason === reason) return 'fails';
  return hasMarker(rec.spec.properties, check.id) ? 'added' : 'pending';
}

// ───────────── the evidence line in plain words (shared/evidence.ts keeps the precise wording, shown as a title) ─────────────

const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

/** "4 tests passed." / "3 tests and 2 pinned results passed." / "No tests." */
function plainTests(unit: number, pinned: number): string {
  if (unit === 0 && pinned === 0) return 'No tests.';
  if (unit === 0) return `${n(pinned, 'pinned result', 'pinned results')} reproduced.`;
  return pinned === 0 ? `${n(unit, 'test', 'tests')} passed.` : `${n(unit, 'test', 'tests')} and ${n(pinned, 'pinned result', 'pinned results')} passed.`;
}

/** "No random-input checks." / "1 rule held for 100 random inputs." / "2 rules held for 100 random inputs each." */
function plainRules(props: ReadonlyArray<{ runs: number }>): string {
  if (props.length === 0) return 'No random-input checks.';
  if (props.length === 1) return `1 rule held for ${n(props[0]!.runs, 'random input', 'random inputs')}.`;
  const runs = props.map((p) => p.runs);
  if (runs.every((r) => r === runs[0])) return `${props.length} rules held for ${n(runs[0]!, 'random input', 'random inputs')} each.`;
  return `${props.length} rules held for ${runs.reduce((a, b) => a + b, 0)} random inputs in all.`;
}

function plainReplays(k: number): string {
  return k === 0 ? 'No calls were re-run to look for side effects.' : `${n(k, 'call', 'calls')} re-run to look for side effects.`;
}

/** The broken-copy check: what share of deliberately broken copies the checks caught, never a score. */
export function plainMutation(r: MutationReport | undefined): string {
  if (!r) return 'The broken-copy check has not run yet.';
  if (r.skipped === NO_TESTS_REASON) return 'With nothing to check against, no broken copies were tried.';
  if (r.skipped?.startsWith(MUTATION_FAILED_PREFIX)) return 'The broken-copy check could not run, so nothing was counted.';
  if (r.total === 0) return 'No broken copies could be run.';
  const caught = r.killed + r.killedByBound;
  const parts: string[] = [];
  if (r.killedByBound > 0) parts.push(`${r.killedByBound} of them by the time limit`);
  if (r.survived > 0) parts.push(`${r.survived} slipped through, and may behave exactly like the original`);
  if (r.stillborn > 0) parts.push(`${r.stillborn} more did not compile`);
  const timeBox = r.skipped ? '; the check stopped at its time limit' : '';
  return `Your checks caught ${caught} of ${n(r.total, 'deliberately broken copy', 'deliberately broken copies')}${parts.length ? ` (${parts.join('; ')})` : ''}${timeBox}.`;
}

/** The evidence line under an accepted function: facts, no score. */
export function plainEvidence(ev: Evidence): string {
  return [ev.compiled ? 'Compiled.' : 'Did not compile.', plainTests(ev.unitTests, ev.pinnedTests), plainRules(ev.properties), plainReplays(ev.sampledCalls), plainMutation(ev.mutation)].join(' ');
}

/** The broken-copy check while it is waiting or running; null when nothing is in flight for `fn`. */
export function plainMutationProgress(m: EngineState['mutation'] | undefined, fn: string): string | null {
  if (!m || m.fn !== fn) return null;
  if (m.phase === 'waiting') return 'Next: your checks get tried against deliberately broken copies, once the program has been idle for a few seconds.';
  if (m.phase === 'running') return m.total > 0 ? `Trying your checks against broken copies… ${m.done}/${m.total}` : 'Trying your checks against broken copies…';
  return null;
}

/** One line per broken copy that got through: where, and what was changed. */
export function plainSurvivor(s: MutantInfo): string {
  return `line ${s.line} of the compiled code: ${s.original} → ${s.mutated}`;
}

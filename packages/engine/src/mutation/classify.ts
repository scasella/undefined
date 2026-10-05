/**
 * Pure aggregation of mutant outcomes into a MutationReport (src/types.ts) and its honest one-line description.
 *
 * Bucket arithmetic, exactly:
 *   report.total     = killed + killedByBound + survived   (the mutants that were actually RUN)
 *   report.stillborn = outcomes marked 'stillborn' + stillbornExtra
 * Stillborn mutants never parsed, so nothing ran them: they are NOT part of `total` and NEVER counted as killed.
 * buildReport throws if the `total` it is given disagrees with the run outcomes, so a caller cannot silently report
 * "k of N" where N includes mutants that never ran.
 */
import type { MutantInfo, MutationReport } from '../types';
import type { Mutant } from './mutate';

export type MutantOutcome = 'killed' | 'killed-by-bound' | 'survived' | 'stillborn';

export const NO_TESTS_REASON = 'no tests yet: nothing could kill a mutant';

export function toInfo(m: Mutant): MutantInfo {
  // Explicit fields: the mutant's full `js` must not be copied into stored revisions.
  return { id: m.id, kind: m.kind, line: m.line, original: m.original, mutated: m.mutated };
}

export function buildReport(
  total: number,
  outcomes: Array<{ mutant: Mutant; outcome: MutantOutcome }>,
  stillbornExtra: number,
  ms: number,
  at: number,
  survivorsMax = 5,
): MutationReport {
  let killed = 0;
  let killedByBound = 0;
  let survived = 0;
  let stillborn = Math.max(0, stillbornExtra);
  const survivors: MutantInfo[] = [];
  for (const { mutant, outcome } of outcomes) {
    switch (outcome) {
      case 'killed':
        killed++;
        break;
      case 'killed-by-bound':
        killedByBound++;
        break;
      case 'survived':
        survived++;
        if (survivors.length < survivorsMax) survivors.push(toInfo(mutant));
        break;
      case 'stillborn':
        stillborn++;
        break;
      default:
        throw new Error(`buildReport: unknown mutant outcome ${JSON.stringify(outcome)}`);
    }
  }
  const ran = killed + killedByBound + survived;
  if (total !== ran) {
    throw new RangeError(`buildReport: total ${total} does not match the ${ran} mutants that ran (killed + killed-by-bound + survived)`);
  }
  return { total: ran, killed, killedByBound, survived, stillborn, survivors, ms: Math.round(ms), at };
}

/** A report for a run that did not happen, e.g. skippedReport(NO_TESTS_REASON, Date.now()). */
export function skippedReport(reason: string, at: number, ms = 0): MutationReport {
  return { total: 0, killed: 0, killedByBound: 0, survived: 0, stillborn: 0, survivors: [], ms, at, skipped: reason };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * e.g. "Tests killed 7 of 12 mutants (1 more stopped by the time limit; 4 survived, which may be equivalent; 1 did not compile)".
 * Zero buckets are omitted. A skipped report with nothing run returns its reason; a partial run (time box) appends it.
 */
export function describeReport(r: MutationReport): string {
  if (r.total === 0 && r.skipped !== undefined) {
    return r.stillborn > 0 ? `${r.skipped} (${plural(r.stillborn, 'mutant', 'mutants')} did not compile)` : r.skipped;
  }
  const parts: string[] = [];
  if (r.killedByBound > 0) parts.push(`${r.killedByBound} more stopped by the time limit`);
  if (r.survived > 0) parts.push(`${r.survived} survived, which may be equivalent`);
  if (r.stillborn > 0) parts.push(`${r.stillborn} did not compile`);
  const tail = parts.length > 0 ? ` (${parts.join('; ')})` : '';
  const head = r.total === 0
    ? 'No mutants could be run'
    : `Tests killed ${r.killed} of ${plural(r.total, 'mutant', 'mutants')}`;
  const skipped = r.skipped !== undefined ? `; ${r.skipped}` : '';
  return `${head}${tail}${skipped}`;
}

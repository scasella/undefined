/**
 * Mutation-testing orchestration for one committed artifact. The runner that decides a mutant's fate is INJECTED
 * (the caller wires it to the sandboxed gate runner); this module imports no sandbox, gate, UI or engine code.
 *
 * - Generates up to `max` (default 12) mutants, then runs them one at a time, in order.
 * - Time box (default 6000 ms) starts AFTER generation (the first lazy import of `typescript` in a browser can take
 *   seconds) and is checked before each mutant: once it has expired, no further mutant is started. Mutants not run
 *   are not counted anywhere; `total` is the number that ran and `skipped` says e.g.
 *   "time box reached after 9 of 12 mutants".
 * - A runner that throws (infrastructure fault) rejects runMutation with that error: a fault is never counted as a
 *   kill or a survivor. A runner result outside the three outcomes is also an error.
 *
 * Caveat for the wiring: a mutant that parses but cannot even be loaded by the sandbox (the gate executor's
 * "candidate failed to load" test failure) is not a kill earned by the tests. The runner should throw (or treat it
 * explicitly) rather than return 'killed'; the three-value MutantRunner type cannot express "did not load".
 */
import type { MutationReport } from '../types';
import { buildReport, type MutantOutcome } from './classify';
import { generateMutants, type Mutant } from './mutate';

export type MutantRunner = (mutantJs: string) => Promise<'killed' | 'killed-by-bound' | 'survived'>;

export interface RunMutationInput {
  js: string;
  seed: number;
  /** Mutants to run at most (default 12). */
  max?: number;
  /** Wall-clock box for running mutants, in ms (default 6000). */
  timeBoxMs?: number;
  runner: MutantRunner;
  /** Clock in ms (default performance.now / Date.now); injectable for tests. */
  now?: () => number;
}

export const DEFAULT_MAX_MUTANTS = 12;
export const DEFAULT_TIME_BOX_MS = 6000;

const RUN_OUTCOMES = new Set(['killed', 'killed-by-bound', 'survived']);

const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function runMutation(input: RunMutationInput): Promise<MutationReport> {
  const max = input.max ?? DEFAULT_MAX_MUTANTS;
  const timeBoxMs = input.timeBoxMs ?? DEFAULT_TIME_BOX_MS;
  const now = input.now ?? defaultNow;
  const t0 = now();

  const { mutants, stillborn, sites } = await generateMutants(input.js, { seed: input.seed, max });
  const boxStart = now();

  const outcomes: Array<{ mutant: Mutant; outcome: MutantOutcome }> = [];
  for (const mutant of mutants) {
    if (now() - boxStart >= timeBoxMs) break;
    const outcome = await input.runner(mutant.js);
    if (!RUN_OUTCOMES.has(outcome)) {
      throw new Error(`mutant runner returned ${JSON.stringify(outcome)} for ${mutant.id}; expected 'killed', 'killed-by-bound' or 'survived'`);
    }
    outcomes.push({ mutant, outcome });
  }

  const report = buildReport(outcomes.length, outcomes, stillborn, now() - t0, Date.now());
  if (outcomes.length < mutants.length) {
    report.skipped = `time box reached after ${outcomes.length} of ${mutants.length} mutants`;
  } else if (max <= 0) {
    report.skipped = 'no mutants requested';
  } else if (sites === 0) {
    report.skipped = 'nothing to mutate: no operators, integer literals, conditions or returns';
  } else if (mutants.length === 0) {
    report.skipped = 'no mutant compiled';
  }
  return report;
}

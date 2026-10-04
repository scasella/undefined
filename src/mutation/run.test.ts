import { describe, expect, it } from 'vitest';
import { runMutation, type MutantRunner } from './run';
import { generateMutants } from './mutate';

const MEDIAN = `"use strict";
function median(numbers) {
    if (numbers.length === 0)
        return NaN;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
`;

/** A runner that really executes the mutant against a tiny oracle (no mocks of the mutator). */
const oracleRunner: MutantRunner = async (js) => {
  const f = new Function(`${js}\nreturn median;`)() as (xs: number[]) => number;
  const cases: Array<[number[], number]> = [[[5, 1, 3], 3], [[1, 2], 1.5], [[8, 2, 6, 4], 5], [[7], 7]];
  try {
    for (const [xs, want] of cases) if (!Object.is(f(xs), want)) return 'killed';
  } catch {
    return 'killed';
  }
  return 'survived';
};

describe('runMutation', () => {
  it('runs up to 12 mutants by default and reports four buckets', async () => {
    const r = await runMutation({ js: MEDIAN, seed: 1, runner: oracleRunner });
    expect(r.total).toBe(12);
    expect(r.killed + r.killedByBound + r.survived).toBe(12);
    expect(r.killedByBound).toBe(0);
    expect(r.killed).toBeGreaterThanOrEqual(8);
    expect(r.stillborn).toBe(0);
    expect(r.skipped).toBeUndefined();
    expect(r.survivors.length).toBe(Math.min(5, r.survived));
  });

  it('runs exactly the generated mutants, in order, and passes their JS to the runner', async () => {
    const seen: string[] = [];
    const runner: MutantRunner = async (js) => (seen.push(js), 'survived');
    const r = await runMutation({ js: MEDIAN, seed: 3, max: 5, runner });
    const { mutants } = await generateMutants(MEDIAN, { seed: 3, max: 5 });
    expect(seen).toEqual(mutants.map((m) => m.js));
    expect(r.survivors.map((s) => s.id)).toEqual(mutants.map((m) => m.id));
  });

  it('counts killed-by-bound separately', async () => {
    let i = 0;
    const runner: MutantRunner = async () => (['killed', 'killed-by-bound', 'survived'] as const)[i++ % 3]!;
    const r = await runMutation({ js: MEDIAN, seed: 2, max: 9, runner });
    expect(r).toMatchObject({ total: 9, killed: 3, killedByBound: 3, survived: 3 });
  });

  it('stops when the time box expires; unrun mutants are not counted and skipped says so', async () => {
    let t = 0;
    const now = () => t;
    const runner: MutantRunner = async () => {
      t += 100; // each mutant takes 100 ms of fake time
      return 'killed';
    };
    const r = await runMutation({ js: MEDIAN, seed: 1, max: 12, timeBoxMs: 450, runner, now });
    // Started at 0,100,200,300,400 (< 450); at 500 the box has expired.
    expect(r.total).toBe(5);
    expect(r.killed).toBe(5);
    expect(r.skipped).toBe('time box reached after 5 of 12 mutants');
  });

  it('a zero time box runs nothing', async () => {
    let calls = 0;
    const r = await runMutation({ js: MEDIAN, seed: 1, timeBoxMs: 0, runner: async () => (calls++, 'killed'), now: () => 0 });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ total: 0, killed: 0, skipped: 'time box reached after 0 of 12 mutants' });
  });

  it('a runner that throws rejects the whole run (never counted as killed or survived)', async () => {
    let calls = 0;
    const runner: MutantRunner = async () => {
      if (++calls === 3) throw new Error('worker crashed');
      return 'killed';
    };
    await expect(runMutation({ js: MEDIAN, seed: 1, runner })).rejects.toThrow('worker crashed');
    expect(calls).toBe(3);
  });

  it('a runner returning something other than the three outcomes is an error', async () => {
    const runner = (async () => 'stillborn') as unknown as MutantRunner;
    await expect(runMutation({ js: MEDIAN, seed: 1, runner })).rejects.toThrow(/expected 'killed'/);
  });

  it('reports stillborn mutants without running or killing them', async () => {
    const js = `"use strict";\nfunction f(a, b) {\n    return a+-b;\n}\n`;
    const ran: string[] = [];
    const r = await runMutation({ js, seed: 1, runner: async (m) => (ran.push(m), 'killed') });
    expect(ran).toHaveLength(1);
    expect(r).toMatchObject({ total: 1, killed: 1, survived: 0, stillborn: 1 });
  });

  it('says when there is nothing to mutate', async () => {
    const js = `"use strict";\nfunction f(a) {\n    a.push('x');\n}\n`;
    const r = await runMutation({ js, seed: 1, runner: async () => 'killed' });
    expect(r).toMatchObject({ total: 0, stillborn: 0 });
    expect(r.skipped).toMatch(/nothing to mutate/);
  });

  it('max 0 runs nothing and says so', async () => {
    const r = await runMutation({ js: MEDIAN, seed: 1, max: 0, runner: async () => 'killed' });
    expect(r).toMatchObject({ total: 0, skipped: 'no mutants requested' });
  });

  it('does not modify its input', async () => {
    const input = { js: MEDIAN, seed: 4, runner: oracleRunner };
    const copy = { ...input };
    await runMutation(input);
    expect(input).toEqual(copy);
    expect(Object.keys(input)).toEqual(['js', 'seed', 'runner']);
  });
});

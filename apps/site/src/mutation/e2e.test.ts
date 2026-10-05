/**
 * End to end: real compiled artifacts (the real compile gate on the shipped examples' known-good bodies), real
 * mutants, and a runner wired to the REAL gate executor (read-only use). In Node there is no watchdog, so nothing
 * can be 'killed-by-bound' here and only bodies whose mutants stay bounded are used (median, slugify's loop body,
 * fibonacci's fast doubling: it iterates over the digits of n.toString(2), so every mutant terminates).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { compileCandidate, transpileUserCode, warmUp } from '@scasella/undefined-engine/gates/compile';
import { executeGates } from '@scasella/undefined-engine/sandbox/gateExecutor';
import { gateSeed, hashesFor } from '@scasella/undefined-engine/shared/hash';
import { specExample } from '../examples';
import type { FunctionSpec } from '@scasella/undefined-engine/types';
import { describeReport } from '@scasella/undefined-engine/mutation/classify';
import { runMutation, type MutantRunner } from '@scasella/undefined-engine/mutation/run';

function userJs(src: string): string {
  const out = transpileUserCode(src);
  if (out.error) throw new Error(`spec source does not transpile: ${out.error}`);
  return out.js;
}

/** Runner over the real gate executor. A mutant that cannot even load is an infrastructure fault, not a kill. */
async function gateRunner(spec: FunctionSpec, opts: { withChecks: boolean }): Promise<MutantRunner> {
  const { specHash, testsHash } = await hashesFor(spec);
  const testsJs = opts.withChecks ? userJs(spec.tests) : '';
  const propertiesJs = opts.withChecks ? userJs(spec.properties) : '';
  const seed = gateSeed(specHash, testsHash);
  return async (js) => {
    const gates = executeGates(
      { name: spec.name, js, testsJs, propertiesJs, budgetMs: spec.budgetMs, seed },
      { phase: () => {}, enter: () => {}, leave: () => {} },
    );
    const failed = gates.find((g) => g.status === 'fail');
    if (!failed) return 'survived';
    if (failed.diagnostics.some((d) => d.kind === 'test' && d.name === '(load)')) {
      throw new Error(`mutant failed to load: ${failed.headline}`);
    }
    return 'killed';
  };
}

async function compiled(id: string, bodyIndex: number): Promise<{ spec: FunctionSpec; js: string }> {
  const ex = specExample(id);
  const out = await compileCandidate(ex.spec, ex.goodBodies[bodyIndex]!);
  expect(out.gate.status).toBe('pass');
  return { spec: ex.spec, js: out.js! };
}

const CASES = [
  { id: 'median', body: 0 },
  { id: 'median', body: 1 },
  { id: 'slugify', body: 0 },
  { id: 'slugify', body: 1 },
  { id: 'fibonacci', body: 0 },
] as const;

const SEED = 1;
const printed: string[] = [];

describe('mutation testing against the real gate executor', () => {
  beforeAll(async () => {
    await warmUp();
  });

  it('the original artifacts pass their own gates (a mutant kill means something)', async () => {
    for (const c of CASES) {
      const { spec, js } = await compiled(c.id, c.body);
      const gates = executeGates(
        {
          name: spec.name, js, testsJs: userJs(spec.tests), propertiesJs: userJs(spec.properties), budgetMs: spec.budgetMs,
          seed: gateSeed((await hashesFor(spec)).specHash, (await hashesFor(spec)).testsHash),
        },
        { phase: () => {}, enter: () => {}, leave: () => {} },
      );
      expect(gates.map((g) => g.status), `${c.id}#${c.body}`).not.toContain('fail');
    }
  });

  it('known-good median tests kill a plausible fraction of 12 mutants', async () => {
    const { spec, js } = await compiled('median', 0);
    const before = js;
    const r = await runMutation({ js, seed: SEED, runner: await gateRunner(spec, { withChecks: true }), timeBoxMs: 60_000 });
    expect(js).toBe(before);
    expect(r.total).toBe(12);
    expect(r.killedByBound).toBe(0);
    expect(r.stillborn).toBe(0);
    expect(r.killed).toBeGreaterThanOrEqual(9);
  }, 60_000);

  it('a weak spec (one single-value test, no properties) lets many mutants survive', async () => {
    const { spec, js } = await compiled('median', 0);
    const weak: FunctionSpec = { ...spec, tests: `test('single value', () => {\n  eq(median([7]), 7);\n});\n`, properties: '' };
    const r = await runMutation({ js, seed: SEED, runner: await gateRunner(weak, { withChecks: true }), timeBoxMs: 60_000 });
    printed.push(`median#0 weak (1 test) max 12 ${describeReport(r)}`);
    expect(r.total).toBe(12);
    expect(r.survived).toBeGreaterThanOrEqual(3);
    expect(r.killed).toBeLessThan(12);
  }, 60_000);

  it('with NO tests and NO properties nothing is killed', async () => {
    for (const c of CASES) {
      const { spec, js } = await compiled(c.id, c.body);
      const r = await runMutation({ js, seed: SEED, runner: await gateRunner(spec, { withChecks: false }), timeBoxMs: 60_000 });
      expect(r.killed, `${c.id}#${c.body}`).toBe(0);
      expect(r.killedByBound).toBe(0);
      expect(r.survived).toBe(r.total);
    }
  }, 60_000);

  it('measures kill rates on the shipped examples (12 mutants, and every site)', async () => {
    for (const c of CASES) {
      const { spec, js } = await compiled(c.id, c.body);
      const runner = await gateRunner(spec, { withChecks: true });
      for (const max of [12, 1000]) {
        const t0 = performance.now();
        const r = await runMutation({ js, seed: SEED, max, runner, timeBoxMs: 120_000 });
        const ms = Math.round(performance.now() - t0);
        expect(r.total + r.stillborn).toBeGreaterThan(0);
        printed.push(
          `${`${c.id}#${c.body}`.padEnd(12)} max ${String(max).padEnd(4)} ${describeReport(r)} [${ms} ms]` +
            (r.survivors.length ? `\n      survivors: ${r.survivors.map((s) => `${s.id} ${s.original} → ${s.mutated}`).join(' | ')}` : ''),
        );
      }
    }
    console.log(`\nMutation kill rates (seed ${SEED}, real gates, Node):\n${printed.join('\n')}\n`);
  }, 300_000);
});

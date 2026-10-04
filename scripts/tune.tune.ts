// Dev tool (not part of the product): samples real candidates from the model for each example and runs the real gates.
// Usage: TUNE_N=6 TUNE_EX=median,slugify npx vitest run -c scripts/vitest.tune.config.ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCodexService } from '../server/codexService';
import { buildPrompt } from '../src/shared/prompt';
import { compileCandidate, transpileUserCode, warmUp } from '../src/gates/compile';
import { executeGates } from '../src/sandbox/gateExecutor';
import { hashesFor, gateSeed } from '../src/shared/hash';
import { EXAMPLES, brokenSpec } from '../src/examples';
import type { FunctionSpec, GateResult } from '../src/types';

async function gate(spec: FunctionSpec, body: string): Promise<GateResult[]> {
  const c = await compileCandidate(spec, body);
  const gates: GateResult[] = [c.gate];
  if (spec.name === 'fibonacci' && c.js) {
    // Node has no watchdog: pre-screen for a hang (the browser gate terminates the worker instead).
    try {
      vm.runInNewContext(c.js + '\nfibonacci(1000000);', {}, { timeout: Math.max(spec.budgetMs, 1500) });
    } catch (e) {
      if (String((e as Error).message).includes('timed out'))
        return [
          c.gate,
          { gate: 'tests', status: 'skipped', ms: 0, summary: 'interrupted', note: 'interrupted: invariant violated', diagnostics: [] },
          { gate: 'properties', status: 'skipped', ms: 0, summary: 'not reached', note: 'not reached', diagnostics: [] },
          {
            gate: 'invariants', status: 'fail', ms: 1500, summary: 'bounded violated',
            headline: `Rejected: fibonacci(1000000) did not return within ${spec.budgetMs} ms (bounded)`,
            diagnostics: [{ kind: 'invariant', invariant: 'bounded', message: `fibonacci(1000000) did not return within ${spec.budgetMs} ms`, call: 'fibonacci(1000000)', phase: 'tests', budgetMs: spec.budgetMs, elapsedMs: spec.budgetMs + 20 }],
          },
        ] as GateResult[];
    }
  }
  if (c.gate.status !== 'pass' || c.js === null) return gates.concat(['tests', 'properties', 'invariants'].map((g) => ({ gate: g, status: 'skipped', ms: 0, summary: 'not reached', diagnostics: [] }) as GateResult));
  const h = await hashesFor(spec);
  const exec = executeGates(
    { name: spec.name, js: c.js, testsJs: transpileUserCode(spec.tests).js, propertiesJs: transpileUserCode(spec.properties).js, budgetMs: spec.budgetMs, seed: gateSeed(h.specHash, h.testsHash) },
    { phase() {}, enter() {}, leave() {} },
  );
  return gates.concat(exec);
}

it('tune', async () => {
  await warmUp();
  const N = Number(process.env.TUNE_N ?? 6);
  const only = (process.env.TUNE_EX ?? 'median,slugify').split(',');
  const broken = process.env.TUNE_BROKEN === '1';
  const out: unknown[] = [];
  // spec-less examples (orders) have nothing to tune until a call grows their spec
  for (const ex of EXAMPLES.filter((e) => only.includes(e.id) && e.spec)) {
    const base = broken ? brokenSpec(ex) : ex.spec!;
    const spec = process.env.TUNE_DOC ? { ...base, doc: process.env.TUNE_DOC } : base;
    const runs = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const svc = createCodexService();
        const p1 = buildPrompt({ spec, callArgTypes: undefined, history: [] });
        const r1 = await svc.generate(p1, () => {});
        if (!r1.ok) return { i, error: r1.error.message };
        const g1 = await gate(spec, r1.result.body);
        const bad = g1.find((g) => g.status === 'fail');
        let retry: unknown = null;
        if (bad) {
          const p2 = buildPrompt({ spec, history: [{ attempt: 1, body: r1.result.body, gates: g1, headline: bad.headline }] });
          const r2 = await svc.generate(p2, () => {});
          if (r2.ok) {
            const g2 = await gate(spec, r2.result.body);
            const b2 = g2.find((g) => g.status === 'fail');
            retry = { pass: !b2, rejectedBy: b2?.gate, headline: b2?.headline, ms: r2.result.durationMs };
          }
        }
        return { i, ms: r1.result.durationMs, first: bad ? { rejectedBy: bad.gate, headline: bad.headline } : 'PASS', retry, body: r1.result.body };
      }),
    );
    out.push({ ex: ex.id, runs });
    console.log(`\n=== ${ex.id}${broken ? ' (broken)' : ''}`);
    for (const r of runs as any[]) console.log(r.i, r.error ?? JSON.stringify({ ms: r.ms, first: r.first, retry: r.retry }));
  }
  writeFileSync('.tmp/tune-out.json', JSON.stringify(out, null, 1));
});

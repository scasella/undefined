import { describe, expect, it } from 'vitest';
import type { FunctionRecord } from '../types';
import { ejectFiles } from '../eject/eject';
import { hashesFor } from '../shared/hash';
import { encodeValue } from '../shared/serialize';
import { specWithDecisions } from '../core/program';
import { EXAMPLES } from '../examples';
import { buildDecision } from './decisions';

const MEDIAN = EXAMPLES.find((e) => e.id === 'median')!;
const AT = Date.UTC(2026, 9, 4, 12);

describe('eject with decisions', () => {
  it('writes the decisions section, the waiver prelude, provenance and the README sentence', async () => {
    const d = buildDecision({
      fn: 'median',
      kind: 'empty',
      args: [[]],
      ruling: { kind: 'outcome', outcome: { throws: true } },
      answers: { check: 'agrees with a sort-based reference', checkKind: 'property', silentOn: 'what the median of nothing is', gate: 'properties' },
      expected: { returns: encodeValue(NaN) },
      decidedAt: AT,
      reason: 'callers must check */ first',
    });
    const spec = specWithDecisions(MEDIAN.spec!, [d]);
    const h = await hashesFor(spec);
    const body = MEDIAN.badBodies.find((b) => b.silentOn)!.body;
    const rec: FunctionRecord = {
      spec,
      ...h,
      artifact: { body, source: '', js: '', returnType: 'number', ...h, model: 'm', codexVersion: 'c', committedAt: AT, candidates: [], revision: 3 },
    };
    const files = Object.fromEntries(ejectFiles({ functions: [rec], now: AT }).files.map((f) => [f.path, f.text]));
    const t = files['median.test.ts']!;
    expect(t).toContain(`const __uWaived: Array<{ kind: 'test' | 'property'; name: string }> = [{"kind":"property","name":"agrees with a sort-based reference"}];`);
    expect(t).toContain("// ───────── your decisions (where a check said the spec was silent, you ruled) ─────────\n__uDescribe('your decisions', () => {\n// decided by you on 2026-10-04: callers must check */ first\n// replaces the property \"agrees with a sort-based reference\" where the spec was silent (what the median of nothing is)\n" + d.test);
    // the spec's own tests are unchanged text (the decision is not appended to them)
    expect(t).toContain(`__uDescribe('unit tests', () => {\n${MEDIAN.spec!.tests.trimEnd()}\n});`);
    const prov = JSON.parse(files['provenance.json']!);
    expect(prov.decisions).toEqual([
      {
        id: d.id,
        call: 'median([])',
        ruling: 'throws',
        summary: 'median([]) → throws',
        answers: { check: 'agrees with a sort-based reference', silentOn: 'what the median of nothing is' },
        replaces: 'agrees with a sort-based reference',
        decidedAt: '2026-10-04T12:00:00.000Z',
        reason: 'callers must check */ first',
      },
    ]);
    expect(prov.testsHash).toBe(h.testsHash);
    expect(files['README.md']).toContain('It also holds one decision');
  });

  it('a spec without decisions ejects exactly as before (no waiver list entries, no section, empty provenance list)', async () => {
    const spec = MEDIAN.spec!;
    const h = await hashesFor(spec);
    const rec: FunctionRecord = { spec, ...h, artifact: { body: 'return 0;', source: '', js: '', returnType: 'number', ...h, model: 'm', codexVersion: 'c', committedAt: AT, candidates: [], revision: 2 } };
    const files = Object.fromEntries(ejectFiles({ functions: [rec], now: AT }).files.map((f) => [f.path, f.text]));
    expect(files['median.test.ts']).toContain('= [];');
    expect(files['median.test.ts']).not.toContain('your decisions (where');
    expect(JSON.parse(files['provenance.json']!).decisions).toEqual([]);
    expect(files['README.md']).not.toContain('decision');
  });
});

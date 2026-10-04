import { describe, expect, it } from 'vitest';
import type { Image, Revision } from '../types';
import { toImage, validateImage } from './store';

const H = 'a'.repeat(64);
const gate = (g: 'compile' | 'tests' | 'properties' | 'invariants') => ({ gate: g, status: 'pass' as const, ms: 1, summary: 'ok', diagnostics: [] });

function revision(): Revision {
  return {
    id: 1,
    at: 1,
    kind: 'init',
    title: 'r1',
    env: { rows: { $t: 'dataset', name: 'rows', hash: H } as never },
    program: {
      datasets: { rows: { name: 'rows', hash: H, typeName: 'Row', typeDecl: 'type Row = { a: number }', rowCount: 2, columns: [{ name: 'a', type: 'number' }], source: 'paste', bytes: 20 } },
      functions: {
        f: {
          specHash: H,
          testsHash: H,
          spec: {
            name: 'f', params: [{ name: 'xs', type: 'Row[]' }], returns: null, doc: 'd', tests: '', properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'call',
            typeDecls: 'type Row = { a: number }',
            pins: [{ id: 'p1', label: 'f(rows)', args: [{ kind: 'dataset', name: 'rows', hash: H }, { kind: 'value', encoded: { $t: 'bigint', v: '5' } }], expected: [1, 2], pinnedAt: 5 }],
          },
          artifact: {
            body: 'return 1;', source: 's', js: 'j', returnType: 'number', specHash: H, testsHash: H, model: 'm', codexVersion: 'c', committedAt: 1, revision: 1,
            evidence: { compiled: true, unitTests: 2, pinnedTests: 1, properties: [{ name: 'p', runs: 100 }], sampledCalls: 3 },
            recertified: [{ at: 9, revision: 2, reason: 'property added' }],
            candidates: [{ id: 'c1', attempt: 1, body: 'return 1;', notes: 'n', source: 'live', generationMs: 5, verdict: 'accepted', gates: [gate('compile'), gate('tests'), gate('properties'), gate('invariants')], prompt: 'THE EXACT PROMPT' }],
          },
        },
      },
    },
  };
}

describe('validateImage keeps the fields later phases rely on', () => {
  const rows = [{ a: 1 }, { a: 2 }];
  const image = toImage([revision()], 1, { [H]: rows as never });

  it('round-trips prompt, pins, typeDecls, evidence, recertified and datasets through JSON', () => {
    const res = validateImage(JSON.parse(JSON.stringify(image)));
    if (!res.ok) throw new Error(res.error);
    const f = res.image.revisions[0]!.program.functions.f!;
    expect(f.artifact!.candidates[0]!.prompt).toBe('THE EXACT PROMPT');
    expect(f.spec.pins![0]!.args[0]).toEqual({ kind: 'dataset', name: 'rows', hash: H });
    expect(f.spec.pins![0]!.expected).toEqual([1, 2]);
    expect(f.spec.typeDecls).toBe('type Row = { a: number }');
    expect(f.artifact!.evidence!.unitTests).toBe(2);
    expect(f.artifact!.recertified![0]!.reason).toBe('property added');
    expect(res.image.revisions[0]!.program.datasets!.rows!.typeName).toBe('Row');
    expect(res.image.datasets![H]).toEqual(rows);
  });

  it('rejects a dataset reference whose rows are not in the image', () => {
    const bad: Image = { ...JSON.parse(JSON.stringify(image)) };
    delete bad.datasets;
    const res = validateImage(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/refers to a dataset that is not in the image/);
  });

  it('rejects malformed pins and dataset keys', () => {
    const a = JSON.parse(JSON.stringify(image));
    a.revisions[0].program.functions.f.spec.pins[0].args[0].kind = 'banana';
    expect(validateImage(a)).toMatchObject({ ok: false });
    const b = JSON.parse(JSON.stringify(image));
    b.datasets = { notahash: [] };
    expect(validateImage(b)).toMatchObject({ ok: false });
  });
});

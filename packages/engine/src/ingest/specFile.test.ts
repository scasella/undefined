import { describe, expect, it } from 'vitest';
import { hashesFor } from '../shared/hash';
import { decodeDatasets, parseSpecFile, specFor, triggeringCall } from './specFile';

const doc = (functions: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'undefined-spec', version: 1, functions, ...extra });
const sig = { name: 'median', params: [{ name: 'numbers', type: 'number[]' }], returns: 'number', doc: 'From JSDoc.', typeDecls: '' };
const errorOf = (text: string): string => {
  try {
    parseSpecFile(text, 'spec.json');
  } catch (e) {
    return (e as Error).message;
  }
  return 'no error';
};

describe('parseSpecFile (undefined-spec v1)', () => {
  it('reads tests, properties, budget, pins, decisions and calls', () => {
    const f = parseSpecFile(
      doc({
        median: {
          doc: 'Returns the median.',
          tests: "test('one', () => { eq(median([1]), 1); });",
          properties: '',
          budgetMs: 500,
          pins: [{ id: 'p1', label: 'median(xs)', args: [{ kind: 'value', encoded: [1, 2, 3] }], expected: 2, pinnedAt: 1 }],
          calls: [[[3, 1, 2]], [[{ $t: 'number', v: 'NaN' }]]],
        },
      }),
      'spec.json',
    );
    const e = f.functions.median!;
    expect(e.budgetMs).toBe(500);
    expect(e.pins![0]!.label).toBe('median(xs)');
    expect(triggeringCall(e)).toEqual([[3, 1, 2]]);
  });

  it('refuses what would silently weaken a spec, with a path-addressed message', () => {
    expect(errorOf('{')).toMatch(/^spec\.json: not JSON/);
    expect(errorOf(JSON.stringify({ format: 'nope', version: 1, functions: {} }))).toBe('spec.json: format must be "undefined-spec"');
    expect(errorOf(JSON.stringify({ format: 'undefined-spec', version: 2, functions: {} }))).toBe('spec.json: version must be 1 (this tool reads version 1)');
    expect(errorOf(doc({}, { fucntions: {} }))).toBe('spec.json: fucntions is not a key of an undefined-spec file (allowed: format, version, functions, datasets)');
    expect(errorOf(doc({ median: { test: '' } }))).toBe(
      'spec.json: functions.median.test is not a spec field (allowed: doc, tests, properties, budgetMs, params, returns, typeDecls, pins, decisions, calls)',
    );
    expect(errorOf(doc({ median: { budgetMs: '1000' } }))).toBe('spec.json: functions.median.budgetMs must be a number');
    expect(errorOf(doc({ median: { budgetMs: 0 } }))).toBe('spec.json: functions.median.budgetMs must be a positive number of milliseconds');
    expect(errorOf(doc({ median: { decisions: [{ id: 'x' }] } }))).toBe('spec.json: functions.median.decisions[0].args must be an array');
    expect(errorOf(doc({ median: { calls: [1] } }))).toBe('spec.json: functions.median.calls[0] must be an array of encoded arguments');
    expect(errorOf(doc({}, { datasets: { abc: [] } }))).toBe('spec.json: datasets.abc dataset keys must be sha256 hashes');
  });

  it('decodes dataset rows (encoded values) by hash', () => {
    const h = 'a'.repeat(64);
    const f = parseSpecFile(doc({}, { datasets: { [h]: [{ x: { $t: 'number', v: '-0' } }] } }), 'spec.json');
    const rows = decodeDatasets(f.datasets)[h] as Array<{ x: number }>;
    expect(Object.is(rows[0]!.x, -0)).toBe(true);
  });
});

describe('specFor', () => {
  it('takes the signature from the source and the checks from the entry; the entry doc wins', async () => {
    const spec = specFor(sig, { doc: 'Returns the median.', tests: 'T', properties: 'P' });
    const { typeDecls: _none, ...signature } = sig;
    expect(spec).toEqual({ ...signature, doc: 'Returns the median.', tests: 'T', properties: 'P', budgetMs: 1000, maxAttempts: 1, origin: 'user' });
    // hashed exactly like the site's spec with the same fields (maxAttempts/origin are not hashed)
    expect(await hashesFor(spec)).toEqual(await hashesFor({ ...spec, maxAttempts: 3, origin: 'example', exampleId: 'median' }));
  });

  it('falls back to the JSDoc and the default budget; no entry means no checks', () => {
    expect(specFor(sig, undefined, { defaultBudgetMs: 250 })).toMatchObject({ doc: 'From JSDoc.', tests: '', properties: '', budgetMs: 250 });
  });

  it('refuses a params/returns/typeDecls that differs from the source (they feed the seed)', () => {
    expect(() => specFor(sig, { tests: '', properties: '', params: [{ name: 'xs', type: 'number[]' }] }, { file: 'spec.json' })).toThrow(
      'spec.json: functions.median.params [{"name":"xs","type":"number[]"}] differs from the source signature [{"name":"numbers","type":"number[]"}]',
    );
    expect(() => specFor(sig, { tests: '', properties: '', returns: null })).toThrow('functions.median.returns null differs from the source\'s "number"');
    expect(() => specFor(sig, { tests: '', properties: '', typeDecls: 'type X = 1;' })).toThrow('functions.median.typeDecls differs');
  });
});

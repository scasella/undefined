import fc from 'fast-check';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { coerceCsvRows, inferDataset } from './infer';

describe('coerceCsvRows', () => {
  it('coerces numeric, boolean and string columns; empty → null only in coerced columns', () => {
    const { rows, coerced } = coerceCsvRows([
      { id: '1', price: '9.99', ok: 'TRUE', note: 'hi', coupon: '' },
      { id: '2', price: '', ok: 'false', note: '', coupon: '' },
      { id: '3', price: '-1e3', ok: '', note: 'x', coupon: '' },
    ]);
    expect(coerced).toEqual({ id: 'number', price: 'number', ok: 'boolean', note: 'string', coupon: 'string' });
    expect(rows).toEqual([
      { id: 1, price: 9.99, ok: true, note: 'hi', coupon: '' },
      { id: 2, price: null, ok: false, note: '', coupon: '' },
      { id: 3, price: -1000, ok: null, note: 'x', coupon: '' },
    ]);
  });

  it.each([
    ['0'], ['-0'], ['12'], ['-12'], ['3.14'], ['.5'], ['-0.25'], ['1e6'], ['2.5E-3'], ['1E+2'], [' 42 '],
  ])('%j is numeric', (v) => {
    expect(coerceCsvRows([{ c: v }]).coerced.c).toBe('number');
  });

  it.each([
    ['007'], ['00'], ['1,000'], ['+1 555 0100'], ['+5'], ['1.'], ['0x1F'], ['Infinity'], ['NaN'], ['1e999'],
    ['12345678901234567890'], ['1 000'], ['2024-01-05'], ['$5'], ['5%'], ['--1'],
  ])('%j is not numeric', (v) => {
    expect(coerceCsvRows([{ c: v }]).coerced.c).toBe('string');
  });

  it('never produces -0', () => {
    expect(Object.is(coerceCsvRows([{ c: '-0' }]).rows[0]!.c, 0)).toBe(true);
  });

  it('one non-numeric value keeps the whole column as strings', () => {
    const { rows, coerced } = coerceCsvRows([{ zip: '02134' }, { zip: '90210' }, { zip: '' }]);
    expect(coerced.zip).toBe('string');
    expect(rows).toEqual([{ zip: '02134' }, { zip: '90210' }, { zip: '' }]);
  });

  it('booleans are case-insensitive; yes/no and 0/1 are not booleans', () => {
    expect(coerceCsvRows([{ b: 'True' }, { b: 'fAlSe' }]).rows).toEqual([{ b: true }, { b: false }]);
    expect(coerceCsvRows([{ b: 'yes' }, { b: 'no' }]).coerced.b).toBe('string');
    expect(coerceCsvRows([{ b: '0' }, { b: '1' }]).coerced.b).toBe('number');
  });

  it('dates stay strings; all-empty columns stay strings', () => {
    const { coerced, rows } = coerceCsvRows([{ d: '2024-03-01', e: '' }, { d: '2024-03-02T10:00:00Z', e: ' ' }]);
    expect(coerced).toEqual({ d: 'string', e: 'string' });
    expect(rows[1]).toEqual({ d: '2024-03-02T10:00:00Z', e: ' ' });
  });

  it('whitespace-only cells in a coerced column become null', () => {
    expect(coerceCsvRows([{ n: '1' }, { n: '  ' }]).rows).toEqual([{ n: 1 }, { n: null }]);
  });

  it('no rows → nothing', () => {
    expect(coerceCsvRows([])).toEqual({ rows: [], coerced: {} });
  });
});

describe('inferDataset', () => {
  it('builds the merged row type with optional keys and null last', () => {
    const r = inferDataset([
      { id: 1, customer: 'A', total: 9.5, coupon: null },
      { id: 2, customer: 'B', total: 3 },
      { id: 3, customer: 'C', total: 1, coupon: 'SAVE' },
    ]);
    expect(r.typeName).toBe('Row');
    expect(r.typeDecl).toBe('type Row = { id: number; customer: string; total: number; coupon?: string | null }');
    expect(r.columns).toEqual([
      { name: 'id', type: 'number' },
      { name: 'customer', type: 'string' },
      { name: 'total', type: 'number' },
      { name: 'coupon', type: 'string | null | undefined' },
    ]);
  });

  it('unions in first-seen order', () => {
    expect(inferDataset([{ v: 'a' }, { v: 1 }, { v: true }, { v: null }, { v: 2 }]).typeDecl).toBe(
      'type Row = { v: string | number | boolean | null }',
    );
    expect(inferDataset([{ v: null }, { v: 1 }]).typeDecl).toBe('type Row = { v: number | null }');
  });

  it('arrays merge element types; empty arrays → unknown[] unless an element was seen elsewhere', () => {
    expect(inferDataset([{ t: [] }, { t: [] }]).typeDecl).toBe('type Row = { t: unknown[] }');
    expect(inferDataset([{ t: [] }, { t: ['a'] }, { t: ['b', 'c'] }]).typeDecl).toBe('type Row = { t: string[] }');
    expect(inferDataset([{ t: [1, 'a'] }, { t: [null] }]).typeDecl).toBe('type Row = { t: (number | string | null)[] }');
    expect(inferDataset([{ t: [[1], []] }]).typeDecl).toBe('type Row = { t: number[][] }');
  });

  it('nested objects merge into one inline type with their own optional keys', () => {
    const r = inferDataset([{ addr: { city: 'X', zip: 1 } }, { addr: { city: 'Y' } }, { addr: null }]);
    expect(r.typeDecl).toBe('type Row = { addr: { city: string; zip?: number } | null }');
    expect(inferDataset([{ items: [{ sku: 'a', n: 1 }, { sku: 'b' }] }]).typeDecl).toBe(
      'type Row = { items: { sku: string; n?: number }[] }',
    );
    expect(inferDataset([{ o: {} }]).typeDecl).toBe('type Row = { o: {} }');
  });

  it('mixed primitive / array / object values become a union', () => {
    expect(inferDataset([{ v: 1 }, { v: [1] }, { v: { a: 1 } }]).typeDecl).toBe('type Row = { v: number | number[] | { a: number } }');
  });

  it('quotes non-identifier keys', () => {
    expect(inferDataset([{ 'first name': 'a', 'x-y': 1, $ok: true, '': 0, '1a': 2, 'q"t': 3 }]).typeDecl).toBe(
      'type Row = { "first name": string; "x-y": number; $ok: boolean; "": number; "1a": number; "q\\"t": number }',
    );
  });

  it('a key whose value is undefined counts as absent', () => {
    expect(inferDataset([{ a: 1, b: undefined }, { a: 2, b: 'x' }]).typeDecl).toBe('type Row = { a: number; b?: string }');
  });

  it('optional keys inherited from Object include the inherited member (TypeScript checks it)', () => {
    expect(inferDataset([{ toString: true }, {}]).typeDecl).toBe('type Row = { toString?: boolean | Object["toString"] }');
    expect(inferDataset([{ constructor: 1 }, { constructor: 2 }]).typeDecl).toBe('type Row = { constructor: number }');
    expect(inferDataset([{ o: { valueOf: null } }, { o: {} }]).typeDecl).toBe('type Row = { o: { valueOf?: null | Object["valueOf"] } }');
  });

  it('custom type name; invalid names fall back to Row; zero rows → {}', () => {
    expect(inferDataset([{ a: 1 }], { typeName: 'Order' }).typeDecl).toBe('type Order = { a: number }');
    expect(inferDataset([{ a: 1 }], { typeName: 'not valid' }).typeName).toBe('Row');
    expect(inferDataset([])).toEqual({ typeName: 'Row', typeDecl: 'type Row = {}', columns: [] });
  });

  it('non-JSON leaves: bigint, Date, Map', () => {
    expect(inferDataset([{ a: 1n, d: new Date(0), m: new Map() }]).typeDecl).toBe('type Row = { a: bigint; d: Date; m: unknown }');
  });
});

// ───────────────────────── the declared type really type-checks every row ─────────────────────────

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  types: [],
  skipLibCheck: true,
};
const FILE = '/virtual/data-check.ts';
const baseHost = ts.createCompilerHost(OPTIONS, true);
let oldProgram: ts.Program | undefined;

/** Real type-check of a source file with the TypeScript compiler; returns formatted diagnostics. */
function typeCheck(source: string): string[] {
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (f) => f === FILE || baseHost.fileExists(f),
    readFile: (f) => (f === FILE ? source : baseHost.readFile(f)),
    getSourceFile: (f, lang, onError) =>
      f === FILE ? ts.createSourceFile(f, source, lang) : baseHost.getSourceFile(f, lang, onError),
  };
  const program = ts.createProgram([FILE], OPTIONS, host, oldProgram);
  oldProgram = program;
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `${d.start ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

function checkSource(datasets: Array<Array<Record<string, unknown>>>): string {
  return datasets
    .map((rows, i) => {
      const { typeDecl } = inferDataset(rows, { typeName: `R${i}` });
      return `${typeDecl};\nconst x${i}: R${i}[] = ${JSON.stringify(rows)};\n`;
    })
    .join('\n');
}

const KEY = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('id', 'name', 'total', 'tags', 'meta', 'first name', 'x-y', '', '$', 'constructor', 'toString', 'valueOf', '__proto__') },
  { weight: 1, arbitrary: fc.string({ maxLength: 4 }) },
);
const ROW = fc.dictionary(KEY, fc.jsonValue({ maxDepth: 3 }), { maxKeys: 6 }) as fc.Arbitrary<Record<string, unknown>>;
const DATASET = fc.array(ROW, { maxLength: 6 });

describe('inferDataset: declared type compiles for every row (TypeScript, strict)', () => {
  it('the checker is real: a wrong type is rejected', () => {
    expect(typeCheck('type R = { a: number };\nconst x: R[] = [{"a":"s"}];\n').length).toBeGreaterThan(0);
    expect(typeCheck('type R = { a: number };\nconst x: R[] = [{"a":1},{}];\n').length).toBeGreaterThan(0);
    expect(typeCheck('type R = { a: number };\nconst x: R[] = [{"a":1}];\n')).toEqual([]);
  });

  it('hand-picked tricky datasets', () => {
    const cases: Array<Array<Record<string, unknown>>> = [
      [],
      [{}],
      [{ a: [] }, { a: [[]] }, { a: [[1, null]] }],
      [{ a: { b: { c: [] } } }, { a: { b: {} } }, { a: null }],
      [{ v: 1 }, { v: [1, 'x'] }, { v: { k: [{ z: true }, {}] } }, { v: null }],
      [{ 'a"b': 1, 'a\\b': 2, ' ': 3, '😀': 4 }],
      JSON.parse('[{"__proto__": {"a": 1}, "b": 1}, {"__proto__": null}, {}]') as Array<Record<string, unknown>>,
      [{ toString: 'x', valueOf: 1, hasOwnProperty: [] }, { constructor: { a: 1 } }, {}],
    ];
    expect(typeCheck(checkSource(cases))).toEqual([]);
  });

  it('fast-check generated row sets (batched into one program)', () => {
    const datasets = fc.sample(DATASET, { numRuns: 250, seed: 20241004 });
    const source = checkSource(datasets);
    const diags = typeCheck(source);
    expect(diags, diags.slice(0, 3).join('\n')).toEqual([]);
  }, 60_000);

  it('fast-check: shared keys across rows (optional/union heavy)', () => {
    const narrowRow = fc.record(
      {
        id: fc.oneof(fc.integer(), fc.constant(null)),
        name: fc.string({ maxLength: 3 }),
        tags: fc.array(fc.oneof(fc.string({ maxLength: 2 }), fc.integer()), { maxLength: 3 }),
        meta: fc.oneof(fc.record({ a: fc.integer(), b: fc.boolean() }, { requiredKeys: ['a'] }), fc.constant(null), fc.array(fc.jsonValue({ maxDepth: 1 }), { maxLength: 2 })),
      },
      { requiredKeys: [] },
    ) as fc.Arbitrary<Record<string, unknown>>;
    const datasets = fc.sample(fc.array(narrowRow, { minLength: 1, maxLength: 8 }), { numRuns: 250, seed: 5 });
    const diags = typeCheck(checkSource(datasets));
    expect(diags, diags.slice(0, 3).join('\n')).toEqual([]);
  }, 60_000);
});

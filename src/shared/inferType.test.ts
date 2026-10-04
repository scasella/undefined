import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import fc from 'fast-check';
import { inferType } from './inferType';

/** The inferred text ends up as a parameter annotation, so it must parse as a TS type. */
function assertValidType(t: string): void {
  const out = ts.transpileModule(`let x: ${t};`, { reportDiagnostics: true, compilerOptions: { strict: true } });
  expect(out.diagnostics ?? [], t).toEqual([]);
}

const cases: Array<[string, unknown, string]> = [
  ['number', 1, 'number'],
  ['NaN', NaN, 'number'],
  ['string', 'a', 'string'],
  ['boolean', false, 'boolean'],
  ['bigint', 1n, 'bigint'],
  ['null', null, 'null'],
  ['undefined', undefined, 'undefined'],
  ['number[]', [1, 2], 'number[]'],
  ['mixed array', [1, 'a'], '(number | string)[]'],
  ['first-seen order', ['a', 1, 'b', 2], '(string | number)[]'],
  ['nullable', [1, null], '(number | null)[]'],
  ['booleans', [true, false], 'boolean[]'],
  ['empty array', [], 'unknown[]'],
  ['nested arrays', [[1], [2]], 'number[][]'],
  ['nested empty', [[]], 'unknown[][]'],
  ['nested mixed', [[1], ['a']], '(number[] | string[])[]'],
  ['object', { a: 1, b: ['x'] }, '{ a: number; b: string[] }'],
  ['empty object', {}, '{}'],
  ['quoted keys', { 'my key': 1, $ok: true, '1x': null }, '{ "my key": number; $ok: boolean; "1x": null }'],
  ['nested object', { p: { x: 1, y: 2 } }, '{ p: { x: number; y: number } }'],
  ['array of objects', [{ id: 1 }, { id: 2 }], '{ id: number }[]'],
  ['array of differing objects', [{ id: 1 }, { name: 'a' }], '({ id: number } | { name: string })[]'],
  ['map', new Map([['a', 1]]), 'Map<string, number>'],
  ['map with mixed keys', new Map<unknown, unknown>([['a', 1], [2, [true]]]), 'Map<string | number, number | boolean[]>'],
  ['empty map', new Map(), 'Map<unknown, unknown>'],
  ['set', new Set([1, 'a']), 'Set<number | string>'],
  ['empty set', new Set(), 'Set<unknown>'],
  ['date', new Date(0), 'Date'],
  ['null-prototype object', Object.assign(Object.create(null) as object, { a: 1 }), '{ a: number }'],
];

describe('inferType', () => {
  it.each(cases)('%s', (_label, value, expected) => {
    expect(inferType(value)).toBe(expected);
    assertValidType(expected);
  });

  it('shared (non-cyclic) references are fine', () => {
    const shared = [1];
    expect(inferType({ a: shared, b: shared })).toBe('{ a: number[]; b: number[] }');
  });

  it('rejects functions, symbols, class instances and cycles', () => {
    class Point {
      x = 1;
    }
    expect(() => inferType(() => 1)).toThrow('function arguments are not supported');
    expect(() => inferType([Symbol()])).toThrow('symbol arguments are not supported');
    expect(() => inferType(new Point())).toThrow('class instance (Point) arguments are not supported');
    expect(() => inferType(new Uint8Array(1))).toThrow('class instance (Uint8Array) arguments are not supported');
    const cyc: unknown[] = [];
    cyc.push(cyc);
    expect(() => inferType(cyc)).toThrow('cyclic arguments are not supported');
  });

  it('always yields parseable type text for JSON-like values (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 3 }), (v) => {
        assertValidType(inferType(v));
      }),
      { seed: 7, numRuns: 200 },
    );
  });
});

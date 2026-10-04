import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseJsonData, type JsonDataResult } from './json';

function ok(r: JsonDataResult): Extract<JsonDataResult, { rows: unknown }> {
  if ('error' in r) throw new Error(`expected rows, got error: ${r.error}`);
  return r;
}
function err(r: JsonDataResult): string {
  if (!('error' in r)) throw new Error('expected an error');
  return r.error;
}

describe('parseJsonData', () => {
  it('accepts an array of objects and preserves value types', () => {
    const r = ok(parseJsonData('[{"id":1,"ok":true,"n":null,"tags":["a"],"o":{"x":1.5}},{"id":-2e3}]'));
    expect(r.shape).toBe('array');
    expect(r.rows).toEqual([{ id: 1, ok: true, n: null, tags: ['a'], o: { x: 1.5 } }, { id: -2000 }]);
    expect(r.warnings).toEqual([]);
  });

  it('accepts surrounding whitespace and a BOM', () => {
    expect(ok(parseJsonData('﻿  \n[{"a":1}]\n ')).rows).toEqual([{ a: 1 }]);
  });

  it('takes the single array-of-objects property of an object, naming it', () => {
    const r = ok(parseJsonData('{"meta":{"page":1},"count":2,"orders":[{"id":1},{"id":2}],"empty":[]}'));
    expect(r.shape).toBe('object-with-array');
    expect(r.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(r.warnings).toEqual(['Used the "orders" property (2 rows); ignored "meta", "count", "empty".']);
  });

  it('an object whose only property is the array has a short warning', () => {
    expect(ok(parseJsonData('{"data":[{"a":1}]}')).warnings).toEqual(['Used the "data" property (1 row).']);
  });

  it('rejects an object with several arrays of objects, listing them', () => {
    expect(err(parseJsonData('{"a":[{"x":1}],"b":[{"y":2}]}'))).toBe(
      'The JSON object has 2 arrays of objects ("a", "b"); it is ambiguous which one to import. Paste just the one you want.',
    );
  });

  it('rejects an object with no array of objects, listing its keys', () => {
    expect(err(parseJsonData('{"a":1,"b":[1,2]}'))).toMatch(/none of its properties is a non-empty array of objects \(its properties are "a", "b"\)/);
    expect(err(parseJsonData('{}'))).toMatch(/it has no properties/);
  });

  it('rejects scalars with what they are', () => {
    expect(err(parseJsonData('42'))).toMatch(/^The JSON is a number, not an array of objects/);
    expect(err(parseJsonData('"hi"'))).toMatch(/^The JSON is a string/);
    expect(err(parseJsonData('null'))).toMatch(/^The JSON is null/);
    expect(err(parseJsonData('true'))).toMatch(/^The JSON is a boolean/);
  });

  it('wraps non-object elements as { value } with a warning', () => {
    const r = ok(parseJsonData('[1, {"a":2}, "s", null, [3]]'));
    expect(r.rows).toEqual([{ value: 1 }, { a: 2 }, { value: 's' }, { value: null }, { value: [3] }]);
    expect(r.warnings).toEqual(['4 of 5 elements were not an object (rows 1, 3, 4, 5); each was wrapped as { value: … }.']);
  });

  it('empty array → no rows, with a warning', () => {
    const r = ok(parseJsonData('[]'));
    expect(r.rows).toEqual([]);
    expect(r.warnings).toEqual(['The array is empty: there are no rows.']);
  });

  it('accepts JSON Lines (blank lines and CRLF ok)', () => {
    const r = ok(parseJsonData('{"id":1,"x":[1]}\r\n\r\n{"id":2,"x":null}\n7\n'));
    expect(r.shape).toBe('jsonl');
    expect(r.rows).toEqual([{ id: 1, x: [1] }, { id: 2, x: null }, { value: 7 }]);
    expect(r.warnings).toEqual(['1 of 3 lines was not an object (row 3); each was wrapped as { value: … }.']);
  });

  it('reports the bad line of almost-valid JSON Lines', () => {
    expect(err(parseJsonData('{"a":1}\n{"a":2}\n{"a":\n{"a":4}'))).toMatch(/^This looks like JSON Lines, but line 3: /);
  });

  it('reports a precise syntax error with line and column', () => {
    const e = err(parseJsonData('[\n  {"a": 1},\n  {"a": 2,}\n]'));
    expect(e).toMatch(/^This is not valid JSON: /);
    expect(e).toMatch(/line 3/);
    expect(e).toMatch(/column \d+/);
  });

  it('empty input is an error', () => {
    expect(err(parseJsonData(''))).toBe('Nothing to import: the input is empty.');
    expect(err(parseJsonData(' \n '))).toBe('Nothing to import: the input is empty.');
  });

  it('keeps a "__proto__" key as an own property', () => {
    const r = ok(parseJsonData('[{"__proto__":{"x":1},"b":2}]'));
    expect(Object.keys(r.rows[0]!)).toEqual(['__proto__', 'b']);
    expect(Object.getPrototypeOf(r.rows[0])).toBe(Object.prototype);
  });

  it('never throws and always returns rows XOR error (property)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.array(fc.json()).map((xs) => xs.join('\n'))), (text) => {
        const r = parseJsonData(text);
        if ('error' in r) {
          expect(typeof r.error).toBe('string');
          expect(r.error.length).toBeGreaterThan(0);
        } else {
          for (const row of r.rows) expect(typeof row === 'object' && row !== null && !Array.isArray(row)).toBe(true);
        }
      }),
      { numRuns: 500, seed: 3 },
    );
  });

  it('round-trips any array of JSON objects exactly (property)', () => {
    const obj = fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 3 }));
    fc.assert(
      fc.property(fc.array(obj, { maxLength: 6 }), (rows) => {
        const r = ok(parseJsonData(JSON.stringify(rows)));
        expect(r.rows).toEqual(JSON.parse(JSON.stringify(rows)));
      }),
      { numRuns: 200, seed: 11 },
    );
  });
});

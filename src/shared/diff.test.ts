import { describe, expect, it } from 'vitest';
import { firstDifference, formatDifference } from './diff';
import { show } from './show';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('firstDifference', () => {
  it('names the first differing array index when show() renders both the same', () => {
    const a = range(60);
    const b = range(60);
    b[59] = 99;
    expect(show(a)).toBe(show(b));
    const d = firstDifference(a, b)!;
    expect(d).toEqual({ path: '[59]', actual: '59', expected: '99' });
    expect(formatDifference(d)).toBe('[59]: 59 vs 99');
  });

  it('shows a window around the first differing character of long strings', () => {
    const a = 'x'.repeat(250) + 'A' + 'y'.repeat(49);
    const b = 'x'.repeat(250) + 'B' + 'y'.repeat(49);
    expect(show(a)).toBe(show(b));
    expect(firstDifference(a, b)).toEqual({ path: '[250]', actual: '"…xxxxxxxxxxxxAyyyyyyyyyyy…"', expected: '"…xxxxxxxxxxxxByyyyyyyyyyy…"' });
  });

  it('walks objects, Maps, nested arrays and lengths', () => {
    expect(firstDifference({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toEqual({ path: '.a.b[1]', actual: '2', expected: '3' });
    expect(firstDifference({ 'a b': 1 }, {})).toEqual({ path: '["a b"]', actual: '1', expected: '(missing)' });
    expect(firstDifference(new Map([['k', [1]]]), new Map([['k', [2]]]))).toEqual({ path: '.get("k")[0]', actual: '1', expected: '2' });
    expect(firstDifference([1, 2], [1, 2, 3])).toEqual({ path: '.length', actual: '2', expected: '3' });
    expect(firstDifference(new Set([1, 2]), new Set([1, 3]))).toEqual({ path: '', actual: 'contains 2', expected: 'does not contain 2' });
    expect(firstDifference(-0, 0)).toEqual({ path: '', actual: '-0', expected: '0' });
  });

  it('returns null for equal values, cycles, and uninformative differences', () => {
    expect(firstDifference([1, NaN, { a: 1n }], [1, NaN, { a: 1n }])).toBeNull();
    const c1: unknown[] = [1];
    c1.push(c1);
    const c2: unknown[] = [1];
    c2.push(c2);
    expect(firstDifference(c1, c2)).toBeNull();
    expect(firstDifference(function f() {}, function f() {})).toBeNull();
  });
});

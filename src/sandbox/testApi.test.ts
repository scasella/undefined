import { describe, expect, it } from 'vitest';
import { InvariantViolation } from './mask';
import { AssertionFailure, deepEqual, eq, isAssertionFailure, registerCases, throws, type PropertyCase } from './testApi';

describe('deepEqual', () => {
  it('uses Object.is for primitives', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
  });

  it('compares bigints by value', () => {
    expect(deepEqual(2880067194370816120n, 2880067194370816120n)).toBe(true);
    expect(deepEqual(1n, 1)).toBe(false);
    expect(deepEqual([1n, { a: 2n }], [1n, { a: 2n }])).toBe(true);
  });

  it('compares arrays and plain objects deeply', () => {
    expect(deepEqual([1, [2, { x: [3] }]], [1, [2, { x: [3] }]])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({ 0: 1, length: 1 }, [1])).toBe(false);
  });

  it('compares Map, Set and Date', () => {
    expect(deepEqual(new Map([['a', [1]]]), new Map([['a', [1]]]))).toBe(true);
    expect(deepEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
    expect(deepEqual(new Set([1, { a: 1 }]), new Set([{ a: 1 }, 1]))).toBe(true);
    expect(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]))).toBe(false);
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(new Date(NaN), new Date(NaN))).toBe(true);
    expect(deepEqual(new Map(), new Set())).toBe(false);
  });

  it('compares typed arrays and handles cycles', () => {
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(deepEqual(new Uint8Array([1, 2]), new Int8Array([1, 2]))).toBe(false);
    const a: { self?: unknown } = {};
    a.self = a;
    const b: { self?: unknown } = {};
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });
});

describe('eq / throws', () => {
  it('eq throws an AssertionFailure carrying both values', () => {
    expect(() => eq([1], [1])).not.toThrow();
    try {
      eq(1, 1.5);
      expect.unreachable();
    } catch (e) {
      expect(isAssertionFailure(e)).toBe(true);
      const f = e as AssertionFailure;
      expect(f.actual).toBe(1);
      expect(f.expected).toBe(1.5);
      expect(f.actualShown).toBe('1');
      expect(f.expectedShown).toBe('1.5');
      expect(f.actualIsValue).toBe(true);
      expect(f.message).toBe('expected 1.5, got 1');
    }
    expect(() => eq(1n, 2n, 'custom')).toThrow('custom');
  });

  it('throws() checks that something was thrown, optionally matching', () => {
    expect(() => throws(() => { throw new RangeError('empty input'); })).not.toThrow();
    expect(() => throws(() => { throw new RangeError('empty input'); }, /empty/)).not.toThrow();
    expect(() => throws(() => { throw new RangeError('empty input'); }, 'input')).not.toThrow();
    expect(() => throws(() => 1)).toThrow('nothing was thrown');
    try {
      throws(() => { throw new Error('other'); }, /empty/);
      expect.unreachable();
    } catch (e) {
      const f = e as AssertionFailure;
      expect(isAssertionFailure(f)).toBe(true);
      expect(f.actualShown).toBe('Error: other');
      expect(f.expectedShown).toBe('an error matching /empty/');
      expect(f.actualIsValue).toBe(false);
    }
  });

  it('throws() rethrows InvariantViolation untouched', () => {
    const v = new InvariantViolation('fetch');
    try {
      throws(() => { throw v; });
      expect.unreachable();
    } catch (e) {
      expect(e).toBe(v);
    }
  });
});

describe('registerCases', () => {
  const double = (...args: unknown[]): unknown => (args[0] as number) * 2;

  it('collects tests and properties with the candidate in scope', () => {
    const cases = registerCases(
      `test('doubles', () => eq(double(2), 4));
       property('even', [fc.integer()], (n) => double(n) % 2 === 0, { numRuns: 7 });
       export {};`,
      'double',
      double,
    );
    expect(cases.map((c) => [c.kind, c.name])).toEqual([['test', 'doubles'], ['property', 'even']]);
    expect((cases[1] as PropertyCase).numRuns).toBe(7);
    if (cases[0].kind === 'test') cases[0].body(); // passes
  });

  it('lets a candidate named like an API function shadow it', () => {
    const cases = registerCases(`test('t', () => { if (eq(1) !== 'mine') throw new Error('not shadowed'); });`, 'eq', () => 'mine');
    expect(cases).toHaveLength(1);
    if (cases[0].kind === 'test') expect(() => (cases[0] as { body: () => void }).body()).not.toThrow();
  });

  it('rejects malformed registrations at load time', () => {
    expect(() => registerCases(`property('p', fc.integer(), () => true)`, 'f', double)).toThrow(/non-empty array/);
    expect(() => registerCases(`property('p', [], () => true)`, 'f', double)).toThrow(/non-empty array/);
    expect(() => registerCases(`test(42, () => {})`, 'f', double)).toThrow(/name string/);
    expect(() => registerCases(`test('x', () => {`, 'f', double)).toThrow(SyntaxError);
    expect(() => registerCases(`property('p', [fc.nat()], () => true, { numRuns: 0 })`, 'f', double)).toThrow(/numRuns/);
  });

  it('matchesReference compares candidate and reference on separate clones', () => {
    const sortInPlace = (...args: unknown[]): unknown => (args[0] as number[]).sort((a, b) => a - b)[0];
    const [c] = registerCases(`matchesReference('min', [fc.array(fc.integer())], (xs) => xs.length ? Math.min(...xs) : undefined)`, 'f', sortInPlace) as PropertyCase[];
    const input = [3, 1, 2];
    expect(() => c.predicate(input)).not.toThrow();
    expect(input).toEqual([3, 1, 2]);
    const [bad] = registerCases(`matchesReference('min', [fc.array(fc.integer())], (xs) => -1)`, 'f', sortInPlace) as PropertyCase[];
    expect(() => bad.predicate([3, 1, 2])).toThrow('expected -1, got 1');
  });

  it('matchesReference requires the candidate to throw when the reference throws', () => {
    const src = `matchesReference('r', [fc.nat()], (n) => { if (n === 0) throw new RangeError('zero'); return n; })`;
    const [lenient] = registerCases(src, 'f', (...a) => a[0]) as PropertyCase[];
    expect(() => lenient.predicate(0)).toThrow(/expected to throw \(reference threw RangeError: zero\), got 0/);
    const [strict] = registerCases(src, 'f', (...a) => {
      if (a[0] === 0) throw new Error('nope');
      return a[0];
    }) as PropertyCase[];
    expect(() => strict.predicate(0)).not.toThrow();
    expect(() => strict.predicate(3)).not.toThrow();
  });
});

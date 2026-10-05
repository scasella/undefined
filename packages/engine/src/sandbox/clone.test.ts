/**
 * The Node realm's structuredClone (clone.ts) against the native one: same shapes, same values, same refusals.
 * (Risk 3 of docs/WORKSPACE-DESIGN.md §9: a divergence would change what candidates see on the Node host.)
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { structuredClonePolyfill as clone } from './clone';

const anything = fc.anything({
  withBigInt: true,
  withBoxedValues: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withNullPrototype: true,
  withObjectString: true,
  withSparseArray: true,
  withTypedArray: true,
  maxDepth: 3,
});

describe('structuredClonePolyfill', () => {
  it('agrees with the native structuredClone on fc.anything()', () => {
    fc.assert(
      fc.property(anything, (v) => {
        const native = structuredClone(v);
        const mine = clone(v);
        expect(mine).toStrictEqual(native);
        if (typeof v === 'object' && v !== null) expect(mine).not.toBe(v);
      }),
      { numRuns: 300, seed: 7 },
    );
  });

  it('keeps holes, -0, NaN, extra array properties, shared references and cycles', () => {
    const shared = { s: 1 };
    const arr: unknown[] = [1, , -0, NaN]; // eslint-disable-line no-sparse-arrays
    (arr as unknown as Record<string, unknown>).extra = 'x';
    const v: Record<string, unknown> = { a: shared, b: shared, arr };
    v.self = v;
    const c = clone(v);
    expect(c).toStrictEqual(structuredClone(v));
    expect(1 in (c.arr as unknown[])).toBe(false);
    expect(Object.is((c.arr as unknown[])[2], -0)).toBe(true);
    expect(c.a).toBe(c.b);
    expect(c.self).toBe(c);
  });

  it('clones Date, RegExp, Map, Set, typed arrays sharing a buffer, and Errors by their native type', () => {
    const buf = new ArrayBuffer(8);
    const v = {
      d: new Date(5),
      r: /a+/gi,
      m: new Map([[{ k: 1 }, new Set([1n])]]),
      u8: new Uint8Array(buf, 0, 4),
      i16: new Int16Array(buf, 4, 2),
      e: new RangeError('boom'),
      custom: Object.assign(new (class MyError extends Error {})('mine'), { name: 'MyError' }),
    };
    const c = clone(v);
    expect(c).toStrictEqual(structuredClone(v));
    expect(c.u8.buffer).toBe(c.i16.buffer);
    expect(c.e).toBeInstanceOf(RangeError);
    expect(c.e.message).toBe('boom');
    expect(Object.getPrototypeOf(c.custom)).toBe(Error.prototype);
  });

  it('turns class instances into plain objects and invokes getters, as natively', () => {
    class P {
      x = 1;
      get y(): number {
        return 2;
      }
    }
    const o = { p: new P(), get g() { return 3; } };
    expect(clone(o)).toStrictEqual(structuredClone(o));
    expect(Object.getPrototypeOf(clone(o).p)).toBe(Object.prototype);
  });

  it('refuses functions, symbols, WeakMap and Promise with a DataCloneError', () => {
    for (const v of [() => 1, Symbol('s'), { f: () => 1 }, new WeakMap(), Promise.resolve(1)]) {
      expect(() => structuredClone(v)).toThrow();
      expect(() => clone(v)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    }
  });
});

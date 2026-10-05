import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Json } from '../types';
import { decodeEnv, decodeValue, encodeEnv, encodeValue } from './serialize';

/** Strict structural equality: Object.is for primitives, holes vs undefined, own key sets, Date times. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof Map) {
    const bm = b as Map<unknown, unknown>;
    if (a.size !== bm.size) return false;
    const be = [...bm.entries()];
    return [...a.entries()].every(([k, v], i) => deepEqual(k, be[i]![0]) && deepEqual(v, be[i]![1]));
  }
  if (a instanceof Set) {
    const bs = [...(b as Set<unknown>)];
    return a.size === bs.length && [...a].every((v, i) => deepEqual(v, bs[i]));
  }
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (i in a !== i in bb || !deepEqual(a[i], bb[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const roundTrip = (v: unknown): unknown => decodeValue(JSON.parse(JSON.stringify(encodeValue(v))) as Json);

const key = fc.oneof(fc.string(), fc.constantFrom('$t', '__proto__', 'v', 'show', 'constructor'));

const { value: serializable } = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    tie('leaf'),
    tie('array'),
    tie('object'),
    tie('map'),
    tie('set'),
  ),
  leaf: fc.oneof(
    fc.string(),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.double(), // includes NaN, ±Infinity, -0
    fc.integer(),
    fc.bigInt(),
    fc.date({ noInvalidDate: false }),
  ),
  array: fc.oneof(fc.array(tie('value'), { maxLength: 5 }), fc.sparseArray(tie('value'), { maxLength: 6 })),
  // null-prototype objects decode with Object.prototype (documented), so they are excluded here
  object: fc.dictionary(key, tie('value'), { maxKeys: 5, noNullPrototype: true }),
  map: fc.array(fc.tuple(tie('value'), tie('value')), { maxLength: 4 }).map((es) => new Map(es)),
  set: fc.array(tie('value'), { maxLength: 4 }).map((xs) => new Set(xs)),
}));

describe('encodeValue / decodeValue', () => {
  it('round-trips every serializable value through JSON text (property)', () => {
    fc.assert(
      fc.property(serializable, (x) => {
        const json = JSON.stringify(encodeValue(x));
        expect(deepEqual(roundTrip(x), x)).toBe(true);
        // encoding is itself pure JSON: re-stringifying the parsed text is stable
        expect(JSON.stringify(JSON.parse(json))).toBe(json);
      }),
      { seed: 1234, numRuns: 1000 },
    );
  });

  it('encodes special numbers, bigint, undefined with tags (not null)', () => {
    expect(encodeValue(NaN)).toEqual({ $t: 'number', v: 'NaN' });
    expect(encodeValue(-Infinity)).toEqual({ $t: 'number', v: '-Infinity' });
    expect(encodeValue(-0)).toEqual({ $t: 'number', v: '-0' });
    expect(encodeValue(10n ** 30n)).toEqual({ $t: 'bigint', v: '1000000000000000000000000000000' });
    expect(encodeValue([undefined])).toEqual([{ $t: 'undefined' }]);
    expect(encodeValue({ a: 1, b: [true, 'x', null] })).toEqual({ a: 1, b: [true, 'x', null] });
    expect(Object.is(roundTrip(-0), -0)).toBe(true);
  });

  it('dates, including invalid ones', () => {
    const d = roundTrip(new Date('2020-01-01T00:00:00.000Z'));
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(Number.isNaN((roundTrip(new Date(NaN)) as Date).getTime())).toBe(true);
  });

  it('escapes objects with a "$t" key', () => {
    const tricky = { $t: 'unserializable', show: 'x' };
    expect(encodeValue(tricky)).toEqual({ $t: 'object', v: { $t: 'unserializable', show: 'x' } });
    expect(roundTrip(tricky)).toEqual(tricky);
    expect(roundTrip({ $t: 'bigint', v: '1' })).toEqual({ $t: 'bigint', v: '1' });
  });

  it('keeps "__proto__" as an own data property', () => {
    const o = JSON.parse('{"__proto__": {"polluted": 1}, "a": 2}') as object;
    const back = roundTrip(o) as Record<string, unknown>;
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(Object.keys(back)).toEqual(['__proto__', 'a']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('preserves sparse array holes', () => {
    const back = roundTrip(new Array(3)) as unknown[];
    expect(back.length).toBe(3);
    expect(0 in back).toBe(false);
  });

  it('unserializable values become a placeholder that decodes to undefined', () => {
    class Point {
      x = 1;
    }
    const cases: Array<[unknown, string]> = [
      [function f() {}, '[Function f]'],
      [Symbol('s'), 'Symbol(s)'],
      [new Point(), 'Point { x: 1 }'],
      [new Uint8Array([1]), 'Uint8Array(1) [1]'],
      [new Error('e'), 'Error: e'],
    ];
    for (const [v, shown] of cases) {
      expect(encodeValue(v)).toEqual({ $t: 'unserializable', show: shown });
      expect(roundTrip(v)).toBeUndefined();
    }
    expect(roundTrip({ a: 1, f: () => 1 })).toEqual({ a: 1, f: undefined });
  });

  it('a cycle makes the whole value unserializable', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(encodeValue(o)).toEqual({ $t: 'unserializable', show: '{ a: 1, self: [Circular] }' });
    // shared references are not cycles
    const shared = [1];
    expect(roundTrip([shared, shared])).toEqual([[1], [1]]);
  });

  it('never invokes getters and never throws on hostile objects', () => {
    let called = false;
    const o = {
      get g(): number {
        called = true;
        return 1;
      },
    };
    expect(encodeValue(o)).toEqual({ g: { $t: 'unserializable', show: '[Getter]' } });
    expect(called).toBe(false);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(encodeValue(proxy)).toEqual({ $t: 'unserializable', show: '[Unshowable]' });
  });

  it('decoding malformed or unknown tags is lenient', () => {
    expect(decodeValue({ $t: 'nope' })).toBeUndefined();
    expect(decodeValue({ $t: 'bigint', v: 'not a number' })).toBeUndefined();
    expect(decodeValue({ $t: 'number', v: '42' })).toBeUndefined();
    expect(decodeValue({ $t: 'Map', v: 3 })).toEqual(new Map());
  });
});

describe('encodeEnv / decodeEnv', () => {
  it('reports keys that lost information, at any depth', () => {
    const { env, unserializable } = encodeEnv({ n: 1n, f: () => 1, nested: { list: [Symbol()] }, ok: new Map([[1, 'a']]) });
    expect(unserializable).toEqual(['f', 'nested']);
    const back = decodeEnv(JSON.parse(JSON.stringify(env)) as Record<string, Json>);
    expect(back.unserializable).toEqual(['f', 'nested']);
    expect(back.env.n).toBe(1n);
    expect(back.env.f).toBeUndefined();
    expect(back.env.ok).toEqual(new Map([[1, 'a']]));
  });

  it('does not mistake an escaped user object for a placeholder', () => {
    const { env, unserializable } = encodeEnv({ x: { $t: 'unserializable' } });
    expect(unserializable).toEqual([]);
    expect(decodeEnv(env).unserializable).toEqual([]);
  });
});

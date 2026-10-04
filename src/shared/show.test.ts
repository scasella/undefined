import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { callString, show } from './show';

describe('show: primitives', () => {
  it.each([
    ['a', '"a"'],
    ['say "hi"\n', '"say \\"hi\\"\\n"'],
    [1, '1'],
    [1.5, '1.5'],
    [-0, '-0'],
    [0, '0'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-Infinity, '-Infinity'],
    [1n, '1n'],
    [-12345678901234567890n, '-12345678901234567890n'],
    [true, 'true'],
    [undefined, 'undefined'],
    [null, 'null'],
    [Symbol('s'), 'Symbol(s)'],
    [Symbol(), 'Symbol()'],
  ])('%s', (v, expected) => {
    expect(show(v)).toBe(expected);
  });
});

describe('show: containers', () => {
  it('arrays', () => {
    expect(show([1, 2, 3])).toBe('[1, 2, 3]');
    expect(show([])).toBe('[]');
    expect(show([[1], [2, [3]]])).toBe('[[1], [2, [3]]]');
    expect(show(['a', null, undefined])).toBe('["a", null, undefined]');
  });

  it('sparse arrays show holes as <empty>', () => {
    expect(show(new Array(2))).toBe('[<empty>, <empty>]');
    // eslint-disable-next-line no-sparse-arrays
    expect(show([1, , 3])).toBe('[1, <empty>, 3]');
  });

  it('plain objects in insertion order, quoting non-identifier keys', () => {
    expect(show({ a: 1, b: 'x' })).toBe('{ a: 1, b: "x" }');
    expect(show({})).toBe('{}');
    expect(show({ b: 1, a: 2 })).toBe('{ b: 1, a: 2 }');
    expect(show({ 'my key': 1, $ok: 2, '1x': 3 })).toBe('{ "my key": 1, $ok: 2, "1x": 3 }');
    expect(show(Object.create(null))).toBe('{}');
    expect(show({ nested: { deep: [1] } })).toBe('{ nested: { deep: [1] } }');
  });

  it('Map and Set', () => {
    expect(show(new Map([['a', 1]]))).toBe('Map(1) { "a" => 1 }');
    expect(show(new Map())).toBe('Map(0) {}');
    expect(show(new Set([1, 2]))).toBe('Set(2) { 1, 2 }');
    expect(show(new Set())).toBe('Set(0) {}');
    expect(show(new Map([[{ k: 1 }, new Set(['x'])]]))).toBe('Map(1) { { k: 1 } => Set(1) { "x" } }');
  });

  it('typed arrays', () => {
    expect(show(new Uint8Array([1, 2, 3]))).toBe('Uint8Array(3) [1, 2, 3]');
    expect(show(new Float64Array(0))).toBe('Float64Array(0) []');
    expect(show(new BigInt64Array([1n]))).toBe('BigInt64Array(1) [1n]');
  });
});

describe('show: other objects', () => {
  it('dates', () => {
    expect(show(new Date('2020-01-01T00:00:00.000Z'))).toBe('Date(2020-01-01T00:00:00.000Z)');
    expect(show(new Date(NaN))).toBe('Invalid Date');
    class MyDate extends Date {}
    expect(show(new MyDate(0))).toBe('Date(1970-01-01T00:00:00.000Z)');
  });

  it('functions', () => {
    function median() {}
    expect(show(median)).toBe('[Function median]');
    expect(show([() => 1][0])).toBe('[Function (anonymous)]');
    expect(show(Math.max)).toBe('[Function max]');
  });

  it('errors', () => {
    expect(show(new Error('boom'))).toBe('Error: boom');
    expect(show(new RangeError('bad'))).toBe('RangeError: bad');
    expect(show(new Error())).toBe('Error');
  });

  it('class instances and regexps', () => {
    class Point {
      constructor(public x: number) {}
    }
    expect(show(new Point(1))).toBe('Point { x: 1 }');
    expect(show(/a+/g)).toBe('/a+/g');
  });

  it('cycles', () => {
    const a: unknown[] = [1];
    a.push(a);
    expect(show(a)).toBe('[1, [Circular]]');
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(show(o)).toBe('{ a: 1, self: [Circular] }');
  });

  it('a shared (non-cyclic) reference is shown twice, not as [Circular]', () => {
    const shared = [1];
    expect(show([shared, shared])).toBe('[[1], [1]]');
  });
});

describe('show: never throws', () => {
  it('does not invoke getters', () => {
    let called = false;
    const o = {
      get bad(): number {
        called = true;
        throw new Error('no');
      },
      set w(_x: number) {},
    };
    expect(show(o)).toBe('{ bad: [Getter], w: [Setter] }');
    expect(called).toBe(false);
  });

  it('revoked proxies and hostile proxies', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(show(proxy)).toBe('[Unshowable]');
    expect(show([proxy])).toBe('[Unshowable]');
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('x');
        },
        getPrototypeOf() {
          throw new Error('x');
        },
      },
    );
    expect(typeof show(hostile)).toBe('string');
  });

  it('error with a throwing message getter', () => {
    const e = new Error('x');
    Object.defineProperty(e, 'message', {
      get() {
        throw new Error('no');
      },
    });
    expect(typeof show(e)).toBe('string');
  });

  it('never throws and is deterministic for arbitrary values', () => {
    fc.assert(
      fc.property(fc.anything({ withBigInt: true, withMap: true, withSet: true, withDate: true, withTypedArray: true, withSparseArray: true, withNullPrototype: true, withBoxedValues: true }), (v) => {
        const s = show(v);
        expect(typeof s).toBe('string');
        expect(s.length).toBeLessThanOrEqual(200);
        expect(show(v)).toBe(s);
      }),
      { seed: 42, numRuns: 500 },
    );
  });
});

describe('show: truncation and bounded work', () => {
  it('long strings are cut to 200 chars ending in …', () => {
    const s = show('x'.repeat(1000));
    expect(s.length).toBe(200);
    expect(s.endsWith('…')).toBe(true);
    expect(s.startsWith('"xxx')).toBe(true);
  });

  it('more than 20 entries: first 20 then "… N more"', () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    expect(show(arr)).toBe(`[${arr.slice(0, 20).join(', ')}, … 5 more]`);
    const obj = Object.fromEntries(arr.map((i) => [`k${i}`, i]));
    expect(show(obj)).toMatch(/k19: 19, … 5 more \}$/);
    expect(show(new Map(arr.map((i) => [i, i])))).toMatch(/^Map\(25\) \{ 0 => 0, .* … 5 more \}$|…$/);
    expect(show(new Set(arr))).toMatch(/^Set\(25\) \{ 0, 1, .*19, … 5 more \}$/);
  });

  it('exactly 20 entries are all shown', () => {
    const arr = Array.from({ length: 20 }, () => 0);
    expect(show(arr)).toBe(`[${arr.join(', ')}]`);
  });

  it('long containers are cut', () => {
    const s = show(Array.from({ length: 20 }, () => 'abcdefghijklmnop'));
    expect(s.length).toBe(200);
    expect(s.endsWith('…')).toBe(true);
  });

  it('huge sparse arrays render instantly', () => {
    const s = show(new Array(1e9));
    expect(s.startsWith('[<empty>, <empty>')).toBe(true);
  });

  it('wide, deep trees do bounded work', () => {
    let tree: unknown = 1;
    for (let d = 0; d < 10; d++) {
      const level = tree;
      tree = Array.from({ length: 20 }, () => level); // 20^10 leaves if fully walked
    }
    const t0 = Date.now();
    const s = show(tree);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(s.length).toBe(200);
  });

  it('very deep nesting is elided, no stack overflow', () => {
    let deep: unknown = [];
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(show(deep)).toBe('[[[[[[[[[Array]]]]]]]]]');
    let obj: unknown = {};
    for (let i = 0; i < 20; i++) obj = { a: obj };
    expect(show(obj)).toContain('[Object]');
  });
});

describe('callString', () => {
  it('formats calls', () => {
    expect(callString('median', [[1, 2]])).toBe('median([1, 2])');
    expect(callString('f', [])).toBe('f()');
    expect(callString('slugify', ['Crème Brûlée', 2, { a: 1n }])).toBe('slugify("Crème Brûlée", 2, { a: 1n })');
  });
});

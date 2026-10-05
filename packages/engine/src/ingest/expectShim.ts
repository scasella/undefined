/**
 * The `expect` subset for vitest test files (docs/WORKSPACE-DESIGN.md §3.3), as Test API source text.
 *
 * It is prepended to the tests/properties source generated from a vitest file, so it is part of the hashed spec text:
 * change it only together with SHIM_VERSION (a change changes every vitest-derived testsHash, hence the seed).
 * It runs in the gate realm with the Test API in scope and throws the Test API's own AssertionFailure, so diagnostics
 * and headlines read like the site's: an equality matcher failing on a call's result gives
 * `Rejected: median([]) returned NaN, expected 0` and can carry a spec-gap question; a relational matcher gives
 * `Rejected: test "…" failed after …: expected 3 to be greater than 5`. A matcher outside the list throws an error named
 * UnsupportedMatcher (the static check in vitest.ts refuses such files before anything runs; this is the backstop).
 *
 * Gate equality is stricter than vitest's `toEqual` about `undefined` properties ({a: undefined} vs {}), and `toBe`
 * is Object.is, as in vitest.
 */

export const SHIM_VERSION = 1;

export const SUPPORTED_MATCHERS: readonly string[] = [
  'toBe',
  'toEqual',
  'toStrictEqual',
  'toThrow',
  'toThrowError',
  'toBeCloseTo',
  'toBeNaN',
  'toBeNull',
  'toBeUndefined',
  'toBeDefined',
  'toBeTruthy',
  'toBeFalsy',
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'toHaveLength',
  'toContain',
  'toContainEqual',
  'toMatch',
];

export const UNSUPPORTED_MATCHER = 'UnsupportedMatcher';

export const EXPECT_SHIM = `// expect() for tests read from a vitest file (Undefined vitest shim v${SHIM_VERSION}; a subset of vitest's matchers)
const expect = (() => {
  let AssertionFailure;
  try { eq(0, 1); } catch (e) { AssertionFailure = e.constructor; }
  const shown = (v) => new AssertionFailure(v, v).actualShown;
  const isViolation = (e) => typeof e === 'object' && e !== null && e.isInvariantViolation === true;
  const same = (a, b) => { try { eq(a, b); return true; } catch (e) { if (e instanceof AssertionFailure) return false; throw e; } };
  // an equality failure: the actual is a value under test (headline "returned X, expected Y"; decidable)
  const unequal = (actual, expected, message, expectedText) =>
    new AssertionFailure(actual, expected, message, expectedText === undefined ? undefined : { expected: expectedText });
  // any other failure: described, never claimed to be a returned value
  const failed = (actual, message, expectedText) => new AssertionFailure(actual, undefined, message, { actual: shown(actual), expected: expectedText });
  const thrownBy = (fn) => {
    if (typeof fn !== 'function') throw new TypeError('expect(...).toThrow() needs a function: expect(() => f(x)).toThrow()');
    try { fn(); } catch (e) { if (isViolation(e)) throw e; return { threw: true, error: e }; }
    return { threw: false };
  };
  const messageOf = (e) => (typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e));
  const matches = (e, m) => {
    if (m === undefined) return true;
    if (typeof m === 'string') return messageOf(e).includes(m);
    if (m instanceof RegExp) return m.test(messageOf(e));
    if (typeof m === 'function') return e instanceof m;
    if (typeof m === 'object' && m !== null) return messageOf(e) === messageOf(m);
    return false;
  };
  const describeMatch = (m) => (m === undefined ? 'an error' : typeof m === 'function' ? 'an error of type ' + (m.name || 'that class') : 'an error matching ' + (typeof m === 'string' ? JSON.stringify(m) : m instanceof RegExp ? String(m) : JSON.stringify(messageOf(m))));
  const matchers = (actual, not) => {
    const check = (ok, fail) => { if (ok === not) throw fail(); };
    const neg = not ? 'not ' : '';
    return {
      toBe: (expected) => check(Object.is(actual, expected), () => (not ? failed(actual, 'expected ' + shown(actual) + ' not to be ' + shown(expected), 'not ' + shown(expected)) : unequal(actual, expected))),
      toEqual: (expected) => check(same(actual, expected), () => (not ? failed(actual, 'expected ' + shown(actual) + ' not to equal ' + shown(expected), 'not ' + shown(expected)) : unequal(actual, expected))),
      toStrictEqual: (expected) => check(same(actual, expected), () => (not ? failed(actual, 'expected ' + shown(actual) + ' not to equal ' + shown(expected), 'not ' + shown(expected)) : unequal(actual, expected))),
      toBeNaN: () => check(Number.isNaN(actual), () => (not ? failed(actual, 'expected a value other than NaN', 'not NaN') : unequal(actual, NaN))),
      toBeNull: () => check(actual === null, () => (not ? failed(actual, 'expected a value other than null', 'not null') : unequal(actual, null))),
      toBeUndefined: () => check(actual === undefined, () => (not ? failed(actual, 'expected a value other than undefined', 'not undefined') : unequal(actual, undefined))),
      toBeDefined: () => check(actual !== undefined, () => (not ? unequal(actual, undefined) : failed(actual, 'expected a defined value', 'a defined value'))),
      toBeTruthy: () => check(!!actual, () => failed(actual, 'expected ' + shown(actual) + ' to be ' + neg + 'truthy', neg + 'truthy')),
      toBeFalsy: () => check(!actual, () => failed(actual, 'expected ' + shown(actual) + ' to be ' + neg + 'falsy', neg + 'falsy')),
      toBeCloseTo: (n, digits = 2) => check(Math.abs(actual - n) < Math.pow(10, -digits) / 2, () => (not ? failed(actual, 'expected ' + shown(actual) + ' not to be close to ' + shown(n), 'not close to ' + shown(n)) : unequal(actual, n, 'expected ' + shown(actual) + ' to be close to ' + shown(n) + ' (' + digits + ' digits)', shown(n) + ' (to ' + digits + ' digits)'))),
      toBeGreaterThan: (n) => check(actual > n, () => failed(actual, 'expected ' + shown(actual) + ' to be ' + neg + 'greater than ' + shown(n), neg + '> ' + shown(n))),
      toBeGreaterThanOrEqual: (n) => check(actual >= n, () => failed(actual, 'expected ' + shown(actual) + ' to be ' + neg + 'greater than or equal to ' + shown(n), neg + '>= ' + shown(n))),
      toBeLessThan: (n) => check(actual < n, () => failed(actual, 'expected ' + shown(actual) + ' to be ' + neg + 'less than ' + shown(n), neg + '< ' + shown(n))),
      toBeLessThanOrEqual: (n) => check(actual <= n, () => failed(actual, 'expected ' + shown(actual) + ' to be ' + neg + 'less than or equal to ' + shown(n), neg + '<= ' + shown(n))),
      toHaveLength: (n) => check(actual != null && actual.length === n, () => failed(actual, 'expected ' + shown(actual) + ' ' + (not ? 'not ' : '') + 'to have length ' + n, (not ? 'not ' : '') + 'length ' + n)),
      toContain: (x) => check(actual != null && typeof actual.includes === 'function' && actual.includes(x), () => failed(actual, 'expected ' + shown(actual) + ' ' + (not ? 'not ' : '') + 'to contain ' + shown(x), (not ? 'not ' : '') + 'containing ' + shown(x))),
      toContainEqual: (x) => check(Array.isArray(actual) && actual.some((y) => same(y, x)), () => failed(actual, 'expected ' + shown(actual) + ' ' + (not ? 'not ' : '') + 'to contain an element equal to ' + shown(x), (not ? 'not ' : '') + 'an element equal to ' + shown(x))),
      toMatch: (m) => check(typeof actual === 'string' && (typeof m === 'string' ? actual.includes(m) : m.test(actual)), () => failed(actual, 'expected ' + shown(actual) + ' ' + (not ? 'not ' : '') + 'to match ' + (typeof m === 'string' ? JSON.stringify(m) : String(m)), (not ? 'not ' : '') + 'matching ' + (typeof m === 'string' ? JSON.stringify(m) : String(m)))),
      toThrow: (m) => {
        if (!not) {
          if (m === undefined || typeof m === 'string' || m instanceof RegExp) return throws(actual, m);
          const r = thrownBy(actual);
          if (!r.threw) { const f = failed(undefined, 'expected ' + describeMatch(m) + ', but nothing was thrown', describeMatch(m)); f.expectsThrow = true; throw f; }
          if (!matches(r.error, m)) throw failed(r.error, 'expected ' + describeMatch(m) + ', got ' + shown(r.error), describeMatch(m));
          return;
        }
        const r = thrownBy(actual);
        if (r.threw && matches(r.error, m)) throw failed(r.error, 'expected no ' + (m === undefined ? 'error' : describeMatch(m)) + ', got ' + shown(r.error), 'no ' + (m === undefined ? 'error' : describeMatch(m)));
      },
    };
  };
  const unsupported = (name) => {
    const e = new Error('expect(...).' + name + ' is not supported by the Undefined vitest shim');
    e.name = '${UNSUPPORTED_MATCHER}';
    return e;
  };
  const guard = (m) => new Proxy(m, { get: (t, k) => { if (typeof k === 'string' && !(k in t)) throw unsupported(k); return t[k]; } });
  return (actual) => {
    const m = matchers(actual, false);
    m.toThrowError = m.toThrow;
    const n = matchers(actual, true);
    n.toThrowError = n.toThrow;
    m.not = guard(n);
    return guard(m);
  };
})();
`;

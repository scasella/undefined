/**
 * The Test API that user-written `tests` / `properties` code sees (docs/DESIGN.md §Test API).
 *
 * Environment-agnostic: no Worker globals. Registration only collects cases; gateExecutor.ts runs them.
 */
import * as fc from 'fast-check';
import { isDate, isMap, isSet, show } from '../shared/show';
import { isInvariantViolation } from './mask';

// ───────────────────────── equality ─────────────────────────

function tagOf(v: object): string {
  return Object.prototype.toString.call(v).slice(8, -1);
}

/**
 * Deep equality used by `eq`, `matchesReference` and the Invariants determinism check.
 * Primitives compare with Object.is (NaN equals NaN, -0 differs from 0, bigint by value).
 * Built-ins are recognised by brand checks so values from other realms compare correctly.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return eqInner(a, b, []);
}

function eqInner(a: unknown, b: unknown, seen: Array<[object, object]>): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (seen.some(([x, y]) => x === a && y === b)) return true;
  seen = [...seen, [a, b]];

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const tag = tagOf(a);
  if (tag !== tagOf(b)) return false;

  if (isDate(a)) return isDate(b) && Object.is(a.getTime(), b.getTime());
  if (isMap(a)) {
    if (!isMap(b) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !eqInner(v, b.get(k), seen)) return false;
    }
    return true;
  }
  if (isSet(a)) {
    if (!isSet(b) || a.size !== b.size) return false;
    const unmatched = [...b].filter((x) => !a.has(x));
    for (const x of a) {
      if (b.has(x)) continue;
      if (typeof x !== 'object' || x === null) return false;
      const i = unmatched.findIndex((y) => eqInner(x, y, seen));
      if (i < 0) return false;
      unmatched.splice(i, 1);
    }
    return true;
  }
  if (tag === 'RegExp') return String(a) === String(b);
  if (tag === 'Error') {
    const ea = a as Error;
    const eb = b as Error;
    return ea.name === eb.name && ea.message === eb.message;
  }
  if (ArrayBuffer.isView(a)) {
    const xa = a as unknown as ArrayLike<unknown>;
    const xb = b as unknown as ArrayLike<unknown>;
    if (xa.length !== xb.length) return false;
    for (let i = 0; i < xa.length; i++) if (!Object.is(xa[i], xb[i])) return false;
    return true;
  }
  if (Array.isArray(a)) {
    const arrB = b as unknown[];
    if (a.length !== arrB.length) return false;
    for (let i = 0; i < a.length; i++) if (!eqInner(a[i], arrB[i], seen)) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const rb = b as Record<string, unknown>;
  const ra = a as Record<string, unknown>;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !eqInner(ra[k], rb[k], seen)) return false;
  }
  return true;
}

// ───────────────────────── assertions ─────────────────────────

/** Thrown by `eq` / `throws` / `matchesReference`. Carries raw values plus their display strings. */
export class AssertionFailure extends Error {
  readonly isAssertionFailure = true;
  readonly actualShown: string;
  readonly expectedShown: string;
  /** False for failures whose `actual` is not a value under test (e.g. `throws` saw no error). */
  readonly actualIsValue: boolean;
  constructor(
    public readonly actual: unknown,
    public readonly expected: unknown,
    message?: string,
    shown?: { actual?: string; expected?: string },
  ) {
    const actualShown = shown?.actual ?? show(actual);
    const expectedShown = shown?.expected ?? show(expected);
    super(message ?? `expected ${expectedShown}, got ${actualShown}`);
    this.name = 'AssertionFailure';
    this.actualShown = actualShown;
    this.expectedShown = expectedShown;
    this.actualIsValue = shown?.actual === undefined;
  }
}

export function isAssertionFailure(e: unknown): e is AssertionFailure {
  return typeof e === 'object' && e !== null && (e as { isAssertionFailure?: unknown }).isAssertionFailure === true;
}

export function eq(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEqual(actual, expected)) throw new AssertionFailure(actual, expected, message);
}

export function throws(fn: () => unknown, match?: RegExp | string): void {
  if (typeof fn !== 'function') throw new TypeError('throws() expects a function');
  let error: unknown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    if (isInvariantViolation(e)) throw e;
    threw = true;
    error = e;
  }
  const wanted = match === undefined ? 'an error' : `an error matching ${typeof match === 'string' ? JSON.stringify(match) : String(match)}`;
  if (!threw) throw new AssertionFailure(undefined, undefined, `expected ${wanted}, but nothing was thrown`, { actual: 'no error', expected: wanted });
  if (match === undefined) return;
  const text = error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as { message: unknown }).message)
    : String(error);
  const ok = typeof match === 'string' ? text.includes(match) : match.test(text);
  if (!ok) throw new AssertionFailure(error, match, `expected ${wanted}, got ${show(error)}`, { actual: show(error), expected: wanted });
}

// ───────────────────────── registration ─────────────────────────

/** structuredClone, or the value itself when it cannot be cloned (functions, symbols…). */
export function cloneOrSelf<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}

export interface TestCase {
  kind: 'test';
  name: string;
  body: () => void;
}

export interface PropertyCase {
  kind: 'property';
  name: string;
  arbs: fc.Arbitrary<unknown>[];
  predicate: (...args: unknown[]) => unknown;
  numRuns?: number;
}

export type Case = TestCase | PropertyCase;

export interface TestApi {
  test(name: string, body: () => void): void;
  eq: typeof eq;
  throws: typeof throws;
  property(name: string, arbs: unknown, predicate: (...args: unknown[]) => unknown, opts?: { numRuns?: number }): void;
  matchesReference(name: string, arbs: unknown, reference: (...args: unknown[]) => unknown, opts?: { numRuns?: number }): void;
  fc: typeof fc;
}

function checkName(fn: string, name: unknown): asserts name is string {
  if (typeof name !== 'string' || name === '') throw new TypeError(`${fn}() needs a name string as its first argument`);
}

function checkArbs(fn: string, name: string, arbs: unknown): asserts arbs is fc.Arbitrary<unknown>[] {
  const ok =
    Array.isArray(arbs) &&
    arbs.length > 0 &&
    arbs.every((a) => typeof a === 'object' && a !== null && typeof (a as { generate?: unknown }).generate === 'function');
  if (!ok) throw new TypeError(`${fn}("${name}"): arbitraries must be a non-empty array like [fc.integer()]`);
}

function checkRuns(fn: string, name: string, opts: unknown): number | undefined {
  if (opts === undefined) return undefined;
  const n = (opts as { numRuns?: unknown } | null)?.numRuns;
  if (n === undefined) return undefined;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new TypeError(`${fn}("${name}"): numRuns must be a positive integer`);
  return n;
}

/**
 * The API object for one source file. Registered cases are pushed into `cases`.
 * `candidate` is the instrumented wrapper (used by matchesReference).
 */
export function createTestApi(candidate: (...args: unknown[]) => unknown, cases: Case[]): TestApi {
  return {
    test(name, body) {
      checkName('test', name);
      if (typeof body !== 'function') throw new TypeError(`test("${name}") needs a function body`);
      cases.push({ kind: 'test', name, body });
    },
    eq,
    throws,
    property(name, arbs, predicate, opts) {
      checkName('property', name);
      checkArbs('property', name, arbs);
      if (typeof predicate !== 'function') throw new TypeError(`property("${name}") needs a predicate function`);
      cases.push({ kind: 'property', name, arbs, predicate, numRuns: checkRuns('property', name, opts) });
    },
    matchesReference(name, arbs, reference, opts) {
      checkName('matchesReference', name);
      checkArbs('matchesReference', name, arbs);
      if (typeof reference !== 'function') throw new TypeError(`matchesReference("${name}") needs a reference function`);
      // If the reference throws for some input, the candidate must throw too (any error).
      const predicate = (...args: unknown[]): void => {
        let expected: unknown;
        let refError: unknown;
        let refThrew = false;
        try {
          expected = reference(...args.map(cloneOrSelf));
        } catch (e) {
          refThrew = true;
          refError = e;
        }
        if (refThrew) {
          let actual: unknown;
          try {
            actual = candidate(...args.map(cloneOrSelf));
          } catch (e) {
            if (isInvariantViolation(e)) throw e;
            return;
          }
          throw new AssertionFailure(actual, refError, undefined, { expected: `to throw (reference threw ${show(refError)})` });
        }
        const actual = candidate(...args.map(cloneOrSelf));
        if (!deepEqual(actual, expected)) throw new AssertionFailure(actual, expected);
      };
      cases.push({ kind: 'property', name, arbs, predicate, numRuns: checkRuns('matchesReference', name, opts) });
    },
    fc,
  };
}

export const API_NAMES = ['test', 'eq', 'throws', 'property', 'matchesReference', 'fc'] as const;

/**
 * Evaluate user test/property JS, registering its cases. The candidate is in scope under `name`.
 * Throws whatever the user's code throws at load time (a spec error, unless it is an InvariantViolation).
 */
export function registerCases(js: string, name: string, candidate: (...args: unknown[]) => unknown): Case[] {
  const cases: Case[] = [];
  const api = createTestApi(candidate, cases);
  // `transpileModule` may append `export {};`, which is not valid inside a function body.
  const body = js.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, '');
  // A candidate named like an API function shadows it (duplicate params would be a SyntaxError).
  const apiNames = API_NAMES.filter((n) => n !== name);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...apiNames, name, body);
  factory(...apiNames.map((n) => api[n]), candidate);
  return cases;
}

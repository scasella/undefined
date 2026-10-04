/**
 * The Test API that user-written `tests` / `properties` code sees (docs/DESIGN.md §Test API).
 *
 * Environment-agnostic: no Worker globals. Registration only collects cases; gateExecutor.ts runs them.
 */
import * as fc from 'fast-check';
import { firstDifference, formatDifference } from '../shared/diff';
import { isDate, isMap, isSet, show } from '../shared/show';
import { isInvariantViolation } from './mask';

// Intrinsics captured at load: candidate code runs in this realm and could replace the globals (mask.ts detects and
// restores that after every call, but these keep the harness itself honest in between).
const objectIs = Object.is;
const objectKeys = Object.keys;
const isArray = Array.isArray;
const isView = ArrayBuffer.isView;
const hasOwn = Object.prototype.hasOwnProperty;
const toStringTag = Object.prototype.toString;
const realStructuredClone = structuredClone;

// ───────────────────────── equality ─────────────────────────

function tagOf(v: object): string {
  return (toStringTag.call(v) as string).slice(8, -1);
}

export interface EqualityOptions {
  /** Treat any two functions as equal (the Invariants determinism check: a returned closure is a new object each time). */
  functionsByType?: boolean;
}

/**
 * Deep equality used by `eq`, `matchesReference` and the Invariants determinism check.
 * Primitives compare with Object.is (NaN equals NaN, -0 differs from 0, bigint by value).
 * Built-ins are recognised by brand checks so values from other realms compare correctly.
 */
export function deepEqual(a: unknown, b: unknown, opts: EqualityOptions = {}): boolean {
  return eqInner(a, b, [], opts.functionsByType === true);
}

function eqInner(a: unknown, b: unknown, seen: Array<[object, object]>, fnByType: boolean): boolean {
  if (objectIs(a, b)) return true;
  if (fnByType && typeof a === 'function' && typeof b === 'function') return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (seen.some(([x, y]) => x === a && y === b)) return true;
  seen = [...seen, [a, b]];

  if (isArray(a) !== isArray(b)) return false;
  const tag = tagOf(a);
  if (tag !== tagOf(b)) return false;

  if (isDate(a)) return isDate(b) && objectIs(a.getTime(), b.getTime());
  if (isMap(a)) {
    if (!isMap(b) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !eqInner(v, b.get(k), seen, fnByType)) return false;
    }
    return true;
  }
  if (isSet(a)) {
    if (!isSet(b) || a.size !== b.size) return false;
    const unmatched = [...b].filter((x) => !a.has(x));
    for (const x of a) {
      if (b.has(x)) continue;
      if (typeof x !== 'object' || x === null) return false;
      const i = unmatched.findIndex((y) => eqInner(x, y, seen, fnByType));
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
  if (isView(a)) {
    const xa = a as unknown as ArrayLike<unknown>;
    const xb = b as unknown as ArrayLike<unknown>;
    if (xa.length !== xb.length) return false;
    for (let i = 0; i < xa.length; i++) if (!objectIs(xa[i], xb[i])) return false;
    return true;
  }
  if (isArray(a)) {
    const arrB = b as unknown[];
    if (a.length !== arrB.length) return false;
    for (let i = 0; i < a.length; i++) if (!eqInner(a[i], arrB[i], seen, fnByType)) return false;
    return true;
  }
  const ka = objectKeys(a);
  const kb = objectKeys(b);
  if (ka.length !== kb.length) return false;
  const rb = b as Record<string, unknown>;
  const ra = a as Record<string, unknown>;
  for (const k of ka) {
    if (!hasOwn.call(b, k) || !eqInner(ra[k], rb[k], seen, fnByType)) return false;
  }
  return true;
}

// ───────────────────────── assertions ─────────────────────────

/**
 * Thrown by `eq` / `throws` / `matchesReference`. Carries raw values plus their display strings.
 * When both are values whose show() texts are identical (show truncates long values), each text gets the first
 * difference appended, e.g. `[0, 1, …] (at [59]: 99)` vs `[0, 1, …] (at [59]: 59)`, so every consumer (headline,
 * diagnostics, the model prompt) can see where they differ.
 */
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
    let actualShown = shown?.actual ?? show(actual);
    let expectedShown = shown?.expected ?? show(expected);
    let where = '';
    if (shown?.actual === undefined && shown?.expected === undefined && actualShown === expectedShown) {
      const d = firstDifference(actual, expected);
      if (d) {
        const at = d.path || 'value';
        actualShown = `${actualShown} (at ${at}: ${d.actual})`;
        expectedShown = `${expectedShown} (at ${at}: ${d.expected})`;
        where = `; they first differ at ${formatDifference(d)}`;
      }
    }
    super(message ? `${message}${where}` : `expected ${expectedShown}, got ${actualShown}${where}`);
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
    return realStructuredClone(v);
  } catch {
    return v;
  }
}

/**
 * Optional marker on a check: "the spec was silent on this; the check holds a convention". Copied onto the failing
 * Diagnostic so a rejection can say who held the contract ("The spec didn't say X. Your tests did."). Never changes
 * a headline or a verdict.
 */
export interface SilenceMeta {
  /** Completes "The spec didn't say ___", e.g. "what the median of nothing is". */
  silentOn?: string;
  /** One sentence on why a candidate's different choice there is defensible. */
  reasonable?: string;
}

export type TestMeta = SilenceMeta;

export interface PropertyOpts extends SilenceMeta {
  numRuns?: number;
  /**
   * Evaluated on the SHRUNK counterexample arguments: the marker applies only when this returns true (a throw counts
   * as false). Lets one property mark only the case the doc is silent on (e.g. the empty list), never a real mistake.
   */
  when?: (...args: unknown[]) => unknown;
}

export interface TestCase extends SilenceMeta {
  kind: 'test';
  name: string;
  body: () => void;
}

export interface PropertyCase extends SilenceMeta {
  kind: 'property';
  name: string;
  arbs: fc.Arbitrary<unknown>[];
  predicate: (...args: unknown[]) => unknown;
  numRuns?: number;
  when?: (...args: unknown[]) => unknown;
}

export type Case = TestCase | PropertyCase;

export interface TestApi {
  test(name: string, body: () => void, meta?: TestMeta): void;
  eq: typeof eq;
  throws: typeof throws;
  property(name: string, arbs: unknown, predicate: (...args: unknown[]) => unknown, opts?: PropertyOpts): void;
  matchesReference(name: string, arbs: unknown, reference: (...args: unknown[]) => unknown, opts?: PropertyOpts): void;
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

/** Validates `meta`/`opts`; a malformed marker is the spec author's error (surfaces as a spec error). */
function checkOpts(fn: string, name: string, opts: unknown, allowRuns: boolean): SilenceMeta & { numRuns?: number; when?: (...args: unknown[]) => unknown } {
  if (opts === undefined) return {};
  if (typeof opts !== 'object' || opts === null) throw new TypeError(`${fn}("${name}"): options must be an object`);
  const o = opts as Record<string, unknown>;
  const out: SilenceMeta & { numRuns?: number; when?: (...args: unknown[]) => unknown } = {};
  if (o.numRuns !== undefined) {
    const n = o.numRuns;
    if (!allowRuns) throw new TypeError(`${fn}("${name}"): numRuns only applies to properties`);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new TypeError(`${fn}("${name}"): numRuns must be a positive integer`);
    out.numRuns = n;
  }
  for (const k of ['silentOn', 'reasonable'] as const) {
    const v = o[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.trim() === '') throw new TypeError(`${fn}("${name}"): ${k} must be a non-empty string`);
    out[k] = v;
  }
  if (o.when !== undefined) {
    if (!allowRuns) throw new TypeError(`${fn}("${name}"): when only applies to properties (a unit test has no counterexample)`);
    if (typeof o.when !== 'function') throw new TypeError(`${fn}("${name}"): when must be a function of the property's arguments`);
    out.when = o.when as (...args: unknown[]) => unknown;
  }
  return out;
}

/**
 * The API object for one source file. Registered cases are pushed into `cases`.
 * `candidate` is the instrumented wrapper (used by matchesReference).
 */
export function createTestApi(candidate: (...args: unknown[]) => unknown, cases: Case[]): TestApi {
  return {
    test(name, body, meta) {
      checkName('test', name);
      if (typeof body !== 'function') throw new TypeError(`test("${name}") needs a function body`);
      cases.push({ kind: 'test', name, body, ...checkOpts('test', name, meta, false) });
    },
    eq,
    throws,
    property(name, arbs, predicate, opts) {
      checkName('property', name);
      checkArbs('property', name, arbs);
      if (typeof predicate !== 'function') throw new TypeError(`property("${name}") needs a predicate function`);
      cases.push({ kind: 'property', name, arbs, predicate, ...checkOpts('property', name, opts, true) });
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
        let actual: unknown;
        try {
          actual = candidate(...args.map(cloneOrSelf));
        } catch (e) {
          if (!isInvariantViolation(e) && typeof e === 'object' && e !== null) {
            // lets the failure description say what the reference returned where the candidate threw
            try {
              Object.defineProperty(e, '__expectedShown', { value: show(expected), configurable: true });
            } catch {
              /* frozen error object: the plain 'threw' description still applies */
            }
          }
          throw e;
        }
        if (!deepEqual(actual, expected)) throw new AssertionFailure(actual, expected);
      };
      cases.push({ kind: 'property', name, arbs, predicate, ...checkOpts('matchesReference', name, opts, true) });
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

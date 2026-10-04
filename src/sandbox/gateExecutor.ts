/**
 * Environment-agnostic core of gates 2–4 (Tests, Properties, Invariants). No Worker globals and no timers:
 * it runs in the gate worker and, unchanged, in Node under vitest. Bounded-ness is enforced outside, by the
 * main-thread watchdog in gateRunner.ts, which only needs the enter/leave hooks fired here.
 */
import * as fc from 'fast-check';
import type { Diagnostic, GateResult } from '../types';
import { firstDifference, formatDifference } from '../shared/diff';
import { callString, show } from '../shared/show';
import { evalMasked, InvariantViolation, takeViolations } from './mask';
import {
  applyAttribution,
  invariantFailure,
  notReached,
  pureMessage,
  type ExecPhase,
} from './attribution';
import {
  cloneOrSelf,
  deepEqual,
  isAssertionFailure,
  registerCases,
  type Case,
  type PropertyCase,
  type TestCase,
} from './testApi';

export interface ExecGateInput {
  name: string;
  /** Strict-mode JS from the compile gate (function declaration named `name`). */
  js: string;
  /** Transpiled JS of spec.tests / spec.properties ('' when none). */
  testsJs: string;
  propertiesJs: string;
  budgetMs: number; // per call
  seed: number; // gateSeed(specHash, testsHash)
  /** Real args of the triggering call (extra invariant probe). */
  callArgs?: unknown[];
  overallCapMs?: number; // default 15000
}

export interface ExecHooks {
  phase(p: ExecPhase): void;
  /** Fired immediately before each call of the candidate, with its call string. */
  enter(label: string): void;
  /** Fired after each call of the candidate returns or throws. */
  leave(): void;
  /** Fired once per gate, in order, as soon as its result is final. */
  gate?(r: GateResult): void;
}

export const MAX_SAMPLES = 25;
const DEFAULT_RUNS = 100;
export const NO_TESTS_NOTE = 'no tests yet — add one to make the gate stricter';
export const NO_PROPERTIES_NOTE = 'no properties yet — add one to make the gate stricter';
export const NEVER_CALLED_NOTE = 'the candidate was never called, so purity and bounded runtime were not exercised';

type Fn = (...args: unknown[]) => unknown;

interface CallRecord {
  label: string;
  returned: boolean;
  result?: unknown;
  threw: boolean;
  thrown?: unknown;
}

interface Violation {
  what: string;
  call?: string;
  phase: ExecPhase;
}

interface Failure {
  diag: Diagnostic;
  headline: string;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

// Intrinsics captured at load (candidate code runs in this realm; see mask.ts for detection and restoration).
const realPerformance = performance;
const now = (): number => realPerformance.now();
const realStructuredClone = structuredClone;
const ownNames = Object.getOwnPropertyNames;
const objectFreeze = Object.freeze;
const objectValues = Object.values;

function deepFreeze<T>(v: T, seen = new Set<object>()): T {
  if (typeof v !== 'object' || v === null || seen.has(v)) return v;
  seen.add(v);
  try {
    objectFreeze(v);
  } catch {
    /* non-empty typed arrays cannot be frozen */
  }
  for (const x of objectValues(v)) deepFreeze(x, seen);
  if (v instanceof Map) for (const [k, x] of v) (deepFreeze(k, seen), deepFreeze(x, seen));
  if (v instanceof Set) for (const x of v) deepFreeze(x, seen);
  return v;
}

function isTypeError(e: unknown): boolean {
  return e instanceof TypeError || (typeof e === 'object' && e !== null && (e as Error).name === 'TypeError');
}

/** Functions compare by typeof only: a returned closure is a fresh object on every call, not non-determinism. */
function sameOutcome(a: Outcome, b: Outcome): boolean {
  if (a.ok && b.ok) return deepEqual(a.value, b.value, { functionsByType: true });
  if (!a.ok && !b.ok) return show(a.error) === show(b.error);
  return false;
}

function showOutcome(o: Outcome): string {
  return o.ok ? show(o.value) : `threw ${show(o.error)}`;
}

function isThenable(v: unknown): boolean {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

export function executeGates(input: ExecGateInput, hooks: ExecHooks): GateResult[] {
  takeViolations(); // discard anything left over from an earlier run in this realm
  const { name } = input;
  const results: GateResult[] = [];
  const emit = (r: GateResult): void => {
    results.push(r);
    hooks.gate?.(r);
  };
  const finish = (all: GateResult[]): GateResult[] => {
    for (const r of all.slice(results.length)) emit(r);
    return results;
  };

  let phase: ExecPhase = 'tests';
  let phaseStart = now();
  let violation: Violation | null = null;
  let last: CallRecord | null = null;
  let sampling = true;
  let calls = 0;
  const samples: unknown[][] = [];
  const sampleKeys = new Set<string>();

  const record = (what: string, call?: string): void => {
    if (!violation) violation = { what, call, phase };
  };
  const collectViolations = (call?: string): void => {
    const v = takeViolations();
    if (v.length > 0) record(v[0], call);
  };
  const violationResults = (): GateResult[] => {
    const v = violation!;
    const diag: Diagnostic = { kind: 'invariant', invariant: 'pure', message: pureMessage(v.what), phase: v.phase };
    if (v.call) diag.call = v.call;
    const ms = now() - phaseStart;
    return applyAttribution(results, v.phase, invariantFailure(diag, ms), ms);
  };
  const enterPhase = (p: ExecPhase): void => {
    phase = p;
    phaseStart = now();
    hooks.phase(p);
  };

  // (a) evaluate the candidate once, masked
  hooks.phase('tests');
  let candidate: Fn;
  try {
    candidate = evalMasked<Fn>(input.js, name);
    if (typeof candidate !== 'function') throw new TypeError(`${name} is not a function`);
  } catch (e) {
    collectViolations();
    if (violation) return finish(violationResults());
    const msg = show(e);
    return finish([
      {
        gate: 'tests',
        status: 'fail',
        ms: 0,
        summary: 'candidate failed to load',
        headline: `Rejected: candidate failed to load: ${msg}`,
        diagnostics: [{ kind: 'test', name: '(load)', message: 'candidate failed to load', error: msg }],
      },
      notReached('properties'),
      notReached('invariants'),
    ]);
  }
  collectViolations();
  if (violation) return finish(violationResults());

  // The instrumented wrapper handed to user code.
  const wrapper: Fn = (...args) => {
    if (violation) throw new InvariantViolation(violation.what);
    calls++;
    const label = callString(name, args);
    if (sampling && samples.length < MAX_SAMPLES && !sampleKeys.has(label)) {
      try {
        samples.push(realStructuredClone(args)); // before the call: the candidate may mutate them
        sampleKeys.add(label);
      } catch {
        /* uncloneable arguments are not replayed */
      }
    }
    const rec: CallRecord = { label, returned: false, threw: false };
    last = rec;
    const globalsBefore = ownNames(globalThis);
    hooks.enter(label);
    try {
      rec.result = candidate(...args);
      rec.returned = true;
    } catch (e) {
      rec.threw = true;
      rec.thrown = e;
    } finally {
      hooks.leave();
    }
    collectViolations(label);
    if (!violation) {
      const globalsAfter = ownNames(globalThis);
      if (globalsAfter.length !== globalsBefore.length) {
        const before = new Set(globalsBefore);
        const added = globalsAfter.find((n) => !before.has(n));
        record(added ? `wrote global '${added}'` : 'deleted a global', label);
      }
    }
    if (violation) throw new InvariantViolation((violation as Violation).what);
    if (rec.threw) throw rec.thrown;
    return rec.result;
  };

  // (b) registration; a throw here is the user's spec, not the candidate
  const register = (js: string): { cases: Case[] } | { specError: string } | null => {
    if (js.trim() === '') return { cases: [] };
    try {
      const cases = registerCases(js, name, wrapper);
      collectViolations();
      return violation ? null : { cases };
    } catch (e) {
      collectViolations();
      if (violation) return null;
      return { specError: e instanceof Error ? e.message || e.name : show(e) };
    }
  };
  const specErrorResult = (gate: 'tests' | 'properties', message: string): GateResult => ({
    gate,
    status: 'fail',
    ms: now() - phaseStart,
    summary: 'spec error',
    note: 'spec error',
    headline: `Spec error: ${message}`,
    diagnostics: [{ kind: 'test', name: '(spec error)', message, error: message }],
  });

  // ── failure description: shared by unit tests and the property re-run ──
  const describe = (e: unknown, caseName: string, kind: 'test' | 'property'): { headline: string; fields: { call?: string; expected?: string; actual?: string; error?: string; message: string } } => {
    const rec = last as CallRecord | null;
    const call = rec?.label;
    const subject = kind === 'test' ? `test "${caseName}"` : `property "${caseName}"`;
    if (isAssertionFailure(e)) {
      const returned = e.actualIsValue && rec?.returned === true && deepEqual(e.actual, rec.result);
      const fields = { call, expected: e.expectedShown, actual: e.actualShown, message: e.message };
      if (returned) return { headline: `Rejected: ${call} returned ${e.actualShown}, expected ${e.expectedShown}`, fields };
      return { headline: `Rejected: ${subject} failed${call ? ` after ${call}` : ''}: ${e.message}`, fields };
    }
    const error = show(e);
    const expectedShown = typeof e === 'object' && e !== null ? (e as { __expectedShown?: unknown }).__expectedShown : undefined;
    const expected = typeof expectedShown === 'string' ? expectedShown : undefined;
    if (rec?.threw && rec.thrown === e) {
      const tail = expected !== undefined ? `, expected ${expected}` : '';
      return { headline: `Rejected: ${call} threw ${error}${tail}`, fields: { call, error, expected, message: `${call} threw ${error}${tail}` } };
    }
    return {
      headline: `Rejected: ${subject} threw ${error}${call ? ` after ${call}` : ''}`,
      fields: { call, error, message: `${kind} threw ${error}` },
    };
  };

  const runTest = (c: TestCase): Failure | null => {
    last = null;
    try {
      const r = c.body();
      if (isThenable(r)) throw new Error('async tests are not supported; the test body must be synchronous');
      return null;
    } catch (e) {
      if (violation) return null;
      const { headline, fields } = describe(e, c.name, 'test');
      return { headline, diag: { kind: 'test', name: c.name, ...fields, ...silence(c) } };
    }
  };

  const runProperty = (c: PropertyCase): { failure: Failure | null; runs: number } => {
    const pred = (...args: unknown[]): boolean => {
      if (violation) return true; // stop paying for shrinking once the run is already rejected
      const r = c.predicate(...args.map(cloneOrSelf));
      if (isThenable(r)) throw new Error('async predicates are not supported');
      return r !== false;
    };
    const property = (fc.property as unknown as (...a: unknown[]) => fc.IProperty<unknown[]>)(...c.arbs, pred);
    const details = fc.check(property, { seed: input.seed, numRuns: c.numRuns ?? DEFAULT_RUNS });
    if (violation || !details.failed) return { failure: null, runs: details.numRuns };

    const base = { kind: 'property' as const, name: c.name, shrinks: details.numShrinks, runs: details.numRuns, seed: details.seed };
    const cx = details.counterexample as unknown[] | null;
    const errorText = details.errorInstance == null ? undefined : show(details.errorInstance);
    if (!cx) {
      const message = errorText ?? 'property failed';
      // No counterexample to evaluate `when` on: the marker applies only when it is unconditional.
      const marker = c.when === undefined ? silence(c) : {};
      return { failure: { headline: `Rejected: property "${c.name}" failed: ${message}`, diag: { ...base, counterexample: '(none)', error: message, ...marker } }, runs: details.numRuns };
    }
    const counterexample = show(cx);

    // Re-run on the shrunk counterexample with instrumentation to recover the exact call.
    last = null;
    let returned: unknown;
    let thrown: unknown;
    let threw = false;
    try {
      returned = c.predicate(...cx.map(cloneOrSelf));
    } catch (e) {
      threw = true;
      thrown = e;
    }
    if (violation) return { failure: null, runs: details.numRuns };
    const rec = last as CallRecord | null;
    const at = rec?.label ?? `arguments ${counterexample}`;
    let failure: Failure;
    if (threw) {
      const { headline, fields } = describe(thrown, c.name, 'property');
      failure = { headline, diag: { ...base, counterexample, ...withoutMessage(fields) } };
    } else if (returned === false) {
      failure = { headline: `Rejected: property "${c.name}" failed for ${at}`, diag: { ...base, counterexample, call: rec?.label } };
    } else {
      // Did not reproduce outside fast-check: report what fast-check saw.
      failure = {
        headline: `Rejected: property "${c.name}" failed for ${at}${errorText ? `: ${errorText}` : ''}`,
        diag: { ...base, counterexample, call: rec?.label, error: errorText },
      };
    }
    // The "spec was silent" marker, only when `when` holds at the shrunk counterexample. Evaluated after the failure
    // is described: `when` is user code and could call the candidate, which would overwrite `last`.
    let applies = true;
    if (c.when !== undefined) {
      try {
        applies = c.when(...cx.map(cloneOrSelf)) === true;
      } catch {
        applies = false;
      }
      collectViolations(); // a `when` that trips the mask is still a violation, never swallowed
      if (violation) return { failure: null, runs: details.numRuns };
    }
    if (applies) failure.diag = { ...failure.diag, ...silence(c) } as Diagnostic;
    return { failure, runs: details.numRuns };
  };

  // (c) phases ─────────────────────────────────────────────

  // Tests
  const testsReg = register(input.testsJs);
  if (!testsReg) return finish(violationResults());
  if ('specError' in testsReg) {
    return finish([specErrorResult('tests', testsReg.specError), notReached('properties'), notReached('invariants')]);
  }
  const testsResult = runCases('tests', testsReg.cases);
  if (!testsResult) return finish(violationResults());
  emit(testsResult);
  if (testsResult.status === 'fail') return finish([testsResult, notReached('properties'), notReached('invariants')]);

  // Properties
  enterPhase('properties');
  const propsReg = register(input.propertiesJs);
  if (!propsReg) return finish(violationResults());
  if ('specError' in propsReg) {
    return finish([testsResult, specErrorResult('properties', propsReg.specError), notReached('invariants')]);
  }
  const propsResult = runCases('properties', propsReg.cases);
  if (!propsResult) return finish(violationResults());
  emit(propsResult);
  if (propsResult.status === 'fail') return finish([testsResult, propsResult, notReached('invariants')]);

  // Invariants: replay sampled calls on deep-frozen clones, twice each
  enterPhase('invariants');
  sampling = false;
  const probes: unknown[][] = [];
  if (input.callArgs) probes.push(input.callArgs);
  for (const s of samples) {
    if (!input.callArgs || callString(name, s) !== callString(name, input.callArgs)) probes.push(s);
  }
  const attempt = (args: unknown[]): Outcome => {
    try {
      return { ok: true, value: wrapper(...args) };
    } catch (e) {
      return { ok: false, error: e };
    }
  };
  let replayFailure: Diagnostic | null = null;
  for (const args of probes) {
    const label = callString(name, args);
    const r1 = attempt(deepFreeze(cloneOrSelf(args)));
    if (violation) break;
    const r2 = attempt(deepFreeze(cloneOrSelf(args)));
    if (violation) break;
    const free = cloneOrSelf(args);
    const r3 = attempt(free);
    if (violation) break;
    const frozenTypeError = [r1, r2].find((r): r is { ok: false; error: unknown } => !r.ok && isTypeError(r.error));
    const unfrozenTypeError = !r3.ok && isTypeError(r3.error);
    // A TypeError only on frozen arguments means a write to them; a changed unfrozen clone catches Map/Set writes.
    if ((frozenTypeError && !unfrozenTypeError) || !deepEqual(free, args)) {
      replayFailure = {
        kind: 'invariant',
        invariant: 'pure',
        message: 'mutated its argument',
        call: label,
        phase: 'invariants',
        detail: frozenTypeError ? `on a frozen argument it threw ${show(frozenTypeError.error)}` : `argument became ${show(free)}`,
      };
      break;
    }
    if (!sameOutcome(r1, r2)) {
      const d = r1.ok && r2.ok && showOutcome(r1) === showOutcome(r2) ? firstDifference(r1.value, r2.value) : null;
      replayFailure = {
        kind: 'invariant',
        invariant: 'pure',
        message: 'returned different results for identical input (non-deterministic)',
        call: label,
        phase: 'invariants',
        detail: `first ${showOutcome(r1)}, then ${showOutcome(r2)}${d ? `; they first differ at ${formatDifference(d)}` : ''}`,
      };
      break;
    }
  }
  if (violation) return finish(violationResults());
  const ms = now() - phaseStart;
  if (replayFailure && replayFailure.kind === 'invariant') {
    return finish([testsResult, propsResult, invariantFailure(replayFailure, ms)]);
  }
  if (calls === 0) {
    // No tests, no properties, no triggering call: nothing ran, so "pure ✓ bounded ✓" would be a vacuous claim.
    return finish([
      testsResult,
      propsResult,
      { gate: 'invariants', status: 'skipped', ms, summary: 'not exercised', note: NEVER_CALLED_NOTE, diagnostics: [] },
    ]);
  }
  return finish([
    testsResult,
    propsResult,
    {
      gate: 'invariants',
      status: 'pass',
      ms,
      summary:
        probes.length === 0
          ? 'pure ✓ bounded ✓ (no sampled calls to replay)'
          : `pure ✓ bounded ✓ (${probes.length} sampled call${probes.length === 1 ? '' : 's'} replayed on frozen arguments)`,
      diagnostics: [],
    },
  ]);

  /** Runs a gate's cases. null = interrupted by an invariant violation. */
  function runCases(gate: 'tests' | 'properties', cases: Case[]): GateResult | null {
    if (cases.length === 0) {
      return {
        gate,
        status: 'skipped',
        ms: now() - phaseStart,
        summary: gate === 'tests' ? 'no tests yet' : 'no properties yet',
        note: gate === 'tests' ? NO_TESTS_NOTE : NO_PROPERTIES_NOTE,
        diagnostics: [],
      };
    }
    const failures: Failure[] = [];
    let runs = 0;
    for (const c of cases) {
      let failure: Failure | null;
      if (c.kind === 'test') {
        failure = runTest(c);
      } else {
        const r = runProperty(c);
        runs += r.runs;
        failure = r.failure;
      }
      if (violation) return null;
      if (failure) failures.push(failure);
    }
    const total = cases.length;
    const passed = total - failures.length;
    const plural = (n: number): string => (gate === 'tests' ? (n === 1 ? 'test' : 'tests') : n === 1 ? 'property' : 'properties');
    const ms = now() - phaseStart;
    if (failures.length === 0) {
      return {
        gate,
        status: 'pass',
        ms,
        summary: gate === 'tests' ? `${passed}/${total} ${plural(total)} passed` : `${passed}/${total} ${plural(total)} held (${runs} runs)`,
        diagnostics: [],
        counts: { passed, total },
      };
    }
    return {
      gate,
      status: 'fail',
      ms,
      summary: gate === 'tests' ? `${passed}/${total} ${plural(total)} passed` : `${failures.length}/${total} ${plural(total)} failed`,
      headline: failures[0].headline,
      diagnostics: failures.map((f) => f.diag),
      counts: { passed, total },
    };
  }
}

/** The check's "spec was silent" marker, as Diagnostic fields (absent keys when unset). */
function silence(c: { silentOn?: string; reasonable?: string }): { silentOn?: string; reasonable?: string } {
  const out: { silentOn?: string; reasonable?: string } = {};
  if (c.silentOn !== undefined) out.silentOn = c.silentOn;
  if (c.reasonable !== undefined) out.reasonable = c.reasonable;
  return out;
}

function withoutMessage<T extends { message: string }>(f: T): Omit<T, 'message'> {
  const { message: _message, ...rest } = f;
  return rest;
}

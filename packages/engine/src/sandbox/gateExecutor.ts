/**
 * Environment-agnostic core of gates 2–4 (Tests, Properties, Invariants). No Worker globals and no timers:
 * it runs in the gate worker and, unchanged, in Node under vitest. Bounded-ness is enforced outside, by the
 * main-thread watchdog in gateRunner.ts, which only needs the enter/leave hooks fired here.
 *
 * Returned shape: one GateResult per REQUESTED phase (`input.phases`, default all three), in the order tests,
 * properties, invariants. A phase that was not requested is omitted entirely — except that an invariant violation
 * (pure/bounded) is always reported by an Invariants result, even when 'invariants' was not requested (the attribution
 * rule). So `phases: ['tests', 'properties']` yields [tests, properties] or [tests, properties, invariants(fail)].
 *
 * Pinned results (`input.pinned`) run in the Tests phase AFTER the user's unit tests, each as a unit test named
 * `pinned: <label>`, on a deep clone of its arguments, compared with eq()'s equality. Tests-gate summaries:
 *   no pins:   "4/4 tests passed"                      (unchanged)   fail: "3/4 tests passed"
 *   pins:      "5 unit tests + 2 pinned passed"        pins only: "2 pinned passed"
 *              fail: "5/7 tests passed (5 unit + 2 pinned)"
 * Properties summaries carry the per-property runs: `2/2 properties held (150 runs: "a" 100, "b" 50)` /
 * `1/2 properties failed (…)`. evidenceFrom() (gateRunner.ts) parses exactly these formats.
 */
import * as fc from 'fast-check';
import type { DecideFields, Diagnostic, GateId, GateResult, Json, Outcome as CallOutcome, WaivedCheck } from '../types';
import { firstDifference, formatDifference } from '../shared/diff';
import { callString, show } from '../shared/show';
import { encodeReport } from '../shared/serialize';
import { deepFreeze, evalMasked, InvariantViolation, pendingViolationCount, takeViolations } from './mask';
import {
  applyAttribution,
  invariantFailure,
  notReached,
  pureMessage,
  type ExecPhase,
} from './attribution';
import {
  AssertionFailure,
  cloneOrSelf,
  deepEqual,
  isAssertionFailure,
  registerCases,
  type Case,
  type DeclaredAlternative,
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
  /**
   * Results pinned as unit tests ("Pin as test"), already decoded by the caller (dataset arguments are the real row
   * arrays; they are deep-cloned before every call, so a candidate can never change them).
   */
  pinned?: PinnedCase[];
  /** Phases to run (default all three). See the module comment for the returned shape. */
  phases?: ExecPhase[];
  /**
   * Checks replaced by the user's decisions (decide/decisions.ts effectiveChecks). A waived unit test is not run and
   * not counted (the Tests gate's note says so); a waived property passes vacuously wherever its `when` holds, and is
   * not run at all when it has no `when`. Summary formats are unchanged.
   */
  waived?: WaivedCheck[];
  /** The "type your own" probe: every eq() failure also carries its raw values, encoded (actualValue/expectedValue). */
  probe?: boolean;
  /**
   * Other generated functions the candidate calls (composition, docs/COMPOSE-DESIGN.md §A5): the transitive closure,
   * callees first, each with its CERTIFIED js and its own direct dependencies. They are linked once, in this realm and
   * under the same mask, so purity, determinism and the per-call budget are judged over the whole call tree. They are
   * never instrumented (no enter/leave, no sampling) and never mutated. ABSENT when the candidate calls nothing.
   */
  deps?: Array<{ name: string; js: string; deps: string[] }>;
}

export interface PinnedCase {
  /** e.g. `topCustomers(rows)`: the diagnostic's call and the test name `pinned: <label>`. */
  label: string;
  args: unknown[];
  expected: unknown;
}

export const PINNED_PREFIX = 'pinned: ';

/** Whether a result belongs in the output for `phases` (an invariant failure always does: attribution rule). */

/**
 * What a call is reported as having thrown when the thrown value itself throws on inspection (a Proxy whose traps throw,
 * a getter on `message` that throws): the gates read `instanceof`, `message` and the shown form of a thrown value to
 * describe the failure, and an exception there used to escape the gate as a worker error, so a wrong function could turn
 * its rejection into "could not run". It stays a failure of the call, attributed to the call.
 */
export const UNINSPECTABLE_THROW = 'threw a value that cannot be inspected (reading it throws)';

function uninspectable(e: unknown): boolean {
  if ((typeof e !== 'object' && typeof e !== 'function') || e === null) return false;
  try {
    void (e instanceof Error);
    void (e as { __expectedShown?: unknown }).__expectedShown;
    void (e as { message?: unknown }).message;
    void (e as { name?: unknown }).name;
    show(e);
    return false;
  } catch {
    return true;
  }
}

export function phaseWanted(r: GateResult, phases: readonly ExecPhase[] | undefined): boolean {
  if (!phases) return true;
  return (phases as readonly GateId[]).includes(r.gate) || (r.gate === 'invariants' && r.status === 'fail');
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
  /** Arguments cloned BEFORE the call (only while a "spec was silent" check runs: Decide needs the exact call). */
  args?: unknown[];
  returned: boolean;
  result?: unknown;
  threw: boolean;
  thrown?: unknown;
}

interface Violation {
  what: string;
  call?: string;
  phase: ExecPhase;
  /** The linked dependency that was running when the trap fired (innermost), when it was not the candidate itself. */
  inside?: string;
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
  const wants = (p: ExecPhase): boolean => !input.phases || input.phases.includes(p);
  const results: GateResult[] = [];
  const emitted = new Set<GateId>();
  const emit = (r: GateResult): void => {
    if (emitted.has(r.gate)) return;
    emitted.add(r.gate);
    if (!phaseWanted(r, input.phases)) return;
    results.push(r);
    hooks.gate?.(r);
  };
  const finish = (all: GateResult[]): GateResult[] => {
    for (const r of all) emit(r);
    return results;
  };
  /** Stand-in for a phase that was not requested (never part of the output). */
  const notRequested = (gate: ExecPhase): GateResult => ({ gate, status: 'skipped', ms: 0, summary: 'not requested', diagnostics: [] });

  let phase: ExecPhase = 'tests';
  let phaseStart = now();
  let violation: Violation | null = null;
  let last: CallRecord | null = null;
  let sampling = true;
  /** True while a check with a silentOn marker runs: each call's arguments are cloned before the call (Decide). */
  let capture = false;
  let calls = 0;
  const samples: unknown[][] = [];
  const sampleKeys = new Set<string>();

  /** Innermost linked dependency during which a trap fired (shared blame: the message names both functions). */
  let blame: string | null = null;
  const record = (what: string, call?: string): void => {
    if (!violation) violation = { what, call, phase, ...(blame !== null ? { inside: blame } : {}) };
    blame = null;
  };
  const collectViolations = (call?: string): void => {
    const v = takeViolations();
    if (v.length > 0) record(v[0], call);
    blame = null;
  };
  const violationResults = (): GateResult[] => {
    const v = violation!;
    const diag: Diagnostic = { kind: 'invariant', invariant: 'pure', message: pureMessage(v.what), phase: v.phase };
    if (v.call) diag.call = v.call;
    if (v.inside) diag.detail = `inside ${v.inside}, called by ${name}`;
    const ms = now() - phaseStart;
    return applyAttribution(results, v.phase, invariantFailure(diag, ms), ms);
  };
  const enterPhase = (p: ExecPhase): void => {
    phase = p;
    phaseStart = now();
    hooks.phase(p);
  };

  // (a) evaluate the candidate once, masked (with its linked dependencies, when it has any)
  hooks.phase('tests');
  let candidate: Fn;
  try {
    const bindings = linkDeps(input.deps, (dep) => {
      if (blame === null) blame = dep;
    });
    candidate = bindings ? evalMasked<Fn>(input.js, name, bindings) : evalMasked<Fn>(input.js, name);
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
    if (capture) {
      try {
        rec.args = realStructuredClone(args);
      } catch {
        /* uncloneable arguments: no Decide for this call */
      }
    }
    last = rec;
    const globalsBefore = ownNames(globalThis);
    hooks.enter(label);
    try {
      rec.result = candidate(...args);
      rec.returned = true;
    } catch (e) {
      rec.threw = true;
      rec.thrown = uninspectable(e) ? new Error(UNINSPECTABLE_THROW) : e;
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
    capture = c.silentOn !== undefined;
    try {
      const r = c.body();
      if (isThenable(r)) throw new Error('async tests are not supported; the test body must be synchronous');
      return null;
    } catch (e) {
      if (violation) return null;
      const { headline, fields } = describe(e, c.name, 'test');
      const decide = c.silentOn !== undefined ? decideFields(e, last as CallRecord | null, c) : {};
      return { headline, diag: { kind: 'test', name: c.name, ...fields, ...silence(c), ...decide, ...probeFields(e) } };
    } finally {
      capture = false;
    }
  };

  /** A pinned result as a unit test: deep-cloned arguments, eq() equality, a standard 'test' diagnostic on failure. */
  const runPin = (p: PinnedCase): Failure | null => {
    last = null;
    const testName = `${PINNED_PREFIX}${p.label}`;
    let args: unknown[];
    try {
      args = realStructuredClone(p.args);
    } catch {
      args = p.args.map(cloneOrSelf);
    }
    let actual: unknown;
    try {
      actual = wrapper(...args);
    } catch (e) {
      if (violation) return null;
      const error = show(e);
      const expected = show(p.expected);
      const message = `${p.label} threw ${error}, expected ${expected}`;
      return { headline: `Rejected: ${message}`, diag: { kind: 'test', name: testName, call: p.label, expected, error, message } };
    }
    if (violation) return null;
    if (deepEqual(actual, p.expected)) return null;
    const f = new AssertionFailure(actual, p.expected);
    return {
      headline: `Rejected: ${p.label} returned ${f.actualShown}, expected ${f.expectedShown}`,
      diag: { kind: 'test', name: testName, call: p.label, expected: f.expectedShown, actual: f.actualShown, message: f.message },
    };
  };

  const runProperty = (c: PropertyCase): { failure: Failure | null; runs: number } => {
    // A property waived by a decision passes vacuously where its `when` holds (the domain the decision now rules).
    // `when` is user code: it runs on fresh clones before the predicate, and a mask violation is never swallowed.
    const waivedWhen = c.when !== undefined && isWaived('property', c.name) ? c.when : undefined;
    const pred = (...args: unknown[]): boolean => {
      if (violation) return true; // stop paying for shrinking once the run is already rejected
      if (waivedWhen) {
        let inDomain: boolean;
        try {
          inDomain = waivedWhen(...args.map(cloneOrSelf)) === true;
        } catch {
          inDomain = false;
        }
        collectViolations();
        if (violation || inDomain) return true;
      }
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
    capture = c.silentOn !== undefined;
    try {
      returned = c.predicate(...cx.map(cloneOrSelf));
    } catch (e) {
      threw = true;
      thrown = e;
    } finally {
      capture = false;
    }
    if (violation) return { failure: null, runs: details.numRuns };
    const lastCall = last as CallRecord | null;
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
    if (applies) {
      const decide = threw ? decideFields(thrown, lastCall, c) : {};
      // a marker without `when` is silent on every input: say so, so no ruling on one call can waive all of it
      if (decide.args && c.when === undefined) decide.everyInput = true;
      failure.diag = { ...failure.diag, ...silence(c), ...decide } as Diagnostic;
    }
    return { failure, runs: details.numRuns };
  };

  // (c) phases ─────────────────────────────────────────────

  // Tests (the user's unit tests, then the pinned results)
  let testsResult: GateResult;
  if (wants('tests')) {
    const testsReg = register(input.testsJs);
    if (!testsReg) return finish(violationResults());
    if ('specError' in testsReg) {
      return finish([specErrorResult('tests', testsReg.specError), notReached('properties'), notReached('invariants')]);
    }
    const r = runCases('tests', testsReg.cases, input.pinned ?? []);
    if (!r) return finish(violationResults());
    testsResult = r;
  } else {
    testsResult = notRequested('tests');
  }
  emit(testsResult);
  if (testsResult.status === 'fail') return finish([testsResult, notReached('properties'), notReached('invariants')]);

  // Properties
  enterPhase('properties');
  let propsResult: GateResult;
  if (wants('properties')) {
    const propsReg = register(input.propertiesJs);
    if (!propsReg) return finish(violationResults());
    if ('specError' in propsReg) {
      return finish([testsResult, specErrorResult('properties', propsReg.specError), notReached('invariants')]);
    }
    const r = runCases('properties', propsReg.cases);
    if (!r) return finish(violationResults());
    propsResult = r;
  } else {
    propsResult = notRequested('properties');
  }
  emit(propsResult);
  if (propsResult.status === 'fail') return finish([testsResult, propsResult, notReached('invariants')]);
  if (!wants('invariants')) return finish([testsResult, propsResult]);

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

  /** Runs a gate's cases (and, for tests, the pinned results after them). null = interrupted by an invariant violation. */
  function runCases(gate: 'tests' | 'properties', all: Case[], pins: PinnedCase[] = []): GateResult | null {
    // Checks replaced by a decision: a unit test is not run; a property without `when` is not run (see waived).
    const cases = all.filter((c) => !(isWaived(c.kind, c.name) && (c.kind === 'test' || c.when === undefined)));
    const replaced = all.length - cases.length;
    const replacedNote = replaced > 0 ? `${replaced} ${replaced === 1 ? 'check' : 'checks'} replaced by your decision` : undefined;
    if (cases.length === 0 && pins.length === 0) {
      return {
        gate,
        status: 'skipped',
        ms: now() - phaseStart,
        summary: gate === 'tests' ? 'no tests yet' : 'no properties yet',
        note: replacedNote ?? (gate === 'tests' ? NO_TESTS_NOTE : NO_PROPERTIES_NOTE),
        diagnostics: [],
      };
    }
    const failures: Failure[] = [];
    let runs = 0;
    const perProperty: Array<{ name: string; runs: number }> = [];
    for (const c of cases) {
      let failure: Failure | null;
      if (c.kind === 'test') {
        failure = runTest(c);
      } else {
        const r = runProperty(c);
        runs += r.runs;
        perProperty.push({ name: c.name, runs: r.runs });
        failure = r.failure;
      }
      if (violation) return null;
      if (failure) failures.push(failure);
    }
    for (const p of pins) {
      const failure = runPin(p);
      if (violation) return null;
      if (failure) failures.push(failure);
    }
    const unit = cases.length;
    const total = unit + pins.length;
    const passed = total - failures.length;
    const ms = now() - phaseStart;
    const ok = failures.length === 0;
    const summary = gate === 'tests' ? testsSummary(ok, passed, unit, pins.length) : propertiesSummary(ok, passed, failures.length, total, runs, perProperty);
    if (ok) return { gate, status: 'pass', ms, summary, diagnostics: [], counts: { passed, total }, ...(replacedNote ? { note: replacedNote } : {}) };
    return {
      gate,
      status: 'fail',
      ms,
      summary,
      headline: failures[0].headline,
      diagnostics: failures.map((f) => f.diag),
      counts: { passed, total },
      ...(replacedNote ? { note: replacedNote } : {}),
    };
  }

  function isWaived(kind: 'test' | 'property', caseName: string): boolean {
    return (input.waived ?? []).some((w) => w.kind === kind && w.name === caseName);
  }

  /** Encoded raw values of an eq() failure, for the "type your own" probe only. */
  function probeFields(e: unknown): DecideFields {
    if (!input.probe || !isAssertionFailure(e) || !e.actualIsValue) return {};
    return { actualValue: encodeCapped(e.actual) ?? { $t: 'unserializable', show: e.actualShown }, expectedValue: encodeCapped(e.expected) ?? null };
  }
}

/**
 * Evaluate the dependencies (callees first) under the mask, each bound to the ones it calls, and return them by name
 * for the candidate; undefined when there are none (then the candidate is evaluated exactly as before composition).
 * Each is wrapped only to notice that a trap fired while it was running (`onViolation(name)`, innermost first); the
 * wrapper never catches, retags or instruments anything.
 */
function linkDeps(deps: ExecGateInput['deps'], onViolation: (dep: string) => void): Record<string, Fn> | undefined {
  if (!deps || deps.length === 0) return undefined;
  const linked: Record<string, Fn> = {};
  for (const d of deps) {
    const own: Record<string, Fn> = {};
    for (const n of d.deps) {
      if (!linked[n]) throw new Error(`dependency ${d.name} calls ${n}, which was not linked before it`);
      own[n] = linked[n]!;
    }
    const raw = Object.keys(own).length > 0 ? evalMasked<Fn>(d.js, d.name, own) : evalMasked<Fn>(d.js, d.name);
    if (typeof raw !== 'function') throw new TypeError(`${d.name} is not a function`);
    const depName = d.name;
    linked[depName] = function (this: unknown, ...args: unknown[]): unknown {
      const before = pendingViolationCount();
      try {
        return raw.apply(undefined, args);
      } finally {
        if (pendingViolationCount() > before) onViolation(depName);
      }
    };
  }
  return linked;
}

/** Encoded value, or undefined when it would be lossy or too large to keep on a stored diagnostic. */
const DECIDE_MAX_CHARS = 4000;
function encodeCapped(v: unknown): Json | undefined {
  const r = encodeReport(v);
  if (r.lossy) return undefined;
  try {
    return JSON.stringify(r.json).length <= DECIDE_MAX_CHARS ? r.json : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Decide facts of a failing marked check (types.ts DecideFields), only when the failure is about ONE exact call:
 * the assertion's actual IS what that call returned, or that call itself threw. Encoded and size-capped; anything
 * that does not encode cleanly leaves the fields out (then the card shows the silence lines only, as before).
 */
function decideFields(e: unknown, rec: CallRecord | null, c: { alternatives?: DeclaredAlternative[] }): DecideFields {
  if (!rec || !rec.args) return {};
  let actualOutcome: CallOutcome | undefined;
  let expectedOutcome: CallOutcome | undefined;
  if (isAssertionFailure(e)) {
    if (e.expectsThrow && rec.returned) {
      if (e.actualIsValue && !deepEqual(e.actual, rec.result)) return {};
      const r = encodeCapped(rec.result);
      if (r === undefined) return {};
      actualOutcome = { returns: r };
      expectedOutcome = { throws: true };
    } else if (e.actualIsValue && rec.returned && deepEqual(e.actual, rec.result)) {
      const r = encodeCapped(rec.result);
      const x = encodeCapped(e.expected);
      if (r === undefined || x === undefined) return {};
      actualOutcome = { returns: r };
      expectedOutcome = { returns: x };
    } else {
      return {};
    }
  } else if (rec.threw && rec.thrown === e) {
    const raw = typeof e === 'object' && e !== null && Object.prototype.hasOwnProperty.call(e, '__expectedRaw') ? (e as { __expectedRaw: unknown }).__expectedRaw : NO_RAW;
    if (raw === NO_RAW) return {};
    const x = encodeCapped(raw);
    if (x === undefined) return {};
    actualOutcome = { throws: true };
    expectedOutcome = { returns: x };
  } else {
    return {};
  }
  const args = encodeCapped(rec.args);
  if (args === undefined || !Array.isArray(args)) return {};
  const out: DecideFields = { args, expectedOutcome, actualOutcome };
  if (c.alternatives && c.alternatives.length > 0) {
    const alts: NonNullable<DecideFields['alternatives']> = [];
    for (const a of c.alternatives) {
      if ('throws' in a) alts.push({ label: a.label, outcome: { throws: true } });
      else {
        const v = encodeCapped(a.value);
        if (v !== undefined) alts.push({ label: a.label, outcome: { returns: v } });
      }
    }
    if (alts.length > 0) out.alternatives = alts;
  }
  return out;
}

const NO_RAW = Symbol('no raw expected value');

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Tests-gate summary (formats in the module comment; evidenceFrom parses them). */
export function testsSummary(ok: boolean, passed: number, unit: number, pinned: number): string {
  const total = unit + pinned;
  if (pinned === 0) return `${passed}/${total} ${total === 1 ? 'test' : 'tests'} passed`;
  if (!ok) return `${passed}/${total} ${total === 1 ? 'test' : 'tests'} passed (${unit} unit + ${pinned} pinned)`;
  return unit === 0 ? `${pinned} pinned passed` : `${plural(unit, 'unit test', 'unit tests')} + ${pinned} pinned passed`;
}

/** Properties-gate summary with per-property runs; names are JSON-quoted so the list parses unambiguously. */
export function propertiesSummary(
  ok: boolean,
  passed: number,
  failed: number,
  total: number,
  runs: number,
  perProperty: ReadonlyArray<{ name: string; runs: number }>,
): string {
  const word = total === 1 ? 'property' : 'properties';
  const detail = `(${runs} runs: ${perProperty.map((p) => `${JSON.stringify(p.name)} ${p.runs}`).join(', ')})`;
  return ok ? `${passed}/${total} ${word} held ${detail}` : `${failed}/${total} ${word} failed ${detail}`;
}

/** The check's "spec was silent" marker, as Diagnostic fields (absent keys when unset). */
function silence(c: { silentOn?: string; reasonable?: string; alternatives?: unknown }): { silentOn?: string; reasonable?: string } {
  const out: { silentOn?: string; reasonable?: string } = {};
  if (c.silentOn !== undefined) out.silentOn = c.silentOn;
  if (c.reasonable !== undefined) out.reasonable = c.reasonable;
  return out;
}

function withoutMessage<T extends { message: string }>(f: T): Omit<T, 'message'> {
  const { message: _message, ...rest } = f;
  return rest;
}

import { describe, expect, it } from 'vitest';
import type { GateResult } from '../types';
import { INTERRUPTED_NOTE } from './attribution';
import { crashResults, selectPhases, timeoutResults, Watchdog } from './gateRunner';

const pass = (gate: GateResult['gate']): GateResult => ({ gate, status: 'pass', ms: 3, summary: 'ok', diagnostics: [] });

describe('Watchdog (fake clock)', () => {
  it('stays quiet while calls finish within budget', () => {
    const dog = new Watchdog(1500, 15000, 0);
    dog.onPhase('tests', 10);
    dog.onEnter('fibonacci(10)', 20);
    expect(dog.check(1500)).toBeNull();
    dog.onLeave();
    expect(dog.check(5000)).toBeNull();
    expect(dog.inFlight()).toBeUndefined();
  });

  it('fires when the in-flight call overruns its budget', () => {
    const dog = new Watchdog(1500, 15000, 0);
    dog.onPhase('tests', 0);
    dog.onEnter('fibonacci(5)', 10);
    dog.onLeave();
    dog.onEnter('fibonacci(90)', 100);
    expect(dog.check(1600)).toBeNull(); // exactly at budget is fine
    expect(dog.check(1625)).toEqual({ reason: 'call', label: 'fibonacci(90)', phase: 'tests', elapsedMs: 1525, phaseMs: 1625 });
  });

  it('tracks the phase the call happened in', () => {
    const dog = new Watchdog(100, 15000, 0);
    dog.onPhase('tests', 0);
    dog.onPhase('properties', 50);
    dog.onEnter('median([1, 2])', 60);
    expect(dog.check(200)).toMatchObject({ phase: 'properties', phaseMs: 150 });
  });

  it('times the outermost call if enters nest', () => {
    const dog = new Watchdog(100, 15000, 0);
    dog.onEnter('outer(1)', 0);
    dog.onEnter('inner(1)', 90);
    expect(dog.check(101)).toMatchObject({ reason: 'call', label: 'outer(1)' });
    dog.onLeave();
    dog.onLeave();
    expect(dog.check(150)).toBeNull();
  });

  it('enforces the overall cap even with no call in flight, naming the last call', () => {
    const dog = new Watchdog(1500, 15000, 1000);
    expect(dog.check(15999)).toBeNull();
    expect(dog.check(16001)).toMatchObject({ reason: 'overall', label: undefined, phase: 'tests' });
    dog.onEnter('median([1])', 2000);
    dog.onLeave();
    expect(dog.check(16001)).toMatchObject({ reason: 'overall', label: 'median([1])' });
  });
});

describe('timeoutResults (attribution rule)', () => {
  it('turns a timeout during Tests into Tests ⏭, Properties ⏭, Invariants ✗ bounded', () => {
    const rs = timeoutResults([], { reason: 'call', label: 'fibonacci(90)', phase: 'tests', elapsedMs: 1503.4, phaseMs: 1510 }, 1500, 15000);
    expect(rs.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:skipped', 'properties:skipped', 'invariants:fail']);
    expect(rs[0].note).toBe(INTERRUPTED_NOTE);
    expect(rs[1].note).toBe(INTERRUPTED_NOTE);
    expect(rs[2].headline).toBe('Rejected: fibonacci(90) did not return within 1500 ms (bounded)');
    expect(rs[2].summary).toBe('bounded violated');
    expect(rs[2].diagnostics).toEqual([
      {
        kind: 'invariant',
        invariant: 'bounded',
        message: 'fibonacci(90) did not return within 1500 ms',
        call: 'fibonacci(90)',
        phase: 'tests',
        budgetMs: 1500,
        elapsedMs: 1503,
        detail: 'worker terminated by the watchdog',
      },
    ]);
  });

  it('keeps gates that completed before the interrupted phase', () => {
    const tests = pass('tests');
    const rs = timeoutResults([tests], { reason: 'call', label: 'f(1)', phase: 'properties', elapsedMs: 200, phaseMs: 210 }, 100, 15000);
    expect(rs[0]).toBe(tests);
    expect(rs[1]).toMatchObject({ status: 'skipped', note: INTERRUPTED_NOTE, ms: 210 });
    expect(rs[2].diagnostics[0]).toMatchObject({ phase: 'properties' });
  });

  it('keeps both earlier gates when the replay itself times out', () => {
    const rs = timeoutResults([pass('tests'), pass('properties')], { reason: 'call', label: 'f(1)', phase: 'invariants', elapsedMs: 200, phaseMs: 200 }, 100, 15000);
    expect(rs.map((r) => r.status)).toEqual(['pass', 'pass', 'fail']);
  });

  it('describes the overall cap', () => {
    const rs = timeoutResults([], { reason: 'overall', label: 'median([1])', phase: 'tests', elapsedMs: 15020, phaseMs: 15000 }, 1500, 15000);
    expect(rs[2].headline).toBe('Rejected: the gates did not finish within the 15000 ms overall cap (bounded)');
    expect(rs[2].diagnostics[0]).toMatchObject({ invariant: 'bounded', budgetMs: 15000, call: 'median([1])' });
  });
});

describe('crashResults', () => {
  it('fails the current gate, keeps earlier ones, and never yields an accepted set', () => {
    const rs = crashResults([pass('tests')], 'properties', 'out of memory', 'median([1])');
    expect(rs.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:fail', 'invariants:skipped']);
    expect(rs[1].headline).toBe('Rejected: gate worker error: out of memory');
    expect(rs[1].diagnostics[0]).toMatchObject({ call: 'median([1])', error: 'out of memory' });
    expect(rs[2].note).toBe('not reached');
  });

  it('fails Tests when the worker dies before reporting anything', () => {
    const rs = crashResults([], 'tests', 'failed to load module');
    expect(rs.map((r) => r.status)).toEqual(['fail', 'skipped', 'skipped']);
  });
});

describe('selectPhases (input.phases on the main thread)', () => {
  it('keeps everything when phases is undefined', () => {
    const all = [pass('tests'), pass('properties'), pass('invariants')];
    expect(selectPhases(all, undefined)).toEqual(all);
  });

  it("a watchdog timeout with phases ['tests', 'properties'] still reports the bounded violation via Invariants", () => {
    const dog = new Watchdog(100, 15000, 0);
    dog.onPhase('properties', 50);
    dog.onEnter('fib(90)', 60);
    const o = dog.check(200)!;
    const results = selectPhases(timeoutResults([pass('tests')], o, 100, 15000), ['tests', 'properties']);
    expect(results.map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:skipped', 'invariants:fail']);
    expect(results[2]!.diagnostics[0]).toMatchObject({ invariant: 'bounded', call: 'fib(90)', phase: 'properties' });
  });

  it('drops a non-failing Invariants result and unrequested phases', () => {
    const crashed = crashResults([pass('tests')], 'properties', 'boom');
    expect(selectPhases(crashed, ['tests', 'properties']).map((r) => `${r.gate}:${r.status}`)).toEqual(['tests:pass', 'properties:fail']);
    expect(selectPhases([pass('tests'), pass('properties'), pass('invariants')], ['properties']).map((r) => r.gate)).toEqual(['properties']);
  });
});

import { describe, expect, it } from 'vitest';
import type { AttemptView, Diagnostic, GateResult, GenerationView, MutationReport } from '@scasella/undefined-engine/types';
import {
  deliberateBreaks,
  detailOf,
  factsFromSpec,
  footerFor,
  ghostFromAttempts,
  headerFor,
  liveLanes,
  liveTextFor,
  OFF_NOTES,
  parsePropertiesSummary,
  parseTestsSummary,
  sealHead,
  sealOfLanes,
  sealWords,
  stressChecked,
  stressLabel,
  stressNotChecked,
  stressStatus,
  stressWords,
  type LaneFacts,
  type StressStatus,
} from './lanes';

// ───── fixtures in the exact shapes and summary formats the gate executor produces ─────

const g = (gate: GateResult['gate'], status: GateResult['status'], summary: string, extra: Partial<GateResult> = {}): GateResult => ({
  gate,
  status,
  ms: 100,
  summary,
  diagnostics: [],
  ...extra,
});
const compileOk = g('compile', 'pass', 'compiled', { ms: 120, counts: { passed: 1, total: 1 } });
const testsOk = g('tests', 'pass', '6 unit tests + 1 pinned passed', { ms: 90, counts: { passed: 7, total: 7 } });
const propsOk = g('properties', 'pass', '2/2 properties held (200 runs: "paid only" 100, "each order once" 100)', { ms: 150, counts: { passed: 2, total: 2 } });
const invOk = g('invariants', 'pass', 'pure ✓ bounded ✓ (1 sampled call replayed on frozen arguments)', { ms: 50 });
const notReached = (gate: GateResult['gate']): GateResult => g(gate, 'skipped', 'not reached', { ms: 0, note: 'not reached' });

const pinFail: Diagnostic = {
  kind: 'test',
  name: 'pinned: topCustomers(rows)',
  message: 'not equal',
  call: 'topCustomers(rows)',
  expected: '$2,252.07',
  actual: '$2,260.06',
};

const attempt = (n: number, status: AttemptView['status'], gates: GateResult[]): AttemptView => ({ attempt: n, status, shown: '', gates });

const gen = (attempts: AttemptView[], phase: GenerationView['phase'], extra: Partial<GenerationView> = {}): GenerationView => ({
  id: 'g1',
  fn: 'topCustomers',
  signature: 'function topCustomers(rows: Row[]): Array<{ customer: string; revenue: number }>',
  call: 'topCustomers(orders)',
  phase,
  attempt: attempts.length,
  maxAttempts: 3,
  progress: [],
  attempts,
  ungated: false,
  mode: 'replay',
  ...extra,
});

const full: LaneFacts = { examples: 6, pins: 1, pinLabel: 'Chef Ravioli Starbright = $2,252.07', houseRules: 2, decisionTests: 0, tables: 100 };
const basic: LaneFacts = { examples: 0, pins: 0, houseRules: 0, decisionTests: 0, tables: null };

const report = (killed: number, survived: number): MutationReport => ({
  total: killed + survived,
  killed,
  killedByBound: 0,
  survived,
  stillborn: 0,
  survivors: [],
  ms: 900,
  at: 1,
});

describe('summary parsers (gateExecutor formats)', () => {
  it('tests', () => {
    expect(parseTestsSummary('6 unit tests + 1 pinned passed')).toEqual({ unit: 6, pinned: 1 });
    expect(parseTestsSummary('2 pinned passed')).toEqual({ unit: 0, pinned: 2 });
    expect(parseTestsSummary('6/7 tests passed (6 unit + 1 pinned)')).toEqual({ unit: 6, pinned: 1 });
    expect(parseTestsSummary('4/4 tests passed')).toEqual({ unit: 4, pinned: 0 });
    expect(parseTestsSummary('no tests yet')).toBeNull();
  });
  it('properties', () => {
    expect(parsePropertiesSummary(propsOk.summary)).toEqual({ total: 2, runs: [100, 100] });
    expect(parsePropertiesSummary('1/2 properties failed (147 runs: "a" 100, "b" 47)')).toEqual({ total: 2, runs: [100, 47] });
    expect(parsePropertiesSummary('no properties yet')).toBeNull();
  });
});

describe('liveLanes', () => {
  it('idle with full facts: six ready lanes in the design words', () => {
    const lanes = liveLanes({ generation: null, facts: full, run: 'idle' });
    expect(lanes.map((l) => l.label)).toEqual([
      'Runs without errors',
      'Matches your 6 examples',
      'Matches your locked answer · Chef Ravioli Starbright = $2,252.07',
      'Follows your 2 house rules on 100 made-up tables',
      'Never changes your data · finishes fast',
      'Stress test: deliberate breaks',
    ]);
    expect(lanes.every((l) => l.state === 'ready')).toBe(true);
    expect(lanes[0]?.aria).toBe('Runs without errors: ready');
  });

  it('idle with nothing set up: the first-run off lanes and notes', () => {
    const lanes = liveLanes({ generation: null, facts: basic, run: 'idle' });
    expect(lanes.map((l) => [l.num, l.state, l.offNote ?? null])).toEqual([
      ['01', 'ready', null],
      ['02', 'off', 'No examples yet'],
      ['03', 'off', 'Nothing locked yet'],
      ['04', 'off', 'No house rules yet'],
      ['05', 'ready', null],
      ['06', 'off', 'Needs your rules first'],
    ]);
    expect(lanes[1]?.label).toBe('Matches your examples');
    expect(lanes[3]?.label).toBe('Follows your house rules on made-up tables');
    expect(lanes[1]?.aria).toBe('Matches your examples: not checked yet. Add an example, a locked answer or a house rule to switch it on.');
  });

  it('unknown counts are never invented', () => {
    const lanes = liveLanes({ generation: null, facts: { examples: null, pins: 0, houseRules: null, decisionTests: 0, tables: null }, run: 'idle' });
    expect(lanes[1]?.label).toBe('Matches your examples');
    expect(lanes[1]?.state).toBe('ready');
    expect(lanes[3]?.label).toBe('Follows your house rules on made-up tables');
  });

  it('gating in progress: running gate, the rest waiting', () => {
    const a = attempt(1, 'gating', [compileOk, g('tests', 'running', ''), g('properties', 'pending', ''), g('invariants', 'pending', '')]);
    const lanes = liveLanes({ generation: gen([a], 'gating'), facts: full, run: 'running' });
    expect(lanes.map((l) => l.state)).toEqual(['passed', 'running', 'running', 'waiting', 'waiting', 'ready']);
  });

  it('all gates passed: counts come from the gate results', () => {
    const a = attempt(1, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const lanes = liveLanes({ generation: gen([a], 'committed', { revision: 3 }), facts: full, run: 'done' });
    expect(lanes.slice(0, 5).map((l) => [l.state, l.done])).toEqual([
      ['passed', '1/1'],
      ['passed', '6/6'],
      ['passed', '1/1'],
      ['passed', '100/100'],
      ['passed', '2/2'],
    ]);
    expect(lanes[3]?.cells).toBe(100);
    expect(lanes[3]?.kind).toBe('grid');
  });

  it('a failing pin throws out lane 03; examples still passed; later lanes not reached', () => {
    const a = attempt(1, 'rejected', [
      compileOk,
      g('tests', 'fail', '6/7 tests passed (6 unit + 1 pinned)', { counts: { passed: 6, total: 7 }, diagnostics: [pinFail], headline: 'Rejected: topCustomers(rows) returned a different list' }),
      notReached('properties'),
      notReached('invariants'),
    ]);
    const lanes = liveLanes({ generation: gen([a], 'generating'), attempt: a, facts: full, run: 'running' });
    expect(lanes.map((l) => l.state)).toEqual(['passed', 'passed', 'failed', 'skipped', 'skipped', 'skipped']);
    expect(lanes[2]).toMatchObject({ word: 'Thrown out', aria: 'Matches your locked answer · Chef Ravioli Starbright = $2,252.07: thrown out' });
    expect(lanes[3]?.idle).toBe('Not run');
  });

  it('a failing decision test is a house rule (lane 04), not an example', () => {
    const decided: Diagnostic = { kind: 'test', name: 'decided: topCustomers([]) returns []', message: 'x', silentOn: 'an empty file' };
    const a = attempt(1, 'rejected', [
      compileOk,
      g('tests', 'fail', '6/7 tests passed', { counts: { passed: 6, total: 7 }, diagnostics: [decided] }),
      notReached('properties'),
      notReached('invariants'),
    ]);
    const facts: LaneFacts = { ...full, pins: 0, decisionTests: 1, houseRules: 3 };
    const lanes = liveLanes({ generation: gen([a], 'failed'), facts, run: 'done' });
    expect(lanes[1]).toMatchObject({ state: 'passed', done: '6/6', label: 'Matches your 6 examples' });
    expect(lanes[3]?.state).toBe('failed');
    // held for the question: that lane turns amber
    expect(liveLanes({ generation: gen([a], 'failed'), facts, run: 'held' })[3]?.state).toBe('stopped');
  });

  it('held on a property: stopped on made-up table N of T, only the silent lane', () => {
    const prop: Diagnostic = { kind: 'property', name: 'refunds', counterexample: '[]', shrinks: 3, runs: 47, seed: 1, silentOn: 'all refunded' };
    const a = attempt(1, 'rejected', [compileOk, testsOk, g('properties', 'fail', '1/2 properties failed (147 runs: "a" 100, "refunds" 47)', { diagnostics: [prop] }), notReached('invariants')]);
    const lanes = liveLanes({ generation: gen([a], 'failed'), facts: full, run: 'held' });
    expect(lanes[3]).toMatchObject({
      state: 'stopped',
      line2: 'on made-up table 47 of 100',
      stopAt: 47,
      aria: 'Follows your 2 house rules on 100 made-up tables: stopped on made-up table 47 of 100, a question only you can answer',
    });
    expect(lanes[4]?.state).toBe('skipped');
    // without a reported table count, no "of 100"
    expect(liveLanes({ generation: gen([a], 'failed'), facts: { ...full, tables: null }, run: 'held' })[3]?.line2).toBe('on made-up table 47');
  });

  it('lane 05 passes only when the invariants gate passed', () => {
    const skipped = attempt(1, 'accepted', [compileOk, testsOk, propsOk, g('invariants', 'skipped', 'never called', { note: 'never called' })]);
    expect(liveLanes({ generation: gen([skipped], 'committed'), facts: full, run: 'done' })[4]?.state).toBe('skipped');
    const failed = attempt(1, 'rejected', [compileOk, testsOk, propsOk, g('invariants', 'fail', 'pure ✗')]);
    expect(liveLanes({ generation: gen([failed], 'failed'), facts: full, run: 'done' })[4]?.state).toBe('failed');
  });

  it('a tests gate with nothing to run reads as off, not as not reached', () => {
    const a = attempt(1, 'accepted', [compileOk, g('tests', 'skipped', 'no tests yet'), g('properties', 'skipped', 'no properties yet'), invOk]);
    const lanes = liveLanes({ generation: gen([a], 'committed'), facts: { examples: null, pins: 0, houseRules: null, decisionTests: 0, tables: null }, run: 'done' });
    expect(lanes.map((l) => l.state)).toEqual(['passed', 'off', 'off', 'off', 'passed', 'off']);
  });

  describe('a locked answer set after the answer on file was checked (pins are outside the hashes)', () => {
    const none = attempt(1, 'accepted', [compileOk, g('tests', 'skipped', 'no tests yet'), g('properties', 'skipped', 'no properties yet'), invOk]);
    const locked: LaneFacts = { examples: 0, pins: 1, pinLabel: 'Puddlesworth Inc = $2,599.13', houseRules: 0, decisionTests: 0, tables: null };

    it('the committed run did not check it: lane 03 says so instead of "Nothing locked yet", and still names it', () => {
      const lanes = liveLanes({ generation: gen([none], 'committed'), facts: locked, run: 'done' });
      expect(lanes[2]).toMatchObject({ state: 'off', idle: 'Not checked', offNote: OFF_NOTES.locksLate, label: 'Matches your locked answer · Puddlesworth Inc = $2,599.13' });
      expect(lanes[2]?.aria).toContain('you locked it afterwards');
      expect(lanes[2]?.aria).not.toContain('Add an example');
      // nothing was set when the stress test would have run: it is not "needs your rules first" for a viewer who set a lock
      expect(lanes[5]).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressLate });
      // examples and house rules: nothing set, so the plain words
      expect(lanes[1]?.offNote).toBe(OFF_NOTES.examples);
      expect(lanes[3]?.offNote).toBe(OFF_NOTES.rules);
    });
    it('with no lock set it is still "Nothing locked yet" / "Needs your rules first"', () => {
      const lanes = liveLanes({ generation: gen([none], 'committed'), facts: basic, run: 'done' });
      expect(lanes[2]?.offNote).toBe(OFF_NOTES.locks);
      expect(lanes[5]?.offNote).toBe(OFF_NOTES.stress);
    });
    it('a tests gate that ran examples but no pin reads the same way', () => {
      const exOnly = attempt(1, 'accepted', [compileOk, g('tests', 'pass', '6/6 tests passed'), g('properties', 'skipped', 'no properties yet'), invOk]);
      const lanes = liveLanes({ generation: gen([exOnly], 'committed'), facts: { ...locked, examples: 6 }, run: 'done' });
      expect(lanes[1]?.state).toBe('passed');
      expect(lanes[2]?.offNote).toBe(OFF_NOTES.locksLate);
    });
    it('idle with a certified answer on file: the lanes show what the next ask will run (pinsChecked), not what is set', () => {
      const lanes = liveLanes({ generation: null, facts: { ...locked, pinsChecked: 0 }, run: 'idle' });
      expect(lanes[2]).toMatchObject({ state: 'off', offNote: OFF_NOTES.locksLate });
      expect(lanes[5]).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressLate });
      // nothing on file: every pin will run
      expect(liveLanes({ generation: null, facts: locked, run: 'idle' })[2]?.state).toBe('ready');
      // the answer on file was checked with the lock: it will run again
      expect(liveLanes({ generation: null, facts: { ...locked, pinsChecked: 1 }, run: 'idle' })[2]?.state).toBe('ready');
    });
  });

  describe('lane 06: the lazy mutation check, after the commit', () => {
    const a = attempt(1, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const committed = gen([a], 'committed', { revision: 3 });
    const waiting = { fn: 'topCustomers', phase: 'waiting' as const, done: 0, total: 0 };
    it('waiting after commit, then running with the engine progress, never touching 01–05', () => {
      const before = liveLanes({ generation: committed, facts: full, run: 'done', mutation: waiting });
      expect(before[5]).toMatchObject({ state: 'waiting', idle: 'Waiting', stress: { kind: 'pending', phase: 'waiting' } });
      const runningLanes = liveLanes({ generation: committed, facts: full, run: 'done', mutation: { fn: 'topCustomers', phase: 'running', done: 5, total: 12 } });
      expect(runningLanes[5]).toMatchObject({ state: 'running', progress: { done: 5, total: 12 }, label: 'Stress test: 12 deliberate breaks' });
      expect(runningLanes.slice(0, 5)).toEqual(before.slice(0, 5));
    });
    it('before the commit it is only ready (never waiting on, or running for, a draft that is still being checked)', () => {
      const checking = gen([attempt(1, 'generating', [])], 'gating');
      expect(liveLanes({ generation: checking, facts: full, run: 'running', mutation: waiting })[5]).toMatchObject({ state: 'ready', idle: 'Ready' });
      expect(liveLanes({ generation: null, facts: full, run: 'idle', mutation: { ...waiting, phase: 'running', done: 3, total: 12 } })[5]?.state).toBe('ready');
    });
    it('done: k of N caught + m missed', () => {
      const lanes = liveLanes({ generation: committed, facts: full, run: 'done', mutation: { fn: 'topCustomers', phase: 'done', done: 12, total: 12 }, mutationReport: report(11, 1) });
      expect(lanes[5]).toMatchObject({
        state: 'passed',
        done: '11 of 12 caught',
        line2: '1 missed',
        missed: 1,
        label: 'Stress test: 12 deliberate breaks',
        aria: 'Stress test: 12 deliberate breaks: 11 of 12 caught, 1 missed',
        stress: { kind: 'done', total: 12, caught: 11, missed: 1 },
      });
      const clean = liveLanes({ generation: committed, facts: full, run: 'done', mutationReport: report(12, 0) });
      expect(clean[5]).toMatchObject({ done: '12 of 12 caught', glyph: 'pass' });
      expect(clean[5]?.line2).toBeUndefined();
    });
    it('a stale report is not the result while the engine is on the stress test again', () => {
      expect(liveLanes({ generation: committed, facts: full, run: 'done', mutation: waiting, mutationReport: report(11, 1) })[5]?.state).toBe('waiting');
    });
    it('ignores another function’s mutation progress', () => {
      const other = liveLanes({ generation: committed, facts: full, run: 'done', mutation: { fn: 'median', phase: 'running', done: 1, total: 9 }, mutationReport: report(11, 1) });
      expect(other[5]).toMatchObject({ state: 'passed', done: '11 of 12 caught' });
    });
    it('a skipped report with nothing run is not "needs your rules first" when there are rules: it did not run', () => {
      const skipped: MutationReport = { ...report(0, 0), skipped: 'mutation check failed: boom' };
      const lane = liveLanes({ generation: committed, facts: full, run: 'done', mutationReport: skipped })[5]!;
      expect(lane).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressNotRun, stress: { kind: 'not-run' } });
      expect(lane.aria).toBe("Stress test: deliberate breaks: didn't run, so this answer was not stress-tested.");
      // committed, and nothing at all about it: the engine is not going to run it
      expect(liveLanes({ generation: committed, facts: full, run: 'done' })[5]).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressNotRun });
      // nothing was set when it was checked: the old words
      const noRules = attempt(1, 'accepted', [compileOk, g('tests', 'skipped', 'no tests yet'), g('properties', 'skipped', 'no properties yet'), invOk]);
      expect(liveLanes({ generation: gen([noRules], 'committed'), facts: basic, run: 'done', mutationReport: { ...report(0, 0), skipped: 'no tests yet: nothing could kill a mutant' } })[5]?.offNote).toBe(OFF_NOTES.stress);
    });
    it('a time-boxed report reads as what it is: k of the copies that ran, and that it ran out of time', () => {
      const partial: MutationReport = { ...report(4, 1), skipped: 'time box reached after 5 of 12 mutants' };
      const lane = liveLanes({ generation: committed, facts: full, run: 'done', mutationReport: partial })[5]!;
      expect(lane).toMatchObject({ state: 'passed', done: '4 of 5 caught', line2: '1 missed · ran out of time', stress: { kind: 'partial', planned: 12 } });
      expect(lane.aria).toContain('ran out of time');
      expect(liveLanes({ generation: committed, facts: full, run: 'done', mutationReport: { ...report(5, 0), skipped: 'time box reached after 5 of 12 mutants' } })[5]?.line2).toBe('ran out of time');
    });
    it('the page stopped waiting: it did not run, whatever the engine reports later', () => {
      const lane = liveLanes({ generation: committed, facts: full, run: 'done', mutation: waiting, stressGaveUp: true })[5];
      expect(lane).toMatchObject({ state: 'off', offNote: OFF_NOTES.stressNotRun });
      expect(liveLanes({ generation: committed, facts: full, run: 'done', mutationReport: report(11, 1), stressGaveUp: true })[5]?.state).toBe('off');
    });
  });
});

describe('the stress test, in one place', () => {
  const rep = (o: Partial<MutationReport> = {}): MutationReport => ({ ...report(8, 4), ...o });
  const waiting = { fn: 'f', phase: 'waiting' as const, done: 0, total: 0 };
  it('total is the copies that ran (stillborn ones are not taken off again); caught = killed + stopped by the time limit; missed = survived', () => {
    expect(stressStatus({ expected: true, report: rep({ stillborn: 3, killedByBound: 1, killed: 7 }), fn: 'f' })).toEqual({ kind: 'done', total: 12, caught: 8, missed: 4 });
  });
  it('nothing to hold it against: none, whatever the engine says', () => {
    expect(stressStatus({ expected: false, report: rep(), mutation: waiting, fn: 'f' })).toEqual({ kind: 'none' });
  });
  it('pending while the engine has it waiting or running for this function (a stale report does not count), done when it says so', () => {
    expect(stressStatus({ expected: true, report: rep(), mutation: waiting, fn: 'f' })).toEqual({ kind: 'pending', phase: 'waiting', done: 0, total: 0 });
    expect(stressStatus({ expected: true, mutation: { ...waiting, phase: 'running', done: 6, total: 12 }, fn: 'f' })).toEqual({ kind: 'pending', phase: 'running', done: 6, total: 12 });
    expect(stressStatus({ expected: true, report: rep(), mutation: { ...waiting, phase: 'done' }, fn: 'f' }).kind).toBe('done');
    expect(stressStatus({ expected: true, report: rep(), mutation: waiting, fn: 'g' }).kind).toBe('done');
  });
  it('not-run: no report, or one with nothing run (it failed, nothing to break, baseline failed), or the page gave up', () => {
    expect(stressStatus({ expected: true, fn: 'f' })).toEqual({ kind: 'not-run' });
    for (const skipped of ['mutation check failed: boom', 'nothing to mutate: no operators, integer literals, conditions or returns', 'no mutant compiled', 'time box reached after 0 of 12 mutants']) {
      expect(stressStatus({ expected: true, report: { ...rep({ total: 0, killed: 0, killedByBound: 0, survived: 0 }), skipped }, fn: 'f' })).toEqual({ kind: 'not-run' });
    }
    expect(stressStatus({ expected: true, report: rep(), mutation: waiting, fn: 'f', gaveUp: true })).toEqual({ kind: 'not-run' });
  });
  it('partial: a time-boxed report, with the planned count when the engine says it', () => {
    expect(stressStatus({ expected: true, report: rep({ total: 7, killed: 5, survived: 2, skipped: 'time box reached after 7 of 12 mutants' }), fn: 'f' })).toEqual({ kind: 'partial', total: 7, caught: 5, missed: 2, planned: 12 });
    expect(stressStatus({ expected: true, report: rep({ skipped: 'something else' }), fn: 'f' })).toMatchObject({ kind: 'partial', planned: null });
  });

  const done = (caught: number, total = 12): StressStatus => ({ kind: 'done', total, caught, missed: total - caught });
  it('the seal: "every check" only when the stress test finished, with its own count', () => {
    expect(sealWords({ stress: done(11), ran: 5, of: 6 })).toBe('Passed every check · stress test caught 11 of 12');
    expect(sealWords({ stress: done(12), ran: 5, of: 6 })).toBe('Passed every check · stress test caught 12 of 12');
    expect(sealWords({ stress: { kind: 'not-run' }, ran: 5, of: 6 })).toBe("Passed 5 of 6 checks · stress test didn't run");
    // counts the checks that apply, never a fixed "5 of 6"
    expect(sealWords({ stress: { kind: 'not-run' }, ran: 3, of: 4 })).toBe("Passed 3 of 4 checks · stress test didn't run");
    expect(sealWords({ stress: { kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 }, ran: 5, of: 6 })).toBe('Passed 5 of 6 checks · stress test ran out of time');
    for (const st of [{ kind: 'not-run' }, { kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 }] as const) {
      expect(sealWords({ stress: st, ran: 5, of: 6 })).not.toMatch(/every check/);
    }
  });
  it('the seal is its two halves: how many checks passed, then the stress test in its own words', () => {
    const partial: StressStatus = { kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 };
    expect(stressWords(done(8))).toBe('stress test caught 8 of 12');
    expect(stressWords(partial)).toBe('stress test ran out of time');
    expect(stressWords({ kind: 'not-run' })).toBe("stress test didn't run");
    expect(stressWords({ kind: 'none' })).toBeNull();
    expect(stressWords({ kind: 'pending', phase: 'running', done: 2, total: 12 })).toBeNull();
    expect(sealHead({ stress: done(8), ran: 5, of: 6 })).toBe('Passed every check');
    expect(sealHead({ stress: partial, ran: 5, of: 6 })).toBe('Passed 5 of 6 checks');
    expect(sealHead({ stress: { kind: 'not-run' }, ran: 3, of: 4 })).toBe('Passed 3 of 4 checks');
    // and the seal is exactly the two joined, so the verdict line that reuses them can never drift from it
    for (const st of [done(8), done(12), partial, { kind: 'not-run' }, { kind: 'none' }] as const) {
      const w = stressWords(st);
      expect(sealWords({ stress: st, ran: 5, of: 6 })).toBe(w ? `${sealHead({ stress: st, ran: 5, of: 6 })} · ${w}` : sealHead({ stress: st, ran: 5, of: 6 }));
    }
  });
  it('the checked line takes the amber glyph when anything was missed or unfinished, and the not-checked line says what', () => {
    expect(stressChecked(done(12))).toEqual({ text: 'stress test (caught 12 of 12 deliberate breaks)', ask: false });
    expect(stressChecked(done(8))).toEqual({ text: 'stress test (caught 8 of 12 deliberate breaks)', ask: true });
    expect(stressChecked({ kind: 'not-run' })).toBeNull();
    expect(stressNotChecked(done(12))).toBeNull();
    expect(stressNotChecked(done(8))).toBe('4 of 12 deliberate breaks went unnoticed by your checks');
    for (const st of [done(8), { kind: 'not-run' }, { kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 }] as const) {
      expect(`${stressChecked(st)?.text ?? ''} ${stressNotChecked(st) ?? ''} ${sealWords({ stress: st, ran: 5, of: 6 })}`).not.toMatch(/mutant|mutation|fuzz|gate|spec\b|revision/i);
    }
  });
  it('one wording for the check and for what it does: it is the "stress test", and the things it does are "deliberate breaks", on every surface', () => {
    expect(deliberateBreaks(12)).toBe('12 deliberate breaks');
    expect(deliberateBreaks(1)).toBe('1 deliberate break');
    expect(stressLabel(12)).toBe('Stress test: 12 deliberate breaks');
    expect(stressLabel(1)).toBe('Stress test: 1 deliberate break');
    // before the run has a count (or when nothing is known), no number is made up
    expect(stressLabel(null)).toBe('Stress test: deliberate breaks');
    expect(stressLabel(0)).toBe('Stress test: deliberate breaks');
    const a = attempt(1, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const generation = gen([a], 'committed');
    const partialReport: MutationReport = { ...report(4, 1), skipped: 'time box reached after 5 of 12 mutants' };
    for (const mutationReport of [report(8, 4), report(12, 0), partialReport]) {
      const lanes = liveLanes({ generation, facts: full, run: 'done', mutationReport });
      const lane = lanes[5]!;
      const st = lane.stress!;
      expect(lane.label).toBe(stressLabel(st.kind === 'done' || st.kind === 'partial' ? st.total : null));
      const footer = footerFor(lanes, headerFor({ question: 'q', file: 'orders.csv', rows: 332, generation, lanes, run: 'done' })).text;
      // the ledger and the footer under the trace read one function, so a number cannot be said two ways: the footer is the ledger's line
      // without the unit, which lane 06 a line above has already named (a longer footer wrapped to a third line and made the pane taller)
      const short = stressChecked(st, false)!.text;
      expect(footer).toContain(short);
      expect(stressChecked(st)!.text.replace(/ deliberate breaks?/, '')).toBe(short);
      expect(short).not.toMatch(/deliberate/);
      const said = [lane.label, lane.aria, stressChecked(st)?.text ?? '', stressNotChecked(st) ?? '', stressWords(st) ?? '', footer].join(' | ');
      expect(said).not.toMatch(/small (breaks|ways)|on purpose|-way|we broke|\bmutant|\bmutation/i);
      expect(said).toMatch(/deliberate break/);
      expect(footer).not.toMatch(/deliberate/);
    }
    // the running footer and the ready lane use the same words too
    const ready = liveLanes({ generation: null, facts: full, run: 'idle' })[5]!;
    expect(ready.label).toBe('Stress test: deliberate breaks');
    const waitingLanes = liveLanes({ generation, facts: full, run: 'running', mutation: { fn: 'topCustomers', phase: 'running', done: 3, total: 12 } });
    const f = footerFor(waitingLanes, headerFor({ question: 'q', file: 'orders.csv', rows: 332, generation, lanes: waitingLanes, run: 'running' }));
    expect(f.text).toContain('Last is the stress test: it makes deliberate breaks in the calculation');
    expect(f.text).not.toMatch(/small ways|on purpose/);
    // not checked, time-boxed: counted in deliberate breaks as well
    expect(stressNotChecked({ kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 })).toBe('the stress test ran out of time: it tried 5 of 12 deliberate breaks, and 1 of those went unnoticed by your checks');
  });
  it('the lane, the header, the footer and the live sentence all say the same thing', () => {
    const a = attempt(1, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const generation = gen([a], 'committed');
    const base = { question: 'Top 5 customers by revenue', file: 'orders.csv', rows: 332 };
    for (const [mutationReport, seal] of [
      [report(8, 4), 'Passed every check · stress test caught 8 of 12'],
      [report(12, 0), 'Passed every check · stress test caught 12 of 12'],
      [{ ...report(0, 0), skipped: 'mutation check failed: boom' }, "Passed 5 of 6 checks · stress test didn't run"],
    ] as const) {
      const lanes = liveLanes({ generation, facts: full, run: 'done', mutationReport });
      expect(sealOfLanes(lanes)).toBe(seal);
      const h = headerFor({ ...base, generation, lanes, run: 'done' });
      expect(h.verdict?.startsWith(seal)).toBe(true);
      expect(h).toMatchObject({ done: true, tone: 'pass' });
      expect(liveTextFor(h, lanes)).toBe(`${seal}. Showing the answer.`);
    }
  });
  it('held: no verdict, no seal, until the stress test has finished; the other checks stay as they are', () => {
    const a = attempt(1, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const generation = gen([a], 'committed');
    const base = { question: 'Top 5 customers by revenue', file: 'orders.csv', rows: 332 };
    for (const [phase, right, meta] of [['waiting', 'stress test next…', 'stress test next…'], ['running', 'stress test running…', 'stress test running…']] as const) {
      const lanes = liveLanes({ generation, facts: full, run: 'running', mutation: { fn: 'topCustomers', phase, done: 3, total: 12 } });
      const h = headerFor({ ...base, generation, lanes, run: 'running' });
      expect(h).toEqual({ left: 'CHECK TRACE · DRAFT 1 · Top 5 customers by revenue · orders.csv · 332 rows', right, running: true, stress: phase });
      expect(h.verdict).toBeUndefined();
      expect(h.done).toBeUndefined();
      const f = footerFor(lanes, h);
      expect(f.meta).toBe(meta);
      expect(f.text).toMatch(/^The other checks passed\./);
      expect(f.text).not.toMatch(/passed every check|checked against/i);
      expect(liveTextFor(h, lanes)).toBe('The other checks passed. Running the stress test before showing the answer.');
    }
  });
  it('the footer after it finished: the same numbers; a stress test that gave no result says so', () => {
    const a = attempt(1, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const generation = gen([a], 'committed');
    const base = { question: 'q', file: 'orders.csv', rows: 332 };
    const foot = (mutationReport: MutationReport) => {
      const lanes = liveLanes({ generation, facts: full, run: 'done', mutationReport });
      return footerFor(lanes, headerFor({ ...base, generation, lanes, run: 'done' })).text;
    };
    expect(foot(report(8, 4))).toBe('Checked against: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables · stress test (caught 8 of 12) · your data untouched.');
    expect(foot({ ...report(0, 0), skipped: 'mutation check failed: boom' })).toBe("Checked against: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables · your data untouched. The stress test didn't run.");
  });
  it('basic checks are untouched: no stress test, no hold, the same words', () => {
    const a = attempt(1, 'accepted', [compileOk, g('tests', 'skipped', 'no tests yet'), g('properties', 'skipped', 'no properties yet'), invOk]);
    const generation = gen([a], 'committed');
    const lanes = liveLanes({ generation, facts: basic, run: 'done', mutation: waiting });
    const h = headerFor({ question: 'q', file: 'orders.csv', rows: 332, generation, lanes, run: 'done' });
    expect(h.verdict).toBe("Passed 2 basic checks ↓ see what wasn't checked");
    expect(h.running).toBeUndefined();
  });
});

describe('ghostFromAttempts', () => {
  it('a rejected first draft: lanes up to the failure, the design sentence, real detail', () => {
    const a1 = attempt(1, 'rejected', [
      compileOk,
      g('tests', 'fail', '6/7 tests passed (6 unit + 1 pinned)', { counts: { passed: 6, total: 7 }, diagnostics: [pinFail], headline: 'Rejected: x' }),
      notReached('properties'),
      notReached('invariants'),
    ]);
    const a2 = attempt(2, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const ghosts = ghostFromAttempts(gen([a1, a2], 'committed'), full);
    expect(ghosts).toHaveLength(1);
    const gh = ghosts[0]!;
    expect(gh.title).toBe('DRAFT 1');
    expect(gh.lanes.map((l) => [l.num, l.state])).toEqual([['01', 'passed'], ['02', 'passed'], ['03', 'failed']]);
    expect(gh.lanes[2]?.label).toBe('Matches your locked answer');
    expect(gh.note.map((s) => s.text).join('')).toBe(
      "First draft thrown out: it didn't match an answer you locked. topCustomers(rows): expected $2,252.07, got $2,260.06. Checks 04 to 06 never ran: a draft stops at its first failure.",
    );
    expect(gh.note.filter((s) => s.mono).map((s) => s.text)).toEqual(['$2,252.07', '$2,260.06']);
  });
  it('the detail describes the failing lane, not just the first diagnostic', () => {
    const exFail: Diagnostic = { kind: 'test', name: 'two orders', message: 'x', call: 'topCustomers(two)', expected: '20', actual: '25' };
    const a1 = attempt(1, 'rejected', [
      compileOk,
      g('tests', 'fail', '5/7 tests passed (6 unit + 1 pinned)', { diagnostics: [pinFail, exFail] }),
      notReached('properties'),
      notReached('invariants'),
    ]);
    const gh = ghostFromAttempts(gen([a1, attempt(2, 'generating', [])], 'generating'), full)[0]!;
    expect(gh.lanes.map((l) => l.state)).toEqual(['passed', 'failed']);
    expect(gh.note.map((s) => s.text).join('')).toContain("it didn't match one of your examples. topCustomers(two): expected 20, got 25.");
  });
  it('no ghost for the attempt shown, for a re-check, or with no generation', () => {
    const a1 = attempt(1, 'rejected', [g('compile', 'fail', '1 error', { headline: 'Rejected: Type error' }), notReached('tests'), notReached('properties'), notReached('invariants')]);
    expect(ghostFromAttempts(gen([a1], 'failed'), full)).toEqual([]);
    expect(ghostFromAttempts(gen([a1, attempt(2, 'generating', [])], 'generating', { kind: 'recheck' }), full)).toEqual([]);
    expect(ghostFromAttempts(null, full)).toEqual([]);
    const ghosts = ghostFromAttempts(gen([a1, attempt(2, 'generating', [])], 'generating'), full);
    expect(ghosts[0]?.note.map((s) => s.text).join('')).toBe(
      "First draft thrown out: it didn't run without errors. Type error. Checks 02 to 06 never ran: a draft stops at its first failure.",
    );
  });
});

describe('detailOf', () => {
  const tests = (...diagnostics: Diagnostic[]): GateResult => g('tests', 'fail', 'x', { diagnostics, headline: 'Rejected: something else entirely' });
  const join = (segs: Array<{ text: string }>): string => segs.map((s) => s.text).join('');
  it('a thrown error names the call, the error and what was expected, never the gate headline', () => {
    const d: Diagnostic = { kind: 'test', name: 'pinned: topCustomers(rows)', call: 'topCustomers(rows)', expected: '[…]', error: 'TypeError: x is undefined\n    at line 3', message: 'm' };
    const segs = detailOf(tests(d), 'Rejected: something else entirely');
    expect(join(segs)).toBe('topCustomers(rows) threw TypeError: x is undefined (expected […]). ');
    expect(segs.filter((s) => s.mono).map((s) => s.text)).toEqual(['TypeError: x is undefined', '[…]']);
  });
  it('a thrown error without a call or expected value uses the plain test name (no "decided:" prefix)', () => {
    const d: Diagnostic = { kind: 'test', name: 'decided: f([]) → []', error: 'Error: boom', message: 'test threw Error: boom' };
    expect(join(detailOf(tests(d), undefined))).toBe('f([]) → [] threw Error: boom. ');
  });
  it('a property that came back false names the rule and the call', () => {
    const d: Diagnostic = { kind: 'property', name: 'never negative', call: 'f([-1])', counterexample: '[[-1]]', shrinks: 2, runs: 10, seed: 1 };
    expect(join(detailOf(g('properties', 'fail', 'x', { diagnostics: [d] }), undefined))).toBe('"never negative" was false for f([-1]). ');
    const bare: Diagnostic = { kind: 'property', name: 'never negative', counterexample: '(none)', shrinks: 0, runs: 10, seed: 1 };
    expect(join(detailOf(g('properties', 'fail', 'x', { diagnostics: [bare] }), undefined))).toBe('"never negative" was false. ');
  });
  it('compile, invariant and spec errors in plain words', () => {
    const c: Diagnostic = { kind: 'compile', code: 2322, message: "Type 'string' is not assignable to type 'number'.\n  more", category: 'error', line: 3, col: 1, endLine: 3, endCol: 2, snippet: '' };
    expect(join(detailOf(g('compile', 'fail', 'x', { diagnostics: [c] }), undefined))).toBe("Line 3: Type 'string' is not assignable to type 'number'. ");
    const inv: Diagnostic = { kind: 'invariant', invariant: 'pure', message: 'm', call: 'f(rows)' };
    expect(join(detailOf(g('invariants', 'fail', 'x', { diagnostics: [inv] }), undefined))).toBe('It changed the data it was given (f(rows)). ');
    const spec: Diagnostic = { kind: 'test', name: '(spec error)', message: 'Unexpected token', error: 'Unexpected token' };
    expect(join(detailOf(tests(spec), 'Spec error: Unexpected token'))).toBe('Your checks did not load: Unexpected token. ');
  });
  it('no diagnostic: the headline without "Rejected: "', () => {
    expect(join(detailOf(g('tests', 'fail', 'x'), 'Rejected: candidate failed to load: boom.'))).toBe('candidate failed to load: boom. ');
  });
});

describe('headerFor / footerFor / liveTextFor', () => {
  const base = { question: 'Top 5 customers by revenue', file: 'orders.csv', rows: 332 };
  it('idle: READY line, waiting for your question', () => {
    const lanes = liveLanes({ generation: null, facts: full, run: 'idle' });
    const h = headerFor({ ...base, generation: null, lanes, run: 'idle' });
    expect(h).toEqual({ left: 'CHECK TRACE · READY · Top 5 customers by revenue · orders.csv · 332 rows', right: 'waiting for your question' });
    expect(headerFor({ ...base, rows: 1, run: 'idle', generation: null, lanes: [] } as Parameters<typeof headerFor>[0]).left).toMatch(/· 1 row$/);
    expect(footerFor(lanes, h)).toEqual({
      text: 'When you ask, all six checks run before you see anything. A draft that fails any of them is thrown out and the AI tries again.',
      meta: '6 checks ready',
    });
    const basicLanes = liveLanes({ generation: null, facts: basic, run: 'idle' });
    expect(footerFor(basicLanes, headerFor({ ...base, generation: null, lanes: basicLanes, run: 'idle' })).meta).toBe('2 checks ready · 4 not set up');
  });
  it('committed: verdict, real seconds from the gates, design footer', () => {
    const a = attempt(2, 'accepted', [compileOk, testsOk, propsOk, invOk]);
    const generation = gen([attempt(1, 'rejected', []), a], 'committed');
    const lanes = liveLanes({ generation, facts: full, run: 'done', mutationReport: report(11, 1) });
    const h = headerFor({ ...base, generation, lanes, run: 'done' });
    expect(h).toMatchObject({
      left: 'CHECK TRACE · DRAFT 2 · Top 5 customers by revenue · orders.csv · 332 rows',
      right: '0.41 s',
      verdict: 'Passed every check · stress test caught 11 of 12 ↓ see the list',
      done: true,
      tone: 'pass',
    });
    expect(footerFor(lanes, h)).toEqual({
      text: 'Checked against: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables · stress test (caught 11 of 12) · your data untouched.',
      meta: 'real run 0.41 s',
    });
    expect(liveTextFor(h, lanes)).toBe('Passed every check · stress test caught 11 of 12. Showing the answer.');
  });
  it('basic checks only', () => {
    const a = attempt(1, 'accepted', [compileOk, g('tests', 'skipped', 'no tests yet'), g('properties', 'skipped', 'no properties yet'), invOk]);
    const generation = gen([a], 'committed');
    const lanes = liveLanes({ generation, facts: basic, run: 'done' });
    const h = headerFor({ ...base, generation, lanes, run: 'done' });
    expect(h.verdict).toBe("Passed 2 basic checks ↓ see what wasn't checked");
    expect(footerFor(lanes, h).text).toBe('Checked against: runs without errors · never changes your data · finishes fast. Nothing else yet.');
    expect(liveTextFor(h, lanes)).toBe('Passed 2 basic checks. Showing the answer.');
  });
  it('a lock set after the answer on file was checked: the footer says it is not part of this run (never "nothing else yet" or "switch on once you lock")', () => {
    const none = attempt(1, 'accepted', [compileOk, g('tests', 'skipped', 'no tests yet'), g('properties', 'skipped', 'no properties yet'), invOk]);
    const facts: LaneFacts = { examples: 0, pins: 1, pinLabel: 'Puddlesworth Inc = $2,599.13', houseRules: 0, decisionTests: 0, tables: null };
    const generation = gen([none], 'committed');
    const lanes = liveLanes({ generation, facts, run: 'done' });
    const h = headerFor({ ...base, generation, lanes, run: 'done' });
    expect(footerFor(lanes, h).text).toBe('Checked against: runs without errors · never changes your data · finishes fast. Nothing else yet: your locked answer was set after this answer was checked.');
    const idle = liveLanes({ generation: null, facts: { ...facts, pinsChecked: 0 }, run: 'idle' });
    const f = footerFor(idle, headerFor({ ...base, generation: null, lanes: idle, run: 'idle' }));
    expect(f.text).toContain('Your locked answer was set after the answer on file was checked, so asking again does not re-run it.');
    expect(f.text).not.toContain('switch on once you lock');
    expect(f.meta).toBe('2 checks ready · 4 not run on this answer');
  });
  it('held: paused, amber verdict', () => {
    const prop: Diagnostic = { kind: 'property', name: 'refunds', counterexample: '[]', shrinks: 3, runs: 47, seed: 1, silentOn: 'all refunded' };
    const a = attempt(1, 'rejected', [compileOk, testsOk, g('properties', 'fail', '1/2 properties failed (147 runs: "a" 100, "refunds" 47)', { diagnostics: [prop] }), notReached('invariants')]);
    const generation = gen([a], 'failed');
    const lanes = liveLanes({ generation, facts: full, run: 'held' });
    const h = headerFor({ ...base, generation, lanes, run: 'held' });
    expect(h).toMatchObject({ right: 'paused · waiting on you', verdict: 'Stopped · a question only you can answer', tone: 'ask' });
    expect(footerFor(lanes, h)).toEqual({
      text: "Checked so far: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables. Stopped on table 47: your rules don't say what happens there.",
      meta: 'Nothing is shown until you decide',
    });
    expect(liveTextFor(h, lanes)).toBe('Stopped: a question only you can answer.');
  });
  it('running: checking…', () => {
    const generation = gen([attempt(1, 'generating', [])], 'generating');
    const lanes = liveLanes({ generation, facts: full, run: 'running' });
    expect(headerFor({ ...base, generation, lanes, run: 'running' })).toMatchObject({ right: 'checking…', running: true, left: 'CHECK TRACE · DRAFT 1 · Top 5 customers by revenue · orders.csv · 332 rows' });
    expect(lanes.slice(0, 5).every((l) => l.state === 'waiting')).toBe(true);
  });
});

describe('factsFromSpec', () => {
  it('uses evidence counts when committed, spec presence otherwise, decisions as house rules', () => {
    const spec = { tests: 'test("a", () => {})', properties: 'property(...)', pins: [{ id: 'p', label: 'f(x)', args: [], expected: 1, pinnedAt: 1 }], decisions: [] };
    expect(factsFromSpec(spec)).toEqual({ examples: null, pins: 1, houseRules: null, decisionTests: 0, tables: null });
    expect(
      factsFromSpec(spec, { compiled: true, unitTests: 6, pinnedTests: 1, properties: [{ name: 'a', runs: 100 }, { name: 'b', runs: 100 }], sampledCalls: 1 }, 'X = 1'),
    ).toEqual({ examples: 6, pins: 1, pinLabel: 'X = 1', houseRules: 2, decisionTests: 0, tables: 100 });
    expect(factsFromSpec({ tests: '', properties: '', pins: [], decisions: [] })).toEqual({ examples: 0, pins: 0, houseRules: 0, decisionTests: 0, tables: null });
  });
});

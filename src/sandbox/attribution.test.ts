import { describe, expect, it } from 'vitest';
import type { GateResult } from '../types';
import { applyAttribution, INTERRUPTED_NOTE, invariantFailure, invariantHeadline, notReached, pureMessage } from './attribution';

describe('attribution helpers', () => {
  it('builds invariant headlines from the diagnostic message', () => {
    expect(invariantHeadline({ kind: 'invariant', invariant: 'pure', message: "candidate read global 'Math.random'" })).toBe(
      "Rejected: candidate read global 'Math.random' (pure)",
    );
    expect(invariantHeadline({ kind: 'invariant', invariant: 'pure', message: 'mutated its argument', call: 'median([2, 1])' })).toBe(
      'Rejected: median([2, 1]) mutated its argument (pure)',
    );
    expect(invariantHeadline({ kind: 'invariant', invariant: 'bounded', message: 'f(9) did not return within 5 ms', call: 'f(9)' })).toBe(
      'Rejected: f(9) did not return within 5 ms (bounded)',
    );
  });

  it('phrases mask violations as globals read or written', () => {
    expect(pureMessage('Math.random')).toBe("candidate read global 'Math.random'");
    expect(pureMessage('Date (reads the clock)')).toBe("candidate read global 'Date'");
    expect(pureMessage("wrote global 'x'")).toBe("candidate wrote global 'x'");
  });

  it('applies the rule: completed kept, interrupted and later skipped, Invariants reports', () => {
    const tests: GateResult = { gate: 'tests', status: 'pass', ms: 1, summary: '1/1 tests passed', diagnostics: [] };
    const inv = invariantFailure({ kind: 'invariant', invariant: 'pure', message: 'm' }, 4);
    const rs = applyAttribution([tests], 'properties', inv, 9);
    expect(rs).toEqual([tests, { gate: 'properties', status: 'skipped', ms: 9, summary: 'interrupted', diagnostics: [], note: INTERRUPTED_NOTE }, inv]);
    expect(applyAttribution([], 'tests', inv).map((r) => r.note)).toEqual([INTERRUPTED_NOTE, INTERRUPTED_NOTE, undefined]);
    expect(notReached('invariants')).toMatchObject({ status: 'skipped', note: 'not reached' });
  });
});

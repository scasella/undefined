import { describe, expect, it } from 'vitest';
import { plainEvidence, plainMutation, plainMutationProgress } from './evidence';
import { MUTATION_FAILED_PREFIX } from '../shared/evidence';
import { NO_TESTS_REASON } from '../mutation/classify';

const JARGON = /property-based|\binvariant\b|\bmutants?\b|\bshrunk\b|fast-check|counterexample|\bkill/i;
const report = (o: Partial<Parameters<typeof plainMutation>[0] & object> = {}) => ({
  total: 12, killed: 11, killedByBound: 0, survived: 1, stillborn: 0, survivors: [], ms: 900, at: 0, ...o,
});

describe('plain evidence line', () => {
  it('lists the same five facts without a score or jargon', () => {
    const line = plainEvidence({ compiled: true, unitTests: 4, pinnedTests: 0, properties: [{ name: 'a', runs: 100 }], sampledCalls: 26, mutation: report() });
    expect(line).toBe(
      'Compiled. 4 tests passed. 1 rule held for 100 random inputs. 26 calls re-run to look for side effects. Your checks caught 11 of 12 deliberately broken copies (1 slipped through, and may behave exactly like the original).',
    );
    expect(line).not.toMatch(JARGON);
    expect(line).not.toMatch(/%|score|grade/i);
  });
  it('says "no" for zero, and covers every mutation outcome', () => {
    expect(plainEvidence({ compiled: true, unitTests: 0, pinnedTests: 2, properties: [], sampledCalls: 0 })).toBe(
      'Compiled. 2 pinned results reproduced. No random-input checks. No calls were re-run to look for side effects. The broken-copy check has not run yet.',
    );
    expect(plainMutation(report({ total: 0, killed: 0, survived: 0, skipped: NO_TESTS_REASON }))).toBe('With nothing to check against, no broken copies were tried.');
    expect(plainMutation(report({ total: 0, killed: 0, survived: 0, skipped: `${MUTATION_FAILED_PREFIX}boom` }))).toMatch(/could not run/);
    expect(plainMutation(report({ killed: 8, killedByBound: 2, survived: 2, stillborn: 1 }))).toBe(
      'Your checks caught 10 of 12 deliberately broken copies (2 of them by the time limit; 2 slipped through, and may behave exactly like the original; 1 more did not compile).',
    );
    for (const r of [report(), report({ skipped: 'time box reached after 6 of 12 mutants' })]) expect(plainMutation(r)).not.toMatch(JARGON);
  });
  it('counts the decisions in the tests and rules they belong to (absent = unchanged)', () => {
    const base = { compiled: true, unitTests: 5, pinnedTests: 0, properties: [{ name: 'a', runs: 100 }, { name: 'b', runs: 100 }], sampledCalls: 25 };
    expect(plainEvidence({ ...base, decisions: 2 })).toMatch(/^Compiled\. 5 tests passed, including 2 decisions\. 2 rules held for 100 random inputs each\./);
    expect(plainEvidence({ ...base, decisions: 1 })).toMatch(/5 tests passed, including 1 decision\./);
    expect(plainEvidence({ ...base, unitTests: 1, decisions: 1 })).toMatch(/1 test passed, your decision\./);
    expect(plainEvidence({ ...base, decisionProperties: 1 })).toMatch(/2 rules held for 100 random inputs each, including 1 decision\./);
    expect(plainEvidence({ ...base, pinnedTests: 1, decisions: 1 })).toMatch(/5 tests and 1 pinned result passed, including 1 decision\./);
  });
  it('progress only for the function it is about', () => {
    expect(plainMutationProgress({ fn: 'median', phase: 'running', done: 3, total: 12 }, 'median')).toBe('Trying your checks against broken copies… 3/12');
    expect(plainMutationProgress({ fn: 'median', phase: 'running', done: 3, total: 12 }, 'slugify')).toBeNull();
  });
});

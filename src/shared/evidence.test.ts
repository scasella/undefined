import { describe, expect, it } from 'vitest';
import type { Evidence, MutationReport } from '../types';
import { NO_TESTS_REASON, skippedReport } from '../mutation/classify';
import {
  describeEvidence,
  describeMutation,
  describeProperties,
  describeSampledCalls,
  describeTests,
  MUTATION_FAILED_PREFIX,
  MUTATION_NOT_RUN,
  mutationAdvice,
  mutationFailed,
  mutationProgress,
  NO_TESTS_ADVICE,
  sentence,
  survivorLine,
} from './evidence';

const report = (over: Partial<MutationReport> = {}): MutationReport => ({
  total: 12,
  killed: 9,
  killedByBound: 0,
  survived: 3,
  stillborn: 0,
  survivors: [],
  ms: 812,
  at: 1,
  ...over,
});

describe('describeTests', () => {
  it.each([
    [0, 0, 'No unit tests.'],
    [1, 0, '1 unit test.'],
    [3, 0, '3 unit tests.'],
    [3, 2, '3 unit tests and 2 pinned.'],
    [1, 1, '1 unit test and 1 pinned.'],
    [0, 1, '1 pinned test and no unit tests.'],
    [0, 2, '2 pinned tests and no unit tests.'],
  ])('%i unit, %i pinned → %s', (u, p, want) => {
    expect(describeTests(u, p)).toBe(want);
  });
});

describe('describeProperties', () => {
  it('none, one, equal runs, differing runs', () => {
    expect(describeProperties([])).toBe('No properties.');
    expect(describeProperties([{ name: 'a', runs: 100 }])).toBe('1 property, 100 runs.');
    expect(describeProperties([{ name: 'a', runs: 1 }])).toBe('1 property, 1 run.');
    expect(describeProperties([{ name: 'a', runs: 200 }, { name: 'b', runs: 200 }])).toBe('2 properties, 200 runs each.');
    expect(describeProperties([{ name: 'a', runs: 1 }, { name: 'b', runs: 1 }])).toBe('2 properties, 1 run each.');
    expect(describeProperties([{ name: 'a', runs: 100 }, { name: 'b', runs: 300 }])).toBe('2 properties (100 and 300 runs).');
    expect(describeProperties([{ name: 'a', runs: 100 }, { name: 'b', runs: 50 }, { name: 'c', runs: 300 }])).toBe('3 properties (100, 50 and 300 runs).');
  });
});

describe('describeSampledCalls', () => {
  it('says none rather than omitting zero', () => {
    expect(describeSampledCalls(0)).toBe('No calls were replayed for purity.');
    expect(describeSampledCalls(1)).toBe('1 call replayed for purity.');
    expect(describeSampledCalls(26)).toBe('26 calls replayed for purity.');
  });
});

describe('describeMutation', () => {
  it('not run yet, skipped, failed to run, and the counts', () => {
    expect(describeMutation(undefined)).toBe(MUTATION_NOT_RUN);
    expect(describeMutation(skippedReport(NO_TESTS_REASON, 1))).toBe('No tests yet: nothing could kill a mutant.');
    const failed = skippedReport(`${MUTATION_FAILED_PREFIX}mutant failed to load: boom`, 1);
    expect(describeMutation(failed)).toBe('Mutation check could not run: mutant failed to load: boom.');
    expect(mutationFailed(failed)).toBe(true);
    expect(mutationFailed(skippedReport(NO_TESTS_REASON, 1))).toBe(false);
    expect(describeMutation(report())).toBe('Tests killed 9 of 12 mutants (3 survived, which may be equivalent).');
    expect(describeMutation(report({ killed: 12, survived: 0 }))).toBe('Tests killed 12 of 12 mutants.');
    expect(describeMutation(report({ total: 1, killed: 1, survived: 0 }))).toBe('Tests killed 1 of 1 mutant.');
    expect(describeMutation(report({ killed: 8, killedByBound: 1, stillborn: 2 }))).toBe(
      'Tests killed 8 of 12 mutants (1 more stopped by the time limit; 3 survived, which may be equivalent; 2 did not compile).',
    );
    expect(describeMutation(report({ total: 9, killed: 9, survived: 0, skipped: 'time box reached after 9 of 12 mutants' }))).toBe(
      'Tests killed 9 of 9 mutants; time box reached after 9 of 12 mutants.',
    );
  });

  it('advice only for the no-tests case', () => {
    expect(mutationAdvice(skippedReport(NO_TESTS_REASON, 1))).toBe(NO_TESTS_ADVICE);
    expect(mutationAdvice(report())).toBeNull();
    expect(mutationAdvice(undefined)).toBeNull();
  });
});

describe('describeEvidence', () => {
  const ev: Evidence = {
    compiled: true,
    unitTests: 3,
    pinnedTests: 0,
    properties: [{ name: 'a', runs: 100 }, { name: 'b', runs: 100 }],
    sampledCalls: 1,
  };
  it('is facts only, in a fixed order, never a score', () => {
    expect(describeEvidence(ev)).toBe(
      'Compiled. 3 unit tests. 2 properties, 100 runs each. 1 call replayed for purity. Mutation check: not run yet.',
    );
    expect(describeEvidence({ ...ev, mutation: report() })).toBe(
      'Compiled. 3 unit tests. 2 properties, 100 runs each. 1 call replayed for purity. Tests killed 9 of 12 mutants (3 survived, which may be equivalent).',
    );
    const text = describeEvidence({ ...ev, pinnedTests: 2, mutation: report() });
    expect(text).toContain('3 unit tests and 2 pinned.');
    expect(text).not.toMatch(/%|score|grade|confidence|\/10|★/i);
  });

  it('says none for every zero', () => {
    expect(describeEvidence({ compiled: true, unitTests: 0, pinnedTests: 0, properties: [], sampledCalls: 0, mutation: skippedReport(NO_TESTS_REASON, 1) })).toBe(
      'Compiled. No unit tests. No properties. No calls were replayed for purity. No tests yet: nothing could kill a mutant.',
    );
  });
});

describe('small formatters', () => {
  it('sentence, survivor line, progress', () => {
    expect(sentence('abc')).toBe('Abc.');
    expect(sentence('Done!')).toBe('Done!');
    expect(survivorLine({ id: 'm1', kind: 'comparison', line: 3, original: '<', mutated: '<=' })).toBe(
      'compiled line 3: < → <= (may be an equivalent mutant)',
    );
    expect(mutationProgress(undefined)).toBeNull();
    expect(mutationProgress({ fn: 'median', phase: 'running', done: 5, total: 12 })).toBe('Checking the tests against 12 broken copies… 5/12');
    expect(mutationProgress({ fn: 'median', phase: 'running', done: 0, total: 1 })).toBe('Checking the tests against 1 broken copy… 0/1');
    expect(mutationProgress({ fn: 'median', phase: 'running', done: 5, total: 12 }, 'slugify')).toBeNull();
    expect(mutationProgress({ fn: 'median', phase: 'done', done: 12, total: 12 })).toBeNull();
    expect(mutationProgress({ fn: 'median', phase: 'waiting', done: 0, total: 0 })).toMatch(/idle/);
  });
});

import { describe, expect, it } from 'vitest';
import { buildReport, describeReport, NO_TESTS_REASON, skippedReport, type MutantOutcome } from './classify';
import type { Mutant } from './mutate';

const mutant = (i: number): Mutant => ({
  id: `arithmetic@${i}:5`,
  kind: 'arithmetic',
  line: i,
  original: '+',
  mutated: '-',
  js: `"use strict";\nfunction f(a, b) {\n    return a - b; // ${i}\n}\n`,
});

const outcomes = (...os: MutantOutcome[]) => os.map((outcome, i) => ({ mutant: mutant(i + 1), outcome }));

describe('buildReport', () => {
  it('keeps four separate buckets: total = killed + killedByBound + survived, stillborn outside total', () => {
    const r = buildReport(
      12,
      outcomes(...Array<MutantOutcome>(7).fill('killed'), 'killed-by-bound', ...Array<MutantOutcome>(4).fill('survived')),
      1,
      123.4,
      1000,
    );
    expect(r).toMatchObject({ total: 12, killed: 7, killedByBound: 1, survived: 4, stillborn: 1, ms: 123, at: 1000 });
    expect(r.total).toBe(r.killed + r.killedByBound + r.survived);
    expect(r.skipped).toBeUndefined();
  });

  it('counts stillborn outcomes and the extra stillborn count, never as killed and never in total', () => {
    const r = buildReport(2, outcomes('killed', 'stillborn', 'survived', 'stillborn'), 3, 0, 0);
    expect(r).toMatchObject({ total: 2, killed: 1, killedByBound: 0, survived: 1, stillborn: 5 });
  });

  it('throws when total disagrees with the mutants that ran (e.g. counting stillborn in total)', () => {
    expect(() => buildReport(3, outcomes('killed', 'stillborn', 'survived'), 0, 0, 0)).toThrow(RangeError);
    expect(() => buildReport(1, outcomes('killed', 'survived'), 0, 0, 0)).toThrow(/total 1 does not match the 2/);
  });

  it('lists at most survivorsMax survivors, in run order, without the mutant JS', () => {
    const r = buildReport(7, outcomes('survived', 'killed', 'survived', 'survived', 'survived', 'survived', 'survived'), 0, 0, 0, 3);
    expect(r.survived).toBe(6);
    expect(r.survivors.map((s) => s.line)).toEqual([1, 3, 4]);
    expect(r.survivors[0]).toEqual({ id: 'arithmetic@1:5', kind: 'arithmetic', line: 1, original: '+', mutated: '-' });
    expect(buildReport(6, outcomes(...Array<MutantOutcome>(6).fill('survived')), 0, 0, 0).survivors).toHaveLength(5);
  });

  it('rejects an unknown outcome', () => {
    expect(() => buildReport(1, [{ mutant: mutant(1), outcome: 'timeout' as MutantOutcome }], 0, 0, 0)).toThrow(/unknown mutant outcome/);
  });
});

describe('describeReport', () => {
  const report = (killed: number, killedByBound: number, survived: number, stillborn: number, skipped?: string) => {
    const os = [
      ...Array<MutantOutcome>(killed).fill('killed'),
      ...Array<MutantOutcome>(killedByBound).fill('killed-by-bound'),
      ...Array<MutantOutcome>(survived).fill('survived'),
    ];
    const r = buildReport(os.length, outcomes(...os), stillborn, 0, 0);
    if (skipped !== undefined) r.skipped = skipped;
    return describeReport(r);
  };

  it('the full sentence', () => {
    expect(report(7, 1, 4, 1)).toBe(
      'Tests killed 7 of 12 mutants (1 more stopped by the time limit; 4 survived, which may be equivalent; 1 did not compile)',
    );
  });

  it('omits zero buckets and the parenthesis when nothing but kills', () => {
    expect(report(12, 0, 0, 0)).toBe('Tests killed 12 of 12 mutants');
    expect(report(5, 0, 1, 0)).toBe('Tests killed 5 of 6 mutants (1 survived, which may be equivalent)');
    expect(report(3, 2, 0, 0)).toBe('Tests killed 3 of 5 mutants (2 more stopped by the time limit)');
    expect(report(4, 0, 0, 2)).toBe('Tests killed 4 of 4 mutants (2 did not compile)');
  });

  it('pluralises', () => {
    expect(report(1, 0, 0, 0)).toBe('Tests killed 1 of 1 mutant');
    expect(report(0, 0, 1, 0)).toBe('Tests killed 0 of 1 mutant (1 survived, which may be equivalent)');
    expect(report(0, 0, 3, 0)).toBe('Tests killed 0 of 3 mutants (3 survived, which may be equivalent)');
  });

  it('a partial (time-boxed) run appends the reason', () => {
    expect(report(6, 0, 3, 0, 'time box reached after 9 of 12 mutants')).toBe(
      'Tests killed 6 of 9 mutants (3 survived, which may be equivalent); time box reached after 9 of 12 mutants',
    );
  });

  it('skipped reports say why nothing ran', () => {
    expect(describeReport(skippedReport(NO_TESTS_REASON, 5))).toBe('no tests yet: nothing could kill a mutant');
    const r = skippedReport('no mutant compiled', 5);
    r.stillborn = 2;
    expect(describeReport(r)).toBe('no mutant compiled (2 mutants did not compile)');
    expect(skippedReport(NO_TESTS_REASON, 5)).toEqual({
      total: 0, killed: 0, killedByBound: 0, survived: 0, stillborn: 0, survivors: [], ms: 0, at: 5, skipped: NO_TESTS_REASON,
    });
  });

  it('nothing run and nothing skipped', () => {
    expect(report(0, 0, 0, 3)).toBe('No mutants could be run (3 did not compile)');
    expect(report(0, 0, 0, 0)).toBe('No mutants could be run');
  });
});

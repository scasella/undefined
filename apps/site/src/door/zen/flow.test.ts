import { describe, expect, it } from 'vitest';
import { canContinue, paneOf, zenChecks, zenChecksSummary } from './flow';

const agr = (examples: number, locks: number, rules: number, seeded = false) => ({ n: { examples, locks, rules }, seeded });

describe('canContinue', () => {
  it('needs data, then a question, and never while busy', () => {
    expect(canContinue(1, { bound: false, question: false, busy: false })).toBe(false);
    expect(canContinue(1, { bound: true, question: false, busy: false })).toBe(true);
    expect(canContinue(2, { bound: true, question: false, busy: false })).toBe(false);
    expect(canContinue(2, { bound: true, question: true, busy: false })).toBe(true);
    expect(canContinue(3, { bound: true, question: true, busy: true })).toBe(false);
  });
  it('panes 4 and 5 are left by their own buttons', () => {
    expect(canContinue(4, { bound: true, question: true, busy: false })).toBe(false);
    expect(canContinue(5, { bound: true, question: true, busy: false })).toBe(false);
  });
});

describe('zenChecks', () => {
  it('lists the six checks in order', () => {
    expect(zenChecks(agr(0, 0, 0)).map((c) => c.num)).toEqual(['01', '02', '03', '04', '05', '06']);
  });
  it('an empty agreement: two always-on checks, three that do not apply yet', () => {
    const c = zenChecks(agr(0, 0, 0));
    expect(c.map((x) => x.state)).toEqual(['always', 'none', 'after', 'none', 'always', 'none']);
  });
  it('the demo agreement counts its parts and switches the stress test on', () => {
    const c = zenChecks(agr(6, 1, 2, true));
    expect(c[1]!.label).toBe('Matches your 6 examples');
    expect(c[2]!.label).toBe('Matches your 1 locked answer');
    expect(c[3]!.label).toBe('Follows your 2 house rules on made-up tables');
    expect(c[5]!.state).toBe('applies');
    expect(c[1]!.note).toContain('this demo file brings');
  });
  it('summarises the level honestly', () => {
    expect(zenChecksSummary('full')).toMatch(/Full checks/);
    expect(zenChecksSummary('basic')).toMatch(/Basic checks/);
  });
  it('names the panes', () => {
    expect(paneOf(3).title).toBe('What your answer must pass');
  });
});

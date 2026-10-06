import { describe, expect, it } from 'vitest';
import { NOT_RERUN } from '../model/agreement';
import { OFF_NOTES } from '../model/lanes';
import { canContinue, CONTINUE_WHY_ID, continueReason, isTypedQuestion, NEEDS_DATA_REASON, NEEDS_QUESTION_REASON, openingStep, paneOf, ZEN_CONTINUE_ID, zenChecks, zenChecksSummary } from './flow';

const agr = (examples: number, locks: number, rules: number, seeded = false) => ({ n: { examples, locks, rules }, seeded });
const FULL = { level: 'full', mode: 'live' } as const;
const BASIC = { level: 'basic', mode: 'live' } as const;

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
  it('a question that needs the version on the viewer\'s computer cannot leave panes 2 or 3 (replay would dead-end three panes later)', () => {
    const s = { bound: true, question: true, busy: false };
    expect(canContinue(2, { ...s, needsLive: true })).toBe(false);
    expect(canContinue(3, { ...s, needsLive: true })).toBe(false);
    expect(canContinue(2, { ...s, needsLive: false })).toBe(true);
    // pane 1 is about the data, not the question
    expect(canContinue(1, { ...s, needsLive: true })).toBe(true);
  });
});

describe('continueReason', () => {
  const why = 'In this demo, answers are recorded, …';
  it('gives the words only where Continue is blocked by a question that needs live', () => {
    expect(continueReason(2, { question: true, needsLive: true }, why)).toBe(why);
    expect(continueReason(3, { question: true, needsLive: true }, why)).toBe(why);
    expect(continueReason(2, { question: true, needsLive: false }, why)).toBe('');
    expect(continueReason(2, { question: false, needsLive: true }, why)).not.toBe(why);
    expect(continueReason(1, { question: true, needsLive: true }, why)).toBe('');
  });
  it('the first pane says what it needs while there is no data, and nothing once there is', () => {
    expect(continueReason(1, { question: false, needsLive: false, bound: false }, '')).toBe('Choose a sample or bring a file to continue.');
    expect(NEEDS_DATA_REASON).toBe('Choose a sample or bring a file to continue.');
    expect(continueReason(1, { question: false, needsLive: false, bound: true }, '')).toBe('');
    expect(continueReason(1, { question: false, needsLive: false }, '')).toBe('');
    // it is a reason for exactly the cases canContinue refuses on the first pane
    expect(canContinue(1, { bound: false, question: false, busy: false })).toBe(false);
    expect(canContinue(1, { bound: true, question: false, busy: false })).toBe(true);
  });
  it('the second pane says so when nothing is picked', () => {
    expect(continueReason(2, { question: false, needsLive: false, bound: true }, why)).toBe(NEEDS_QUESTION_REASON);
    expect(continueReason(2, { question: false, needsLive: false, bound: false }, why)).toBe('');
    expect(continueReason(3, { question: false, needsLive: false, bound: true }, why)).toBe('');
  });
});

describe('the Continue button is a place focus can be sent to', () => {
  it('has one id (the data pane sends focus there once the picker it was pressed in has closed)', () => {
    expect(ZEN_CONTINUE_ID).toBe('zen-continue');
  });
});

describe('openingStep: where Step by step opens when the shared session already holds something', () => {
  it('no data: the first pane', () => {
    expect(openingStep({ bound: false, outcome: 'idle', answerShown: false })).toBe(1);
    // a run cannot outlive its file: nothing bound wins over whatever the outcome says
    expect(openingStep({ bound: false, outcome: 'committed', answerShown: true })).toBe(1);
  });
  it('a file but nothing asked: the question', () => {
    expect(openingStep({ bound: true, outcome: 'idle', answerShown: false })).toBe(2);
  });
  it('an answer that is committed (or answered from the version on file) and shown: the answer', () => {
    expect(openingStep({ bound: true, outcome: 'committed', answerShown: true })).toBe(5);
    expect(openingStep({ bound: true, outcome: 'cached', answerShown: true })).toBe(5);
  });
  it('an answer that is not shown yet is not step 5 (the seal and the answer arrive together, after the stress test)', () => {
    expect(openingStep({ bound: true, outcome: 'committed', answerShown: false })).toBe(2);
    expect(openingStep({ bound: true, outcome: 'cached', answerShown: false })).toBe(2);
  });
  it('a run still going: the live trace, which hands over by itself', () => {
    expect(openingStep({ bound: true, outcome: 'running', answerShown: false })).toBe(4);
  });
  it('a run that ended without an answer: the question again (the way to ask is there; the reasons were on the page that ran it)', () => {
    for (const outcome of ['thrown-out', 'stopped', 'declined', 'no-recording', 'service', 'error'] as const) {
      expect(openingStep({ bound: true, outcome, answerShown: false })).toBe(2);
    }
  });
});

describe('the reason lives under the selected question', () => {
  it('one id for the status region (under the "Asking" line on panes 2 and 3) that Continue and Run point at', () => {
    expect(CONTINUE_WHY_ID).toBe('zen-why');
  });
});

describe('isTypedQuestion', () => {
  it('only the questions the viewer typed (own:…) can be removed, never a suggestion', () => {
    expect(isTypedQuestion('own:howManyOrdersWereRefunded')).toBe(true);
    expect(isTypedQuestion('top')).toBe(false);
    expect(isTypedQuestion('countByStatus')).toBe(false);
  });
});

describe('zenChecks', () => {
  it('lists the six checks in order', () => {
    expect(zenChecks(agr(0, 0, 0), BASIC).map((c) => c.num)).toEqual(['01', '02', '03', '04', '05', '06']);
  });
  it('an empty agreement: two always-on checks, three that do not apply yet', () => {
    const c = zenChecks(agr(0, 0, 0), BASIC);
    expect(c.map((x) => x.state)).toEqual(['always', 'none', 'after', 'none', 'always', 'none']);
  });
  it('the words for a check with nothing to run are the trace\'s own (one wording per state)', () => {
    const c = zenChecks(agr(0, 0, 0), BASIC);
    expect(c.map((x) => x.tag)).toEqual(['Always', OFF_NOTES.examples, OFF_NOTES.locks, OFF_NOTES.rules, 'Always', OFF_NOTES.stress]);
  });
  it('the demo agreement counts its parts and switches the stress test on', () => {
    const c = zenChecks(agr(6, 1, 2, true), FULL);
    expect(c[1]!.label).toBe('Matches your 6 examples');
    expect(c[2]!.label).toBe('Matches your 1 locked answer');
    expect(c[3]!.label).toBe('Follows your 2 house rules on made-up tables');
    expect(c[5]!.state).toBe('applies');
    expect(c[1]!.note).toContain('this demo file brings');
    expect(c.map((x) => x.tag)).toEqual(['Always', 'Applies', 'Applies', 'Applies', 'Always', 'Applies']);
  });
  it('a lock set after the answer on file was checked is NOT "Applies": the next ask re-runs nothing (basic level)', () => {
    const c = zenChecks(agr(0, 1, 0), BASIC);
    expect(c[2]).toMatchObject({ label: 'Matches your 1 locked answer', state: 'held', tag: NOT_RERUN });
    expect(c[2]!.note).toContain('Added after the answer on file was checked');
    expect(c[2]!.note).toContain('applies to the next version');
    // nothing else was set, so the plain words stay for those; the stress test did not run either
    expect(c[1]!.tag).toBe(OFF_NOTES.examples);
    expect(c[3]!.tag).toBe(OFF_NOTES.rules);
    expect(c[5]).toMatchObject({ state: 'held', tag: NOT_RERUN });
    expect(c.filter((x) => x.tag === 'Applies')).toHaveLength(0);
  });
  it('in the replay demo the same rows say the demo cannot re-run, and never promise the next version', () => {
    const c = zenChecks(agr(0, 1, 0), { level: 'basic', mode: 'replay' });
    expect(c[2]!.note).toContain("This demo can't re-run");
    expect(c[2]!.note).not.toContain('next version');
  });
  it('the level that will run decides: full level keeps Applies', () => {
    expect(zenChecks(agr(0, 1, 0), FULL)[2]).toMatchObject({ state: 'applies', tag: 'Applies' });
  });
  it('Full checks: the answer comes after all six have run, and the stress test reports a count instead of passing or failing (no "only if every one passes")', () => {
    const s = zenChecksSummary('full');
    expect(s).toBe('Full checks: all six apply. The answer appears after all six have run: the first five must pass, and the stress test reports how many of its deliberate breaks your checks caught.');
    expect(s).not.toMatch(/only if every one passes/);
    expect(s).not.toMatch(/gate|spec|property|fuzz|mutant|revision|pin/i);
  });
  it('summarises the level honestly', () => {
    expect(zenChecksSummary('full')).toMatch(/Full checks/);
    expect(zenChecksSummary('basic')).toMatch(/Basic checks/);
    expect(zenChecksSummary('basic', { examples: 0, locks: 0, rules: 0 })).toBe('Basic checks: the two that always run. The answer says plainly that it was checked this lightly.');
  });
  it('basic checks with something set: says it is not re-run, so no "two that always run" next to a row saying Applies', () => {
    const s = zenChecksSummary('basic', { examples: 0, locks: 1, rules: 0 });
    expect(s).toBe("Basic checks: the two that always run. Your agreement (1 locked answer) isn't re-run: the answer on file was checked before it was added.");
  });
  it('names the panes', () => {
    expect(paneOf(3).title).toBe('What your answer must pass');
  });
});

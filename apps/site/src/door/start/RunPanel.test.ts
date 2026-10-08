import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIVE_CACHED } from './derive';
import { sayAnswer, settledLiveText, traceLiveText } from './RunPanel';

const SEAL = 'Passed every check · stress test caught 8 of 12';
const pass = { done: true, tone: 'pass', verdict: `${SEAL} ↓ see the list`, left: 'CHECK TRACE', right: '0.41 s' } as const;

describe('settledLiveText: what the trace says aloud when the run is over and the answer is not beside it (Step by step, "Checking")', () => {
  it('a run that passed says its one-line summary, the answer pane\'s own words, and never "Showing the answer"', () => {
    const said = settledLiveText({ header: pass, footer: { text: '', meta: 'real run 0.41 s' }, liveText: `${SEAL}. Showing the answer.` });
    expect(said).toBe(`${SEAL} · real run 0.41 s`);
    expect(said).not.toMatch(/showing the answer/i);
  });
  it('an answer certified earlier says that, not "real run"', () => {
    const said = settledLiveText({ header: pass, footer: { text: '', meta: 'checked when it was written · 0.41 s · nothing re-run' }, liveText: LIVE_CACHED });
    expect(said).toBe(`${SEAL} · checked when it was written · 0.41 s · nothing re-run`);
  });
  it('a pass with no verdict to quote keeps the trace\'s own sentence, minus the claim that the answer is showing', () => {
    expect(settledLiveText({ header: { done: true, tone: 'pass', left: 'x', right: '0.41 s' }, footer: { text: '', meta: '' }, liveText: LIVE_CACHED })).toBe('Answered by a version that already passed these checks.');
  });
  it('a run still going, or one that did not pass, is left exactly as the trace words it', () => {
    const running = { header: { left: 'x', right: '', running: true }, footer: { text: '', meta: '' }, liveText: 'Checking the draft.' } as const;
    expect(settledLiveText(running)).toBe('Checking the draft.');
    const thrownOut = { header: { done: true, tone: 'fail', verdict: 'Every draft was thrown out', left: 'x', right: '' }, footer: { text: '', meta: '' }, liveText: 'Every draft was thrown out.' } as const;
    expect(settledLiveText(thrownOut)).toBe('Every draft was thrown out.');
  });
});

describe('sayAnswer: the verdict and the answer, once, in one sentence', () => {
  const LEAD = 'Chef Ravioli Starbright, $2,252.07';
  it('puts the lead after "Showing the answer", leaving the verdict as it was', () => {
    expect(sayAnswer(`${SEAL}. Showing the answer.`, LEAD)).toBe(`${SEAL}. Showing the answer: ${LEAD}.`);
    expect(sayAnswer(LIVE_CACHED, LEAD)).toBe(`Answered by a version that already passed these checks. Showing the answer: ${LEAD}.`);
    expect(sayAnswer('Passed 2 basic checks. Showing the answer.', '258 orders')).toBe('Passed 2 basic checks. Showing the answer: 258 orders.');
  });
  it('keeps every "$" of the lead exactly (a replacement string would read "$&" or "$1" as a pattern)', () => {
    for (const lead of ['A, $1,909.90', "B, $&", "C, $'", 'D, $$5']) expect(sayAnswer('x. Showing the answer.', lead)).toBe(`x. Showing the answer: ${lead}.`);
  });
  it('says nothing more when there is no lead, or when the sentence does not say the answer is showing', () => {
    expect(sayAnswer(`${SEAL}. Showing the answer.`, null)).toBe(`${SEAL}. Showing the answer.`);
    expect(sayAnswer('Thrown out: no draft passed every check. No answer is shown.', LEAD)).toBe('Thrown out: no draft passed every check. No answer is shown.');
    expect(sayAnswer('Checking the draft.', LEAD)).toBe('Checking the draft.');
  });
  it('is said on the Full view (every part), and not on Step by step\'s "Checking" pane, which keeps its own summary', () => {
    const done = { header: { ...pass }, footer: { text: '', meta: 'real run 0.41 s' }, liveText: `${SEAL}. Showing the answer.` };
    for (const part of ['all', 'answer'] as const) {
      expect(traceLiveText(done, { drafting: null, zen: false, part, lead: LEAD })).toBe(`${SEAL}. Showing the answer: ${LEAD}.`);
    }
    expect(traceLiveText(done, { drafting: null, zen: true, part: 'run', lead: LEAD })).toBe(`${SEAL} · real run 0.41 s`);
    expect(traceLiveText(done, { drafting: null, zen: true, part: 'run', lead: LEAD })).not.toContain('Chef');
    // the answer pane (zen, part answer) has no trace; were it drawn, it would say what the Full view says
    expect(traceLiveText(done, { drafting: null, zen: true, part: 'answer', lead: LEAD })).toBe(`${SEAL}. Showing the answer: ${LEAD}.`);
    // drafting still wins, and a run still going is untouched
    const drafting = { runningText: 'x', footer: { text: '', meta: '' }, liveText: 'Replaying the recorded draft 1. Checking starts when it is done.' };
    expect(traceLiveText(done, { drafting, zen: false, part: 'all', lead: LEAD })).toBe(drafting.liveText);
    const going = { header: { left: 'x', right: '', running: true }, footer: { text: '', meta: '' }, liveText: 'Checking the draft.' } as const;
    expect(traceLiveText(going, { drafting: null, zen: false, part: 'all', lead: LEAD })).toBe('Checking the draft.');
  });
});

describe('RunPanel.tsx: the hand-off is the answer card\'s primary action, not a second block under it', () => {
  const src = readFileSync(new URL('./RunPanel.tsx', import.meta.url), 'utf8');
  it('is handed to the card through its `primaryAction` slot and drawn as the primary button', () => {
    expect(src).toMatch(/\.\.\.\(handoff \? \{ primaryAction: handoff \} : \{\}\)/);
    expect(src).toMatch(/<Button\s+variant="primary"\s+class="fd-btn--wrap"\s+title=\{view\.title\}/);
    expect(src).not.toMatch(/fd-run__handoff['"]/);
  });
  it('keeps the hand-off\'s spoken status (a polite live region) and its accessible title', () => {
    expect(src).toMatch(/<p class="fd-run__handoff-msg" role="status">/);
    expect(src).toContain("aria-disabled={busy ? 'true' : undefined}");
  });
  it('says the live sentence with the answer\'s lead only while the answer is shown', () => {
    expect(src).toContain('lead: a.held ? null : answerLead(a.view)');
  });
});

describe('RunPanel.tsx: what the card shows about the viewer and the demo comes from the session and the pure helpers', () => {
  const src = readFileSync(new URL('./RunPanel.tsx', import.meta.url), 'utf8');
  it('the version line goes through versionNoteFor, which carries the demo-only rule (a copy on your computer gets none) and the answer\'s own function', () => {
    expect(src).toMatch(/versionNoteFor\(st\.mode, st\.revisions, [^;]*, run\.fn\)/);
    // the bare helper has no mode: calling it here would drop the rule
    expect(src).not.toMatch(/[^A-Za-z]versionNote\(/);
    expect(src).not.toMatch(/st\.mode === 'replay'/);
  });
  it('"Confirmed by you" is the session\'s (kept for the life of the run), not state of a component that Step by step unmounts with the pane', () => {
    expect(src).toContain('confirmed={s.confirmed.value}');
    expect(src).toContain('onConfirm={s.confirm}');
    expect(src).not.toMatch(/setConfirmed|useState<\{ key: string; ids/);
  });
});

describe('traceLiveText: with no answer to name, the Full view keeps the trace\'s own sentence, "Showing the answer." included', () => {
  const FULL_SENTENCE = `${SEAL}. Showing the answer.`;
  const BASIC_SENTENCE = 'Passed 2 basic checks. Showing the answer.';
  const done = (liveText: string, verdict = `${SEAL} ↓ see the list`) => ({ header: { ...pass, verdict }, footer: { text: '', meta: 'real run 0.41 s' }, liveText });
  it('on #/start (not Step by step, every part) with no lead given the sentence is the trace\'s, word for word, and it still says the answer is showing', () => {
    for (const part of ['all', 'run', 'answer'] as const) {
      expect(traceLiveText(done(FULL_SENTENCE), { drafting: null, zen: false, part })).toBe('Passed every check · stress test caught 8 of 12. Showing the answer.');
      expect(traceLiveText(done(BASIC_SENTENCE, 'Passed 2 basic checks ↓ see what wasn\'t checked'), { drafting: null, zen: false, part })).toBe('Passed 2 basic checks. Showing the answer.');
    }
  });
  it('only Step by step\'s "Checking" pane (zen, part run) gets the other words: the summary, and never "Showing the answer"', () => {
    const said = traceLiveText(done(FULL_SENTENCE), { drafting: null, zen: true, part: 'run' });
    expect(said).toBe(settledLiveText(done(FULL_SENTENCE)));
    expect(said).not.toBe(FULL_SENTENCE);
    expect(said).not.toMatch(/showing the answer/i);
  });
  it('a run still going is the trace\'s own sentence on both pages', () => {
    const going = { header: { left: 'x', right: '', running: true }, footer: { text: '', meta: '' }, liveText: 'Checking the draft.' } as const;
    expect(traceLiveText(going, { drafting: null, zen: false, part: 'all' })).toBe('Checking the draft.');
    expect(traceLiveText(going, { drafting: null, zen: true, part: 'run' })).toBe('Checking the draft.');
  });
  it('while the AI is writing, the drafting sentence wins on both pages (no check has run yet)', () => {
    const drafting = { runningText: 'drafting…', footer: { text: '', meta: '' }, liveText: 'Replaying the recorded draft 1. Checking starts when it is done.' };
    for (const zen of [false, true]) expect(traceLiveText(done(FULL_SENTENCE), { drafting, zen, part: zen ? 'run' : 'all' })).toBe(drafting.liveText);
  });
});

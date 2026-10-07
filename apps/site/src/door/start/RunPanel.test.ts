import { describe, expect, it } from 'vitest';
import { LIVE_CACHED } from './derive';
import { settledLiveText, traceLiveText } from './RunPanel';

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

describe('traceLiveText: the Full view keeps the trace\'s own sentence, "Showing the answer." included', () => {
  const FULL_SENTENCE = `${SEAL}. Showing the answer.`;
  const BASIC_SENTENCE = 'Passed 2 basic checks. Showing the answer.';
  const done = (liveText: string, verdict = `${SEAL} ↓ see the list`) => ({ header: { ...pass, verdict }, footer: { text: '', meta: 'real run 0.41 s' }, liveText });
  it('on #/start (not Step by step, every part) the sentence is the trace\'s, word for word, and it still says the answer is showing', () => {
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

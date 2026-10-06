import { describe, expect, it } from 'vitest';
import { LIVE_PILL, modeNote, PRIVACY_SHORT, REPLAY_PILL } from './TelemetryBar';

describe('modeNote (the mode pill\'s disclosure)', () => {
  it('replay: says answers are played back, checks run live, and that nothing is sent', () => {
    const n = modeNote(true, true);
    expect(n.how).toBe('This page plays back answers the AI gave earlier. The checks run again in your browser right now.');
    expect(n.privacy).toBe('Your file stays in this browser. This demo sends nothing.');
    // replay never claims the AI sees rows, whatever the switch says
    expect(modeNote(true, false).privacy).toBe(n.privacy);
  });
  it('live: says where the AI runs and exactly what it sees, following the example-rows switch', () => {
    expect(modeNote(false, true).how).toMatch(/runs on your computer/);
    expect(modeNote(false, true).privacy).toBe('Your file stays in this browser. The AI sees column names + 3 example rows.');
    expect(modeNote(false, false).privacy).toBe('Your file stays in this browser. The AI sees column names + types only.');
  });
  it('keeps the honest pill wording', () => {
    expect(REPLAY_PILL).toBe('Demo · recorded answers, real checks');
    expect(LIVE_PILL).toBe('Live · the AI runs on your computer, real checks');
    expect(PRIVACY_SHORT).toBe('Your file stays in this browser');
  });
});

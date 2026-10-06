import { describe, expect, it } from 'vitest';
import type { SuggestedQuestion } from '../model/questions';
import { agreementPhrase, BASIC_LEVEL_LINE, chipsOf, levelLine, levelLineView, needsLiveLegend } from './AskCard';
import { NEXT_VERSION_LIVE, NEXT_VERSION_REPLAY } from '../model/agreement';
import { NO_RECORDING_OWN, noRecordingText } from './derive';

const seeded = { empty: false, seeded: true, n: { examples: 6, locks: 1, rules: 2 } };
const none = { empty: true, seeded: false, n: { examples: 0, locks: 0, rules: 0 } };
const q = (id: string, level: 'full' | 'basic'): SuggestedQuestion => ({ id, label: `L ${id}`, text: `T ${id}`, call: `${id}(rows)`, fn: id, level });

describe('agreementPhrase', () => {
  it('joins the parts that exist', () => {
    expect(agreementPhrase(seeded.n)).toBe('6 examples, 1 locked answer and 2 house rules');
    expect(agreementPhrase({ examples: 0, locks: 1, rules: 0 })).toBe('1 locked answer');
    expect(agreementPhrase({ examples: 1, locks: 0, rules: 1 })).toBe('1 example and 1 house rule');
  });
});

describe('levelLine', () => {
  it("reproduces the design's two lines from the real agreement", () => {
    expect(levelLine({ level: 'full', agreement: seeded, availability: 'recorded', ownData: false, recordedOther: null, mode: 'live' })).toBe(
      'Full checks: this demo file comes with 6 examples, 1 locked answer and 2 house rules for this question.',
    );
    expect(levelLine({ level: 'basic', agreement: none, availability: undefined, ownData: false, recordedOther: null, mode: 'live' })).toBe(BASIC_LEVEL_LINE);
  });
  it('says an agreement the user set is theirs', () => {
    expect(levelLine({ level: 'full', agreement: { empty: false, seeded: false, n: { examples: 0, locks: 1, rules: 0 } }, availability: 'live', ownData: false, recordedOther: null, mode: 'live' })).toBe(
      'Full checks: you set 1 locked answer for this question.',
    );
  });
  it('when nothing is recorded the line is the honest replay sentence (naming the other question) and claims no level', () => {
    const l = levelLine({ level: 'basic', agreement: none, availability: 'none', ownData: false, recordedOther: { label: 'Top 5 customers by revenue' }, mode: 'replay' });
    expect(l).toBe(noRecordingText(false, { label: 'Top 5 customers by revenue' }));
    expect(l.startsWith('In this demo, answers are recorded')).toBe(true);
    expect(l).toContain('“Top 5 customers by revenue” has one');
    expect(l).not.toMatch(/Basic checks|Full checks/);
    expect(levelLine({ level: 'basic', agreement: none, availability: 'none', ownData: true, recordedOther: null, mode: 'replay' })).toBe(NO_RECORDING_OWN);
  });
});

describe('chipsOf', () => {
  it('tags every answerable chip, the selected one too, with the level that will really run; a chip that needs live says only that', () => {
    const chips = chipsOf([q('a', 'basic'), q('b', 'full'), q('c', 'basic')], 'a', { b: 'none', c: 'recorded' });
    expect(chips.map((c) => [c.id, c.pressed, c.tag, c.needsLive])).toEqual([
      ['a', true, 'Basic checks', false],
      ['c', false, 'Basic checks', false],
      ['b', false, null, true],
    ]);
  });
  it('questions this page can answer come first, the ones that need your computer after (each group keeps its order)', () => {
    const qs = [q('status', 'basic'), q('top', 'full'), q('country', 'basic'), q('region', 'basic')];
    expect(chipsOf(qs, 'top', { status: 'none', top: 'recorded', country: 'none', region: 'certified' }).map((c) => c.id)).toEqual(['top', 'region', 'status', 'country']);
    // until what can be answered is known, nothing moves
    expect(chipsOf(qs, 'top', {}).map((c) => c.id)).toEqual(['status', 'top', 'country', 'region']);
    // live mode: everything can be asked, so the order is the list's own
    expect(chipsOf(qs, 'top', { status: 'live', top: 'live', country: 'live', region: 'live' }).map((c) => c.id)).toEqual(['status', 'top', 'country', 'region']);
  });
  it('a question the demo cannot answer, typed or suggested, says "needs live" and nothing about checks; in live mode, and while it is not yet known, the level stays', () => {
    const typed = { ...q('own:whatIsTheWeatherInParis', 'basic'), doc: 'What is the weather in Paris?' };
    expect(chipsOf([typed], null, { [typed.id]: 'none' })[0]).toMatchObject({ tag: null, needsLive: true });
    expect(chipsOf([q('country', 'basic')], null, { country: 'none' })[0]).toMatchObject({ tag: null, needsLive: true });
    expect(chipsOf([q('top', 'full')], null, { top: 'none' })[0]).toMatchObject({ tag: null, needsLive: true });
    // live mode: every question can be asked, and "Basic checks" is true there
    expect(chipsOf([typed], null, { [typed.id]: 'live' })[0]).toMatchObject({ tag: 'Basic checks', needsLive: false });
    expect(chipsOf([q('country', 'basic')], null, { country: 'live' })[0]).toMatchObject({ tag: 'Basic checks', needsLive: false });
    // answerable: recorded, certified, Full checks
    expect(chipsOf([q('top', 'full')], null, { top: 'recorded' })[0]).toMatchObject({ tag: 'Full checks', needsLive: false });
    expect(chipsOf([q('top', 'basic')], null, { top: 'certified' })[0]).toMatchObject({ tag: 'Basic checks', needsLive: false });
    // not known yet: nothing is claimed away
    expect(chipsOf([typed], null, {})[0]).toMatchObject({ tag: 'Basic checks', needsLive: false });
  });
});

describe('needsLiveLegend', () => {
  const chips = (...live: boolean[]) => live.map((needsLive) => ({ needsLive }));
  it('says what "needs live" means, once, only in the demo and only when a chip carries it', () => {
    expect(needsLiveLegend(chips(true, false, true), 'replay')).toBe('needs live: this demo has recorded answers for one question; the others need the version on your computer.');
    expect(needsLiveLegend(chips(false, false, false), 'replay')).toBeNull();
    expect(needsLiveLegend(chips(true, false, true), 'live')).toBeNull();
    expect(needsLiveLegend([], 'replay')).toBeNull();
  });
  it('counts the answers, never types the number in', () => {
    expect(needsLiveLegend(chips(true, false, false, true), 'replay')).toBe('needs live: this demo has recorded answers for 2 questions; the others need the version on your computer.');
    expect(needsLiveLegend(chips(true, true), 'replay')).toBe('needs live: this demo has no recorded answers for these questions; they need the version on your computer.');
  });
});

describe('levelLine for a question the demo cannot answer', () => {
  it('claims no level, typed or suggested: only what the demo can do about it', () => {
    for (const level of ['basic', 'full'] as const) {
      const l = levelLine({ level, agreement: level === 'full' ? seeded : none, availability: 'none', ownData: false, recordedOther: { id: 'top', label: 'Top 5 customers by revenue' }, mode: 'replay' });
      expect(l).toBe(noRecordingText(false, { label: 'Top 5 customers by revenue' }));
      expect(l).not.toMatch(/Basic checks|Full checks/);
    }
    // answerable questions, and live mode, keep their level line
    expect(levelLine({ level: 'basic', agreement: none, availability: 'live', ownData: false, recordedOther: null, mode: 'live' })).toBe(BASIC_LEVEL_LINE);
    expect(levelLine({ level: 'basic', agreement: none, availability: 'recorded', ownData: false, recordedOther: null, mode: 'replay' })).toBe(BASIC_LEVEL_LINE);
  });
  it('says nothing at all once the no-recording card is on screen (quiet)', () => {
    const v = levelLineView({ level: 'basic', agreement: none, availability: 'none', ownData: false, recordedOther: { id: 'top', label: 'x' }, mode: 'replay', quiet: true });
    expect(v).toEqual({ head: '', noRecording: null });
    expect(levelLine({ level: 'basic', agreement: none, availability: 'none', ownData: false, recordedOther: null, mode: 'replay', quiet: true })).toBe('');
  });
  it('the sentence comes in pieces so `try it` can be a button, and the pieces read as the same line', () => {
    const input = { level: 'basic', agreement: none, availability: 'none', ownData: false, recordedOther: { id: 'top', label: 'Top 5 customers by revenue' }, mode: 'replay' } as const;
    const v = levelLineView(input);
    expect(v.head).toBe('');
    expect(v.noRecording?.action).toEqual({ id: 'top', label: 'Top 5 customers by revenue', text: 'try it' });
    expect(levelLine(input)).toBe(noRecordingText(false, { label: 'Top 5 customers by revenue' }));
    expect(levelLineView({ ...input, availability: 'recorded' })).toEqual({ head: BASIC_LEVEL_LINE, noRecording: null });
  });
});

describe('Lock, then Ask again (the answer on file passed only basic checks)', () => {
  const locked = { empty: false, seeded: false, n: { examples: 0, locks: 1, rules: 0 } };
  it('keeps the chip on Basic checks although the agreement now holds a locked answer', () => {
    // session questions: levelFor(certified, artifact checked without the lock) === 'basic'
    expect(chipsOf([q('top', 'basic')], 'top', { top: 'certified' })[0]!.tag).toBe('Basic checks');
  });
  it('says the answer was checked before the lock, not Full checks (live keeps the engine\'s promise)', () => {
    const l = levelLine({ level: 'basic', agreement: locked, availability: 'certified', ownData: false, recordedOther: null, mode: 'live' });
    expect(l).toBe('Basic checks: the answer on file was checked before you set 1 locked answer. The next version runs full checks.');
    expect(l).toBe(`Basic checks: the answer on file was checked before you set 1 locked answer. ${NEXT_VERSION_LIVE}`);
    expect(l).not.toContain('Full checks');
  });
  it('replay cannot re-run with the lock and says so instead of promising full checks', () => {
    const l = levelLine({ level: 'basic', agreement: locked, availability: 'certified', ownData: false, recordedOther: null, mode: 'replay' });
    expect(l).toBe(`Basic checks: the answer on file was checked before you set 1 locked answer. ${NEXT_VERSION_REPLAY}`);
    expect(l).toContain("This demo can't re-run");
    expect(l).toContain('asking again shows that same answer');
    expect(l).not.toContain('runs full checks');
  });
  it('the empty and Full lines do not depend on the mode', () => {
    for (const mode of ['live', 'replay'] as const) {
      expect(levelLine({ level: 'basic', agreement: none, availability: undefined, ownData: false, recordedOther: null, mode })).toBe(BASIC_LEVEL_LINE);
      expect(levelLine({ level: 'full', agreement: seeded, availability: 'recorded', ownData: false, recordedOther: null, mode })).toContain('Full checks: this demo file comes with');
    }
  });
});

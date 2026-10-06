import { describe, expect, it } from 'vitest';
import type { SuggestedQuestion } from '../model/questions';
import { agreementPhrase, BASIC_LEVEL_LINE, chipsOf, levelLine } from './AskCard';
import { NEXT_VERSION_LIVE, NEXT_VERSION_REPLAY } from '../model/agreement';
import { NO_RECORDING_OWN } from './derive';

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
  it('adds the honest replay sentence (and the other question) when nothing is recorded', () => {
    const l = levelLine({ level: 'basic', agreement: none, availability: 'none', ownData: false, recordedOther: { label: 'Top 5 customers by revenue' }, mode: 'replay' });
    expect(l.startsWith(BASIC_LEVEL_LINE + ' In this demo, answers are recorded')).toBe(true);
    expect(l).toContain('“Top 5 customers by revenue” has one');
    expect(levelLine({ level: 'basic', agreement: none, availability: 'none', ownData: true, recordedOther: null, mode: 'replay' })).toBe(`${BASIC_LEVEL_LINE} ${NO_RECORDING_OWN}`);
  });
});

describe('chipsOf', () => {
  it('tags every chip, the selected one too, with the level that will really run; needs live only when known', () => {
    const chips = chipsOf([q('a', 'basic'), q('b', 'full'), q('c', 'basic')], 'a', { b: 'none', c: 'recorded' });
    expect(chips.map((c) => [c.id, c.pressed, c.tag, c.needsLive])).toEqual([
      ['a', true, 'Basic checks', false],
      ['b', false, 'Full checks', true],
      ['c', false, 'Basic checks', false],
    ]);
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

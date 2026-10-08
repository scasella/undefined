import { describe, expect, it } from 'vitest';
import type { SuggestedQuestion } from '../model/questions';
import { readFileSync } from 'node:fs';
import { agreementPhrase, BASIC_LEVEL_LINE, chipsOf, legendUnlessDeadEnd, levelLine, levelLineView, NEEDS_YOUR_COMPUTER, needsLiveLegend, tagsTellApart } from './AskCard';
import { runLocallyView } from '../model/runLocally';
import { OWN_REPLAY_NOTE } from '../zen/ZenPanes';
import { NEXT_VERSION_LIVE, NEXT_VERSION_REPLAY } from '../model/agreement';
import { NO_RECORDING_OWN, noRecordingText, sampleOffer } from './derive';

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
  it('tags every answerable chip, the selected one too, with the level that will really run; a chip that needs your computer says only that', () => {
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
  it('a question the demo cannot answer, typed or suggested, says "needs your computer" and nothing about checks; in live mode, and while it is not yet known, the level stays', () => {
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

describe('the "needs your computer" tag and its legend', () => {
  const chips = (...live: boolean[]) => live.map((needsLive) => ({ needsLive }));
  it('the tag is the phrase the sentences use for the same thing, one constant that both pages draw (the pane has no literal of its own)', () => {
    expect(NEEDS_YOUR_COMPUTER).toBe('needs your computer');
    expect(NEEDS_YOUR_COMPUTER).toMatch(/\byour computer\b/);
    expect(NEEDS_YOUR_COMPUTER).not.toMatch(/\blive\b/i);
    const pane = readFileSync(new URL('../zen/ZenPanes.tsx', import.meta.url), 'utf8');
    const card = readFileSync(new URL('./AskCard.tsx', import.meta.url), 'utf8');
    expect(pane).toContain('{NEEDS_YOUR_COMPUTER}');
    expect(card).toContain('{NEEDS_YOUR_COMPUTER}');
    for (const src of [pane, card]) expect(src).not.toMatch(/>\s*needs live\s*</);
  });
  it('says why some chips carry it, once, only in the demo and only when a chip carries it', () => {
    expect(needsLiveLegend(chips(true, false, true), 'replay')).toBe('This demo has recorded answers for one question; the others need the version on your computer.');
    expect(needsLiveLegend(chips(false, false, false), 'replay')).toBeNull();
    expect(needsLiveLegend(chips(true, false, true), 'live')).toBeNull();
    expect(needsLiveLegend([], 'replay')).toBeNull();
  });
  it('does not begin by repeating the tag, and no word of it is the old "needs live"', () => {
    for (const c of [chips(true, false, true), chips(true, true), chips(true, false, false, true)]) {
      const text = needsLiveLegend(c, 'replay')!;
      expect(text.toLowerCase().startsWith(NEEDS_YOUR_COMPUTER)).toBe(false);
      expect(text).not.toMatch(/needs live/i);
    }
  });
  it('step by step: the legend is not drawn beside the dead-end sentence that says the same (and carries the steps and the link)', () => {
    const own = chips(true, true, true);
    expect(legendUnlessDeadEnd(own, 'replay', false)).toBe(needsLiveLegend(own, 'replay'));
    expect(legendUnlessDeadEnd(own, 'replay', true)).toBeNull();
    expect(legendUnlessDeadEnd(chips(true, false, true), 'replay', true)).toBeNull();
    // and it is still the legend that is drawn when nothing dead-ends (an answerable question is picked), and never in live mode
    expect(legendUnlessDeadEnd(chips(true, false, true), 'replay', false)).toMatch(/^This demo has recorded answers for one question/);
    expect(legendUnlessDeadEnd(chips(true, false, true), 'live', false)).toBeNull();
    // the pane asks with the sentence's presence (whyView), not with a flag of its own
    const pane = readFileSync(new URL('../zen/ZenPanes.tsx', import.meta.url), 'utf8');
    expect(pane).toContain('legendUnlessDeadEnd(chips, mode, whyView !== null)');
  });
  it('counts the answers, never types the number in', () => {
    expect(needsLiveLegend(chips(true, false, false, true), 'replay')).toBe('This demo has recorded answers for 2 questions; the others need the version on your computer.');
    expect(needsLiveLegend(chips(true, true), 'replay')).toBe('This demo has no recorded answers for these questions; they need the version on your computer.');
  });
});

describe('step by step pane 2, a file of your own: "the version on your computer" is said at most twice, and each time for a reason', () => {
  const chips = (...live: boolean[]) => live.map((needsLive) => ({ needsLive }));
  const said = (t: string): number => (t.match(/your computer/gi) ?? []).length;
  /** Every piece of words the pane draws about it, as the pane draws them (ZenPanes.tsx ZenQuestion, Why, RunLocally). */
  const pane = (state: { chips: Array<{ needsLive: boolean }>; deadEnd: boolean; typing: boolean }): string[] => {
    const steps = runLocallyView('replay')!;
    const sentence = state.deadEnd ? noRecordingText(true, null, sampleOffer(null)) : '';
    return [
      // the chip tags (drawn only where they tell chips apart)
      ...state.chips.filter((c) => c.needsLive && tagsTellApart(state.chips)).map(() => NEEDS_YOUR_COMPUTER),
      legendUnlessDeadEnd(state.chips, 'replay', state.deadEnd) ?? '',
      sentence,
      // the disclosure under the sentence, with its heading, the hand-off line and the README link
      ...(state.deadEnd ? [steps.heading, steps.handOff, steps.readmeLabel] : []),
      state.typing ? OWN_REPLAY_NOTE : '',
    ];
  };
  it('a file of your own: every chip needs the computer, so no chip says so; the sentence and the how-to heading say it, and typing adds nothing to it', () => {
    const own = chips(true, true, true);
    for (const typing of [false, true]) {
      const parts = pane({ chips: own, deadEnd: true, typing });
      expect(parts.reduce((n, t) => n + said(t), 0), JSON.stringify(parts)).toBeLessThanOrEqual(2);
    }
    expect(tagsTellApart(own)).toBe(false);
    expect(pane({ chips: own, deadEnd: true, typing: false }).filter((t) => t === NEEDS_YOUR_COMPUTER)).toEqual([]);
    // the two it keeps carry different things: why (and the way out as a button), and where to go to do it
    expect(noRecordingText(true, null, sampleOffer(null))).toMatch(/need the version on your computer\. .* switch to orders\.csv\.$/);
    expect(runLocallyView('replay')!.heading).toBe('How to run it on your computer');
  });
  it('the typed-question note says what happens to the words, not the reason the sentence beside it gives', () => {
    expect(OWN_REPLAY_NOTE).toBe('In this demo, a question you type is added to the list, but it has no recorded answer.');
    expect(OWN_REPLAY_NOTE).not.toMatch(/your computer|version on/);
  });
  it('a file where some chip can be answered keeps the tag on the others: there it tells them apart', () => {
    const mixed = chips(false, true, true);
    expect(tagsTellApart(mixed)).toBe(true);
    expect(pane({ chips: mixed, deadEnd: false, typing: false }).filter((t) => t === NEEDS_YOUR_COMPUTER)).toHaveLength(2);
    // nothing known yet, or live mode (no chip needs the computer): no chip is tagged
    expect(tagsTellApart(chips(false, false))).toBe(true);
    expect(tagsTellApart([])).toBe(false);
  });
  it('the pane draws the tag only through tagsTellApart, and the constant stays the one both pages draw', () => {
    const src = readFileSync(new URL('../zen/ZenPanes.tsx', import.meta.url), 'utf8');
    expect(src).toContain('const tagNeeds = tagsTellApart(chips);');
    expect(src).toContain('{c.needsLive && tagNeeds && <span class="zp__live fd-mono">{NEEDS_YOUR_COMPUTER}</span>}');
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
    expect(v.noRecording?.action).toEqual({ kind: 'question', id: 'top', label: 'Top 5 customers by revenue', text: 'try it' });
    expect(levelLine(input)).toBe(noRecordingText(false, { label: 'Top 5 customers by revenue' }));
    expect(levelLineView({ ...input, availability: 'recorded' })).toEqual({ head: BASIC_LEVEL_LINE, noRecording: null });
  });
});

describe('a file with nothing recorded is not a dead end', () => {
  const base = { level: 'basic', agreement: none, availability: 'none', recordedOther: null, mode: 'replay' } as const;
  it('your own file: the sentence names the recorded sample file and offers to switch to it as a button', () => {
    const offer = sampleOffer(null);
    const v = levelLineView({ ...base, ownData: true, offer });
    expect(v.noRecording?.action).toEqual({ kind: 'sample', sample: 'orders', label: 'Who are our top customers by revenue?', text: 'switch to orders.csv' });
    const text = levelLine({ ...base, ownData: true, offer });
    expect(text).toContain('orders.csv');
    expect(text).toContain('“Who are our top customers by revenue?” has a recorded answer on one sample file: switch to orders.csv.');
    expect(text).not.toContain('Try a sample file');
    // without an offer it is whole and offers nothing it cannot do
    expect(levelLineView({ ...base, ownData: true }).noRecording).toEqual({ before: NO_RECORDING_OWN, action: null, after: '' });
  });
  it('the other sample (sales-q3.csv) is offered the same way; orders.csv itself is not (its other question is)', () => {
    expect(levelLineView({ ...base, ownData: false, offer: sampleOffer('sales') }).noRecording?.action).toMatchObject({ kind: 'sample', text: 'switch to orders.csv' });
    expect(sampleOffer('orders')).toBeNull();
    // a question that has a recording on this very file wins over the offer
    const withOther = levelLineView({ ...base, ownData: false, recordedOther: { id: 'top', label: 'Who are our top customers by revenue?' }, offer: sampleOffer('sales') });
    expect(withOther.noRecording?.action).toMatchObject({ kind: 'question', id: 'top', text: 'try it' });
  });
  it('the card draws it as a real button that binds the sample and returns focus to Ask, busy-guarded', () => {
    const src = readFileSync(new URL('./AskCard.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/a\.kind === 'sample' \? onUse\(a\.sample\) : onTry\(a\.id\)/);
    expect(src).toMatch(/void s\.useSample\(id\)\.then\(\(\) => document\.getElementById\(ASK_BUTTON_ID\)\?\.focus\(\)\)/);
    expect(src).toContain('offer: sampleOffer(s.sampleId.value)');
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

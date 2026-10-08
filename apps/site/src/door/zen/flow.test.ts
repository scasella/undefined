import { describe, expect, it } from 'vitest';
import { NOT_RERUN } from '../model/agreement';
import { OFF_NOTES, stressLabel } from '../model/lanes';
import { isZenHash as routerIsZenHash, parseHash } from '../router';
import {
  afterHistoryBack,
  backPlan,
  canContinue,
  CONTINUE_WHY_ID,
  continueReason,
  forwardLabel,
  hashForStep,
  holdManualScroll,
  isTypedQuestion,
  isZenHash,
  NEEDS_DATA_REASON,
  NEEDS_QUESTION_REASON,
  openingStep,
  paneOf,
  resolveStep,
  stepFromHash,
  ZEN_CONTINUE_ID,
  ZEN_PANES,
  ZEN_SEE_ANSWER_ID,
  zenChecks,
  zenChecksSummary,
  zenHistoryState,
  type ZenSessionView,
  type ZenStep,
} from './flow';

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
  it('panes 4 and 5 are left by their own buttons: nothing moves by itself', () => {
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

describe('forwardLabel: the forward button’s words and look on each pane', () => {
  const modes = [
    { ownData: false, replay: false },
    { ownData: false, replay: true },
    { ownData: true, replay: false },
    { ownData: true, replay: true },
  ];

  it('the demo, your own file bound on the first pane: it says what it opens and is secondary (still a button that goes on)', () => {
    expect(forwardLabel(1, { ownData: true, replay: true })).toEqual({ label: "See what's in your file", variant: 'secondary' });
  });

  it('the first pane is "Continue", primary, in every other case: a sample in the demo, anything on a copy that runs on your computer', () => {
    for (const s of modes.filter((m) => !(m.ownData && m.replay))) expect(forwardLabel(1, s)).toEqual({ label: 'Continue', variant: 'primary' });
    // live mode with the viewer's own file renders exactly as it always did
    expect(forwardLabel(1, { ownData: true, replay: false })).toEqual({ label: 'Continue', variant: 'primary' });
  });

  it('only the first pane changes: the question pane is "Continue", the checks pane "Run the checks", in both modes and for your own file too', () => {
    for (const s of modes) {
      expect(forwardLabel(2, s)).toEqual({ label: 'Continue', variant: 'primary' });
      expect(forwardLabel(3, s)).toEqual({ label: 'Run the checks', variant: 'primary' });
      expect(forwardLabel(4, s)).toEqual({ label: 'See the answer', variant: 'primary' });
      expect(forwardLabel(5, s)).toEqual({ label: 'Ask another question', variant: 'secondary' });
    }
  });

  it('it says nothing of answers or checks on the pane that cannot give one', () => {
    expect(forwardLabel(1, { ownData: true, replay: true }).label).not.toMatch(/answer|check|run/i);
  });
});

describe('continueReason', () => {
  const why = 'In this demo, answers are recorded, …';
  it('gives the words only where Continue is blocked by a question that needs your computer', () => {
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
  it('"See the answer" has its own id: focus goes there when the run settles, never to the heading', () => {
    expect(ZEN_SEE_ANSWER_ID).toBe('zen-see-answer');
    expect(ZEN_SEE_ANSWER_ID).not.toBe(ZEN_CONTINUE_ID);
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
  it('a run still going: the live trace, which stays until the viewer leaves it', () => {
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
  it('the sixth check is named as the trace names it, and speaks of deliberate breaks (never "small breaks on purpose")', () => {
    for (const [a, ctx] of [[agr(0, 0, 0), BASIC], [agr(6, 1, 2, true), FULL], [agr(6, 1, 2, true), { level: 'basic', mode: 'replay' } as const]] as const) {
      const six = zenChecks(a, ctx)[5]!;
      expect(six.label).toBe(stressLabel(null));
      expect(six.label).toBe('Stress test: deliberate breaks');
      expect(`${six.label} ${six.note}`).not.toMatch(/small|on purpose/i);
      expect(six.note).toMatch(/deliberate break|stress test/);
    }
    expect(zenChecks(agr(6, 1, 2, true), FULL)[5]!.note).toBe('It makes deliberate breaks in the calculation; your checks should notice.');
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

const view = (over: Partial<ZenSessionView> = {}): ZenSessionView => ({ bound: true, outcome: 'idle', answerShown: false, ...over });
const ANSWERED = view({ outcome: 'committed', answerShown: true });
const PANES: readonly ZenStep[] = [1, 2, 3, 4, 5];

describe('stepFromHash / hashForStep: the pane is in the URL (#/zen/N)', () => {
  it('reads #/zen/1 … #/zen/5, and writes them back', () => {
    for (const n of PANES) {
      expect(hashForStep(n)).toBe(`#/zen/${n}`);
      expect(stepFromHash(hashForStep(n))).toBe(n);
    }
  });
  it('tolerates a ?query', () => {
    expect(stepFromHash('#/zen/3?x=1')).toBe(3);
    expect(stepFromHash('#/zen/5?')).toBe(5);
  });
  it('reads the pane before an in-page #anchor too (the viewer is still on that pane, not asking for nothing)', () => {
    expect(stepFromHash('#/zen/3#x')).toBe(3);
    expect(stepFromHash('#/zen/3#')).toBe(3);
    expect(stepFromHash('#/zen/1#main')).toBe(1);
    expect(stepFromHash('#/zen/5#a#b')).toBe(5);
    expect(stepFromHash('#/zen/3?x=1#y')).toBe(3);
    expect(stepFromHash('#/zen/4?x#y')).toBe(4);
    // ... and a suffix never rescues a pane that does not exist or is not written as a plain digit
    for (const h of ['#/zen/9#x', '#/zen/0#x', '#/zen/x#3', '#/zen#3', '#/zen?x#3', '#/zen/#3', '#/zen/04#x', '#/zen/3x#y', '#/zen/3/#y']) expect(stepFromHash(h), h).toBeNull();
  });
  it('a bare #/zen, a pane that does not exist and anything else ask for nothing', () => {
    for (const h of ['#/zen', '#/zen/', '#/zen?x=1', '#/zen/0', '#/zen/6', '#/zen/9', '#/zen/x', '#/zen/04', '#/zen/12', '#/zen/-1', '#/zen/3/', '#/zen/3x', '#/zenith/3', '#/start', '#/', '', '#', '#/zen/%33']) {
      expect(stepFromHash(h), h).toBeNull();
    }
  });
  it('knows the walk-through\'s own hashes from another page\'s', () => {
    for (const h of ['#/zen', '#/zen/', '#/zen/3', '#/zen/9', '#/zen?x=1', '#/zen/x', '#/zen/3#x', '#/zen/3?x=1#y']) expect(isZenHash(h), h).toBe(true);
    for (const h of ['#/', '', '#/start', '#/start/zen', '#/zenith', '#/#asks', '#own-file', '#/zen2', '#/zen#x', '#zen', '#/Zen/3']) expect(isZenHash(h), h).toBe(false);
  });
});

describe('"is this a Step by step hash" has ONE definition (router.ts), used by the router and by the page', () => {
  const HASHES = [
    '', '#', '#/', '#/start', '#/start?x=1', '#/start/zen', '#/zen', '#/zen/', '#/zen/1', '#/zen/5', '#/zen/9', '#/zen/04', '#/zen/3x', '#/zen/3/', '#/zen?x=1', '#/zen/3?x=1',
    '#/zen/3#x', '#/zen/3?x=1#y', '#/zen#x', '#/zen?x#3', '#/zenith', '#/zenith/3', '#/zen2', '#/Zen/3', '#zen', '#/#asks', '#own-file', '#main', '#/nope', '#/zen/%33',
  ];
  it('is the router\'s own function, not a second copy that could drift', () => {
    expect(isZenHash).toBe(routerIsZenHash);
  });
  it('agrees with the router on every hash: it is a Step by step hash exactly when the router names the route "zen"', () => {
    for (const h of HASHES) expect(isZenHash(h), h).toBe(parseHash(h) === 'zen');
  });
  it('a pane is only ever read from a hash the router calls Step by step\'s', () => {
    for (const h of HASHES) if (stepFromHash(h) !== null) expect(parseHash(h), h).toBe('zen');
  });
});

describe('resolveStep: the URL asks, the session decides', () => {
  it('pane 1 is always allowed, with or without data', () => {
    expect(resolveStep(1, view({ bound: false }))).toBe(1);
    expect(resolveStep(1, view())).toBe(1);
    expect(resolveStep(1, ANSWERED)).toBe(1);
  });
  it('panes 2 and 3 need data bound; without it the viewer opens where they would (the first pane)', () => {
    for (const n of [2, 3] as const) {
      expect(resolveStep(n, view({ bound: false }))).toBe(1);
      expect(resolveStep(n, view())).toBe(n);
      expect(resolveStep(n, ANSWERED)).toBe(n);
    }
  });
  it('pane 4 needs a run in progress or an answer shown; otherwise the opening pane', () => {
    expect(resolveStep(4, view({ outcome: 'running' }))).toBe(4);
    expect(resolveStep(4, ANSWERED)).toBe(4);
    expect(resolveStep(4, view({ outcome: 'cached', answerShown: true }))).toBe(4);
    expect(resolveStep(4, view())).toBe(2);
    expect(resolveStep(4, view({ bound: false }))).toBe(1);
    // an outcome that is over without an answer is not a reason to show the trace again by URL
    for (const outcome of ['thrown-out', 'stopped', 'declined', 'no-recording', 'service', 'error'] as const) expect(resolveStep(4, view({ outcome }))).toBe(2);
    // an answer that is not shown yet (held for the stress test) is not "shown"
    expect(resolveStep(4, view({ outcome: 'committed', answerShown: false }))).toBe(2);
  });
  it('pane 5 needs an answer shown; a deep link to it with none falls back to the opening pane', () => {
    expect(resolveStep(5, ANSWERED)).toBe(5);
    expect(resolveStep(5, view())).toBe(2);
    expect(resolveStep(5, view({ bound: false }))).toBe(1);
    expect(resolveStep(5, view({ outcome: 'committed', answerShown: false }))).toBe(2);
    expect(resolveStep(5, view({ outcome: 'thrown-out' }))).toBe(2);
    // shown, but no longer the answer of a finished run (nothing bound): never
    expect(resolveStep(5, view({ bound: false, outcome: 'committed', answerShown: true }))).toBe(1);
  });
  it('a run in progress ALWAYS shows pane 4, whatever the URL asked for (the engine cannot cancel it)', () => {
    for (const asked of [...PANES, null]) expect(resolveStep(asked, view({ outcome: 'running' })), String(asked)).toBe(4);
    expect(resolveStep(2, view({ outcome: 'running', answerShown: true }))).toBe(4);
  });
  it('a hash that asks for nothing opens where openingStep says', () => {
    const cases: ZenSessionView[] = [view({ bound: false }), view(), ANSWERED, view({ outcome: 'running' }), view({ outcome: 'thrown-out' })];
    for (const c of cases) expect(resolveStep(null, c)).toBe(c.outcome === 'running' ? 4 : openingStep(c));
    expect(resolveStep(null, view({ bound: false }))).toBe(1);
    expect(resolveStep(null, view())).toBe(2);
    expect(resolveStep(null, ANSWERED)).toBe(5);
  });
  it('is idempotent: what it resolves to resolves to itself (the clamp cannot loop)', () => {
    const states = [view({ bound: false }), view(), ANSWERED, view({ outcome: 'running' }), view({ outcome: 'cached', answerShown: true }), view({ outcome: 'stopped' })];
    for (const st of states) for (const asked of [...PANES, null]) {
      const once = resolveStep(asked, st);
      expect(resolveStep(once, st)).toBe(once);
    }
  });
});

describe('backPlan: the in-app Back button', () => {
  it('steps back through the browser when the previous entry is the previous pane (pushed from it)', () => {
    expect(backPlan(zenHistoryState(3, 2), 3)).toBe('history');
    expect(backPlan(zenHistoryState(4, 3), 4)).toBe('history');
    expect(backPlan(zenHistoryState(2, 1), 2)).toBe('history');
  });
  it('pushes the previous pane when the viewer came from anywhere else (Ask another question, a deep link, a rewritten entry)', () => {
    expect(backPlan(zenHistoryState(2, 5), 2)).toBe('push');
    expect(backPlan(zenHistoryState(1, 5), 1)).toBe('push');
    expect(backPlan(zenHistoryState(3, null), 3)).toBe('push');
    // the entry is for another pane than the one on screen
    expect(backPlan(zenHistoryState(3, 2), 4)).toBe('push');
  });
  it('pushes when history.state is not ours', () => {
    for (const junk of [null, undefined, 3, 'x', {}, { zenStep: 3 }, { zenPrev: 2 }, { zenStep: '3', zenPrev: '2' }, []]) expect(backPlan(junk, 3), JSON.stringify(junk)).toBe('push');
  });
  it('records the pane and where it came from', () => {
    expect(zenHistoryState(4, 3)).toEqual({ zenStep: 4, zenPrev: 3 });
    expect(zenHistoryState(4, null)).toEqual({ zenStep: 4, zenPrev: null });
  });
});

describe('afterHistoryBack: the in-app Back checks where the browser landed', () => {
  it('lands on the pane before: nothing to do', () => {
    expect(afterHistoryBack(4, 3)).toBeNull();
    expect(afterHistoryBack(3, 2)).toBeNull();
    expect(afterHistoryBack(2, 1)).toBeNull();
  });
  it('lands on the same pane (the entry before was rewritten to it by a Back during a run): push the pane before', () => {
    // pane 3 -> Run -> browser Back (held to pane 4, the pane-3 entry rewritten) -> Forward -> in-app Back
    expect(afterHistoryBack(4, 4)).toBe(3);
    expect(afterHistoryBack(3, 3)).toBe(2);
  });
  it('lands on any other pane: still push the pane before, so Back always goes there', () => {
    expect(afterHistoryBack(4, 2)).toBe(3);
    expect(afterHistoryBack(4, 1)).toBe(3);
    expect(afterHistoryBack(3, 5)).toBe(2);
  });
  it('the first pane has nothing before it', () => {
    for (const landed of PANES) expect(afterHistoryBack(1, landed)).toBeNull();
  });
  it('the pane it names is always the one before, and landing there ends it (it cannot ask twice)', () => {
    for (const from of [2, 3, 4, 5] as const) for (const landed of PANES) {
      const next = afterHistoryBack(from, landed);
      if (next !== null) {
        expect(next).toBe(from - 1);
        expect(afterHistoryBack(from, next)).toBeNull();
      }
    }
  });
});

describe('the panes in the URL are the panes on the progress bar', () => {
  it('five of them, 1 to 5, each with a title', () => {
    expect(ZEN_PANES.map((p) => p.step)).toEqual(PANES);
    expect(paneOf(4).title).toBe('Checking');
    expect(paneOf(5).title).toBe('Your answer');
  });
});

describe('holdManualScroll: while the walk-through is on screen the page owns the scroll', () => {
  it('sets "manual" and gives the browser\'s own back ("auto") when it goes, so the landing and the Full view keep it', () => {
    const h = { scrollRestoration: 'auto' };
    const undo = holdManualScroll(h);
    expect(h.scrollRestoration).toBe('manual');
    undo();
    expect(h.scrollRestoration).toBe('auto');
  });
  it('always gives back "auto", never what it found: an entry pushed from a walk-through entry INHERITS "manual", so a later mount finds it (the leak)', () => {
    // history.pushState (and a fragment navigation) copy the current entry's mode to the new one: a visitor who goes
    // Step by step -> Full view -> Back finds "manual" on a page nothing has ever set it on
    const h = { scrollRestoration: 'manual' };
    holdManualScroll(h)();
    expect(h.scrollRestoration).toBe('auto');
  });
  it('cannot ratchet: however many times the walk-through is mounted, found "manual" or not, the page after it gets "auto"', () => {
    const h = { scrollRestoration: 'auto' };
    for (let visit = 0; visit < 4; visit++) {
      const undo = holdManualScroll(h);
      expect(h.scrollRestoration, `visit ${visit}: held`).toBe('manual');
      undo();
      expect(h.scrollRestoration, `visit ${visit}: given back`).toBe('auto');
      h.scrollRestoration = 'manual'; // the entry the next visit lands on inherited the walk-through's mode
    }
  });
  it('gives back "auto" for any value it found (the browser\'s default is the only thing this site ever restores)', () => {
    for (const found of ['auto', 'manual', 'something-new']) {
      const h = { scrollRestoration: found };
      holdManualScroll(h)();
      expect(h.scrollRestoration, found).toBe('auto');
    }
  });
  it('the undo is spent after one call (a late second call cannot overwrite what the next page set)', () => {
    const h = { scrollRestoration: 'auto' };
    const undo = holdManualScroll(h);
    undo();
    h.scrollRestoration = 'manual'; // the next page took it
    undo();
    expect(h.scrollRestoration).toBe('manual');
  });
  it('is quiet when there is nothing to hold: no history, no scrollRestoration, one that is not a string', () => {
    for (const host of [null, undefined, {}, { scrollRestoration: undefined }, { scrollRestoration: 3 as unknown as string }]) {
      expect(() => holdManualScroll(host)()).not.toThrow();
    }
    const h = {} as { scrollRestoration?: string };
    holdManualScroll(h)();
    expect('scrollRestoration' in h).toBe(false);
  });
  it('is quiet when the browser refuses (a sandboxed frame throws on the setter, on the way in or on the way out)', () => {
    let calls = 0;
    const sandbox = {
      get scrollRestoration(): string {
        return 'auto';
      },
      set scrollRestoration(_v: string) {
        calls++;
        throw new Error('SecurityError');
      },
    };
    expect(() => holdManualScroll(sandbox)()).not.toThrow();
    expect(calls).toBe(1); // the setter was tried once on the way in and the failed hold gave nothing to undo
    let first = true;
    const flaky = {
      v: 'auto',
      get scrollRestoration(): string {
        return this.v;
      },
      set scrollRestoration(x: string) {
        if (!first) throw new Error('SecurityError');
        first = false;
        this.v = x;
      },
    };
    const undo = holdManualScroll(flaky);
    expect(flaky.v).toBe('manual');
    expect(() => undo()).not.toThrow();
  });
});

/**
 * Step by step's flow, as pure data: the five panes, where the URL may put the viewer (`#/zen/N`), when each pane may be
 * left, and the "Answer these" checklist (the six checks of the trace, in the design's words, each marked as applying or
 * not for the question about to be asked). No DOM, no engine calls: the pane components feed it what the session reports.
 *
 * The checklist reads what is SET (the agreement) against what will REALLY run (the level: recorded.ts levelFor), so it
 * never says "Applies" for a check the next ask will not re-run (a lock set after the answer on file was checked).
 * The words for a check with nothing to run are the trace's own (model/lanes.ts OFF_NOTES): one wording per state.
 */
import { agreementPhrase, isHeldBack, NOT_RERUN, type AgreementView, type CheckMode } from '../model/agreement';
import { OFF_NOTES } from '../model/lanes';
import { isTypedQuestion } from '../model/questions';
import { isZenHash } from '../router';
import type { RunOutcome } from '../start/derive';

/** A question the viewer typed (session.addQuestion ids start `own:`): the only ones that can be removed. */
export { isTypedQuestion };

export type ZenStep = 1 | 2 | 3 | 4 | 5;

export interface ZenPane {
  step: ZenStep;
  /** Short label in the progress bar. */
  label: string;
  /** The pane's heading. */
  title: string;
}

export const ZEN_PANES: readonly ZenPane[] = [
  { step: 1, label: 'Data', title: 'Bring your data' },
  { step: 2, label: 'Question', title: 'Ask a question' },
  { step: 3, label: 'Checks', title: 'What your answer must pass' },
  { step: 4, label: 'Run', title: 'Checking' },
  { step: 5, label: 'Result', title: 'Your answer' },
];

export const paneOf = (step: ZenStep): ZenPane => ZEN_PANES[step - 1]!;

/**
 * Can the viewer move forward from `step`? (Panes 4 and 5 are left by their own buttons: nothing moves by itself.) A question that
 * needs the version on the viewer's computer (`needsLive`: replay, nothing recorded for it) cannot leave the question
 * or checks panes: it would only end in "No recorded answer for this one" three panes later.
 */
export function canContinue(step: ZenStep, s: { bound: boolean; question: boolean; busy: boolean; needsLive?: boolean }): boolean {
  if (s.busy) return false;
  if (step === 1) return s.bound;
  if (step === 2 || step === 3) return s.bound && s.question && !s.needsLive;
  return false;
}

/** The walk-through's forward button: its words and its look. The id stays ZEN_CONTINUE_ID (below) on panes 1 to 3. */
export interface ForwardButton {
  label: string;
  /** The two looks this button takes (a subset of the shared Button's variants; this module stays free of component imports). */
  variant: 'primary' | 'secondary';
}

/**
 * The forward button's words on each pane. Panes 1 and 2 say "Continue" and pane 3 "Run the checks", all primary; pane 4's
 * button (once the run has settled) is "See the answer" and pane 5 offers "Ask another question". One exception, in the
 * demo: the viewer's OWN file is bound on pane 1. The next pane shows its columns and the questions worked out for it, but
 * the demo cannot answer a question about it, so the button must not look like the way to an answer: it says what it opens
 * ("See what's in your file") and is secondary, and the sample files above it stay the way to see a full run. It is still
 * enabled. On a copy that runs on your computer (`replay` false), and for a sample, nothing differs.
 */
export function forwardLabel(step: ZenStep, s: { ownData: boolean; replay: boolean }): ForwardButton {
  if (step === 1 && s.ownData && s.replay) return { label: "See what's in your file", variant: 'secondary' };
  if (step === 3) return { label: 'Run the checks', variant: 'primary' };
  if (step === 4) return { label: 'See the answer', variant: 'primary' };
  if (step === 5) return { label: 'Ask another question', variant: 'secondary' };
  return { label: 'Continue', variant: 'primary' };
}

/** The element that says why Continue / Run is off (it sits under the selected question; the buttons point at it). */
export const CONTINUE_WHY_ID = 'zen-why';

/** The Continue button (steps 1 and 2): focus goes here when what the viewer was pressing goes away (the picker closes once data is bound). */
export const ZEN_CONTINUE_ID = 'zen-continue';

/** The "See the answer" button on the finished "Checking" pane: focus goes here when the run settles (not to the heading). */
export const ZEN_SEE_ANSWER_ID = 'zen-see-answer';

/** Why Continue is off on the first pane, said next to it. */
export const NEEDS_DATA_REASON = 'Choose a sample or bring a file to continue.';
/** Why Continue is off on the second pane when nothing is picked. */
export const NEEDS_QUESTION_REASON = 'Pick a question to continue.';

/**
 * The words for why Continue is off, shown next to it (and read by assistive tech through aria-describedby), or '' when
 * there is nothing the viewer can act on. `text` is the same sentence the no-recording state gives (derive.ts
 * noRecordingText). `bound` (default: there is data) says whether the first pane has what it needs. A busy engine is
 * not a reason: it says what it is doing on its own.
 */
export function continueReason(step: ZenStep, s: { question: boolean; needsLive: boolean; bound?: boolean }, text: string): string {
  if (step === 1) return s.bound === false ? NEEDS_DATA_REASON : '';
  if (step === 2 && s.bound !== false && !s.question) return NEEDS_QUESTION_REASON;
  return (step === 2 || step === 3) && s.question && s.needsLive ? text : '';
}

/** What the session says, as far as the walk-through's route cares (the engine's own words, no DOM). */
export interface ZenSessionView {
  bound: boolean;
  outcome: RunOutcome['kind'];
  answerShown: boolean;
}

/** A committed (or already certified) answer is on screen: panes 4 and 5 can be shown. Never without data. */
const answerIsShown = (s: ZenSessionView): boolean => s.bound && (s.outcome === 'committed' || s.outcome === 'cached') && s.answerShown;

/**
 * The pane Step by step opens at. The shared session carries the file, the question and the run from the other page
 * (start/session.ts), so a visitor who comes back is put where they were: the answer if one is shown, the live trace if a
 * run is still going, otherwise the question when there is data, and the first pane only when there is none.
 */
export function openingStep(s: ZenSessionView): ZenStep {
  if (!s.bound) return 1;
  if (answerIsShown(s)) return 5;
  if (s.outcome === 'running') return 4;
  return 2;
}

// ───────────────────────── the pane is in the URL ─────────────────────────

/**
 * Is this hash the walk-through's own (`#/zen`, `#/zen/3`, `#/zen?x`)? Anything else is another page: leave the URL alone. The
 * router's own definition, not a second one: it is what names the route (router.ts parseHash), so the page and the router
 * cannot disagree about which hashes are Step by step's.
 */
export { isZenHash };

/**
 * `#/zen/3` → 3. The pane is read before any `?query` or in-page `#anchor` ('#/zen/3?x=1', '#/zen/3#x': the viewer is still on
 * pane 3, the suffix is not a request for another); a bare `#/zen`, `#/zen/9`, `#/zen/3x`, `#/zen/3/` and every other hash → null.
 * Only ever a pane of a hash that isZenHash accepts (a narrower reading of the same prefix, not another definition of it).
 */
export function stepFromHash(hash: string): ZenStep | null {
  const m = /^#\/zen\/([1-5])(?:[?#].*)?$/.exec(hash);
  return m ? (Number(m[1]) as ZenStep) : null;
}

/** The hash that names a pane. */
export const hashForStep = (step: ZenStep): string => `#/zen/${step}`;

/**
 * The pane the URL asks for is only a REQUEST. This is the pane the session allows: 1 always; 2 and 3 once data is bound;
 * 4 while a run is going or an answer is shown; 5 once an answer is shown; anything else (and a hash that asks for
 * nothing: `null`) falls back to where the viewer would open (openingStep). A run in progress ALWAYS shows pane 4: the
 * engine cannot cancel it, so there is nowhere else to go until it ends. Pure; the caller rewrites the URL when this
 * differs from what was asked.
 */
export function resolveStep(requested: ZenStep | null, s: ZenSessionView): ZenStep {
  if (s.outcome === 'running') return 4;
  switch (requested) {
    case 1:
      return 1;
    case 2:
    case 3:
      return s.bound ? requested : openingStep(s);
    case 4:
    case 5:
      return answerIsShown(s) ? requested : openingStep(s);
    default:
      return openingStep(s);
  }
}

/**
 * What the walk-through writes into `history.state` when it pushes a pane: the pane, and the pane the viewer came from.
 * It lets the in-app Back button tell whether the browser's previous entry really is the previous pane.
 */
export interface ZenHistoryState {
  zenStep: ZenStep;
  zenPrev: ZenStep | null;
}

export const zenHistoryState = (step: ZenStep, prev: ZenStep | null): ZenHistoryState => ({ zenStep: step, zenPrev: prev });

/**
 * The in-app "Back" button on pane `step` (2 to 4; the first pane has nothing before it). 'history': the browser's
 * previous entry IS the previous pane, so step back through it (Forward then returns here). 'push': it is not (the pane was
 * reached from further away, the entry was rewritten, or the state is not ours): push the previous pane, so Back always
 * lands on it. This reads only the entry the viewer is on; an entry before it that was rewritten later is caught by
 * afterHistoryBack, once the browser has landed.
 */
export function backPlan(historyState: unknown, step: ZenStep): 'history' | 'push' {
  const h = historyState as Partial<ZenHistoryState> | null | undefined;
  return !!h && typeof h === 'object' && h.zenStep === step && h.zenPrev === step - 1 ? 'history' : 'push';
}

/**
 * The in-app "Back" went through the browser (backPlan said 'history') and the entry it landed on shows pane `landed`.
 * backPlan only reads the entry the viewer was on, and the entry before it may since have been rewritten: a browser Back
 * during a run is held to pane 4 with replaceState, so the entry that said "pane 3" now says "pane 4" while the entry after
 * it still remembers pane 3 as its previous pane (and a pushState entry cannot be told about it afterwards). So the page
 * checks where the browser really landed: when that is not the pane before `from`, this is the pane to push so that Back
 * always lands on it. null when the browser did it right. Pure; the caller pushes.
 */
export function afterHistoryBack(from: ZenStep, landed: ZenStep): ZenStep | null {
  return from > 1 && landed !== from - 1 ? ((from - 1) as ZenStep) : null;
}

/**
 * The part of `history` that says who puts the scroll back when the browser steps through its entries. Passed in, so this
 * stays free of the DOM: the page hands over the real `history`, a test hands over an object.
 */
export interface ScrollRestorationHost {
  scrollRestoration?: string;
}

/**
 * While the walk-through is on screen the page, not the browser, owns the scroll: every pane starts at the top (Zen.tsx scrolls
 * there when the pane changes), and the browser puts an entry's old offset back AFTER that, leaving the next pane 2 to 4 px
 * down on Back and Forward. Sets 'manual' and returns what undoes it: 'auto', the browser's default, which is what the landing
 * and the Full view run with.
 *
 * It gives back 'auto', NEVER the value it found. `scrollRestoration` belongs to a history ENTRY, and an entry made by
 * pushState or a fragment navigation copies the current entry's mode, so every entry made from a walk-through pane is born
 * 'manual'. A later mount (Back from the Full view onto a pane) therefore finds 'manual' on a page that never set it, and "put
 * back what was found" would hand 'manual' on to the landing and the Full view for good. This site sets the value nowhere else,
 * so the only thing there is to restore is the default.
 *
 * Forgiving by design: no `history`, no `scrollRestoration` (not a string), a setter that throws (a sandbox) and a second call
 * to the undo are all quiet.
 */
export function holdManualScroll(host: ScrollRestorationHost | null | undefined): () => void {
  const none = (): void => {};
  try {
    if (!host || typeof host.scrollRestoration !== 'string') return none;
    host.scrollRestoration = 'manual';
    let undone = false;
    return (): void => {
      if (undone) return;
      undone = true;
      try {
        host.scrollRestoration = 'auto';
      } catch {
        /* nothing to put back in a sandbox that refuses */
      }
    };
  } catch {
    return none;
  }
}

/** 'always' and 'applies' will run; the rest will not (or not now). */
export type ApplyState = 'always' | 'applies' | 'none' | 'after' | 'held';

export interface ZenCheck {
  num: string;
  label: string;
  state: ApplyState;
  /** The right-hand tag. */
  tag: string;
  /** One quiet line saying where it comes from or what to do about it. */
  note: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What will really run, besides the agreement: the check level (levelFor) and the mode (what a lock can promise). */
export interface ZenContext {
  level: 'full' | 'basic';
  mode: CheckMode;
}

/** The six checks for a question: the agreement it will be held to (session.agreement), and what will really run. */
export function zenChecks(a: Pick<AgreementView, 'n' | 'seeded'>, ctx: ZenContext): ZenCheck[] {
  const { examples, locks, rules } = a.n;
  const any = examples + locks + rules > 0;
  const held = isHeldBack(ctx.level, { empty: !any });
  const who = a.seeded ? 'this demo file brings' : 'you set';
  // set, but the answer on file was checked before it: asking again shows that answer and runs none of it
  const late = (): string =>
    'Added after the answer on file was checked. ' + (ctx.mode === 'replay' ? "This demo can't re-run, so it isn't checked here." : 'It applies to the next version.');
  return [
    { num: '01', label: 'Runs without errors', state: 'always', tag: 'Always', note: 'Every answer is compiled and run first.' },
    examples > 0
      ? held
        ? { num: '02', label: `Matches your ${plural(examples, 'example', 'examples')}`, state: 'held', tag: NOT_RERUN, note: late() }
        : { num: '02', label: `Matches your ${plural(examples, 'example', 'examples')}`, state: 'applies', tag: 'Applies', note: `Questions with known answers: ${who} ${examples}.` }
      : { num: '02', label: 'Matches your examples', state: 'none', tag: OFF_NOTES.examples, note: 'No examples for this question, so nothing to match.' },
    locks > 0
      ? held
        ? { num: '03', label: `Matches your ${plural(locks, 'locked answer', 'locked answers')}`, state: 'held', tag: NOT_RERUN, note: late() }
        : { num: '03', label: `Matches your ${plural(locks, 'locked answer', 'locked answers')}`, state: 'applies', tag: 'Applies', note: `Answers you trust: ${who} ${locks}.` }
      : { num: '03', label: 'Matches your locked answers', state: 'after', tag: OFF_NOTES.locks, note: 'Lock an answer you trust on the result; every later version must match it.' },
    rules > 0
      ? held
        ? { num: '04', label: `Follows your ${plural(rules, 'house rule', 'house rules')} on made-up tables`, state: 'held', tag: NOT_RERUN, note: late() }
        : { num: '04', label: `Follows your ${plural(rules, 'house rule', 'house rules')} on made-up tables`, state: 'applies', tag: 'Applies', note: `Tried on 100 made-up tables: ${who} ${rules}.` }
      : { num: '04', label: 'Follows your house rules on made-up tables', state: 'none', tag: OFF_NOTES.rules, note: 'No house rules for this question yet.' },
    { num: '05', label: 'Never changes your data · finishes fast', state: 'always', tag: 'Always', note: 'Your table is never edited, and the calculation has a time limit.' },
    held
      ? { num: '06', label: 'Stress test: small breaks on purpose', state: 'held', tag: NOT_RERUN, note: 'Nothing was set when the answer on file was checked, so no stress test ran on it.' }
      : any
        ? { num: '06', label: 'Stress test: small breaks on purpose', state: 'applies', tag: 'Applies', note: 'The calculation is broken in small ways; your checks should notice.' }
        : { num: '06', label: 'Stress test: small breaks on purpose', state: 'none', tag: OFF_NOTES.stress, note: 'It has nothing to catch the breaks with until you have examples or rules.' },
  ];
}

/**
 * One sentence under the list: what the viewer is getting. `set` is the agreement's counts: with basic checks and
 * something set, it says that what they set is not re-run. Full checks: the answer is shown once all six have run (the
 * seal and the ledger arrive together after the stress test, start/derive.ts outcomeOf); the stress test reports how
 * many of its deliberate breaks the checks caught, it does not pass or fail the answer.
 */
export function zenChecksSummary(level: 'full' | 'basic', set?: AgreementView['n']): string {
  if (level === 'full') return 'Full checks: all six apply. The answer appears after all six have run: the first five must pass, and the stress test reports how many of its deliberate breaks your checks caught.';
  const phrase = set ? agreementPhrase(set) : '';
  return phrase
    ? `Basic checks: the two that always run. Your agreement (${phrase}) isn't re-run: the answer on file was checked before it was added.`
    : 'Basic checks: the two that always run. The answer says plainly that it was checked this lightly.';
}

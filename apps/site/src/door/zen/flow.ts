/**
 * Zen mode's flow, as pure data: the five panes, when each may be left, and the "Answer these" checklist (the six
 * checks of the trace, in the design's words, each marked as applying or not for the question about to be asked).
 * No DOM, no engine calls: the pane components feed it what the session reports.
 *
 * The checklist reads what is SET (the agreement) against what will REALLY run (the level: recorded.ts levelFor), so it
 * never says "Applies" for a check the next ask will not re-run (a lock set after the answer on file was checked).
 * The words for a check with nothing to run are the trace's own (model/lanes.ts OFF_NOTES): one wording per state.
 */
import { agreementPhrase, isHeldBack, NOT_RERUN, type AgreementView, type CheckMode } from '../model/agreement';
import { OFF_NOTES } from '../model/lanes';

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
 * Can the viewer move forward from `step`? (Panes 4 and 5 move on their own / by their own buttons.) A question that
 * needs the version on the viewer's computer (`needsLive`: replay, nothing recorded for it) cannot leave the question
 * or checks panes: it would only end in "No recorded answer for this one" three panes later.
 */
export function canContinue(step: ZenStep, s: { bound: boolean; question: boolean; busy: boolean; needsLive?: boolean }): boolean {
  if (s.busy) return false;
  if (step === 1) return s.bound;
  if (step === 2 || step === 3) return s.bound && s.question && !s.needsLive;
  return false;
}

/** The element that says why Continue / Run is off (it sits under the selected question; the buttons point at it). */
export const CONTINUE_WHY_ID = 'zen-why';

/**
 * The words for why Continue is off, shown next to it (and read by assistive tech through aria-describedby), or '' when
 * there is nothing the viewer can act on. `text` is the same sentence the no-recording state gives (derive.ts noRecordingText).
 */
export function continueReason(step: ZenStep, s: { question: boolean; needsLive: boolean }, text: string): string {
  return (step === 2 || step === 3) && s.question && s.needsLive ? text : '';
}

/** A question the viewer typed (session.addQuestion ids start `own:`): the only ones that can be removed. */
export const isTypedQuestion = (id: string): boolean => id.startsWith('own:');

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
 * something set, it says that what they set is not re-run.
 */
export function zenChecksSummary(level: 'full' | 'basic', set?: AgreementView['n']): string {
  if (level === 'full') return 'Full checks: all six apply. The answer is shown only if every one passes.';
  const phrase = set ? agreementPhrase(set) : '';
  return phrase
    ? `Basic checks: the two that always run. Your agreement (${phrase}) isn't re-run: the answer on file was checked before it was added.`
    : 'Basic checks: the two that always run. The answer says plainly that it was checked this lightly.';
}

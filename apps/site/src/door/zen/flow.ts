/**
 * Zen mode's flow, as pure data: the five panes, when each may be left, and the "Answer these" checklist (the six
 * checks of the trace, in the design's words, each marked as applying or not for the question about to be asked).
 * No DOM, no engine calls: the pane components feed it what the session reports.
 */
import type { AgreementView } from '../model/agreement';

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

/** Can the viewer move forward from `step`? (Panes 4 and 5 move on their own / by their own buttons.) */
export function canContinue(step: ZenStep, s: { bound: boolean; question: boolean; busy: boolean }): boolean {
  if (s.busy) return false;
  if (step === 1) return s.bound;
  if (step === 2) return s.bound && s.question;
  return step === 3 ? s.bound && s.question : false;
}

export type ApplyState = 'always' | 'applies' | 'none' | 'after';

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

/** The six checks for a question, from the agreement it will be held to (session.agreement). */
export function zenChecks(a: Pick<AgreementView, 'n' | 'seeded'>): ZenCheck[] {
  const { examples, locks, rules } = a.n;
  const any = examples + locks + rules > 0;
  const who = a.seeded ? 'this demo file brings' : 'you set';
  return [
    { num: '01', label: 'Runs without errors', state: 'always', tag: 'Always', note: 'Every answer is compiled and run first.' },
    examples > 0
      ? { num: '02', label: `Matches your ${plural(examples, 'example', 'examples')}`, state: 'applies', tag: 'Applies', note: `Questions with known answers: ${who} ${examples}.` }
      : { num: '02', label: 'Matches your examples', state: 'none', tag: 'None yet', note: 'No examples for this question, so nothing to match.' },
    locks > 0
      ? { num: '03', label: `Matches your ${plural(locks, 'locked answer', 'locked answers')}`, state: 'applies', tag: 'Applies', note: `Answers you trust: ${who} ${locks}.` }
      : { num: '03', label: 'Matches your locked answers', state: 'after', tag: 'After the answer', note: 'Lock an answer you trust on the result; every later version must match it.' },
    rules > 0
      ? { num: '04', label: `Follows your ${plural(rules, 'house rule', 'house rules')} on made-up tables`, state: 'applies', tag: 'Applies', note: `Tried on 100 made-up tables: ${who} ${rules}.` }
      : { num: '04', label: 'Follows your house rules on made-up tables', state: 'none', tag: 'None yet', note: 'No house rules for this question yet.' },
    { num: '05', label: 'Never changes your data · finishes fast', state: 'always', tag: 'Always', note: 'Your table is never edited, and the calculation has a time limit.' },
    any
      ? { num: '06', label: 'Stress test: small breaks on purpose', state: 'applies', tag: 'Applies', note: 'The calculation is broken in small ways; your checks should notice.' }
      : { num: '06', label: 'Stress test: small breaks on purpose', state: 'none', tag: 'Needs checks', note: 'It has nothing to catch the breaks with until you have examples or rules.' },
  ];
}

/** One sentence under the list: what the viewer is getting. */
export function zenChecksSummary(level: 'full' | 'basic'): string {
  return level === 'full'
    ? 'Full checks: all six apply. The answer is shown only if every one passes.'
    : 'Basic checks: the two that always run. The answer says plainly that it was checked this lightly.';
}

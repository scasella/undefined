/**
 * First run · "Ask a question" (V3-Door-FirstRun 188-206). The suggested questions (worked out from the columns, no
 * model), the selected question read back in a readonly field, the Ask button and the check-level line under it.
 * Everything comes from the session (start/session.ts): questions, availability, the agreement that will be checked.
 *
 * Focus: the Ask button and the chips use aria-disabled (not `disabled`) while the session is busy, so a click never
 * drops focus to <body>; focus stays on the button after asking and the check trace's aria-live says what happened.
 * A non-happy outcome (RunStates) moves focus to its own heading.
 */
import type { Engine } from '@scasella/undefined-engine/types';
import type { AgreementView } from '../model/agreement';
import type { SuggestedQuestion } from '../model/questions';
import { Arrow } from '../icons';
import { noRecordingText } from './derive';
import type { Availability } from './recorded';
import { sessionFor, type Session } from './session';
import './AskCard.css';

/** The Ask button's id (RunStates focuses it after "Try …" selects another question). */
export const ASK_BUTTON_ID = 'fd-ask-btn';
export const ASK_BOX_ID = 'ask-box';

export const BASIC_LEVEL_LINE = "Basic checks only: no examples, locked answers or house rules for this question yet. We'll say so on the answer.";
export const NEEDS_LIVE = 'needs live';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** `6 examples, 1 locked answer and 2 house rules` (only the parts that exist). */
export function agreementPhrase(n: AgreementView['n']): string {
  const parts: string[] = [];
  if (n.examples > 0) parts.push(plural(n.examples, 'example', 'examples'));
  if (n.locks > 0) parts.push(plural(n.locks, 'locked answer', 'locked answers'));
  if (n.rules > 0) parts.push(plural(n.rules, 'house rule', 'house rules'));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The line under the Ask button. The check level is the one that will REALLY check the answer (session questions,
 * recorded.ts levelFor): a function certified before a lock or rule was added still answers from that basic-checked
 * version, so an agreement alone does not make it Full checks. Then, when this page cannot answer the question
 * (replay, nothing recorded), the same honest sentence the no-recording outcome will show.
 */
export function levelLine(input: {
  level: 'full' | 'basic';
  agreement: Pick<AgreementView, 'empty' | 'seeded' | 'n'>;
  availability: Availability | undefined;
  ownData: boolean;
  recordedOther: Pick<SuggestedQuestion, 'label'> | null;
}): string {
  const a = input.agreement;
  let line: string;
  if (input.level === 'basic') {
    line = a.empty
      ? BASIC_LEVEL_LINE
      : `Basic checks: the answer on file was checked before ${a.seeded ? 'this demo file came with' : 'you set'} ${agreementPhrase(a.n)}. The next version runs full checks.`;
  } else if (a.seeded) line = `Full checks: this demo file comes with ${agreementPhrase(a.n)} for this question.`;
  else line = `Full checks: you set ${agreementPhrase(a.n)} for this question.`;
  if (input.availability === 'none') line += ' ' + noRecordingText(input.ownData, input.recordedOther);
  return line;
}

export interface ChipView {
  id: string;
  label: string;
  pressed: boolean;
  tag: 'Full checks' | 'Basic checks';
  /** Replay: nothing recorded for it (availability 'none'). Unknown availability is not 'none'. */
  needsLive: boolean;
}

/** The chips: every tag (the selected one too) is the level that will really run (session questions, levelFor). */
export function chipsOf(questions: readonly SuggestedQuestion[], selected: string | null, availability: Record<string, Availability>): ChipView[] {
  return questions.map((q) => {
    const pressed = q.id === selected;
    return { id: q.id, label: q.label, pressed, tag: q.level === 'full' ? 'Full checks' : 'Basic checks', needsLive: availability[q.id] === 'none' };
  });
}

export function AskCard({ engine, session }: { engine: Engine; session?: Session }) {
  const s = session ?? sessionFor(engine);
  const q = s.question.value;
  const agreement = s.agreement.value;
  const avail = s.availability.value;
  const busy = s.busy.value;
  const canChange = s.canChange.value;
  const canAsk = s.canAsk.value;
  const chips = chipsOf(s.questions.value, s.questionId.value, avail);
  // once the no-recording card below says it, the level line does not repeat it
  const said = s.outcome.value.kind === 'no-recording';
  const line = q
    ? levelLine({ level: q.level, agreement, availability: said ? undefined : avail[q.id], ownData: s.source.value === 'own', recordedOther: s.recordedOther.value })
    : '';

  const pick = (id: string) => {
    if (!canChange) return;
    void s.selectQuestion(id);
  };
  const ask = () => {
    if (!canAsk) return;
    void s.ask();
  };

  return (
    <div class="fd-ask" aria-busy={busy}>
      <div class="fd-ask__head">
        <h2 class="fd-ask__h">Ask a question</h2>
        <span class="fd-ask__note">Suggestions are worked out from your columns. No AI.</span>
      </div>
      <div role="group" aria-label="Suggested questions" class="fd-ask__chips">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            class={`fd-ask__chip${c.pressed ? ' is-on' : ''}`}
            aria-pressed={c.pressed}
            aria-disabled={!canChange || undefined}
            onClick={() => pick(c.id)}
          >
            {c.label}
            <span class="fd-ask__tag">{c.tag}</span>
            {c.needsLive && <span class="fd-ask__live">{NEEDS_LIVE}</span>}
          </button>
        ))}
      </div>
      <div class="fd-ask__row">
        <label for={ASK_BOX_ID} class="fd-sr">
          Your question
        </label>
        <input id={ASK_BOX_ID} class="fd-ask__box" type="text" readOnly value={q?.text ?? ''} />
        <button id={ASK_BUTTON_ID} type="button" class="fd-btn fd-btn--primary fd-ask__go" aria-disabled={!canAsk || undefined} onClick={ask}>
          {s.askLabel.value}
          <Arrow />
        </button>
      </div>
      {line && <p class="fd-ask__level">{line}</p>}
    </div>
  );
}

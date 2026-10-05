/** Zen mode · the panes that are not already a shared component: the question (2) and "what your answer must pass" (3). */
import type { Engine } from '@scasella/undefined-engine/types';
import { CheckDisc, NotChecked } from '../icons';
import { chipsOf, levelLine } from '../start/AskCard';
import { sessionFor } from '../start/session';
import { zenChecks, zenChecksSummary, type ZenCheck } from './flow';
import './ZenPanes.css';

export const ZEN_QUESTION_ID = 'zen-question';

export function ZenQuestion({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const q = s.question.value;
  const canChange = s.canChange.value;
  const avail = s.availability.value;
  const chips = chipsOf(s.questions.value, s.questionId.value, avail);
  return (
    <div class="zp">
      <p class="zp__lede">Suggestions are worked out from your columns, no AI. The question you pick is what gets checked.</p>
      <div role="group" aria-label="Suggested questions" class="zp__chips">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            class={'zp__chip' + (c.pressed ? ' is-on' : '')}
            aria-pressed={c.pressed}
            aria-disabled={!canChange || undefined}
            onClick={() => canChange && void s.selectQuestion(c.id)}
          >
            {c.label}
            <span class="zp__tag fd-mono">{c.tag}</span>
            {c.needsLive && <span class="zp__live fd-mono">needs live</span>}
          </button>
        ))}
      </div>
      <label for={ZEN_QUESTION_ID} class="fd-sr">
        Your question
      </label>
      <input id={ZEN_QUESTION_ID} class="zp__box" type="text" readOnly value={q?.text ?? ''} />
    </div>
  );
}

const TAG_CLASS: Record<ZenCheck['state'], string> = { always: 'is-on', applies: 'is-on', none: 'is-off', after: 'is-off' };

export function ZenChecks({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const q = s.question.value;
  const agreement = s.agreement.value;
  const rows = zenChecks(agreement);
  const level = q?.level ?? 'basic';
  const said = s.outcome.value.kind === 'no-recording';
  const line = q
    ? levelLine({ level, agreement, availability: said ? undefined : s.availability.value[q.id], ownData: s.source.value === 'own', recordedOther: s.recordedOther.value })
    : '';
  return (
    <div class="zp">
      <p class="zp__lede">
        {q ? <>Before you see an answer to “{q.text}”, it has to pass these.</> : 'Pick a question first.'}
      </p>
      <ol class="zp__checks" aria-label="The six checks">
        {rows.map((c) => (
          <li key={c.num} class={'zp__check ' + TAG_CLASS[c.state]}>
            <span class="zp__num fd-mono">{c.num}</span>
            <span class="zp__ico">{c.state === 'always' || c.state === 'applies' ? <CheckDisc size={18} /> : <NotChecked size={18} />}</span>
            <span class="zp__body">
              <span class="zp__label">{c.label}</span>
              <span class="zp__note">{c.note}</span>
            </span>
            <span class="zp__state fd-mono">{c.tag}</span>
          </li>
        ))}
      </ol>
      <p class="zp__sum">{zenChecksSummary(level)}</p>
      {line && q && s.availability.value[q.id] === 'none' && !said && <p class="zp__line">{line}</p>}
    </div>
  );
}

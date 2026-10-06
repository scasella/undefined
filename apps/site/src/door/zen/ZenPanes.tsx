/** Step by step · the panes that are not already a shared component: the question (2) and "what your answer must pass" (3). */
import { useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { CheckDisc, NotChecked } from '../icons';
import { chipsOf } from '../start/AskCard';
import { sessionFor } from '../start/session';
import { CONTINUE_WHY_ID, isTypedQuestion, zenChecks, zenChecksSummary, type ZenCheck } from './flow';
import { ZenTable } from './ZenTable';
import './ZenPanes.css';

export const ZEN_QUESTION_ID = 'zen-question';

/** A plain cross, drawn with the text colour (the shared icon set has none). */
function Cross() {
  return (
    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}
const OWN_REPLAY_NOTE = 'In this demo, answers are recorded, so a question you type needs the version on your computer to be answered. It is still added to the list.';

/**
 * Why Continue / Run is off, said where the cause is: right under the selected question (a status region that exists
 * before it has text, so the change is spoken; the buttons point at it with aria-describedby). Replay only: in live
 * mode no question needs the version on the viewer's computer, so there is nothing to say and nothing is drawn.
 */
function Why({ text, replay }: { text: string; replay: boolean }) {
  if (!replay) return null;
  return (
    <p id={CONTINUE_WHY_ID} class="zp__why" role="status">
      {text}
    </p>
  );
}

export function ZenQuestion({ engine, why = '' }: { engine: Engine; why?: string }) {
  const s = sessionFor(engine);
  const q = s.question.value;
  const canChange = s.canChange.value;
  const avail = s.availability.value;
  const chips = chipsOf(s.questions.value, s.questionId.value, avail);
  const [text, setText] = useState('');
  const group = useRef<HTMLDivElement>(null);
  const dataset = s.dataset.value;
  const rows = s.rows.value;
  const replay = engine.state.value.mode === 'replay';

  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!canChange || text.trim().length < 3) return;
    void s.addQuestion(text).then((ok) => ok && setText(''));
  };

  return (
    <div class="zp">
      <p class="zp__lede">Pick a suggestion (worked out from your columns, no AI) or type your own. Scroll your data below to see what you can ask about.</p>
      <div role="group" aria-label="Suggested questions" class="zp__chips" ref={group}>
        {chips.map((c) => (
          <div key={c.id} class="zp__item">
            <button
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
            {isTypedQuestion(c.id) && (
              // a sibling of the chip (a button inside a button is invalid); only the viewer's own questions can go
              <button
                type="button"
                class="zp__remove"
                aria-label={`Remove question: ${c.label}`}
                aria-disabled={!canChange || undefined}
                // the removed chip took the focus with it: land on the selected chip rather than <body>
                onClick={() => canChange && void s.removeQuestion(c.id).then(() => requestAnimationFrame(() => group.current?.querySelector<HTMLElement>('.zp__chip.is-on')?.focus()))}
              >
                <Cross />
              </button>
            )}
          </div>
        ))}
      </div>
      <form class="zp__form" onSubmit={submit}>
        <label for={ZEN_QUESTION_ID} class="zp__label">
          Or type your own question
        </label>
        <div class="zp__row">
          <input
            id={ZEN_QUESTION_ID}
            class="zp__box"
            type="text"
            maxLength={300}
            autocomplete="off"
            placeholder="e.g. How many orders were refunded?"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <button type="submit" class="zp__add" aria-disabled={!canChange || text.trim().length < 3 || undefined}>
            Use this question
          </button>
        </div>
        {replay && text.trim().length >= 3 && <p class="zp__note">{OWN_REPLAY_NOTE}</p>}
      </form>
      {q && (
        <p class="zp__picked" role="status">
          Asking: <strong>{q.text}</strong>
        </p>
      )}
      <Why text={why} replay={replay} />
      {dataset && rows && (
        <div class="zp__data">
          <h2 class="zp__h2">Your data</h2>
          <ZenTable dataset={dataset} rows={rows} name={s.fileName.value || dataset.name} />
        </div>
      )}
    </div>
  );
}

const TAG_CLASS: Record<ZenCheck['state'], string> = { always: 'is-on', applies: 'is-on', none: 'is-off', after: 'is-off', held: 'is-off' };

export function ZenChecks({ engine, why = '' }: { engine: Engine; why?: string }) {
  const s = sessionFor(engine);
  const q = s.question.value;
  const agreement = s.agreement.value;
  const level = q?.level ?? 'basic';
  const mode = engine.state.value.mode;
  const rows = zenChecks(agreement, { level, mode });
  return (
    <div class="zp">
      <p class="zp__lede">
        {q ? <>Before you see an answer to “{q.text}”, it has to pass these.</> : 'Pick a question first.'}
      </p>
      <Why text={why} replay={mode === 'replay'} />
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
      <p class="zp__sum">{zenChecksSummary(level, agreement.n)}</p>
    </div>
  );
}

/** Zen mode · the panes that are not already a shared component: the question (2) and "what your answer must pass" (3). */
import { useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { CheckDisc, NotChecked } from '../icons';
import { chipsOf, levelLine } from '../start/AskCard';
import { sessionFor } from '../start/session';
import { zenChecks, zenChecksSummary, type ZenCheck } from './flow';
import { ZenTable } from './ZenTable';
import './ZenPanes.css';

export const ZEN_QUESTION_ID = 'zen-question';
const OWN_REPLAY_NOTE = 'In this demo, answers are recorded, so a question you type needs the version on your computer to be answered. It is still added to the list.';

export function ZenQuestion({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const q = s.question.value;
  const canChange = s.canChange.value;
  const avail = s.availability.value;
  const chips = chipsOf(s.questions.value, s.questionId.value, avail);
  const [text, setText] = useState('');
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
      {dataset && rows && (
        <div class="zp__data">
          <h2 class="zp__h2">Your data</h2>
          <ZenTable dataset={dataset} rows={rows} name={s.fileName.value || dataset.name} />
        </div>
      )}
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

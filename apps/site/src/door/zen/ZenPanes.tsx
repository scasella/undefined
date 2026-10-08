/** Step by step · the panes that are not already a shared component: the question (2) and "what your answer must pass" (3). */
import { useMemo, useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { NotChecked } from '../icons';
import { columnNote } from '../model/columnNotes';
import { matchQuestion } from '../model/questions';
import { runLocallyView } from '../model/runLocally';
import { describeColumns, type SampleId } from '../model/samples';
import { chipsOf, legendUnlessDeadEnd, NEEDS_YOUR_COMPUTER, NeedsLiveLegend, NoRecordingSentence, tagsTellApart } from '../start/AskCard';
import { RunLocally } from '../components/DemoNote';
import type { NoRecordingView } from '../start/derive';
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
/**
 * Under the box, while a new question is typed. The reason ("the version on your computer") is the sentence under "Asking:"'s, once
 * the question is picked; this says only what happens to the words.
 */
export const OWN_REPLAY_NOTE = 'In this demo, a question you type is added to the list, but it has no recorded answer.';

/**
 * Why Continue / Run is off, said where the cause is: right under the selected question (a status region that exists
 * before it has text, so the change is spoken; the buttons point at it with aria-describedby). `view` is the
 * no-recording sentence in pieces (its `try it` / `switch to orders.csv` is a real button); `text` is any other reason ("Pick a
 * question to continue."). Replay only for the first: in live mode no question needs the version on the viewer's computer, so there
 * is nothing to say and nothing is drawn. When it is the no-recording sentence, the way to run it on the viewer's computer
 * follows it, inline (model/runLocally.ts, components/DemoNote.tsx RunLocally): one plain sentence for the person who does
 * not run commands, then the steps in a disclosure that starts open (the viewer can fold it away; it stays as they left it
 * when the message is redrawn), so nobody has to leave the page. The status region holds only the sentence, so what the
 * buttons are described by stays short.
 */
function Why({
  text,
  view,
  replay,
  onTry,
  onUse,
}: {
  text: string;
  view: NoRecordingView | null;
  replay: boolean;
  onTry: (id: string) => void;
  onUse: (sample: SampleId) => void;
}) {
  if (!replay && !text) return null;
  const steps = view ? runLocallyView(replay ? 'replay' : 'live') : null;
  return (
    <>
      <p id={CONTINUE_WHY_ID} class="zp__why" role="status">
        {view ? <NoRecordingSentence view={view} onTry={onTry} onUse={onUse} /> : text}
      </p>
      {steps && <RunLocally view={steps} disclosure link />}
    </>
  );
}

export interface WhyProps {
  /** The reason in plain words (flow.ts continueReason), '' when there is none. */
  why?: string;
  /** The reason as the no-recording sentence with its button, when that is the reason. */
  whyView?: NoRecordingView | null;
  /** `try it`: select the question that has a recorded answer (and put focus on the forward button). */
  onTry?: (id: string) => void;
  /** `switch to orders.csv`: bind the recorded sample (and put focus on the forward button). */
  onUse?: (sample: SampleId) => void;
}

export function ZenQuestion({ engine, why = '', whyView = null, onTry = () => undefined, onUse = () => undefined }: { engine: Engine } & WhyProps) {
  const s = sessionFor(engine);
  const q = s.question.value;
  const canChange = s.canChange.value;
  const avail = s.availability.value;
  const chips = chipsOf(s.questions.value, s.questionId.value, avail);
  const [text, setText] = useState('');
  const group = useRef<HTMLDivElement>(null);
  const mode = engine.state.value.mode;
  const replay = mode === 'replay';
  // (the dead-end sentence below says the same, with the steps and the link: not twice; and a tag on every chip says nothing a chip
  // apart from the others would, so it is drawn only where some chip can be answered)
  const legend = legendUnlessDeadEnd(chips, mode, whyView !== null);
  const tagNeeds = tagsTellApart(chips);
  // the words of a question that is already on the list select it: nothing is added, so the note about a new one is not said
  const already = text.trim().length >= 3 && matchQuestion(text, s.questions.value) !== null;
  // columns that look like numbers or dates but were read as text: said ONCE, here, above the suggestions they limit (it reads
  // every value, so once per file, not per keystroke)
  const dataset = s.dataset.value;
  const rows = s.rows.value;
  const colNote = useMemo(() => (dataset && rows ? columnNote(describeColumns(dataset.columns, rows), rows) : null), [dataset, rows]);

  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!canChange || text.trim().length < 3) return;
    void s.addQuestion(text).then((ok) => ok && setText(''));
  };

  return (
    <div class="zp">
      <p class="zp__lede">Pick a suggestion (worked out from your columns, no AI) or type your own. Scroll your data below to see what you can ask about.</p>
      {colNote && <p class="zp__colnote">{colNote}</p>}
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
              <span class="zp__q">{c.label}</span>
              {c.tag && <span class="zp__tag fd-mono">{c.tag}</span>}
              {c.needsLive && tagNeeds && <span class="zp__live fd-mono">{NEEDS_YOUR_COMPUTER}</span>}
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
      {legend && <NeedsLiveLegend text={legend} class="zp__legend" />}
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
        {replay && text.trim().length >= 3 && !already && <p class="zp__note">{OWN_REPLAY_NOTE}</p>}
      </form>
      {q && (
        <p class="zp__picked" role="status">
          Asking: <strong>{q.text}</strong>
        </p>
      )}
      <Why text={why} view={whyView} replay={replay} onTry={onTry} onUse={onUse} />
    </div>
  );
}

/**
 * "Your data", the whole table (scrollable). It comes AFTER the pane's buttons (Zen.tsx renders it under the nav): the
 * table is reference, and above the buttons its 320px would push Continue below the fold.
 */
export function ZenYourData({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const dataset = s.dataset.value;
  const rows = s.rows.value;
  if (!dataset || !rows) return null;
  return (
    <div class="zp__data">
      <h2 class="zp__h2">Your data</h2>
      <ZenTable dataset={dataset} rows={rows} name={s.fileName.value || dataset.name} />
    </div>
  );
}

const TAG_CLASS: Record<ZenCheck['state'], string> = { always: 'is-on', applies: 'is-on', none: 'is-off', after: 'is-off', held: 'is-off' };

/**
 * A check that WILL run: a dashed ring (dashed = not established, drawn in the body ink) with a dot at its centre. Nothing
 * has run on this pane, so nothing is green; the green disc is for a check that passed (the trace and the answer).
 */
function WillRun() {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 16 16" class="zp__will">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export function ZenChecks({ engine, why = '', whyView = null, onTry = () => undefined, onUse = () => undefined }: { engine: Engine } & WhyProps) {
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
      <Why text={why} view={whyView} replay={mode === 'replay'} onTry={onTry} onUse={onUse} />
      <ol class="zp__checks" aria-label="The six checks">
        {rows.map((c) => (
          <li key={c.num} class={'zp__check ' + TAG_CLASS[c.state]}>
            <span class="zp__num fd-mono">{c.num}</span>
            <span class="zp__ico">{c.state === 'always' || c.state === 'applies' ? <WillRun /> : <NotChecked size={18} />}</span>
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

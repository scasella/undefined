/**
 * First run · "Ask a question" (V3-Door-FirstRun 188-206). The suggested questions (worked out from the columns, no
 * model), the selected question read back in a readonly field, the Ask button and the check-level line under it.
 * Everything comes from the session (start/session.ts): questions, availability, the agreement that will be checked.
 *
 * Focus: the Ask button and the chips use aria-disabled (not `disabled`) while the session is busy, so a click never
 * drops focus to <body>. Pressing Ask moves focus on purpose: start/Start.tsx (followRun) scrolls the check trace into
 * view and focuses it, and its aria-live says what happened. A non-happy outcome (RunStates) moves focus to its own
 * heading. `try it` (the no-recording sentence's button) selects the question that has a recorded answer and puts
 * focus on Ask, since the sentence it was in goes away; so does `switch to orders.csv`, which binds the recorded sample.
 *
 * The selected question is shown as text ("Asking: …"), not in a read-only field: it is picked from the chips above, and
 * a field that looks like an input but does nothing when clicked was the thing people tried to type into.
 */
import type { Engine } from '@scasella/undefined-engine/types';
import { agreementPhrase, nextVersionLine, type AgreementView, type CheckMode } from '../model/agreement';
import type { SuggestedQuestion } from '../model/questions';
import { Arrow } from '../icons';
import { RUN_LOCALLY_URL } from '../components/DemoNote';
import type { SampleId } from '../model/samples';
import { noRecordingView, sampleOffer, type NoRecordingView, type SampleOffer } from './derive';
import type { Availability } from './recorded';
import { sessionFor, type Session } from './session';
import './AskCard.css';

/** The Ask button's id (RunStates focuses it after `try it` selects another question, or `switch to orders.csv` binds the recorded sample). */
export const ASK_BUTTON_ID = 'fd-ask-btn';
export const ASK_BOX_ID = 'ask-box';

export const BASIC_LEVEL_LINE = "Basic checks only: no examples, locked answers or house rules for this question yet. We'll say so on the answer.";
/**
 * The tag on a chip whose question the demo cannot answer: the phrase the sentences use for the same thing ("need the version on
 * your computer"), so it means something without its legend. One constant: both pages draw it.
 */
export const NEEDS_YOUR_COMPUTER = 'needs your computer';

// (the phrase lives with the agreement's other words; kept exported here for the callers that import it from the card)
export { agreementPhrase };

/**
 * The line under the Ask button. The check level is the one that will REALLY check the answer (session questions,
 * recorded.ts levelFor): a function certified before a lock or rule was added still answers from that basic-checked
 * version, so an agreement alone does not make it Full checks, and asking again shows that answer. What happens next
 * is mode-specific (model/agreement.ts nextVersionLine): live keeps the engine's promise, the demo says it cannot
 * re-run. When this page cannot answer the question (replay, nothing recorded) the line is instead the same honest
 * sentence the no-recording outcome will show, and nothing about a level: that calculation will never run in the demo
 * (`quiet`: the no-recording card below already says it, so the line says nothing).
 */
export interface LevelLineInput {
  level: 'full' | 'basic';
  agreement: Pick<AgreementView, 'empty' | 'seeded' | 'n'>;
  availability: Availability | undefined;
  ownData: boolean;
  recordedOther: Pick<SuggestedQuestion, 'id' | 'label'> | Pick<SuggestedQuestion, 'label'> | null;
  /** The recorded sample, when the file bound is not it (derive.ts sampleOffer): the way out of a file with no recorded answers. */
  offer?: SampleOffer | null;
  mode: CheckMode;
  /** The no-recording card (RunStates) is already on screen and says it: leave the line empty for such a question. */
  quiet?: boolean;
}

/** The level sentence, and (replay, nothing recorded) the no-recording sentence in pieces so `try it` can be a button. */
export interface LevelLineView {
  head: string;
  noRecording: NoRecordingView | null;
}

export function levelLineView(input: LevelLineInput): LevelLineView {
  const a = input.agreement;
  if (input.availability === 'none') return { head: '', noRecording: input.quiet ? null : noRecordingView(input.ownData, input.recordedOther, input.offer ?? null) };
  let head: string;
  if (input.level === 'basic') {
    head = a.empty
      ? BASIC_LEVEL_LINE
      : `Basic checks: the answer on file was checked before ${a.seeded ? 'this demo file came with' : 'you set'} ${agreementPhrase(a.n)}. ${nextVersionLine(input.mode)}`;
  } else if (a.seeded) head = `Full checks: this demo file comes with ${agreementPhrase(a.n)} for this question.`;
  else head = `Full checks: you set ${agreementPhrase(a.n)} for this question.`;
  return { head, noRecording: null };
}

export function levelLine(input: LevelLineInput): string {
  const v = levelLineView(input);
  const n = v.noRecording;
  const rest = n ? n.before + (n.action?.text ?? '') + n.after : '';
  return v.head && rest ? `${v.head} ${rest}` : v.head || rest;
}

export interface ChipView {
  id: string;
  label: string;
  pressed: boolean;
  /** The level that will really run; none for a question that cannot be answered here (replay: needs your computer; no level is earned). */
  tag: 'Full checks' | 'Basic checks' | null;
  /** Replay: nothing recorded for it (availability 'none'). Unknown availability is not 'none'. */
  needsLive: boolean;
}

/**
 * The chips: every tag (the selected one too) is the level that will really run (session questions, levelFor); a
 * question the demo cannot answer (replay, nothing recorded) carries "needs your computer" alone: its level will never run here. Questions this page can answer come first, the ones that
 * need the version on the viewer's computer after them (each group in list order).
 */
export function chipsOf(questions: readonly SuggestedQuestion[], selected: string | null, availability: Record<string, Availability>): ChipView[] {
  const chips = questions.map((q): ChipView => {
    const needsLive = availability[q.id] === 'none';
    const tag = needsLive ? null : q.level === 'full' ? 'Full checks' : 'Basic checks';
    return { id: q.id, label: q.label, pressed: q.id === selected, tag, needsLive };
  });
  return [...chips.filter((c) => !c.needsLive), ...chips.filter((c) => c.needsLive)];
}

/**
 * Why some chips say "needs your computer", said once near the chips whenever any chip carries the tag (replay only: live mode
 * answers every question). It does not start by repeating the tag; it says what the tag cannot: how many questions this demo has
 * a recording for. That number is counted, not typed in; null when there is nothing to explain.
 */
export function needsLiveLegend(chips: ReadonlyArray<Pick<ChipView, 'needsLive'>>, mode: 'live' | 'replay'): string | null {
  if (mode !== 'replay' || !chips.some((c) => c.needsLive)) return null;
  const n = chips.filter((c) => !c.needsLive).length;
  if (n === 0) return 'This demo has no recorded answers for these questions; they need the version on your computer.';
  return `This demo has recorded answers for ${n === 1 ? 'one question' : `${n} questions`}; the others need the version on your computer.`;
}

/**
 * Whether the "needs your computer" tag tells chips apart: some chip CAN be answered here. When none can (a file of your own, or the
 * sample with no recording), every chip would carry the same tag and the sentence under the question says it once, so Step by step
 * draws no tag then. A tag that marks every chip marks none of them.
 */
export function tagsTellApart(chips: ReadonlyArray<Pick<ChipView, 'needsLive'>>): boolean {
  return chips.some((c) => !c.needsLive);
}

/**
 * Step by step's question pane: the legend, unless the dead-end sentence is on screen beside it (`deadEnd`). That sentence says the same
 * thing (the version on your computer), names the question that does have a recording, and carries the steps and the link, so the
 * legend would only repeat it.
 */
export function legendUnlessDeadEnd(chips: ReadonlyArray<Pick<ChipView, 'needsLive'>>, mode: 'live' | 'replay', deadEnd: boolean): string | null {
  return deadEnd ? null : needsLiveLegend(chips, mode);
}

/**
 * The legend with its way forward: the README's steps, in a new tab so the page and what was picked stay as they are.
 * `link` false leaves the link out where the way forward is already on screen (components/DemoNote.tsx RunLocally lists the
 * steps and ends in the same link).
 */
export function NeedsLiveLegend({ text, class: cls, link = true }: { text: string; class: string; link?: boolean }) {
  return (
    <p class={cls}>
      {text}
      {link && (
        <>
          {' '}
          <a class="fd-ask__run" href={RUN_LOCALLY_URL} target="_blank" rel="noopener">
            How to run it on your computer
            <span class="fd-sr"> (the README on GitHub, opens in a new tab)</span>
          </a>
        </>
      )}
    </p>
  );
}

/**
 * The no-recording sentence with its action as a real button: `try it` selects the question that has a recorded answer,
 * `switch to orders.csv` binds the recorded sample (it replaces the file on screen, and the button says so).
 */
export function NoRecordingSentence({
  view,
  onTry,
  onUse,
  busy = false,
}: {
  view: NoRecordingView;
  onTry: (id: string) => void;
  onUse: (sample: SampleId) => void;
  busy?: boolean;
}) {
  const a = view.action;
  return (
    <>
      {view.before}
      {a && (
        <button type="button" class="fd-tryit" aria-disabled={busy || undefined} onClick={() => !busy && (a.kind === 'sample' ? onUse(a.sample) : onTry(a.id))}>
          {a.text}
        </button>
      )}
      {view.after}
    </>
  );
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
  const mode = engine.state.value.mode;
  const line = q
    ? levelLineView({
        level: q.level,
        agreement,
        availability: avail[q.id],
        ownData: s.source.value === 'own',
        recordedOther: s.recordedOther.value,
        offer: sampleOffer(s.sampleId.value),
        mode,
        quiet: said,
      })
    : null;
  const legend = needsLiveLegend(chips, mode);

  const pick = (id: string) => {
    if (!canChange) return;
    void s.selectQuestion(id);
  };
  // `try it`: the sentence it sits in goes away once the other question is selected, so focus goes to Ask
  const tryOther = (id: string) => {
    void s.selectQuestion(id).then(() => document.getElementById(ASK_BUTTON_ID)?.focus());
  };
  // `switch to orders.csv`: the file changes under the sentence, so focus goes to Ask here too
  const useSample = (id: SampleId) => {
    void s.useSample(id).then(() => document.getElementById(ASK_BUTTON_ID)?.focus());
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
            {c.tag && <span class="fd-ask__tag">{c.tag}</span>}
            {c.needsLive && <span class="fd-ask__live">{NEEDS_YOUR_COMPUTER}</span>}
          </button>
        ))}
      </div>
      {legend && <NeedsLiveLegend text={legend} class="fd-ask__legend" />}
      <div class="fd-ask__row">
        <p id={ASK_BOX_ID} class={`fd-ask__picked${q ? '' : ' is-empty'}`}>
          {q ? (
            <>
              <span class="fd-ask__picked-k">Asking:</span>
              <span class="fd-ask__picked-q">{q.text}</span>
            </>
          ) : (
            'Bring a file, then pick a question.'
          )}
        </p>
        <button id={ASK_BUTTON_ID} type="button" class="fd-btn fd-btn--primary fd-ask__go" aria-disabled={!canAsk || undefined} onClick={ask}>
          {s.askLabel.value}
          <Arrow />
        </button>
      </div>
      {line && (line.head || line.noRecording) && (
        <p class="fd-ask__level">
          {line.head}
          {line.head && line.noRecording ? ' ' : ''}
          {line.noRecording && <NoRecordingSentence view={line.noRecording} onTry={tryOther} onUse={useSample} busy={!canChange} />}
        </p>
      )}
    </div>
  );
}

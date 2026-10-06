/**
 * Step by step (the route is still `#/zen`): the product as a five-pane walk-through, one pane at a time, in a bare
 * single column:
 *   1 Bring your data · 2 Ask a question · 3 What your answer must pass · 4 Checking (the live check trace) · 5 Your answer
 * It is the first run's own session, check trace and answer card (start/*); nothing here is scripted. Pane 4 starts the
 * run and moves on to pane 5 by itself once it has committed; any other outcome (a question only you can answer, a
 * refusal, nothing recorded…) is shown in place with its own way forward. The one footer line says what leaves the
 * browser. Leaving the page disposes the session, as on `#/start`; the session carries the file, the question and the run
 * to the next page, and this one opens where the viewer was (flow.ts openingStep).
 *
 * Pane 2 puts the question first and the whole table ("Your data", reference) after the buttons, so Continue is on screen
 * without scrolling. Pane 5 keeps the proof: a one-line summary and a collapsed check trace (ZenProof).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { BootError } from '../App';
import { Button } from '../components/LinkButton';
import { Mark } from '../icons';
import { rowsShort, sendRows } from '../state';
import { noRecordingText, noRecordingView } from '../start/derive';
import { RunPanel } from '../start/RunPanel';
import { sessionFor } from '../start/session';
import { canContinue, CONTINUE_WHY_ID, continueReason, openingStep, paneOf, ZEN_CONTINUE_ID, ZEN_PANES, type ZenStep } from './flow';
import { ZenData } from './ZenData';
import { ZenChecks, ZenQuestion, ZenYourData } from './ZenPanes';
import { ZenProof } from './ZenProof';
import './Zen.css';

export function zenPrivacyLine(mode: 'live' | 'replay', rowsOn: boolean): string {
  return mode === 'replay'
    ? 'Your file stays in this browser. This demo plays back recorded answers and sends nothing. Checked, not proven.'
    : `Your file stays in this browser. The AI sees column names + ${rowsShort(rowsOn)}. Checked, not proven.`;
}

/** How long the finished trace stays up before the answer pane replaces it (ms). */
const HAND_OVER_MS = 1100;

/** The pane to open at: where the shared session says the viewer was (nothing bound, or the engine not ready: the first). */
function startAt(engine: Engine, initError: string | null): ZenStep {
  if (initError || !engine.state.peek().ready) return 1;
  const s = sessionFor(engine);
  const a = s.answer.peek();
  return openingStep({ bound: s.source.peek() !== 'none', outcome: s.outcome.peek().kind, answerShown: !a.held && a.view !== null });
}

export function Zen({ engine, initError }: { engine: Engine; initError: string | null }) {
  const st = engine.state.value;
  const [step, setStep] = useState<ZenStep>(() => startAt(engine, initError));
  const stepRef = useRef<ZenStep>(step);
  stepRef.current = step;
  const title = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (initError) return;
    const s = sessionFor(engine);
    return () => {
      window.clearTimeout(timer.current);
      s.dispose();
    };
  }, [engine, initError]);

  // a new pane: scroll to the top and speak its heading
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    title.current?.focus({ preventScroll: true });
  }, [step]);

  const go = (n: ZenStep) => {
    window.clearTimeout(timer.current);
    setStep(n);
  };

  const s = st.ready && !initError ? sessionFor(engine) : null;
  const busy = s?.busy.value ?? false;
  const outcome = s?.outcome.value.kind ?? 'idle';
  const done = outcome === 'committed' || outcome === 'cached';
  // replay, nothing recorded for the selected question (typed ones, other suggestions, anything on your own file): it
  // can only end in "No recorded answer for this one", so Continue stays off and says why
  const picked = s?.question.value ?? null;
  const needsLive = !!picked && s?.availability.value[picked.id] === 'none';
  const bound = !!s && s.source.value !== 'none';
  const can = s ? canContinue(step, { bound, question: picked !== null, busy, needsLive }) : false;
  const ownData = s?.source.value === 'own';
  const other = s?.recordedOther.value ?? null;
  const why = s ? continueReason(step, { question: picked !== null, needsLive, bound }, noRecordingText(ownData, other)) : '';
  // the reason as the no-recording sentence in pieces (its `try it` is a button), when that is the reason
  const whyView = why !== '' && needsLive && (step === 2 || step === 3) ? noRecordingView(ownData, other) : null;
  const describedBy = why ? { 'aria-describedby': CONTINUE_WHY_ID } : {};
  const pane = paneOf(step);
  // `try it`: another question that has a recorded answer. The sentence it was in goes away, so focus goes to the way forward
  const tryOther = (id: string) => {
    if (!s) return;
    void s.selectQuestion(id).then(() => requestAnimationFrame(() => document.getElementById(ZEN_CONTINUE_ID)?.focus()));
  };

  const run = () => {
    if (!s || !s.canAsk.value || needsLive) return;
    go(4);
    void s.ask();
  };
  // the trace has finished playing: hand over to the answer once the run committed
  const settled = () => {
    if (stepRef.current !== 4) return;
    const k = sessionFor(engine).outcome.peek().kind;
    if (k !== 'committed' && k !== 'cached') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => stepRef.current === 4 && setStep(5), HAND_OVER_MS);
  };

  return (
    <div class="zen">
      <header class="zen__top">
        <a href="#/" class="zen__home" aria-label="Undefined, home">
          <Mark />
          <span class="zen__word">Undefined</span>
        </a>
        <span class="zen__tag">Step by step</span>
        <a href="#/start" class="zen__full">
          Full view
        </a>
      </header>

      <main id="main" tabIndex={-1} class="zen__main">
        {initError ? (
          <BootError text={initError} />
        ) : !s ? (
          <p class="zen__loading" role="status">
            Loading…
          </p>
        ) : (
          <>
            <ol class="zen__steps" aria-label="Progress">
              {ZEN_PANES.map((p) => (
                <li
                  key={p.step}
                  class={'zen__dot' + (p.step === step ? ' is-now' : p.step < step ? ' is-done' : '')}
                  aria-current={p.step === step ? 'step' : undefined}
                >
                  <span class="zen__n fd-mono" aria-hidden="true">
                    {p.step}
                  </span>
                  <span class="zen__dl">
                    <span class="fd-sr">Step {p.step}: </span>
                    {p.label}
                  </span>
                </li>
              ))}
            </ol>

            <section class="zen__pane" key={step} aria-labelledby="zen-title">
              <h1 id="zen-title" class="zen__h" tabIndex={-1} ref={title}>
                {pane.title}
              </h1>

              {step === 1 && <ZenData engine={engine} />}
              {step === 2 && <ZenQuestion engine={engine} why={why} whyView={whyView} onTry={tryOther} />}
              {step === 3 && <ZenChecks engine={engine} why={why} whyView={whyView} onTry={tryOther} />}
              {step === 4 && <RunPanel engine={engine} zen part="run" onSettled={settled} />}
              {step === 5 && <RunPanel engine={engine} zen part="answer" />}
              {step === 5 && <ZenProof engine={engine} />}

              {/* why Continue is off on the first pane, in words, where the button is (the other panes say it under the question) */}
              {step === 1 && why && (
                <p id={CONTINUE_WHY_ID} class="zen__why">
                  {why}
                </p>
              )}

              <nav class="zen__nav" aria-label="Move between steps">
                {step > 1 && step < 5 && !(step === 4 && busy) && (
                  <Button variant="secondary" onClick={() => go((step - 1) as ZenStep)}>
                    Back
                  </Button>
                )}
                {step === 5 && (
                  <Button variant="secondary" onClick={() => go(2)}>
                    Ask another question
                  </Button>
                )}
                {step === 5 && (
                  <Button variant="secondary" onClick={() => go(1)}>
                    Use different data
                  </Button>
                )}
                <span class="zen__spacer" />
                {step < 3 && (
                  <Button id={ZEN_CONTINUE_ID} variant="primary" icon="arrow" aria-disabled={can ? undefined : 'true'} {...describedBy} onClick={() => can && go((step + 1) as ZenStep)}>
                    Continue
                  </Button>
                )}
                {step === 3 && (
                  <Button id={ZEN_CONTINUE_ID} variant="primary" icon="arrow" aria-disabled={can && s.canAsk.value ? undefined : 'true'} {...describedBy} onClick={run}>
                    Run the checks
                  </Button>
                )}
                {step === 4 && done && (
                  <Button variant="primary" icon="arrow" onClick={() => go(5)}>
                    See the answer
                  </Button>
                )}
              </nav>

              {/* reference, after the buttons: the whole table is 320px tall and would push Continue off the screen */}
              {step === 2 && <ZenYourData engine={engine} />}
            </section>
          </>
        )}
      </main>
      <footer class="zen__foot">{zenPrivacyLine(st.mode, sendRows.value)}</footer>
    </div>
  );
}


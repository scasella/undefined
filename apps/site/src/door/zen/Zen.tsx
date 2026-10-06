/**
 * Zen mode (`#/zen`): the product as a five-pane walk-through, one pane at a time, in a bare single column:
 *   1 Bring your data · 2 Ask a question · 3 What your answer must pass · 4 Checking (the live check trace) · 5 Your answer
 * It is the first run's own session, check trace and answer card (start/*); nothing here is scripted. Pane 4 starts the
 * run and moves on to pane 5 by itself once it has committed; any other outcome (a question only you can answer, a
 * refusal, nothing recorded…) is shown in place with its own way forward. The one footer line says what leaves the
 * browser. Leaving the page disposes the session, as on `#/start`.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { BootError } from '../App';
import { Button } from '../components/LinkButton';
import { Mark } from '../icons';
import { rowsShort, sendRows } from '../state';
import { noRecordingText } from '../start/derive';
import { RunPanel } from '../start/RunPanel';
import { sessionFor } from '../start/session';
import { canContinue, CONTINUE_WHY_ID, continueReason, paneOf, ZEN_PANES, type ZenStep } from './flow';
import { ZenData } from './ZenData';
import { ZenChecks, ZenQuestion } from './ZenPanes';
import './Zen.css';

export function zenPrivacyLine(mode: 'live' | 'replay', rowsOn: boolean): string {
  return mode === 'replay'
    ? 'Your file stays in this browser. This demo plays back recorded answers and sends nothing. Checked, not proven.'
    : `Your file stays in this browser. The AI sees column names + ${rowsShort(rowsOn)}. Checked, not proven.`;
}

/** How long the finished trace stays up before the answer pane replaces it (ms). */
const HAND_OVER_MS = 1100;

export function Zen({ engine, initError }: { engine: Engine; initError: string | null }) {
  const st = engine.state.value;
  const [step, setStep] = useState<ZenStep>(1);
  const stepRef = useRef<ZenStep>(1);
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
  const can = s ? canContinue(step, { bound: s.source.value !== 'none', question: picked !== null, busy, needsLive }) : false;
  const why = s ? continueReason(step, { question: picked !== null, needsLive }, noRecordingText(s.source.value === 'own', s.recordedOther.value)) : '';
  const describedBy = why ? { 'aria-describedby': CONTINUE_WHY_ID } : {};
  const pane = paneOf(step);

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
        <a href="#/" class="zen__home" aria-label="Undefined, full site">
          <Mark />
          <span class="zen__word">Undefined</span>
        </a>
        <span class="zen__tag fd-mono">zen</span>
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
              {step === 2 && <ZenQuestion engine={engine} why={why} />}
              {step === 3 && <ZenChecks engine={engine} why={why} />}
              {step === 4 && <RunPanel engine={engine} zen part="run" onSettled={settled} />}
              {step === 5 && <RunPanel engine={engine} zen part="answer" />}

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
                  <Button variant="primary" icon="arrow" aria-disabled={can ? undefined : 'true'} {...describedBy} onClick={() => can && go((step + 1) as ZenStep)}>
                    Continue
                  </Button>
                )}
                {step === 3 && (
                  <Button variant="primary" icon="arrow" aria-disabled={can && s.canAsk.value ? undefined : 'true'} {...describedBy} onClick={run}>
                    Run the checks
                  </Button>
                )}
                {step === 4 && done && (
                  <Button variant="primary" icon="arrow" onClick={() => go(5)}>
                    See the answer
                  </Button>
                )}
              </nav>
            </section>
          </>
        )}
      </main>
      <footer class="zen__foot">{zenPrivacyLine(st.mode, sendRows.value)}</footer>
    </div>
  );
}


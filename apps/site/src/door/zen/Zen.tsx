/**
 * Step by step: the product as a five-pane walk-through, one pane at a time, in a bare single column:
 *   1 Bring your data · 2 Ask a question · 3 What your answer must pass · 4 Checking (the live check trace) · 5 Your answer
 * It is the first run's own session, check trace and answer card (start/*); nothing here is scripted. Nothing moves by
 * itself: pane 4 starts the run and stays on the finished trace (a plain line saying how the checks went, Back, and
 * "See the answer", which takes focus once the run has settled, wherever focus was) until the viewer presses it; any other
 * outcome (a question only you can answer, a refusal, nothing recorded…) is shown in place with its own way forward. The
 * one footer line says what leaves the browser. Leaving the page disposes the session, as on `#/start`; the session carries
 * the file, the question and the run to the next page, and this one opens where the viewer was (flow.ts openingStep).
 *
 * The pane is in the URL (`#/zen/1` … `#/zen/5`) and the browser's Back and Forward step one pane at a time. Moving with the
 * page's own buttons pushes a history entry (pushState: no hashchange, so the router leaves focus and scroll alone). What
 * the URL asks for is only a request: flow.ts resolveStep clamps it to what the session allows (a run in progress always
 * shows pane 4, there is no cancel to build: the engine cannot cancel) and the URL is rewritten with replaceState to match.
 * The page's own "Back" goes through the browser when the entry before is the previous pane, and checks where it landed
 * (flow.ts afterHistoryBack): an entry rewritten by that clamp no longer says what its neighbour remembers. While it is on
 * screen the page also owns the scroll (history.scrollRestoration is 'manual', flow.ts holdManualScroll, and 'auto' again as
 * soon as the page goes): each pane opens at the top, and the browser does not put the old offset back after that.
 *
 * Pane 2 puts the question first and the whole table ("Your data", reference) after the buttons, so Continue is on screen
 * without scrolling. Pane 5 keeps the proof: a one-line summary and a collapsed check trace (ZenProof).
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { BootError } from '../App';
import { Button } from '../components/LinkButton';
import { Mark } from '../icons';
import { rowsShort, sendRows } from '../state';
import { noRecordingText, noRecordingView, traceSummary } from '../start/derive';
import { RunPanel } from '../start/RunPanel';
import { sessionFor, type Session } from '../start/session';
import {
  afterHistoryBack,
  backPlan,
  canContinue,
  CONTINUE_WHY_ID,
  continueReason,
  hashForStep,
  holdManualScroll,
  isZenHash,
  paneOf,
  resolveStep,
  stepFromHash,
  ZEN_CONTINUE_ID,
  ZEN_PANES,
  ZEN_SEE_ANSWER_ID,
  zenHistoryState,
  type ZenSessionView,
  type ZenStep,
} from './flow';
import { ZenData } from './ZenData';
import { ZenChecks, ZenQuestion, ZenYourData } from './ZenPanes';
import { ZenProof } from './ZenProof';
import './Zen.css';

export function zenPrivacyLine(mode: 'live' | 'replay', rowsOn: boolean): string {
  return mode === 'replay'
    ? 'Your file stays in this browser. This demo plays back recorded answers and sends nothing. Checked, not proven.'
    : `Your file stays in this browser. The AI sees column names + ${rowsShort(rowsOn)}. Checked, not proven.`;
}

/** What the shared session says, in the walk-through's terms (flow.ts resolveStep / openingStep). */
function viewOf(s: Session): ZenSessionView {
  const a = s.answer.peek();
  return { bound: s.source.peek() !== 'none', outcome: s.outcome.peek().kind, answerShown: !a.held && a.view !== null };
}

/** The pane to open at: the one the URL asks for if the shared session allows it (nothing bound, or the engine not ready: the first). */
function startAt(engine: Engine, initError: string | null): ZenStep {
  if (initError || !engine.state.peek().ready) return 1;
  return resolveStep(stepFromHash(location.hash), viewOf(sessionFor(engine)));
}

/** Put a pane in the URL: push a history entry (the viewer moved), or rewrite this one (the URL asked for something else). Neither fires hashchange. */
function writeUrl(how: 'push' | 'replace', step: ZenStep, from: ZenStep | null): void {
  try {
    const url = location.pathname + location.search + hashForStep(step);
    if (how === 'push') history.pushState(zenHistoryState(step, from), '', url);
    else history.replaceState(zenHistoryState(step, null), '', url);
  } catch {
    /* a sandbox that forbids it: the pane still changes, the address just stays where it was */
  }
}

/**
 * The run has settled: focus goes to "See the answer", wherever it was (the heading the pane spoke, the top bar's skip link
 * after a stray Tab, <body>): nothing else on this pane takes focus while it runs, so there is nothing of the viewer's to keep.
 * The browser scrolls the button into view when it takes focus, so the line and the button are on screen on a phone too.
 */
function focusSeeAnswer(): void {
  document.getElementById(ZEN_SEE_ANSWER_ID)?.focus();
}

export function Zen({ engine, initError }: { engine: Engine; initError: string | null }) {
  const st = engine.state.value;
  const [step, setStep] = useState<ZenStep>(() => startAt(engine, initError));
  // the pane on screen, kept in step with `step` the moment it is set (popstate and hashchange both arrive for one Back)
  const stepRef = useRef<ZenStep>(step);
  const title = useRef<HTMLHeadingElement>(null);
  // this visit to pane 4 has seen the run going (or started it): only then does settling move focus to "See the answer"
  const watching = useRef(false);
  // the pane the in-app "Back" was pressed on, from the moment it asks the browser to step back until the browser has landed
  const backFrom = useRef<ZenStep | null>(null);

  useEffect(() => {
    if (initError) return;
    const s = sessionFor(engine);
    return () => s.dispose();
  }, [engine, initError]);

  // while this page is on screen it owns the scroll: the browser must not put an entry's old offset back after the pane has
  // scrolled itself to the top on Back and Forward (flow.ts holdManualScroll); the landing and the Full view get the browser's back
  useEffect(() => holdManualScroll(typeof history === 'undefined' ? null : history), []);

  // a new pane: scroll to the top and speak its heading (the viewer's buttons and the browser's Back and Forward alike)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    title.current?.focus({ preventScroll: true });
  }, [step]);

  const s = st.ready && !initError ? sessionFor(engine) : null;
  const busy = s?.busy.value ?? false;
  const outcome = s?.outcome.value.kind ?? 'idle';
  const running = outcome === 'running';
  const done = outcome === 'committed' || outcome === 'cached';
  const ready = s !== null;

  // Move to a pane with the viewer's own button: push a history entry and show it
  const go = useCallback((n: ZenStep): void => {
    backFrom.current = null;
    const from = stepRef.current;
    if (n === from) return;
    writeUrl('push', n, from);
    stepRef.current = n;
    setStep(n);
  }, []);

  // The URL asks for a pane; the session decides which one it is (flow.ts resolveStep). Idempotent, and quiet when nothing
  // differs: pushState / replaceState fire no event, so rewriting the address here cannot come back round. `viaBrowser`: the
  // browser has just moved through its history (popstate, hashchange), which is when an in-app "Back" that asked it to
  // step back finds out where it really landed.
  const sync = useCallback(
    (viaBrowser = false): void => {
      const askedFrom = viaBrowser ? backFrom.current : null;
      if (viaBrowser) backFrom.current = null;
      if (!isZenHash(location.hash)) return; // another page is on its way in: not ours to touch
      const session = viewOf(sessionFor(engine));
      const want = resolveStep(stepFromHash(location.hash), session);
      if (want !== stepRef.current) {
        stepRef.current = want;
        setStep(want);
      }
      if (location.hash !== hashForStep(want)) writeUrl('replace', want, null);
      // "Back" asked the browser for the pane before and it landed somewhere else (the entry before had been rewritten): push it
      const before = askedFrom === null ? null : afterHistoryBack(askedFrom, want);
      if (before !== null) go(resolveStep(before, session));
    },
    [engine, go],
  );
  useEffect(() => {
    if (!ready) return;
    sync(); // the session is there: put the address on the pane (a bare #/zen gets its number; a deep link is held to what is allowed)
    const onBrowser = (): void => sync(true);
    window.addEventListener('hashchange', onBrowser);
    window.addEventListener('popstate', onBrowser);
    return () => {
      window.removeEventListener('hashchange', onBrowser);
      window.removeEventListener('popstate', onBrowser);
    };
  }, [ready, sync]);
  // a run in progress always shows pane 4 (there is no cancel): whatever put the viewer elsewhere is put right
  useEffect(() => {
    if (ready && running && step !== 4) sync();
  }, [ready, running, step, sync]);
  useEffect(() => {
    if (step !== 4) watching.current = false;
    else if (running) watching.current = true;
  }, [step, running]);

  // "Back": through the browser when its previous entry is the previous pane (Forward then returns here), else push that pane.
  // The browser has the last word on where it lands (sync, afterHistoryBack), so what it was asked from is kept until it does.
  const goBack = (): void => {
    if (step < 2) return;
    if (backPlan(history.state, step) === 'history') {
      backFrom.current = step;
      history.back();
    } else go((step - 1) as ZenStep);
  };
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
    watching.current = true;
    go(4);
    void s.ask();
  };
  // the trace has finished playing its last lane: if this visit watched the run, focus goes to "See the answer" (the pane does
  // not change: the viewer decides when to leave the proof). Arriving on an already finished trace (Back, Forward) says nothing.
  const settled = () => {
    if (stepRef.current !== 4 || !watching.current) return;
    const k = sessionFor(engine).outcome.peek().kind;
    if (k !== 'committed' && k !== 'cached') return;
    watching.current = false;
    requestAnimationFrame(() => stepRef.current === 4 && focusSeeAnswer());
  };
  // one plain line, next to the way forward: how the checks went (the seal's words and the real run: the answer pane's own line)
  const verdict = step === 4 && done && s ? traceSummary(s.trace.value) : null;

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

              {verdict && <p class="zen__verdict">{verdict}</p>}

              {/* why Continue is off on the first pane, in words, where the button is (the other panes say it under the question) */}
              {step === 1 && why && (
                <p id={CONTINUE_WHY_ID} class="zen__why">
                  {why}
                </p>
              )}

              <nav class="zen__nav" aria-label="Move between steps">
                {step > 1 && step < 5 && !(step === 4 && (busy || running)) && (
                  <Button variant="secondary" onClick={goBack}>
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
                  <Button id={ZEN_SEE_ANSWER_ID} variant="primary" icon="arrow" onClick={() => go(5)}>
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


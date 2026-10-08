/**
 * The full first run (`#/start`, V3-Door-FirstRun; the "Step by step" walk-through at `#/zen` is where newcomers are
 * sent, and this page stays for people who want everything at once): a short task heading, then "Get started" in two
 * columns: bring a file, ask, the run (trace + answer), and the file's columns on the left; what the AI will see, your
 * agreement and the demo note on the right. "Ask a question" comes straight after the file, so it is on screen without
 * scrolling; the columns (also listed under "What the AI will see") are reference and come last. Every section reads
 * the one shared session (start/session.ts); nothing here is scripted.
 *
 * On first visit the sample orders.csv is bound (after a reload, the sample last picked) (once per session, unless something is bound already); leaving the
 * page disposes the session so the top bar's file chip and running pulse go with it.
 *
 * Pressing Ask must show something: when a run begins the page scrolls the check trace into view and focus moves to it
 * (a labelled region: the trace's own aria-live sentence then speaks the result), and when the answer is shown the
 * page brings the answer's figure into view if it is not already. Both follow the session's own signals
 * (`run.id`, `answer.held`), not a timer, move smoothly unless the viewer asks for reduced motion, and never act on a
 * run that was already there when the page opened.
 */
import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { AgreementDraft } from '../components/AgreementDraft';
import { ASK_BUTTON_ID, AskCard } from './AskCard';
import { ColumnPreview } from './ColumnPreview';
import { DataBringer } from './DataBringer';
import { Intro } from './Intro';
import { RightRail } from './RightRail';
import { RunPanel } from './RunPanel';
import { sessionFor, type Session } from './session';
import { offScreen, rememberedSample, SAMPLE_KEY } from './startView';
import './Start.css';

/** Sessions that already tried the default sample (never twice: a failure leaves its problem on screen). */
const defaulted = new WeakSet<Session>();

const readSample = (): string | null => {
  try {
    return localStorage.getItem(SAMPLE_KEY);
  } catch {
    return null;
  }
};
const writeSample = (id: string): void => {
  try {
    localStorage.setItem(SAMPLE_KEY, id);
  } catch {
    /* storage blocked: a reload starts from orders.csv */
  }
};

/**
 * Bind the sample the viewer last picked (orders.csv on a first visit) once the engine is idle, unless a dataset is
 * already bound; and remember each sample the viewer picks. Returns the effects' stop.
 */
export function bindDefaultSample(s: Session): () => void {
  const remember = effect(() => {
    const id = s.sampleId.value;
    if (id) writeSample(id);
  });
  const bind = effect(() => {
    if (defaulted.has(s) || !s.canChange.value || s.source.value !== 'none') return;
    defaulted.add(s);
    const id = rememberedSample(readSample());
    // (outside the effect: useSample writes signals this effect reads)
    void Promise.resolve()
      .then(() => s.useSample(id))
      .then((ok) => {
        // not idle after all (no problem recorded): try again when it is
        if (!ok && !s.intake.peek().problem && s.source.peek() === 'none') defaulted.delete(s);
      });
  });
  return () => {
    remember();
    bind();
  };
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The sticky bar at the bottom covers this much of the viewport. */
const bottomBar = (): number => document.querySelector('.fd-honesty')?.getBoundingClientRect().height ?? 0;

/** Scroll `el` to the top of the viewport (smoothly unless reduced motion is asked for). */
function scrollTo(el: HTMLElement): void {
  el.scrollIntoView({ behavior: (reducedMotion() ? 'instant' : 'smooth') as ScrollBehavior, block: 'start' });
}

/**
 * Make the trace a place focus can go (`tabindex=-1`, a labelled region) without touching components/CheckTrace: the
 * element is found inside the run's wrapper.
 */
function traceIn(region: HTMLElement): HTMLElement | null {
  const el = region.querySelector<HTMLElement>('.fd-trace');
  if (!el) return null;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  if (!el.hasAttribute('role')) el.setAttribute('role', 'region');
  if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'The checks');
  return el;
}

/**
 * Follow the session's run: a new run id scrolls the trace into view (unless all of it is already on screen) and
 * focuses it; an answer that is shown (`answer.held` false, with a view) brings its figure into view (unless it is).
 * Run ids that exist when this starts, and answers already shown, are not acted on. Both happen on the next frame, so
 * the layout has settled, and one frame handles both: a cached answer, which is shown at once, scrolls only to the answer.
 */
export function followRun(s: Session, region: () => HTMLElement | null): () => void {
  let seenRun = s.run.peek()?.id ?? 0;
  const first = s.answer.peek();
  let shownRun = !first.held && first.view !== null ? seenRun : -1;
  let want: 'trace' | 'answer' | null = null;
  let frame = 0;
  const flush = () => {
    frame = 0;
    const box = region();
    const act = want;
    want = null;
    if (!box || !act) return;
    const inset = bottomBar();
    if (act === 'trace') {
      const trace = traceIn(box);
      if (!trace) return;
      if (offScreen(trace.getBoundingClientRect(), window.innerHeight, inset)) scrollTo(trace);
      trace.focus({ preventScroll: true });
      return;
    }
    const card = box.querySelector<HTMLElement>('.fd-ac');
    const figure = box.querySelector<HTMLElement>('.fd-ac__lead-num') ?? card;
    if (card && figure && offScreen(figure.getBoundingClientRect(), window.innerHeight, inset)) scrollTo(card);
  };
  const stop = effect(() => {
    const id = s.run.value?.id ?? 0;
    const a = s.answer.value;
    const shown = !a.held && a.view !== null;
    if (id !== seenRun) {
      seenRun = id;
      if (id > 0) want = want ?? 'trace';
    }
    if (shown && id > 0 && shownRun !== id) {
      shownRun = id;
      want = 'answer';
    }
    if (want && !frame) frame = requestAnimationFrame(flush);
  });
  return () => {
    stop();
    if (frame) cancelAnimationFrame(frame);
  };
}

export function Start({ engine }: { engine: Engine }) {
  const run = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = sessionFor(engine);
    const stop = bindDefaultSample(s);
    const follow = followRun(s, () => run.current);
    return () => {
      follow();
      stop();
      s.dispose();
    };
  }, [engine]);

  return (
    <>
      <Intro />
      <section aria-label="Get started" class="fd-start">
        <div class="fd-wrap fd-start__row">
          <div class="fd-start__main">
            <h2 class="fd-sr">Bring a file</h2>
            <DataBringer engine={engine} />
            <AskCard engine={engine} />
            <AgreementDraft session={sessionFor(engine)} forwardId={ASK_BUTTON_ID} lead={false} />
            <div ref={run} class="fd-start__run">
              <RunPanel engine={engine} />
            </div>
            <ColumnPreview engine={engine} />
          </div>
          <RightRail engine={engine} />
        </div>
      </section>
    </>
  );
}

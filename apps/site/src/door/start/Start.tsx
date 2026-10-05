/**
 * The first run (`#/start`, V3-Door-FirstRun): the hero line, then "Get started" in two columns: bring a file, its
 * columns, ask, the run (trace + answer) on the left; what the AI will see, your agreement and the demo note on the
 * right. Every section reads the one shared session (start/session.ts); nothing here is scripted.
 *
 * On first visit the sample orders.csv is bound (after a reload, the sample last picked) (once per session, unless something is bound already); leaving the
 * page disposes the session so the top bar's file chip and running pulse go with it.
 */
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { AskCard } from './AskCard';
import { ColumnPreview } from './ColumnPreview';
import { DataBringer } from './DataBringer';
import { Intro } from './Intro';
import { RightRail } from './RightRail';
import { RunPanel } from './RunPanel';
import { sessionFor, type Session } from './session';
import { rememberedSample, SAMPLE_KEY } from './startView';
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

export function Start({ engine }: { engine: Engine }) {
  useEffect(() => {
    const s = sessionFor(engine);
    const stop = bindDefaultSample(s);
    return () => {
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
            <DataBringer engine={engine} />
            <ColumnPreview engine={engine} />
            <AskCard engine={engine} />
            <RunPanel engine={engine} />
          </div>
          <RightRail engine={engine} />
        </div>
      </section>
    </>
  );
}

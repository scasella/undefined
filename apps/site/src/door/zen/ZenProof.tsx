/**
 * Step by step · the proof beside the answer. The answer pane shows the answer, so without this the viewer would get the
 * answer and lose the check trace they watched on the pane before. One line says how it passed (the seal words and the
 * real run time, cut from the same view model the trace is drawn from: start/derive.ts traceSummary), and a real
 * disclosure button, collapsed by default, opens the full check trace for that run: the same component and props the
 * "Checking" pane uses (components/CheckTrace). Opening it plays nothing (a trace that mounts already settled shows its end
 * state), so there is nothing for reduced motion to switch off, and the trace's own live region stays quiet: the button's
 * expanded state is what is spoken.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { CheckTrace } from '../components/CheckTrace';
import { Button } from '../components/LinkButton';
import { traceSummary } from '../start/derive';
import { sessionFor } from '../start/session';
import './ZenProof.css';

export const ZEN_PROOF_ID = 'zen-proof';
export const SEE_CHECKS = 'See the checks';

const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ZenProof({ engine }: { engine: Engine }) {
  const s = sessionFor(engine);
  const t = s.trace.value;
  const run = s.run.value;
  const shown = s.answer.value.view !== null;
  const line = shown ? traceSummary(t) : null;
  const [open, setOpen] = useState<{ run: number; on: boolean }>({ run: run?.id ?? 0, on: false });
  // collapsed again for another run (asking again from the answer pane starts from a closed one)
  const on = open.run === (run?.id ?? 0) && open.on;
  const body = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    // after it has opened (not on the first render): bring it into view if the button was near the bottom of the screen
    if (!on) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    body.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [on]);
  if (!line) return null;
  return (
    <section class="zpr" aria-label="How it was checked">
      <p class="zpr__line">{line}</p>
      <Button variant="secondary" class="zpr__btn" aria-expanded={on} aria-controls={ZEN_PROOF_ID} onClick={() => setOpen({ run: run?.id ?? 0, on: !on })}>
        {SEE_CHECKS}
        <span aria-hidden="true" class="zpr__chev" />
      </Button>
      <div id={ZEN_PROOF_ID} ref={body} class="zpr__body" hidden={!on}>
        {on && (
          <CheckTrace lanes={t.lanes} ghost={t.ghost} header={t.header} footer={t.footer} liveText="" listLabel="The checks that ran on this answer" />
        )}
      </div>
    </section>
  );
}

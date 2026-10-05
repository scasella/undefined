/**
 * Zen mode (`#/zen`): the product with everything else taken away. One narrow column: bring a file (drop, paste or a
 * sample), ask, watch the checks, read the answer. It is the first run's own session, ask card and check trace
 * (start/*) in a bare shell: no top bar, landing, rails or footer. The one honest line that stays says what leaves
 * the browser. Leaving the page disposes the session, as on `#/start`.
 */
import { useEffect } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { Mark } from '../icons';
import { rowsShort, sendRows } from '../state';
import { AskCard } from '../start/AskCard';
import { RunPanel } from '../start/RunPanel';
import { sessionFor } from '../start/session';
import { bindDefaultSample } from '../start/Start';
import { BootError } from '../App';
import { ZenData } from './ZenData';
import './Zen.css';

export function zenPrivacyLine(mode: 'live' | 'replay', rowsOn: boolean): string {
  return mode === 'replay'
    ? 'Your file stays in this browser. This demo plays back recorded answers and sends nothing. Checked, not proven.'
    : `Your file stays in this browser. The AI sees column names + ${rowsShort(rowsOn)}. Checked, not proven.`;
}

export function Zen({ engine, initError }: { engine: Engine; initError: string | null }) {
  const st = engine.state.value;
  useEffect(() => {
    if (initError) return;
    const s = sessionFor(engine);
    const stop = bindDefaultSample(s);
    return () => {
      stop();
      s.dispose();
    };
  }, [engine, initError]);

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
        ) : !st.ready ? (
          <p class="zen__loading" role="status">
            Loading…
          </p>
        ) : (
          <>
            <ZenData engine={engine} />
            <AskCard engine={engine} />
            <RunPanel engine={engine} zen />
          </>
        )}
      </main>
      <footer class="zen__foot">{zenPrivacyLine(st.mode, sendRows.value)}</footer>
    </div>
  );
}

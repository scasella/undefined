/**
 * The front door shell: top bar, <main id="main"> holding the routed page, the landing's footer and the sticky
 * honesty bar. Routes: '#/' landing, '#/start' first run (router.ts). In-page '#id' links scroll, they never route.
 */
import { useEffect } from 'preact/hooks';
import type { Engine } from '@scasella/undefined-engine/types';
import { HonestyBar } from './components/HonestyBar';
import { SiteFooter } from './components/SiteFooter';
import { TelemetryBar } from './components/TelemetryBar';
import { Landing } from './landing/Landing';
import { installRouter, useRoute } from './router';
import { Start } from './start/Start';
import { engineRef, headVersion, shellFileChip, shellRunning } from './state';

/** The landing's example is "Version 3 · 5 Oct 2026" (an illustration, see FRONT-DOOR.md honesty rule 2). */
const LANDING_VERSION = { version: 3, date: '5 Oct 2026' } as const;
const LANDING_CHIP = 'orders.csv · 332 rows · 10 columns';

export function App({ engine, initError }: { engine: Engine; initError?: string | null }) {
  if (engineRef.peek() !== engine) engineRef.value = engine;
  useEffect(() => installRouter(), []);
  const page = useRoute();
  const st = engine.state.value;
  const chip = shellFileChip.value ?? (page === 'landing' ? LANDING_CHIP : null);
  const honesty = page === 'landing' ? LANDING_VERSION : headVersion(st);

  return (
    <div class="fd-shell">
      <TelemetryBar engine={engine} fileChip={chip} running={shellRunning.value} />
      <main id="main" tabIndex={-1}>
        {initError ? (
          <BootError text={initError} />
        ) : page === 'landing' ? (
          <Landing engine={engine} />
        ) : st.ready ? (
          <Start engine={engine} />
        ) : (
          <div class="fd-boot" role="status">
            <p class="fd-boot-line">Loading…</p>
          </div>
        )}
      </main>
      {page === 'landing' && <SiteFooter />}
      <HonestyBar version={honesty.version} date={honesty.date} />
    </div>
  );
}

/** Startup failure, in the page (the engine could not start). */
export function BootError({ text }: { text: string }) {
  return (
    <div class="fd-boot">
      <div class="fd-boot-error" role="alert">
        <h1>Undefined could not start</h1>
        <p>
          Startup failed: <code>{text}</code>
        </p>
        <p>
          Reload the page to try again, or open the <a href="workbench.html">workbench</a>.
        </p>
      </div>
    </div>
  );
}

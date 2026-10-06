/** Entry for index.html, the only page: the front door. Loads and boots the engine once and renders <App/>. */
import { render } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import './tokens.css';
import './base.css';
import './components.css';
import { App, BootError } from './App';
import { installRouter } from './router';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  let engine: Engine;
  try {
    const { createEngine } = await import('../core/engine');
    // No location: the front door has no use for the engine's URL parameters. An old `?opener=<example>` link would
    // silently swap the program, and `?recording=<url>` would fetch a recording that nothing here offers; both are ignored.
    //
    // mutation.idleMs: the stress test (the engine's lazy mutation check) starts once the engine has been idle this long
    // after a commit; the engine's default is 4 s, a REPL-era courtesy so a person typing a second call is not met by a
    // check they did not ask for. Here the answer, its seal and the trace's verdict are held until the stress test has
    // finished (start/derive.ts outcomeOf), so those 4 s were pure waiting before every reveal. It changes only WHEN the
    // check starts, never what it does: the same mutants run against the same tests, properties and pins under the same
    // 6 s time box (the run itself takes about 0.3 s), it still waits for every queued operation and still yields to any
    // new one (a new operation cancels it and it re-runs after the next idle). quietMs (never within 10 s of an Enter)
    // and timeBoxMs stay at the engine's defaults.
    engine = createEngine({ location: () => null, mutation: { idleMs: 600 } });
  } catch (e) {
    renderError(e);
    return;
  }
  if (import.meta.env.DEV) (window as unknown as { __undefined?: Engine }).__undefined = engine; // maintainer hook (scripts)
  installRouter(); // before the first render, so a cold '#/start' never mounts the landing for a frame
  render(<App engine={engine} />, root);
  try {
    await engine.init();
  } catch (e) {
    render(<App engine={engine} initError={errorText(e)} />, root);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** The engine module itself failed to load: no shell (it needs the engine), just the failure. */
function renderError(e: unknown): void {
  render(
    <main id="main" tabIndex={-1}>
      <BootError text={errorText(e)} />
    </main>,
    root,
  );
}

void boot();

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
    engine = createEngine({ location: () => null });
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

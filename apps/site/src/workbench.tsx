import { render } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import { App } from './ui/App';
// self-hosted fonts (latin only, declared in styles.css): IBM Plex Sans (variable, UI), IBM Plex Mono 400/500/600/400 italic (code),
// Fraunces (variable, display)
import './styles.css';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  let engine: Engine;
  const fixture = import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null;
  try {
    if (import.meta.env.DEV && fixture) {
      // dynamic import inside a DEV-only branch: the fixtures are tree-shaken out of production builds
      const { createFixtureEngine } = await import('./ui/dev/fixtureEngine');
      engine = createFixtureEngine(fixture);
    } else {
      const { createEngine } = await import('./core/engine');
      engine = createEngine();
    }
  } catch (e) {
    renderError(e);
    return;
  }
  if (import.meta.env.DEV) (window as unknown as { __undefined?: Engine }).__undefined = engine; // maintainer hook (recording sessions)
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

function renderError(e: unknown): void {
  render(
    <main class="boot boot-error"><div role="alert">
      <h1 class="wordmark">Undefined</h1>
      <p>
        Startup failed: <code>{errorText(e)}</code>
      </p>
    </div></main>,
    root,
  );
}

void boot();

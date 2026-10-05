/** Entry for index.html: the front door. Boots the engine once (lazily, like src/workbench.tsx) and renders <App/>. */
import { render } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import './tokens.css';
import './base.css';
import './components.css';
import { App, BootError } from './App';
import { installRouter } from './router';
import { legacyWorkbenchHref } from './legacyLinks';

const root = document.getElementById('app')!;

// an old root link with ?opener= / ?recording= belongs to the workbench: go there before booting anything here
const legacy = legacyWorkbenchHref(location.search, location.hash);
if (legacy) location.replace(legacy);

async function boot(): Promise<void> {
  let engine: Engine;
  try {
    const { createEngine } = await import('../core/engine');
    engine = createEngine();
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

if (!legacy) void boot();

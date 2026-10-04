import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from '../types';
import { CodePane } from './components/CodePane';
import { Examples, Header, ModeBanner, RunLiveDialog, Toast } from './components/Chrome';
import { PanelBoundary } from './components/common';
import { GatePanel } from './components/GatePanel';
import { Repl } from './components/Repl';
import { Repo } from './components/Repo';
import { RetryStrip } from './components/RetryStrip';
import { Revisions } from './components/Revisions';
import { focusFn, lowerTab } from './uiState';

export function App({ engine, initError }: { engine: Engine; initError?: string | null }) {
  const state = engine.state.value;
  const [runLive, setRunLive] = useState(false);
  const focusSpec = state.focusSpec;
  const handledNonce = useRef<number | null>(null);

  // "Edit the spec" restart: open the Repo tab; the matching card expands, scrolls into view and focuses its doc
  useEffect(() => {
    if (!focusSpec || handledNonce.current === focusSpec.nonce) return;
    handledNonce.current = focusSpec.nonce;
    lowerTab.value = 'repo';
    focusFn.value = { fn: focusSpec.fn, nonce: focusSpec.nonce };
  }, [focusSpec?.nonce, focusSpec?.fn]);

  if (initError) {
    return (
      <main class="boot boot-error"><div role="alert">
        <h1 class="wordmark">Undefined</h1>
        <p>Startup failed: <code>{initError}</code></p>
        <button type="button" class="btn" onClick={() => location.reload()}>
          Reload
        </button>
      </div></main>
    );
  }
  if (!state.ready) {
    return (
      <main class="boot" aria-busy="true">
        <h1 class="wordmark">
          Undefined<span class="wm-caret" aria-hidden="true" />
        </h1>
        <p class="muted">loading the program and probing the local service…</p>
      </main>
    );
  }

  const tab = lowerTab.value;
  return (
    <>
      <div class="stage">
        <PanelBoundary name="Header">
          <Header state={state} engine={engine} />
          <ModeBanner state={state} onRunLive={() => setRunLive(true)} />
          <Examples state={state} engine={engine} />
        </PanelBoundary>
        <main class="bench" id="main">
          <div class="col col-left">
            <PanelBoundary name="REPL">
              <Repl state={state} engine={engine} />
            </PanelBoundary>
            <PanelBoundary name="Code pane">
              <CodePane state={state} />
            </PanelBoundary>
          </div>
          <div class="col col-right">
            <PanelBoundary name="Gate panel">
              <GatePanel gen={state.generation} />
            </PanelBoundary>
            <PanelBoundary name="Candidates">
              <RetryStrip gen={state.generation} />
            </PanelBoundary>
          </div>
        </main>
      </div>
      <section class="lower" aria-label="Revisions and repository">
        <div class="tabs" role="tablist">
          {(['revisions', 'repo'] as const).map((t) => (
            <button
              type="button"
              key={t}
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`tabpanel-${t}`}
              class={`tab${tab === t ? ' is-active' : ''}`}
              onClick={() => (lowerTab.value = t)}
            >
              {t === 'revisions' ? `Revisions (${state.revisions.length})` : `Repo (${Object.keys(state.program.functions).length})`}
            </button>
          ))}
        </div>
        <div class="tabpanel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          <PanelBoundary name={tab === 'revisions' ? 'Revisions' : 'Repo'}>
            {tab === 'revisions' ? <Revisions state={state} engine={engine} /> : <Repo state={state} engine={engine} />}
          </PanelBoundary>
        </div>
      </section>
      <RunLiveDialog state={state} engine={engine} open={runLive} onClose={() => setRunLive(false)} />
      <Toast state={state} />
    </>
  );
}

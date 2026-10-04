import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine, EngineState } from '../types';
import { CodePane } from './components/CodePane';
import { Examples, Header, RunLiveDialog, Toast } from './components/Chrome';
import { DataDrawer } from './components/DataDrawer';
import { PanelBoundary } from './components/common';
import { GatePanel } from './components/GatePanel';
import { Repl } from './components/Repl';
import { Repo } from './components/Repo';
import { RetryStrip } from './components/RetryStrip';
import { DropOverlay, ImportConfirm, LoadRecordingDialog, OtherTabBanner, RecordingBanner, RecordingConfirm, SessionLogDialog, ShareDialog } from './components/Share';
import { Revisions } from './components/Revisions';
import { focusFn, lowerTab } from './uiState';

/**
 * On a phone the panels are stacked, so the key moments (the rejection card, the commit) would happen off-screen while
 * the REPL stays in view. Follow the action: candidate typing -> gates and verdict -> the result in the REPL.
 * Desktop shows everything at once and is never scrolled by this.
 */
function useFollowTheAction(state: EngineState): void {
  const gen = state.generation;
  const a = gen?.attempts[gen.attempts.length - 1];
  const key = gen && a ? `${gen.id}:${a.attempt}:${a.status}` : null;
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!key || key === last.current || typeof window === 'undefined') return;
    last.current = key;
    if (!window.matchMedia?.('(max-width: 700px)').matches) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = (sel: string) => document.querySelector(sel)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const status = a?.status;
    if (status === 'typing') go('.panel-code');
    else if (status === 'gating' || status === 'rejected' || status === 'accepted') go('.panel-gates');
    if (status === 'accepted') {
      const t = window.setTimeout(() => go('.panel-repl'), 2600); // the payoff line, once the verdict has been read
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [key]);
}

export function App({ engine, initError }: { engine: Engine; initError?: string | null }) {
  const state = engine.state.value;
  const [runLive, setRunLive] = useState(false);
  const focusSpec = state.focusSpec;
  const handledNonce = useRef<number | null>(null);
  useFollowTheAction(state);

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
        <p class="boot-line">Loading your program and looking for the local model service…</p>
      </main>
    );
  }

  const tab = lowerTab.value;
  return (
    <>
      <div class="stage">
        <PanelBoundary name="Header">
          <Header state={state} engine={engine} onRunLive={() => setRunLive(true)} />
          <div class="subhead">
            <Examples state={state} engine={engine} />
          </div>
          <OtherTabBanner state={state} engine={engine} />
          <RecordingBanner state={state} engine={engine} />
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
              <GatePanel gen={state.generation} state={state} engine={engine} />
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
      <PanelBoundary name="Data drawer">
        <DataDrawer state={state} engine={engine} />
      </PanelBoundary>
      <PanelBoundary name="Sharing">
        <ShareDialog engine={engine} />
        <LoadRecordingDialog engine={engine} />
        <RecordingConfirm state={state} engine={engine} />
        <ImportConfirm state={state} engine={engine} />
        <SessionLogDialog state={state} engine={engine} />
        <DropOverlay engine={engine} />
      </PanelBoundary>
      <Toast state={state} />
    </>
  );
}

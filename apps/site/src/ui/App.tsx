import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine, EngineState } from '@scasella/undefined-engine/types';
import { Argument } from './components/Argument';
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
import { focusFn, lowerTab, runLiveOpen } from './uiState';

/**
 * On a phone the panels are stacked, so the key moments (the draft arriving, the rejection card, the commit) would
 * happen off-screen while the console stays in view. Follow the action: draft -> checks -> the verdict card. Never
 * when the reader has scrolled or swiped in the last 4 s, or is typing somewhere other than the console; never back
 * up again afterwards (the accepted headline carries the returned value). Desktop shows everything and is never
 * scrolled by this.
 */
function useFollowTheAction(state: EngineState): void {
  const gen = state.generation;
  const a = gen?.attempts[gen.attempts.length - 1];
  const key = gen && a ? `${gen.id}:${a.attempt}:${a.status}` : null;
  const last = useRef<string | null>(null);
  const userMoved = useRef(0);
  useEffect(() => {
    const mark = () => (userMoved.current = Date.now());
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', ' ', 'ArrowUp', 'ArrowDown'].includes(e.key) && !isTyping(e.target)) mark();
    };
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('touchmove', mark, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', mark);
      window.removeEventListener('touchmove', mark);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    if (!key || key === last.current || typeof window === 'undefined') return;
    last.current = key;
    if (!window.matchMedia?.('(max-width: 700px)').matches) return;
    if (Date.now() - userMoved.current < 4000) return;
    const active = document.activeElement;
    if (active && active.id !== 'repl-input' && isTyping(active)) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = (sel: string) => document.querySelector(sel)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const status = a?.status;
    if (status === 'typing') go('.panel-code');
    else if (status === 'gating') go('.panel-gates');
    // the verdict card itself (it renders in the same commit as the status change)
    // a rejection is often followed at once by the next attempt's 'generating': the card is still what to read
    else if (status === 'rejected' || status === 'accepted' || (status === 'generating' && (a?.attempt ?? 1) > 1)) requestAnimationFrame(() => go(document.querySelector('.panel-gates .headline') ? '.panel-gates .headline' : '.panel-gates'));
  }, [key]);
}

const isTyping = (el: EventTarget | Element | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Keyboard shortcuts outside text fields: 1–4 load an example, / focuses the console, Esc closes an open menu. */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        document.querySelectorAll<HTMLDetailsElement>('details.menu[open], details.keys[open]').forEach((d) => d.removeAttribute('open'));
        return;
      }
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('repl-input')?.focus();
      } else if (/^[1-4]$/.test(e.key)) {
        const chip = document.querySelectorAll<HTMLButtonElement>('button.example')[Number(e.key) - 1];
        if (chip && !chip.disabled) {
          e.preventDefault();
          chip.click();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

export function App({ engine, initError }: { engine: Engine; initError?: string | null }) {
  const state = engine.state.value;
  const focusSpec = state.focusSpec;
  const handledNonce = useRef<number | null>(null);
  useFollowTheAction(state);
  useShortcuts();

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
          <Header state={state} engine={engine} onRunLive={() => (runLiveOpen.value = true)} />
          <Argument />
          <div class="subhead">
            <Examples state={state} engine={engine} />
          </div>
          <OtherTabBanner state={state} engine={engine} />
          <RecordingBanner state={state} engine={engine} />
        </PanelBoundary>
      </div>
      <main id="main" tabIndex={-1}>
        <div class={`bench${state.generation ? ' has-gen' : ''}`}>
          <div class="col col-left">
            <PanelBoundary name="Console">
              <Repl state={state} engine={engine} />
            </PanelBoundary>
            <PanelBoundary name="Draft">
              <CodePane state={state} />
            </PanelBoundary>
          </div>
          <div class="col col-right">
            <PanelBoundary name="Checks">
              <GatePanel gen={state.generation} state={state} engine={engine} />
            </PanelBoundary>
            <PanelBoundary name="Attempts">
              <RetryStrip gen={state.generation} />
            </PanelBoundary>
          </div>
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
                title={t === 'revisions' ? `${state.revisions.length} revisions; the program is at r${state.headRevision}` : undefined}
                onClick={() => (lowerTab.value = t)}
              >
                {t === 'revisions' ? (
                  <>
                    Revisions <span class="tab-rev">· r{state.headRevision}</span>
                  </>
                ) : (
                  `Repo (${Object.keys(state.program.functions).length})`
                )}
              </button>
            ))}
          </div>
          <div class="tabpanel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
            <PanelBoundary name={tab === 'revisions' ? 'Revisions' : 'Repo'}>
              {tab === 'revisions' ? <Revisions state={state} engine={engine} /> : <Repo state={state} engine={engine} />}
            </PanelBoundary>
          </div>
        </section>
      </main>
      <RunLiveDialog state={state} engine={engine} open={runLiveOpen.value} onClose={() => (runLiveOpen.value = false)} />
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

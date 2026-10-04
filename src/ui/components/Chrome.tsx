/** Header, mode banner + "run live" dialog, example row, toast. */
import { useEffect, useRef } from 'preact/hooks';
import type { Engine, EngineState } from '../../types';
import { repoUrlFromPages } from '../format';
import { dataDrawerOpen, dismissedNotice, downloadText, loadRecordingOpen, localNotice, noticeKey, sessionLogOpen, shareOpen, showNotice } from '../uiState';
import { CopyBlock, Ticks } from './common';
import { previewImport } from './Share';

function ModeBadge({ state }: { state: EngineState }) {
  const s = state.service;
  if (state.mode === 'live') {
    return (
      <span class="mode-badge mode-live" title={s.effort ? `reasoning effort: ${s.effort}` : undefined}>
        <span class="dot" aria-hidden="true" />
        Live · {s.model ?? 'model'} via Codex CLI {s.codexVersion ?? (s.state === 'degraded' ? 'unavailable' : '…')}
      </span>
    );
  }
  return (
    <span class="mode-badge mode-replay">
      <span class="dot" aria-hidden="true" />
      Replay · gates live
    </span>
  );
}

function Menu({ state, engine }: { state: EngineState; engine: Engine }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const close = () => menuRef.current?.removeAttribute('open');

  const exportImage = async () => {
    close();
    try {
      downloadText('undefined-image.json', await engine.exportImage());
    } catch (e) {
      showNotice('error', `Export failed: ${(e as Error).message}`);
    }
  };
  const reset = () => {
    close();
    if (confirm('Reset discards every revision and the live state, and reseeds r1. Continue?')) void engine.resetImage();
  };

  return (
    <details class="menu" ref={menuRef}>
      <summary class="btn btn-ghost">Image <span aria-hidden="true">▾</span></summary>
      <div class="menu-pop" role="menu">
        <button type="button" role="menuitem" onClick={exportImage}>
          Export image <span class="muted small">undefined-image.json</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={state.busy}
          onClick={() => {
            close();
            fileRef.current?.click();
          }}
        >
          Import image…
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            shareOpen.value = true;
          }}
        >
          Share this session… <span class="muted small">download, host, link</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={state.busy}
          onClick={() => {
            close();
            loadRecordingOpen.value = true;
          }}
        >
          Load a recording…
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            sessionLogOpen.value = true;
          }}
        >
          Session log (this browser only){' '}
          <span class="muted small">{state.sessionLog?.enabled ? `on · ${state.sessionLog.count}` : 'off'}</span>
        </button>
        <button type="button" role="menuitem" class="danger" disabled={state.busy} onClick={reset}>
          Reset…
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (!file) return;
          let text: string;
          try {
            text = await file.text();
          } catch (err) {
            showNotice('error', `Import failed: ${(err as Error).message}`);
            return;
          }
          // checked first; the confirmation (Share.tsx ImportConfirm) replaces the program only on "Replace"
          await previewImport(engine, text, file.name);
        }}
      />
    </details>
  );
}

export function Header({ state, engine, onRunLive }: { state: EngineState; engine: Engine; onRunLive: () => void }) {
  return (
    <header class="topbar">
      <div class="brand">
        <h1 class="wordmark">
          Undefined<span class="wm-caret" aria-hidden="true" />
        </h1>
        <p class="tagline">The model proposes. Your toolchain decides.</p>
      </div>
      <ModeBanner state={state} onRunLive={onRunLive} />
      <div class="topbar-right">
        {state.mode === 'live' && <ModeBadge state={state} />}
        <span class="rev-chip" title="The current revision of your program">
          r{state.headRevision}
        </span>
        <button
          type="button"
          class="btn btn-ghost data-btn"
          aria-haspopup="dialog"
          aria-expanded={dataDrawerOpen.value}
          onClick={() => (dataDrawerOpen.value = true)}
          title="Paste or drop CSV/JSON and bind it to a REPL variable"
        >
          Data
          {state.datasets.length > 0 && (
            <span class="badge-count" aria-label={`${state.datasets.length} bound`}>
              {state.datasets.length}
            </span>
          )}
        </button>
        <Menu state={state} engine={engine} />
      </div>
    </header>
  );
}

function ServiceStatusView({ state }: { state: EngineState }) {
  const s = state.service;
  const word = { checking: 'checking…', up: 'up', down: 'not reachable', degraded: 'running, but Codex is unusable' }[s.state];
  return (
    <div class={`svc svc-${s.state}`} aria-live="polite">
      <p>
        <span class="label">local service</span> <strong>{word}</strong>
        {s.codexVersion && <span class="muted"> · Codex CLI {s.codexVersion}</span>}
      </p>
      {s.problem && (
        <>
          <p>{s.problem.message}</p>
          {s.problem.fix?.map((f) => <CopyBlock key={f} text={f} />)}
        </>
      )}
      {s.state === 'up' && state.mode === 'replay' && <p class="muted small">The service answers. Reload the page to switch to live mode.</p>}
    </div>
  );
}

export function RunLiveDialog({ state, engine, open, onClose }: { state: EngineState; engine: Engine; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const repo = repoUrlFromPages(location.href);
  return (
    <dialog ref={ref} class="dialog" onClose={onClose} aria-labelledby="runlive-title">
      <h2 id="runlive-title">Run it live</h2>
      <p>
        This page replays drafts a model wrote earlier. The four gates that judge them run live in your browser right now.
        To have the model write new drafts, run the local generation service:
      </p>
      <h3>Prerequisites</h3>
      <ul class="prereq">
        <li>Node 20+</li>
        <li>Codex CLI 0.157 or later</li>
        <li>
          <code>codex login</code> (once)
        </li>
      </ul>
      <h3>Then</h3>
      {/* the explicit target directory makes `cd undefined` work whatever the repository is called */}
      <CopyBlock text={`git clone ${repo ?? '<repo>'} undefined && cd undefined`} />
      <CopyBlock text="npm install" />
      <CopyBlock text="npm run dev" />
      <p class="muted small">Open the URL Vite prints. The generation service runs inside the dev server and calls your local Codex CLI.</p>
      <ServiceStatusView state={state} />
      <div class="form-actions">
        <button type="button" class="btn" disabled={state.service.state === 'checking'} onClick={() => void engine.recheckService()}>
          Check again
        </button>
        <button type="button" class="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

export function ModeBanner({ state, onRunLive }: { state: EngineState; onRunLive: () => void }) {
  if (state.mode !== 'replay') return null;
  return (
    <div class="banner" role="status">
      <span class="banner-icon" aria-hidden="true">
        ⟲
      </span>
      {/* the bundled recordings are a gpt-6-luna session whatever model a local service would use */}
      <p>Replaying a recorded gpt-6-luna session; gates are running live</p>
      <button type="button" class="btn btn-xs" onClick={onRunLive}>
        Run live
      </button>
    </div>
  );
}

export function Examples({ state, engine }: { state: EngineState; engine: Engine }) {
  if (state.examples.length === 0) return null;
  return (
    <nav class="examples" aria-label="Examples">
      <span class="label examples-label">try</span>
      {state.examples.map((ex) => (
        <button
          type="button"
          key={ex.id}
          class="example"
          disabled={state.busy}
          title={ex.blurb}
          onClick={() => {
            // so Enter runs the pre-typed call straight away (focus now, and again once the call is typed in)
            const focus = () => document.getElementById('repl-input')?.focus();
            focus();
            void engine.loadExample(ex.id).then(focus);
          }}
        >
          <span class="example-call">{ex.call}</span>
        </button>
      ))}
    </nav>
  );
}

export function Toast({ state }: { state: EngineState }) {
  const local = localNotice.value;
  const engineNotice = state.notice && noticeKey(state.notice) !== dismissedNotice.value ? state.notice : null;
  const n = local ?? engineNotice;
  if (!n) return null;
  const dismiss = () => {
    if (local) localNotice.value = null;
    else if (state.notice) dismissedNotice.value = noticeKey(state.notice);
  };
  return (
    <div class={`toast toast-${n.tone}`} role={n.tone === 'error' ? 'alert' : 'status'}>
      <p>
        <Ticks text={n.text} />
      </p>
      <button type="button" class="btn btn-ghost btn-xs" onClick={dismiss} aria-label="Dismiss notice">
        ✕
      </button>
    </div>
  );
}

/** Header, mode banner + "run live" dialog, example row, toast. */
import { useEffect, useRef } from 'preact/hooks';
import type { Engine, EngineState } from '@scasella/undefined-engine/types';
import { repoUrlFromPages } from '../format';
import { dataDrawerOpen, dismissedNotice, downloadText, loadRecordingOpen, localNotice, noticeKey, sessionLogOpen, shareOpen, showNotice } from '../uiState';
import { CopyBlock, Ticks } from './common';
import { calledName } from '../select';
import { previewImport } from './Share';

/** The one mode indicator: a pill that opens the "Run it live" dialog. The version lives in its tooltip. */
function ModeBadge({ state, onClick }: { state: EngineState; onClick: () => void }) {
  const s = state.service;
  if (state.mode === 'live') {
    const version = s.codexVersion ?? (s.state === 'degraded' ? 'unavailable' : '…');
    return (
      <button
        type="button"
        class="mode-badge mode-live"
        aria-haspopup="dialog"
        title={`${s.model ?? 'model'} via Codex CLI ${version}${s.effort ? ` · reasoning effort: ${s.effort}` : ''}`}
        onClick={onClick}
      >
        <span class="dot" aria-hidden="true" />
        <span>
          Live<span class="mb-more">{' '}· {s.model ?? 'model'}</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      class="mode-badge mode-replay"
      aria-haspopup="dialog"
      title="Replaying a recorded gpt-6-luna session; the gates run live in your browser. Click to run it live."
      onClick={onClick}
    >
      <span class="dot" aria-hidden="true" />
      <span>
        Replay<span class="mb-more">{' '}· gates run live</span>
      </span>
    </button>
  );
}

/** The one session menu: data, sharing, the image file, the session log, reset. */
function Menu({ state, engine }: { state: EngineState; engine: Engine }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const close = () => menuRef.current?.removeAttribute('open');
  const datasets = state.datasets.length;

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
  const item = (label: string, onClick: () => void, opts: { disabled?: boolean; title?: string; extra?: string; cls?: string } = {}) => (
    <button
      type="button"
      role="menuitem"
      class={opts.cls}
      disabled={opts.disabled}
      title={opts.title}
      onClick={() => {
        close();
        onClick();
      }}
    >
      {label}
      {opts.extra && <span class="menu-extra">{opts.extra}</span>}
    </button>
  );

  return (
    <details class="menu" ref={menuRef}>
      <summary class="btn btn-ghost menu-btn" aria-label={`Session menu${datasets ? ` (${datasets} dataset${datasets === 1 ? '' : 's'} bound)` : ''}`}>
        <span class="menu-word">Session</span>
        <span class="menu-dots" aria-hidden="true">
          ⋯
        </span>
        <span class="menu-caret" aria-hidden="true">
          ▾
        </span>
        {datasets > 0 && <span class="menu-dot" aria-hidden="true" />}
      </summary>
      <div class="menu-pop" role="menu">
        {item('Data…', () => (dataDrawerOpen.value = true), {
          title: 'Paste or drop CSV/JSON and bind it to a console variable',
          extra: datasets ? `${datasets} bound` : undefined,
        })}
        {item('Share…', () => (shareOpen.value = true))}
        {item('Export image', () => void exportImage(), { title: 'Download undefined-image.json: every revision of this program' })}
        {item('Import image…', () => fileRef.current?.click(), { disabled: state.busy })}
        {item('Load recording…', () => (loadRecordingOpen.value = true), { disabled: state.busy })}
        <hr class="menu-sep" role="separator" />
        {item('Session log', () => (sessionLogOpen.value = true), {
          title: 'A log kept in this browser only',
          extra: state.sessionLog?.enabled ? `on · ${state.sessionLog.count}` : 'off',
        })}
        {item('Reset…', reset, { disabled: state.busy, cls: 'danger' })}
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
      <div class="topbar-right">
        <ModeBadge state={state} onClick={onRunLive} />
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

/** A short visible call for an example chip (the full call is its tooltip and what it types in). */
const SHORT_CALL: Record<string, string> = {
  median: 'median([3,1,4,2])',
  slugify: 'slugify("Crème Brûlée")',
  fibonacci: 'fibonacci(90)',
};

export function Examples({ state, engine }: { state: EngineState; engine: Engine }) {
  if (state.examples.length === 0) return null;
  // the example whose function is being written (or is typed in): pressed; the others recede while busy
  const current = state.generation && state.busy ? state.generation.fn : calledName(state.replInput);
  return (
    <nav class={`examples${state.busy ? ' is-busy' : ''}`} aria-label="Examples">
      {state.examples.map((ex) => {
        const pressed = calledName(ex.call) === current;
        return (
          <button
            type="button"
            key={ex.id}
            class={`example${pressed ? ' is-current' : ''}`}
            aria-pressed={pressed}
            disabled={state.busy}
            title={`${ex.call}\n\n${ex.blurb}`}
            onClick={() => {
              // so Enter runs the pre-typed call straight away (focus now, and again once the call is typed in)
              const focus = () => document.getElementById('repl-input')?.focus();
              focus();
              void engine.loadExample(ex.id).then(focus);
            }}
          >
            <span class="example-call">{SHORT_CALL[ex.id] ?? ex.call}</span>
          </button>
        );
      })}
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

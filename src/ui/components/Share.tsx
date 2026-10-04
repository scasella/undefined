/**
 * Sharing a session and loading someone else's: the Share dialog, the Load-a-recording dialog, the confirmation shown
 * before anything is loaded, the full-page drop target, the "replaying a recorded session" banner, and the local
 * session log dialog. Nothing here runs a call: loading only pre-types the first one.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine, EngineState, RecordingPreview } from '../../types';
import {
  classifyDroppedText,
  DROP_TEXT,
  droppedFileProblem,
  functionLine,
  NOTHING_TO_SHARE,
  provenanceLine,
  recordingBannerText,
  recordingSummary,
  SESSION_LOG_FILENAME,
  SESSION_LOG_OFF_NOTE,
  SESSION_LOG_SENTENCE,
  SHARE_FILENAME,
  SHARE_HOST_TEXT,
  SHARE_INCLUDES,
  sessionLogCountText,
  shareLinkFor,
} from '../share';
import { copyText, downloadText, loadRecordingOpen, pendingRecording, sessionLogOpen, shareOpen, showNotice } from '../uiState';

/** A modal <dialog> driven by `open`; Escape / the close button call onClose. */
function Sheet({ open, onClose, labelId, title, children }: { open: boolean; onClose: () => void; labelId: string; title: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="dialog sheet" aria-labelledby={labelId} onClose={onClose}>
      <header class="sheet-head">
        <h2 id={labelId}>{title}</h2>
        <button type="button" class="btn btn-ghost btn-xs sheet-close" onClick={onClose} aria-label={`Close: ${title}`}>
          ✕
        </button>
      </header>
      {open ? children : null}
    </dialog>
  );
}

// ───────────────────────── share ─────────────────────────

export function ShareDialog({ engine }: { engine: Engine }) {
  const open = shareOpen.value;
  const close = () => (shareOpen.value = false);
  return (
    <Sheet open={open} onClose={close} labelId="share-title" title="Share this session">
      <ShareBody engine={engine} />
    </Sheet>
  );
}

function ShareBody({ engine }: { engine: Engine }) {
  // computed once per opening (the dialog body mounts fresh each time), not per keystroke in the URL field
  const [rec] = useState(() => engine.exportRecording());
  const summary = recordingSummary(rec);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const link = shareLinkFor(location.href, pasted);
  const copy = async () => {
    if (!link.ok) return;
    setCopied((await copyText(link.link)) ? 'copied' : 'failed');
    setTimeout(() => setCopied('idle'), 1600);
  };
  return (
    <>
      <p class="muted small">
        Someone who opens your link replays what the model wrote here; the compiler, tests, properties and invariants run
        live in their browser.
      </p>
      <ol class="share-steps">
        <li>
          <h3>Download the recording</h3>
          {rec ? (
            <>
              <p class="small mono share-what">{summary}</p>
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => {
                  downloadText(SHARE_FILENAME, JSON.stringify(rec, null, 2));
                  showNotice('info', `Saved ${SHARE_FILENAME}.`);
                }}
              >
                Download {SHARE_FILENAME}
              </button>
            </>
          ) : (
            <p class="share-nothing">{NOTHING_TO_SHARE}</p>
          )}
          <p class="small">{SHARE_INCLUDES}</p>
        </li>
        <li>
          <h3>Host it</h3>
          <p class="small">{SHARE_HOST_TEXT}</p>
        </li>
        <li>
          <h3>Make the link</h3>
          <label class="field">
            <span class="small">The raw URL of your hosted file</span>
            <input
              class="mono"
              type="url"
              inputMode="url"
              spellcheck={false}
              autocomplete="off"
              placeholder="https://gist.githubusercontent.com/you/…/raw"
              value={pasted}
              onInput={(e) => setPasted(e.currentTarget.value)}
            />
          </label>
          {link.ok ? (
            <div class="linkbox">
              <code class="mono" aria-label="Your share link">
                {link.link}
              </code>
              <button type="button" class="btn" onClick={() => void copy()}>
                {copied === 'copied' ? 'copied ✓' : copied === 'failed' ? 'select & copy' : 'Copy link'}
              </button>
            </div>
          ) : link.error ? (
            <p class="form-error" role="alert">
              {link.error}
            </p>
          ) : (
            <p class="muted small">The link appears here. Nothing is fetched until someone opens it, and they are asked before anything loads.</p>
          )}
        </li>
      </ol>
    </>
  );
}

// ───────────────────────── load ─────────────────────────

/** Preview text or a URL, then hand it to the confirmation dialog (or show the error). */
async function previewAndConfirm(engine: Engine, input: { text?: string; url?: string; source: string }): Promise<string | null> {
  const preview = await engine.previewRecording(input);
  if (!preview.ok) return preview.hint ? `${preview.error} ${preview.hint}` : preview.error;
  pendingRecording.value = { input, preview };
  return null;
}

export function LoadRecordingDialog({ engine }: { engine: Engine }) {
  const open = loadRecordingOpen.value;
  const close = () => (loadRecordingOpen.value = false);
  return (
    <Sheet open={open} onClose={close} labelId="load-title" title="Load a recording">
      <LoadBody engine={engine} onDone={close} />
    </Sheet>
  );
}

function LoadBody({ engine, onDone }: { engine: Engine; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const run = async (input: { text?: string; url?: string; source: string }) => {
    setWorking(true);
    setProblem(null);
    const err = await previewAndConfirm(engine, input);
    setWorking(false);
    if (err) setProblem(err);
    else onDone();
  };
  return (
    <>
      <p class="muted small">
        A recording is a session someone saved with "Share this session". You will see what it holds before anything is
        loaded, and nothing runs until you press Enter.
      </p>
      <h3>From a file</h3>
      <button type="button" class="btn" disabled={working} onClick={() => fileRef.current?.click()}>
        Choose a .json file…
      </button>
      <p class="muted small">Or drop it anywhere on the page.</p>
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
          const bad = droppedFileProblem(file);
          if (bad) return setProblem(bad);
          try {
            await run({ text: await file.text(), source: file.name });
          } catch (err) {
            setProblem(`Could not read ${file.name}: ${(err as Error).message}`);
          }
        }}
      />
      <h3>From a link</h3>
      <form
        class="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void run({ url: url.trim(), source: hostOf(url.trim()) });
        }}
      >
        <label class="field">
          <span class="small">Raw URL of the recording (https)</span>
          <input
            class="mono"
            type="url"
            inputMode="url"
            spellcheck={false}
            autocomplete="off"
            placeholder="https://raw.githubusercontent.com/…/session.json"
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="btn" disabled={working || url.trim() === ''}>
          {working ? 'Fetching…' : 'Fetch'}
        </button>
      </form>
      <p class="muted small">Only the address you type is contacted, once, to read that file.</p>
      {problem && (
        <p class="form-error" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || 'a link';
  } catch {
    return 'a link';
  }
}

/**
 * "Load this recording?" for a picked/dropped/fetched recording (pendingRecording) or the `?recording=` offer
 * (state.recordingOffer). Load / Cancel. A failed `?recording=` fetch shows its error and the CORS hint.
 */
export function RecordingConfirm({ state, engine }: { state: EngineState; engine: Engine }) {
  const local = pendingRecording.value;
  const offer = state.recordingOffer;
  const current = local ?? (offer ? { input: { url: offer.url, source: offer.source }, preview: offer.preview } : null);
  // while the dialog closes, keep its last title (no flash of the failure title)
  const last = useRef(current);
  if (current) last.current = current;
  const [loading, setLoading] = useState(false);
  const close = () => {
    if (local) pendingRecording.value = null;
    else if (offer) engine.dismissRecordingOffer();
  };
  const load = async () => {
    if (!current) return;
    setLoading(true);
    await engine.loadRecording(current.input);
    setLoading(false);
    if (local) pendingRecording.value = null;
    else engine.dismissRecordingOffer();
    document.getElementById('repl-input')?.focus();
  };
  const p = current?.preview;
  const titled = last.current?.preview;
  return (
    <Sheet open={current !== null} onClose={close} labelId="confirm-title" title={!titled || titled.ok ? 'Load this recording?' : 'The recording could not be loaded'}>
      {p && <ConfirmBody preview={p} source={current!.input.source} busy={state.busy || loading} onLoad={() => void load()} onCancel={close} />}
    </Sheet>
  );
}

function ConfirmBody({ preview, source, busy, onLoad, onCancel }: { preview: RecordingPreview; source: string; busy: boolean; onLoad: () => void; onCancel: () => void }) {
  if (!preview.ok) {
    return (
      <>
        <p class="small">From {source}</p>
        <p class="form-error" role="alert">
          {preview.error}
        </p>
        {preview.hint && <p class="small">{preview.hint}</p>}
        <p class="muted small">Nothing was loaded.</p>
        <div class="form-actions">
          <button type="button" class="btn" onClick={onCancel}>
            Close
          </button>
        </div>
      </>
    );
  }
  const shownCalls = preview.calls.slice(0, 6);
  return (
    <>
      <p class="confirm-title mono">{preview.title}</p>
      <p class="small muted">From {preview.source}</p>
      <p class="small">{preview.summary}</p>
      <h3>Functions</h3>
      <ul class="confirm-list">
        {preview.functions.map((f) => (
          <li key={f.name} class={`mono small${f.status === 'replaces' ? ' warn-line' : ''}`}>
            {functionLine(f)}
          </li>
        ))}
      </ul>
      <h3>
        {preview.calls.length} {preview.calls.length === 1 ? 'call' : 'calls'}
      </h3>
      {shownCalls.length > 0 ? (
        <ul class="confirm-list">
          {shownCalls.map((c, i) => (
            <li key={i} class="mono small confirm-call">
              {c}
            </li>
          ))}
          {preview.calls.length > shownCalls.length && <li class="muted small">… and {preview.calls.length - shownCalls.length} more</li>}
        </ul>
      ) : (
        <p class="muted small">The recording lists no calls; type one yourself.</p>
      )}
      {preview.datasets.length > 0 && (
        <>
          <h3>Datasets</h3>
          <ul class="confirm-list">
            {preview.datasets.map((d) => (
              <li key={d.name} class="mono small">
                {d.name} · {d.rows} rows × {d.columns} columns
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Recorded with</h3>
      <p class="small mono">{provenanceLine(preview)}</p>
      {preview.skipped.length > 0 && (
        <>
          <h3>Not loaded</h3>
          <ul class="confirm-list">
            {preview.skipped.map((s, i) => (
              <li key={i} class="small">
                {s}
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="confirm-warning" role="note">
        {preview.warning}
      </p>
      {preview.blocked && (
        <p class="form-error" role="alert">
          {preview.blocked}
        </p>
      )}
      <p class="muted small">Loading adds the specs as one revision and types the first call in. Nothing runs until you press Enter.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" disabled={busy || !!preview.blocked} onClick={onLoad}>
          Load
        </button>
        <button type="button" class="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

// ───────────────────────── drop anywhere ─────────────────────────

const anyDialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;
const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Full-page drop target for a recording or an exported program image (only while no dialog is open). */
export function DropOverlay({ engine }: { engine: Engine }) {
  const [shown, setShown] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || anyDialogOpen()) return;
      depth.current++;
      setShown(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e) || depth.current === 0) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setShown(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || anyDialogOpen()) return;
      e.preventDefault(); // allow the drop (and stop the browser from opening the file)
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setShown(false);
      if (!hasFiles(e) || anyDialogOpen()) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) void handleDroppedFile(engine, file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [engine]);
  if (!shown) return null;
  return (
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-overlay-box">
        <p class="mono">{DROP_TEXT}</p>
        <p class="small muted">a .json recording (asks before loading) or an exported program image (imports it)</p>
      </div>
    </div>
  );
}

async function handleDroppedFile(engine: Engine, file: File): Promise<void> {
  const bad = droppedFileProblem(file);
  if (bad) return showNotice('error', bad);
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return showNotice('error', `Could not read ${file.name}: ${(e as Error).message}`);
  }
  const what = classifyDroppedText(text, file.name);
  if (what.kind === 'image') {
    // the program image path, exactly as Image → Import
    try {
      await engine.importImage(text);
    } catch (e) {
      showNotice('error', `Import failed: ${(e as Error).message}`);
    }
    return;
  }
  if (what.kind === 'other') return showNotice('error', what.error);
  const err = await previewAndConfirm(engine, { text, source: file.name });
  if (err) showNotice('error', `${file.name}: ${err}`);
}

// ───────────────────────── banner ─────────────────────────

export function RecordingBanner({ state, engine }: { state: EngineState; engine: Engine }) {
  const lr = state.loadedRecording;
  if (!lr || lr.dismissed) return null;
  return (
    <div class="banner banner-recording" role="status">
      <span class="banner-icon" aria-hidden="true">
        ⇣
      </span>
      <p>{recordingBannerText(lr)}</p>
      <button type="button" class="btn btn-ghost btn-xs banner-close" onClick={() => engine.dismissRecordingBanner()} aria-label="Dismiss the recording banner">
        ✕
      </button>
    </div>
  );
}

// ───────────────────────── session log ─────────────────────────

export function SessionLogDialog({ state, engine }: { state: EngineState; engine: Engine }) {
  const open = sessionLogOpen.value;
  const close = () => (sessionLogOpen.value = false);
  const log = state.sessionLog ?? { enabled: false, count: 0, status: 'memory' as const };
  const [working, setWorking] = useState(false);
  // the engine applies the switch asynchronously: show the click at once, not a flicker back
  const [pendingOn, setPendingOn] = useState<boolean | null>(null);
  const exportLog = async () => {
    try {
      downloadText(SESSION_LOG_FILENAME, await engine.exportSessionLog());
    } catch (e) {
      showNotice('error', `Export failed: ${(e as Error).message}`);
    }
  };
  const clear = async () => {
    if (!confirm(`Delete all ${log.count} session log ${log.count === 1 ? 'entry' : 'entries'} from this browser?`)) return;
    setWorking(true);
    await engine.clearSessionLog();
    setWorking(false);
  };
  return (
    <Sheet open={open} onClose={close} labelId="slog-title" title="Session log (this browser only)">
      <label class="send-toggle slog-toggle">
        <input
          type="checkbox"
          checked={pendingOn ?? log.enabled}
          disabled={working}
          onChange={async (e) => {
            const on = e.currentTarget.checked;
            setPendingOn(on);
            setWorking(true);
            await engine.setSessionLogEnabled(on);
            setWorking(false);
            setPendingOn(null);
          }}
        />
        <span>Keep a session log</span>
      </label>
      <p class="small">{SESSION_LOG_SENTENCE}</p>
      <p class="small muted">It never holds the prompts sent to the model or the rows of your data: inputs, outcome kinds, which gate decided and its headline, declines, commits, pins, rollbacks, spec edits, dataset names and sizes, errors.</p>
      <p class="mono small slog-count" aria-live="polite">
        {sessionLogCountText(log)}
        {log.enabled ? '' : ' · off'}
      </p>
      {!log.enabled && log.count > 0 && <p class="small muted">{SESSION_LOG_OFF_NOTE}</p>}
      <div class="form-actions">
        <button type="button" class="btn" disabled={log.count === 0} onClick={() => void exportLog()}>
          Export log <span class="muted small">{SESSION_LOG_FILENAME}</span>
        </button>
        <button type="button" class="btn btn-warn" disabled={log.count === 0 || working} onClick={() => void clear()}>
          Clear
        </button>
      </div>
    </Sheet>
  );
}

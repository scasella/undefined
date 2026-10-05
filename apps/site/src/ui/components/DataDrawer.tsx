/**
 * The data drawer: paste or drop CSV/JSON, preview it (parsed by the engine, never sent anywhere), see exactly what
 * would leave the browser, and bind it to a REPL variable. Files are read with File.text() in the browser only.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DatasetPreview, Engine, EngineState } from '@scasella/undefined-engine/types';
import { DATA_FILE_ACCEPT, dataFileProblem, datasetLine, formatBytes, formatCount, sendCopy, variableName } from '../data';
import { dataDrawerOpen } from '../uiState';
import { DataTable } from './DataTable';

const PREVIEW_DEBOUNCE_MS = 250;

function Preview({ preview }: { preview: DatasetPreview }) {
  if (!preview.ok) {
    return (
      <p class="form-error" role="alert">
        {preview.error}
      </p>
    );
  }
  return (
    <div class="data-preview-body">
      <p class="data-stats mono">
        {formatCount(preview.rowCount)} rows · {preview.columns.length} columns · {formatBytes(preview.bytes)}
      </p>
      <ul class="data-cols" aria-label="Columns and their types">
        {preview.columns.map((c) => (
          <li key={c.name} class="mono">
            {c.name}: <span class="muted">{c.type}</span>
          </li>
        ))}
      </ul>
      <p class="data-label">Declared type</p>
      <pre class="code small data-type">
        <code>{preview.typeDecl}</code>
      </pre>
      <DataTable table={preview.table} label={`First rows of ${preview.name}`} compact />
      {preview.warnings.length > 0 && (
        <ul class="data-warnings" aria-label="Warnings">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SendBox({ state, engine, preview }: { state: EngineState; engine: Engine; preview: DatasetPreview | null }) {
  const copy = sendCopy(state.mode, state.send.samples, state.send.sampleRows);
  return (
    <section class="send-box" aria-labelledby="send-title">
      <h3 id="send-title">What leaves your browser</h3>
      {copy.toggle && (
        <label class="send-toggle">
          <input type="checkbox" checked={state.send.samples} onChange={(e) => engine.setSendSamples(e.currentTarget.checked)} />
          <span>{copy.toggle}</span>
        </label>
      )}
      <p>{copy.line}</p>
      {state.mode === 'live' && preview?.ok && (
        <>
          {state.send.samples ? (
            <pre class="code small send-sample" aria-label="Exactly the sample rows that would be sent">
              <code>{preview.sampleText}</code>
            </pre>
          ) : null}
          <p class="muted small">{preview.sendDescription}</p>
        </>
      )}
    </section>
  );
}

export function DataDrawer({ state, engine }: { state: EngineState; engine: Engine }) {
  const open = dataDrawerOpen.value;
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [filename, setFilename] = useState<string | undefined>(undefined);
  const [name, setName] = useState('rows');
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // live preview, debounced; a stale answer (older input) is dropped
  useEffect(() => {
    const my = ++seq.current;
    if (text.trim() === '') {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      void engine.previewDataset({ text, name: variableName(name), ...(filename ? { filename } : {}) }).then((p) => {
        if (seq.current === my) setPreview(p);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, name, filename, state.send.samples]);

  const readFile = async (file: File) => {
    const bad = dataFileProblem(file);
    if (bad) {
      setProblem(bad);
      return;
    }
    setProblem(null);
    setLoaded(null);
    try {
      setText(await file.text());
      setFilename(file.name);
    } catch (e) {
      setProblem(`Could not read ${file.name}: ${(e as Error).message}`);
    }
  };

  const load = async () => {
    if (!preview?.ok) return;
    const before = state.headRevision;
    setLoading(true);
    setProblem(null);
    await engine.loadDataset({ text, name: variableName(name), ...(filename ? { filename, source: 'file' as const } : { source: 'paste' as const }) });
    setLoading(false);
    const after = engine.state.value;
    const last = after.revisions[after.revisions.length - 1];
    if (after.headRevision > before && last?.kind === 'dataset') {
      setLoaded(`${variableName(name)} is bound (r${after.headRevision}). Call a function on it in the console.`);
      setText('');
      setFilename(undefined);
      setPreview(null);
    } else if (after.notice?.tone === 'error') {
      setProblem(after.notice.text);
    }
  };

  const close = () => (dataDrawerOpen.value = false);

  return (
    <dialog ref={ref} class="drawer" aria-labelledby="data-title" onClose={close}>
      <header class="drawer-head">
        <h2 id="data-title">Data</h2>
        <button type="button" class="btn btn-ghost btn-xs" onClick={close} aria-label="Close the data drawer">
          ✕
        </button>
      </header>
      <p class="muted small drawer-intro">
        Paste CSV, TSV, JSON or JSON Lines, or drop a file. It is parsed here in your browser and bound to a console variable;
        then call a function on it, e.g. <code class="tick">topCustomersByRevenue({variableName(name)})</code>.
      </p>

      {state.datasets.length > 0 && (
        <section class="bound" aria-labelledby="bound-title">
          <h3 id="bound-title">Bound now</h3>
          <ul>
            {state.datasets.map((d) => (
              <li key={d.name}>
                <span class="mono">{datasetLine(d)}</span>
                {d.filename && <span class="muted small"> · {d.filename}</span>}
                <button type="button" class="btn btn-ghost btn-xs" disabled={state.busy} onClick={() => void engine.removeDataset(d.name)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div
        class={`drop${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) void readFile(f);
        }}
      >
        <label for="data-text" class="data-label">
          Paste data {filename && <span class="muted">· from {filename}</span>}
        </label>
        <textarea
          id="data-text"
          class="mono"
          rows={6}
          spellcheck={false}
          value={text}
          placeholder={'customer,amount,status\nAda,10,paid\n…'}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setFilename(undefined);
            setLoaded(null);
          }}
        />
        <p class="drop-hint muted small">
          Drop a .csv, .tsv, .json or .jsonl file here, or{' '}
          <button type="button" class="btn btn-ghost btn-xs" onClick={() => fileRef.current?.click()}>
            choose a file…
          </button>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept={DATA_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            const f = input.files?.[0];
            input.value = '';
            if (f) void readFile(f);
          }}
        />
      </div>

      <label class="data-name">
        Variable name
        <input class="mono" value={name} spellcheck={false} autocomplete="off" onInput={(e) => setName(e.currentTarget.value)} />
      </label>

      <section class="data-preview" aria-live="polite" aria-label="Preview">
        {preview ? <Preview preview={preview} /> : <p class="muted small">The preview appears here as you paste.</p>}
      </section>

      <SendBox state={state} engine={engine} preview={preview} />

      <div class="form-actions">
        <button type="button" class="btn btn-primary" disabled={!preview?.ok || loading || state.busy} onClick={() => void load()}>
          {loading ? 'Loading…' : `Load as ${variableName(name)}`}
        </button>
        {loaded && <span class="ok-line small">{loaded}</span>}
      </div>
      {problem && (
        <p class="form-error" role="alert">
          {problem}
        </p>
      )}
    </dialog>
  );
}

/**
 * The data drawer: paste or drop CSV/JSON, preview it (parsed by the engine, never sent anywhere), see exactly what
 * would leave the browser, and bind it to a REPL variable. Files are read with File.text() in the browser only.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DatasetPreview, Engine, EngineState } from '@scasella/undefined-engine/types';
import { DATA_FILE_ACCEPT, datasetLine, datasetNameFromFile, delimiterHint, formatBytes, formatCount, sendCopy, variableName } from '../data';
import { dataDrawerOpen, dataFilename, dataName, dataProblem, dataSuggestions, dataText, runLiveOpen } from '../uiState';
import { DataTable } from './DataTable';
import { multiDropProblem } from '../share';
import { openDataFile, takenNames } from './DataStart';

const PREVIEW_DEBOUNCE_MS = 250;

function Preview({ preview, hint }: { preview: DatasetPreview; hint: string | null }) {
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
      {(preview.warnings.length > 0 || hint) && (
        <ul class="data-warnings" aria-label="Warnings">
          {hint && <li>{hint}</li>}
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
  // the draft lives in uiState so a drop anywhere (or the first screen's buttons) opens this drawer pre-filled
  const text = dataText.value;
  const filename = dataFilename.value;
  const name = dataName.value;
  const problem = dataProblem.value;
  const setText = (v: string) => (dataText.value = v);
  const setFilename = (v: string | undefined) => (dataFilename.value = v);
  const setName = (v: string) => (dataName.value = v);
  const setProblem = (v: string | null) => (dataProblem.value = v);
  // the name used when the field is left empty: from the file, or a free default; never `rows`
  const fallbackName = datasetNameFromFile(filename, takenNames(state));
  const varName = variableName(name, fallbackName);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // opened to paste (no draft yet): the cursor goes where the data goes, not to the close button
      if (dataText.value === '' && !dataProblem.value) d.querySelector<HTMLTextAreaElement>('#data-text')?.focus();
    }
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
      void engine.previewDataset({ text, name: varName, ...(filename ? { filename } : {}) }).then((p) => {
        if (seq.current === my) setPreview(p);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, varName, filename, state.send.samples]);

  const readFile = async (file: File) => {
    setLoaded(null);
    await openDataFile(file, state);
  };

  const load = async () => {
    if (!preview?.ok) return;
    const before = state.headRevision;
    setLoading(true);
    setProblem(null);
    const bound = varName;
    const suggestions = preview.suggestions ?? [];
    await engine.loadDataset({ text, name: bound, ...(filename ? { filename, source: 'file' as const } : { source: 'paste' as const }) });
    setLoading(false);
    const after = engine.state.value;
    const last = after.revisions[after.revisions.length - 1];
    if (after.headRevision > before && last?.kind === 'dataset') {
      setText('');
      setFilename(undefined);
      setName('');
      setPreview(null);
      dataSuggestions.value = { dataset: bound, list: suggestions };
      if (suggestions.length > 0) {
        // the suggested calls sit under the examples: close the drawer and put the reader on the first one
        close();
        // (the chips render a frame or two later, and closing the dialog restores focus first: retry until it holds)
        let tries = 0;
        const focusChip = () => {
          const chip = document.querySelector<HTMLButtonElement>('.suggest-chip');
          chip?.focus();
          if ((!chip || document.activeElement !== chip) && ++tries < 10) requestAnimationFrame(focusChip);
        };
        requestAnimationFrame(focusChip);
      } else {
        setLoaded(`${bound} is bound (r${after.headRevision}). Call a function on it in the console.`);
      }
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
        then call a function on it, e.g. <code class="tick">{preview?.ok && preview.suggestions?.[0] ? preview.suggestions[0].call : `countByStatus(${varName})`}</code>.
      </p>
      {state.mode === 'replay' && (
        <p class="small replay-data-note">
          This page replays recorded drafts, so writing a new function for your data needs live mode. The preview, the
          checks and functions that already exist run here.{' '}
          <button type="button" class="btn btn-ghost btn-xs" onClick={() => (runLiveOpen.value = true)}>
            How to run live
          </button>
        </p>
      )}

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
          const files = e.dataTransfer?.files;
          const many = multiDropProblem(files?.length ?? 0);
          if (many) return setProblem(many);
          const f = files?.[0];
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
            setProblem(null);
            setLoaded(null);
          }}
        />
        <p class="drop-hint muted small">
          <span class="df-pointer">Drop a .csv, .tsv, .json or .jsonl file here, or </span>
          <span class="df-touch">A .csv, .tsv, .json or .jsonl file: </span>
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
        <input class="mono" value={name} placeholder={fallbackName} spellcheck={false} autocomplete="off" onInput={(e) => setName(e.currentTarget.value)} />
      </label>

      <section class="data-preview" aria-live="polite" aria-label="Preview">
        {preview ? (
          <Preview preview={preview} hint={preview.ok ? delimiterHint(text, preview.columns.length) : null} />
        ) : (
          <p class="muted small">The preview appears here as you paste.</p>
        )}
      </section>

      <SendBox state={state} engine={engine} preview={preview} />

      <div class="form-actions">
        <button type="button" class="btn btn-primary" disabled={!preview?.ok || loading || state.busy} onClick={() => void load()}>
          {loading ? 'Loading…' : `Load as ${varName}`}
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

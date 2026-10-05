/**
 * The first screen's way in for the user's own data: a quiet "Use your data…" (a real button opening the file picker)
 * and "Paste data…" (the data drawer, empty). A picked or dropped file opens the drawer pre-filled; the drawer is the
 * single preview and the single place that says what leaves the browser. After a Load, DataSuggestions offers two or
 * three calls on the new dataset that pre-type into the console (never class "example": keys 1–4 load examples).
 */
import { useRef } from 'preact/hooks';
import type { Engine, EngineState } from '@scasella/undefined-engine/types';
import { CopyBlock } from './common';
import { binaryProblem, DATA_FILE_ACCEPT, dataFileProblem, datasetNameFromFile, freshSuggestions, suggestionTitle } from '../data';
import { recordingNotData } from '../share';
import { dataDrawerOpen, dataFilename, dataName, dataProblem, dataSuggestions, dataText } from '../uiState';

/** Names a new dataset must not take: the program's functions, the datasets bound now and the console's variables. */
export function takenNames(state: EngineState): string[] {
  return [...Object.keys(state.program.functions), ...state.datasets.map((d) => d.name), ...Object.keys(state.env ?? {})];
}

/** Open the data drawer (empty draft: the name defaults to one that is free). */
export function openDataDrawer(state: EngineState): void {
  if (dataText.value === '' && dataName.value === '') dataName.value = datasetNameFromFile(undefined, takenNames(state));
  dataDrawerOpen.value = true;
}

/**
 * Read a picked or dropped file into the drawer's draft and open the drawer. A file that is not data (wrong type, too
 * large, binary, empty) opens it with the reason instead, so pasting is one step away. Nothing is stored here.
 */
export async function openDataFile(file: File, state: EngineState): Promise<void> {
  // a file that cannot be used leaves any draft already in the drawer as it was (pasted text is not thrown away)
  const fail = (why: string) => {
    dataProblem.value = why;
    dataDrawerOpen.value = true;
  };
  const bad = dataFileProblem(file);
  if (bad) return fail(bad);
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return fail(`Could not read ${file.name}: ${(e as Error).message}`);
  }
  const binary = binaryProblem(file.name, text);
  if (binary) return fail(binary);
  // the drawer's own drop target reaches here unclassified: a recording or program image is not data
  const notData = /\.json$/i.test(file.name) ? recordingNotData(text, file.name) : null;
  if (notData) return fail(notData);
  if (text.trim() === '') return fail(`${file.name} is empty. Nothing to load.`);
  dataProblem.value = null;
  dataText.value = text;
  dataFilename.value = file.name;
  dataName.value = datasetNameFromFile(file.name, takenNames(state));
  dataDrawerOpen.value = true;
}

/** The hidden file input behind a "choose a file" button (a real <button> opens it). */
function DataFileInput({ state, inputRef }: { state: EngineState; inputRef: { current: HTMLInputElement | null } }) {
  return (
    <input
      ref={inputRef}
      class="data-start-input"
      type="file"
      accept={DATA_FILE_ACCEPT}
      hidden
      aria-label="Choose a data file"
      onChange={(e) => {
        const input = e.currentTarget;
        const f = input.files?.[0];
        input.value = '';
        if (f) void openDataFile(f, state);
      }}
    />
  );
}

const FILE_TITLE = 'Choose a CSV, TSV, JSON or JSON Lines file; you see a preview before anything is loaded';

export function DataStart({ state }: { state: EngineState }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div class="data-start">
      <button type="button" class="btn data-start-file" title={FILE_TITLE} onClick={() => fileRef.current?.click()}>
        Use your data…
      </button>
      <button type="button" class="btn btn-ghost data-start-paste" onClick={() => openDataDrawer(state)}>
        Paste data…
      </button>
      <DataFileInput state={state} inputRef={fileRef} />
    </div>
  );
}

/**
 * The data-first opening (state.start === 'data': live mode, a fresh browser): the drop card is the primary action,
 * the examples sit under it. A file dropped anywhere on the page goes through the page-wide DropOverlay to the same
 * drawer, so the card has no drop handler of its own. When the service is up but Codex is unusable (degraded), the
 * fix is shown here, where the reader is about to act. Once something is typed or loaded the card recedes (one primary
 * action per state: the chips or the Run button take over).
 */
export function DataFirst({ state, engine }: { state: EngineState; engine: Engine }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const quiet = state.replInput.trim() !== '' || state.datasets.length > 0 || state.generation !== null;
  const problem = state.service.state === 'degraded' ? state.service.problem : undefined;
  return (
    <section class={`data-first${quiet ? ' is-quiet' : ''}`} aria-labelledby="data-first-title">
      <h2 id="data-first-title" class="data-first-title">
        <span class="df-pointer">Drop a CSV or JSON file, or paste data</span>
        <span class="df-touch">Choose a CSV or JSON file, or paste data</span>
      </h2>
      <p class="data-first-note">You see a preview first; nothing is stored until you press Load.</p>
      <div class="data-first-actions">
        <button
          type="button"
          class={`btn data-first-file${quiet ? '' : ' btn-primary'}`}
          title={FILE_TITLE}
          onClick={() => fileRef.current?.click()}
        >
          Choose a file…
        </button>
        <button type="button" class="btn data-first-paste" onClick={() => openDataDrawer(state)}>
          Paste data…
        </button>
        <DataFileInput state={state} inputRef={fileRef} />
      </div>
      {problem && (
        <div class="data-first-problem">
          <p>
            <strong>Writing needs one fix first.</strong> {problem.message}
          </p>
          {problem.fix?.map((f) => <CopyBlock key={f} text={f} />)}
          <p class="muted small">Loading and previewing data works now; fix this, then call a function on it.</p>
        </div>
      )}
      <p class="data-first-switch">
        <button type="button" class="linkish" onClick={() => startWithExamples(engine)}>
          Start with examples
        </button>
      </p>
    </section>
  );
}

/**
 * Switch the first screen to examples. The link that was pressed goes away with the card, so focus moves to the
 * console (now holding the median call), as on the examples layout's first load; otherwise it would fall to <body>.
 */
export function startWithExamples(engine: Engine): void {
  engine.setStart('examples');
  requestAnimationFrame(() => document.getElementById('repl-input')?.focus());
}

/** "Try on sales:" and two or three calls of functions that do not exist yet, each pre-typed on click. */
export function DataSuggestions({ state, engine }: { state: EngineState; engine: Engine }) {
  const sug = dataSuggestions.value;
  if (!sug || !state.datasets.some((d) => d.name === sug.dataset)) return null;
  const list = freshSuggestions(sug.list, state.program.functions);
  if (list.length === 0) return null;
  return (
    <nav class="suggest-row" aria-label={`Calls to try on ${sug.dataset}`}>
      <span class="suggest-label">
        Try on <code class="tick">{sug.dataset}</code>
      </span>
      {list.map((s) => (
        <button
          type="button"
          key={s.fn}
          class="suggest-chip"
          disabled={state.busy}
          title={suggestionTitle(s, state.mode)}
          onClick={() => {
            engine.setInput(s.call);
            document.getElementById('repl-input')?.focus();
          }}
        >
          <span class="example-call">{s.call}</span>
        </button>
      ))}
    </nav>
  );
}

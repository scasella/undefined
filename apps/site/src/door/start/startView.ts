/**
 * Pure view-models for the top of `#/start` (Intro, DataBringer, ColumnPreview): the title, the "How it works" steps, the
 * column preview table, the replay note and the sample radiogroup's arrow keys. No DOM, no engine calls.
 */
import type { DatasetRef } from '@scasella/undefined-engine/types';
import { columnNote } from '../model/columnNotes';
import type { DataRow } from '../model/figures';
import { formatCount } from '../model/figures';
import { describeColumns, previewCellsFor, sampleFile, type ColumnKind, type SampleId } from '../model/samples';

// ───────────── Intro: how it works ─────────────

export interface IntroStep {
  n: string;
  text: string;
}

export const INTRO_EYEBROW = 'START HERE · BRING A FILE, ASK IN PLAIN WORDS';

/**
 * The page's h1: the task, in plain words. It promises nothing about what this copy can answer (the public demo plays
 * back one recorded answer, with basic checks; the rest needs the version on your computer), and it does not repeat
 * the landing's claim, which the page above it already made.
 */
export const INTRO_TITLE = 'Ask a question about a file';

export function introSteps(): IntroStep[] {
  return [
    { n: '1', text: 'Bring a file. It stays in this browser.' },
    { n: '2', text: 'Ask in plain words.' },
    { n: '3', text: "Your rules check the AI's work before you see it." },
  ];
}

// ───────────── DataBringer ─────────────

/**
 * The sample the viewer last picked is remembered in this browser (a per-viewer convenience: the engine image keeps
 * both samples bound but not which one was chosen), so a reload comes back to it. Anything else → orders.csv.
 */
export const SAMPLE_KEY = 'fd-start-sample';
export function rememberedSample(raw: string | null | undefined): SampleId {
  return raw === 'sales' ? 'sales' : 'orders';
}

export const ACCEPT = '.csv,.tsv,.json,.jsonl,.ndjson,.txt';

/**
 * The one sample file the demo has recorded answers for (and only for some of its questions). The pre-bind caveat and the two
 * notes that follow it all name it from here, so none of them sends the viewer to "a sample file" in general: sales-q3.csv, the
 * other sample, has no recorded answer at all. Typed once, on purpose: reading model/samples.ts here would build (parse and type)
 * the sample at import time; start/ownFileCaveat.test.ts ties this name to sampleFile('orders').filename.
 */
const RECORDED_SAMPLE_FILE = 'orders.csv';

/**
 * What the demo can and cannot do with a file of your own, said under the drop zone BEFORE anything is dropped (Step by
 * step's picker and the Full view's DataBringer both draw this one string, in the demo only: ownFileCaveat). It agrees
 * with the legend on the question pane ("needs live: this demo has recorded answers for one question; the others need
 * the version on your computer", start/AskCard.tsx needsLiveLegend): the recordings are for questions about orders.csv, and
 * only for some of them; sales-q3.csv, the other sample, has none, so this does not say "the sample files".
 */
export const DEMO_OWN_FILE_CAVEAT = `In this demo, only some questions about the sample file ${RECORDED_SAMPLE_FILE} have recorded answers. Your own file loads and previews here; asking about it needs the version on your computer.`;

/** The caveat, in the demo; null on a copy that already runs on your computer (nothing new is drawn there). */
export function ownFileCaveat(mode: 'live' | 'replay'): string | null {
  return mode === 'replay' ? DEMO_OWN_FILE_CAVEAT : null;
}

/**
 * Whether Step by step's picker draws the own-file note's status region (a region that exists, empty, before it has words, so
 * what changes is spoken). The demo only: a copy that runs on your computer draws nothing new.
 */
export function ownFileRegion(mode: 'live' | 'replay'): boolean {
  return mode === 'replay';
}

/**
 * Said once the viewer's own data is bound (the caveat above stays; this says what to do next, and that the file stays put).
 * They do not repeat the caveat: it is the caveat that says what the demo cannot answer. They name the sample that CAN run
 * checks, because the sample buttons sit right under the note and one of them (sales-q3.csv) has no recorded answer.
 */
export const DROP_NOTE = `Your file stays in this browser. To see the checks run, try ${RECORDED_SAMPLE_FILE}.`;
export const PASTE_NOTE = `Read in this browser. To see the checks run, try ${RECORDED_SAMPLE_FILE}.`;

/**
 * The file name the session gives data that was pasted rather than dropped (start/session.ts `PASTED`, which is not exported;
 * start/ownFileCaveat.test.ts reads the session's source and fails if the two drift).
 */
export const PASTED_NAME = 'pasted data';

/** The note under Step by step's drop zone for your own data: pasted rows were "read" here, a dropped file "stays" here. */
export function ownFileNote(fileName: string): string {
  return fileName === PASTED_NAME ? PASTE_NOTE : DROP_NOTE;
}

/** The replay note shows only once the user's own data is bound and the page replays recorded answers. */
export function showOwnFileNote(source: 'sample' | 'own' | 'none', mode: 'live' | 'replay'): boolean {
  return source === 'own' && mode === 'replay';
}

/**
 * Whether the bring-a-file picker is folded behind the bound file's chip, and what the chip's button says. Once something is
 * bound the picker folds away, unless it was opened ("Change") or what it holds is what the viewer needs: the demo's own-file
 * note (the sample buttons stay in sight) or a refusal. Then "Change" does not close anything, it moves in (the page moves
 * focus into the picker), and says so (`expanded`).
 *
 * The Full view (DataBringer) applies it as is. Step by step goes through zenPickerFold, which keeps the refusal clause to the
 * demo: a copy that runs on your computer folds that picker exactly as it always did.
 */
export interface PickerFold {
  /** The picker is out of sight. */
  folded: boolean;
  /** It stays open whatever the viewer pressed: the own-file note or a refusal is showing. */
  forced: boolean;
  /** The chip button's words: "Change" while the picker is folded or cannot be closed, "Close" while it is open by choice. */
  button: 'Change' | 'Close';
  /** aria-expanded of that button: the picker is on screen. */
  expanded: boolean;
}

export function pickerFold(s: { bound: boolean; open: boolean; ownNote: boolean; problem: boolean }): PickerFold {
  const forced = s.ownNote || s.problem;
  const folded = s.bound && !s.open && !forced;
  return { folded, forced, button: folded || forced ? 'Change' : 'Close', expanded: !folded };
}

/**
 * Step by step's picker: pickerFold with the demo's two reasons to stay open, both for the demo only. In live mode the own-file
 * note is never drawn (showOwnFileNote) and a refusal does not hold the picker either: it folds behind the chip, "Close" shuts
 * it, exactly as before this path existed (a refusal still shows under the chip, in both modes).
 */
export function zenPickerFold(s: {
  bound: boolean;
  open: boolean;
  source: 'sample' | 'own' | 'none';
  mode: 'live' | 'replay';
  problem: boolean;
}): PickerFold {
  return pickerFold({ bound: s.bound, open: s.open, ownNote: showOwnFileNote(s.source, s.mode), problem: s.mode === 'replay' && s.problem });
}

/**
 * What a screen reader is told when data is bound ("<file> is ready."). The demo cannot answer questions about the viewer's
 * own file, so for that file "ready" would promise too much: it is loaded.
 */
export function boundAnnouncement(chip: string | null, ownNote: boolean): string {
  return `${chip ?? 'Your data'} ${ownNote ? 'is loaded' : 'is ready'}.`;
}

/** Roving radiogroup: the index arrow keys / Home / End move to, or -1 for any other key. */
export function radioKeyIndex(key: string, current: number, count: number): number {
  if (count <= 0) return -1;
  const i = current < 0 ? 0 : current;
  if (key === 'ArrowDown' || key === 'ArrowRight') return current < 0 ? 0 : (i + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return current < 0 ? count - 1 : (i - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

// ───────────── ColumnPreview ─────────────

export interface PreviewColumn {
  name: string;
  type: ColumnKind;
  /** Numbers right-aligned, as the design does. */
  right: boolean;
}

export interface PreviewModel {
  /** `orders.csv · 332 rows · first 3 shown · types worked out from the values` */
  caption: string;
  /** `First 3 rows of orders.csv` (sr-only table caption) */
  srCaption: string;
  columns: PreviewColumn[];
  cells: string[][];
  /** Columns read as Text that look like numbers or dates (model/columnNotes.ts), in one plain sentence; null when none. */
  note: string | null;
}

export interface PreviewInput {
  sampleId: SampleId | null;
  dataset: Pick<DatasetRef, 'columns' | 'rowCount' | 'filename' | 'name'> | null;
  rows: readonly DataRow[] | null;
  fileName: string;
}

const firstShown = (k: number): string => (k === 1 ? 'first row shown' : `first ${k} shown`);
const rowsWord = (n: number): string => `${formatCount(n)} ${n === 1 ? 'row' : 'rows'}`;

/** The column table for what is bound; null when nothing is. */
export function previewModel({ sampleId, dataset, rows, fileName }: PreviewInput): PreviewModel | null {
  if (sampleId) {
    const f = sampleFile(sampleId);
    return {
      caption: f.previewCaption,
      srCaption: `First 3 rows of ${f.filename}`,
      columns: f.columns.map((c) => ({ ...c, right: c.type === 'Number' })),
      cells: f.previewCells,
      note: rows ? columnNote(f.columns, rows) : null,
    };
  }
  if (!dataset || !rows) return null;
  const name = fileName || dataset.filename || dataset.name;
  const cols = describeColumns(dataset.columns, rows);
  const cells = previewCellsFor(cols, rows);
  const k = cells.length;
  return {
    caption: `${name} · ${rowsWord(dataset.rowCount)} · ${firstShown(k)} · types worked out from the values`,
    srCaption: k === 1 ? `First row of ${name}` : `First ${k} rows of ${name}`,
    columns: cols.map((c) => ({ ...c, right: c.type === 'Number' })),
    cells,
    note: columnNote(cols, rows),
  };
}

export const PREVIEW_FOOTNOTE = 'Read in this browser. Nothing in your file is changed, and nothing is sent until you ask.';
export const PREVIEW_EMPTY = 'No file yet. Drop one, paste rows, or start with a sample file.';

// ───────────── following a run ─────────────

/**
 * Whether an element (its client rect) still has to be scrolled to be seen whole: some of it is above the top edge, or
 * below the bottom edge less the sticky bar that covers `bottomInset` px of it.
 */
export function offScreen(rect: { top: number; bottom: number }, viewportHeight: number, bottomInset = 0): boolean {
  return rect.top < 0 || rect.bottom > viewportHeight - bottomInset;
}

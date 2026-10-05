/**
 * Pure view-models for the top of `#/start` (Intro, DataBringer, ColumnPreview): the "How it works" steps, the
 * column preview table, the replay note and the sample radiogroup's arrow keys. No DOM, no engine calls.
 */
import type { DatasetRef } from '@scasella/undefined-engine/types';
import type { DataRow } from '../model/figures';
import { formatCount } from '../model/figures';
import { describeColumns, previewCellsFor, sampleFile, type ColumnKind, type SampleId } from '../model/samples';

// ───────────── Intro: how it works ─────────────

export interface IntroStep {
  n: string;
  text: string;
  /** Step 3's number chip is dark (the check trace's colour) in every state, as the board draws it. */
  lit: boolean;
}

export const INTRO_EYEBROW = 'START HERE · BRING A FILE, ASK IN PLAIN WORDS';

export function introSteps(): IntroStep[] {
  return [
    { n: '1', text: 'Bring a file. It stays in this browser.', lit: false },
    { n: '2', text: 'Ask in plain words.', lit: false },
    { n: '3', text: "Your rules check the AI's work before you see it.", lit: true },
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
export const DROP_NOTE =
  'In this demo, answers are recorded, so questions about your own file need the version on your computer. Your file would still stay in this browser. Try a sample file for now.';
export const PASTE_NOTE = 'Read in this browser. In this demo, questions about your own data need the version on your computer. Try a sample file for now.';

/** The replay note shows only once the user's own data is bound and the page replays recorded answers. */
export function showOwnFileNote(source: 'sample' | 'own' | 'none', mode: 'live' | 'replay'): boolean {
  return source === 'own' && mode === 'replay';
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
  };
}

export const PREVIEW_FOOTNOTE = 'Read in this browser. Nothing in your file is changed, and nothing is sent until you ask.';
export const PREVIEW_EMPTY = 'No file yet. Drop one, paste rows, or start with a sample file.';

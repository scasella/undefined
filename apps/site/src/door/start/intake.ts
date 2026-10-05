/**
 * Pure intake helpers for the first run (`#/start`): what a dropped/picked/pasted file is, why it cannot be used, the
 * variable it is bound to, and its rows parsed EXACTLY as the engine binds them (core/engine.ts parseDataText →
 * data/dataset.ts buildDataset, which encodes the parsed rows unchanged). No DOM, no engine calls.
 *
 * The rows are not on DatasetRef (they live in the engine's content store), so the session controller keeps this
 * parse next to the binding: privacy.ts sampleForModel and assumptions.ts dataFacts read them.
 */
import type { DatasetRef } from '@scasella/undefined-engine/types';
import { parseCsv } from '../../data/csv';
import { coerceCsvRows } from '../../data/infer';
import { parseJsonData } from '../../data/json';
import { binaryProblem, dataFileProblem, datasetNameFromFile, delimiterHint } from '../../ui/data';
import { formatCount, type DataRow } from '../model/figures';

export type ParsedRows = { ok: true; rows: DataRow[]; warnings: string[] } | { ok: false; error: string };

/**
 * Text → rows, the same branches and messages as core/engine.ts parseDataText (not imported: that module is the
 * engine itself, loaded lazily by main.tsx). JSON / JSON Lines when the text starts with `[` or `{` or the file name
 * says so; otherwise CSV/TSV with the per-column coercion. Never throws.
 */
export function parseRows(text: string, filename?: string): ParsedRows {
  try {
    const t = typeof text === 'string' ? text : '';
    const body = t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
    if (body.trim() === '') return { ok: false, error: 'Nothing to load: paste CSV or JSON, or drop a file.' };
    const json = /^\s*[[{]/.test(body) || /\.(json|jsonl|ndjson)$/i.test(filename ?? '');
    if (json) {
      const r = parseJsonData(body);
      if ('error' in r) return { ok: false, error: r.error };
      if (r.rows.length === 0) return { ok: false, error: 'No rows: the JSON holds an empty list.' };
      return { ok: true, rows: r.rows, warnings: r.warnings };
    }
    const csv = parseCsv(body);
    if (csv.rows.length === 0) return { ok: false, error: 'No rows: the text has a header line but no data lines.' };
    return { ok: true, rows: coerceCsvRows(csv.rows).rows, warnings: csv.warnings };
  } catch (e) {
    return { ok: false, error: `Could not read the data: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** A picked/dropped file that cannot be data, before it is read (spreadsheet, wrong type, far too big): the workbench's words. */
export function fileProblem(file: { name: string; size: number }): string | null {
  return dataFileProblem(file);
}

/**
 * Read text that cannot be used: empty, binary (a spreadsheet saved under a .csv name), or a recording / program
 * image (they are JSON but not data). `label` names it in the message (`sales.csv`, or `The pasted text`).
 */
export function textProblem(text: string, filename?: string): string | null {
  const label = filename ?? 'The pasted text';
  if (text.trim() === '') return filename ? `${filename} is empty. Nothing to load.` : 'Nothing to load: paste CSV or JSON, with the header row first.';
  const binary = binaryProblem(label, text);
  if (binary) return binary;
  const kind = jsonFileKind(text);
  if (kind === 'recording') return `${label} is a recording, not data. Open it in the workbench to replay it.`;
  if (kind === 'image') return `${label} is a program image, not data. Open it in the workbench to import it.`;
  return null;
}

/** 'recording' / 'image' for the app's own JSON files (by their `format` field); null for anything else. */
export function jsonFileKind(text: string): 'recording' | 'image' | null {
  if (!/^\s*\{/.test(text)) return null;
  const m = /"format"\s*:\s*"(undefined-recording|undefined-image)"/.exec(text.slice(0, 4096));
  return m ? (m[1] === 'undefined-recording' ? 'recording' : 'image') : null;
}

/**
 * CSV text that parsed into ONE column while its header line holds a likely separator: the delimiter question
 * (`Only 1 column found. Is the delimiter ";"?`). A real one-column file (no separator anywhere) is not a problem.
 */
export function delimiterProblem(text: string, columnCount: number): string | null {
  const hint = delimiterHint(text, columnCount);
  return hint && /delimiter/.test(hint) ? hint : null;
}

/**
 * The variable the user's own file is bound to: the file's base name as a camelCase identifier (`Sales Q3.csv` →
 * `salesQ3`), `data` for pasted text; never `rows` and never a name in `taken` (ui/data.ts datasetNameFromFile, the
 * workbench's rule). `replacing` is the name the page bound last (a new file takes its place instead of `sales2`).
 */
export function ownDatasetName(filename: string | undefined, taken: Iterable<string>, replacing?: string | null): string {
  const used = [...taken].filter((n) => n !== replacing);
  return datasetNameFromFile(filename, used);
}

/** Names a new dataset must not take: functions, bound datasets and console variables (as the workbench's takenNames). */
export function takenNames(state: { program: { functions: Record<string, unknown> }; datasets: ReadonlyArray<{ name: string }>; env?: Record<string, unknown> }): string[] {
  return [...Object.keys(state.program.functions), ...state.datasets.map((d) => d.name), ...Object.keys(state.env ?? {})];
}

/** The top bar's chip: `orders.csv · 332 rows · 10 columns` (the variable name when there is no file name). */
export function fileChipFor(ref: Pick<DatasetRef, 'name' | 'filename' | 'rowCount' | 'columns'>): string {
  const n = ref.columns.length;
  return `${ref.filename ?? ref.name} · ${formatCount(ref.rowCount)} ${ref.rowCount === 1 ? 'row' : 'rows'} · ${n} ${n === 1 ? 'column' : 'columns'}`;
}

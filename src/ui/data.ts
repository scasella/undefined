/**
 * Pure helpers for the data drawer, REPL result tables and pinned tests. No DOM, no engine calls: unit-tested.
 */
import type { DatasetRef, EngineState, Json, Pin, TablePreview } from '../types';
import { decodeValue } from '../shared/serialize';
import { show } from '../shared/show';

/** What the file picker accepts. */
export const DATA_FILE_ACCEPT = '.csv,.tsv,.json,.jsonl,.ndjson,.txt,text/csv,text/tab-separated-values,application/json,text/plain';

const DATA_EXT = /\.(csv|tsv|json|jsonl|ndjson|txt)$/i;

/** null when a dropped/picked file looks like data we can read; otherwise a plain reason. */
export function dataFileProblem(file: { name: string; size: number }): string | null {
  if (!DATA_EXT.test(file.name)) return `${file.name} is not a .csv, .tsv, .json, .jsonl or .txt file.`;
  // a generous read limit: the engine enforces the real one (1 MB of rows) with a precise message
  if (file.size > 8_000_000) return `${file.name} is ${formatBytes(file.size)}; the limit is about 1 MB of rows. Trim it first.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} kB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const plural = (n: number, one: string, many = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Under a table that shows fewer rows than there are: "showing 100 of 332 rows"; null when every row is shown. */
export function tableNote(t: TablePreview): string | null {
  return t.rows.length < t.total ? `showing ${formatCount(t.rows.length)} of ${plural(t.total, 'row')}` : null;
}

const NUMBERISH = /^-?(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?n?|NaN|-?Infinity)$/i;

/** Columns whose every non-empty cell is a number (rendered right-aligned). */
export function numericColumns(t: TablePreview): boolean[] {
  return t.columns.map((_, c) => {
    let seen = false;
    for (const r of t.rows) {
      const cell = r[c] ?? '';
      if (cell === '' || cell === 'null' || cell === 'undefined') continue;
      if (!NUMBERISH.test(cell)) return false;
      seen = true;
    }
    return seen;
  });
}

/** One line per bound dataset: `rows · Row[] · 332 rows`. */
export function datasetLine(d: Pick<DatasetRef, 'name' | 'typeName' | 'rowCount'>): string {
  return `${d.name} · ${d.typeName}[] · ${plural(d.rowCount, 'row')}`;
}

/** What the "What leaves your browser" box says, by mode and the samples choice. */
export function sendCopy(mode: EngineState['mode'], samples: boolean, sampleRows: number): { toggle: string | null; line: string } {
  if (mode === 'replay') return { toggle: null, line: 'Nothing leaves your browser in replay mode.' };
  return {
    toggle: `Send ${sampleRows} sample rows to Codex along with the type (off = the type only)`,
    line: samples
      ? `When a call uses this data, Codex gets the type and exactly the ${sampleRows} rows below. No other row leaves your browser.`
      : 'When a call uses this data, Codex gets the type only. No row leaves your browser.',
  };
}

/** After pinning: `Pinned ✓ — now a unit test on median (2 pinned)`. */
export function pinnedText(fn: string, count: number): string {
  return `Pinned ✓ — now a unit test on ${fn} (${count} pinned)`;
}

/** A pin's expected value, shown and cut to `max` characters. */
export function expectedSummary(expected: Json, max = 90): string {
  let s: string;
  try {
    s = show(decodeValue(expected));
  } catch {
    s = '(unreadable value)';
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The dataset names a pin's arguments refer to (for "ran on rows"). */
export function pinDatasets(pin: Pick<Pin, 'args'>): string[] {
  return pin.args.flatMap((a) => (a.kind === 'dataset' ? [a.name] : []));
}

/** The variable name typed in the drawer, trimmed; '' means the default. */
export function variableName(input: string): string {
  return input.trim() === '' ? 'rows' : input.trim();
}

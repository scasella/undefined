/**
 * Pure helpers for the data drawer, REPL result tables and pinned tests. No DOM, no engine calls: unit-tested.
 */
import type { DatasetRef, EngineState, Json, Pin, TablePreview } from '@scasella/undefined-engine/types';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';
import { show } from '@scasella/undefined-engine/shared/show';
import { validateVariableName } from '../data/dataset';

/** What the file picker accepts. */
export const DATA_FILE_ACCEPT = '.csv,.tsv,.json,.jsonl,.ndjson,.txt,text/csv,text/tab-separated-values,application/json,text/plain';

export const DATA_EXT = /\.(csv|tsv|json|jsonl|ndjson|txt)$/i;
const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls|ods|numbers)$/i;

/** null when a dropped/picked file looks like data we can read; otherwise a plain reason. */
export function dataFileProblem(file: { name: string; size: number }): string | null {
  if (SPREADSHEET_EXT.test(file.name)) return `${file.name} is a spreadsheet file; export it as CSV.`;
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

const PLAIN_DECIMAL = /^-?\d+\.\d+$/;

/**
 * A numeric table cell as people read it: a plain decimal is rounded to at most 4 places with trailing zeros trimmed
 * (`2260.0574999999994` → `2260.0575`). Integers, bigints, exponent forms, NaN, Infinity and non-numbers are untouched.
 */
export function formatCell(cell: string): string {
  if (!PLAIN_DECIMAL.test(cell)) return cell;
  const n = Number(cell);
  if (!Number.isFinite(n)) return cell;
  const out = n.toFixed(4).replace(/\.?0+$/, '');
  return out === '-0' ? '0' : out;
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
      ? `When a call uses this data, Codex gets the type and exactly the ${sampleRows} rows below. If a draft is rejected, the retry feedback may quote up to 200 characters of your data while sample rows are on (a pinned result, the call the Invariants gate replayed, an error message).`
      : 'When a call uses this data, Codex gets the type only, and retry feedback withholds anything derived from your data. No row leaves your browser.',
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

/** The variable name typed in the drawer, trimmed; '' means `fallback` (the name derived for this data). */
export function variableName(input: string, fallback = 'data'): string {
  return input.trim() === '' ? fallback : input.trim();
}

/**
 * Text read from a file that is really binary (a spreadsheet, an image, a zip): any NUL, or more than 1% U+FFFD
 * (what decoding invalid UTF-8 leaves) in the first 4 kB. null when it reads as text.
 */
export function binaryProblem(filename: string, text: string): string | null {
  const head = text.slice(0, 4096);
  if (head.length === 0) return null;
  let bad = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c === 0) return `${filename} looks binary; export it as CSV.`;
    if (c === 0xfffd) bad++;
  }
  return bad / head.length > 0.01 ? `${filename} looks binary; export it as CSV.` : null;
}

/** Longest variable name derived from a file name (a longer one is cut at a word). */
export const MAX_DERIVED_NAME = 32;
/**
 * Names valid as variables that a derived default must still not take: Object.prototype members (`constructor`,
 * `toString`) and common globals of the page, worker and Node (`console`, `module`), which a binding would shadow.
 * Typed by hand they stay allowed; only the default steers clear (`console.csv` → `consoleData`).
 */
const AVOID_DERIVED = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  ...['console', 'window', 'self', 'document', 'location', 'navigator', 'fetch', 'globalThis', 'global', 'module', 'exports', 'require'],
  ...['process', 'setTimeout', 'setInterval', 'queueMicrotask', 'structuredClone', 'postMessage', 'performance', 'crypto', 'name', 'status', 'event', 'history', 'origin'],
]);

/**
 * The console variable for data from `filename` (or pasted, when absent): the file's base name as a camelCase
 * identifier (`Sales Q3.csv` → `salesQ3`, `2024-orders.csv` → `data2024Orders`), `data` when nothing usable is left.
 * Never `rows` (the orders example rebinds `rows`, so that name would let it replace the user's data) and never a
 * name in `taken` (functions and other datasets): a number is appended instead (`sales2`).
 */
export function datasetNameFromFile(filename: string | undefined, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  used.add('rows');
  let base = 'data';
  if (filename) {
    const file = filename.split(/[\\/]/).pop() ?? '';
    // `.hidden` has no extension: only a dot after the first character starts one
    const stem = file.lastIndexOf('.') > 0 ? file.slice(0, file.lastIndexOf('.')) : file;
    const words = stem
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
    let camel = '';
    for (const [i, w] of words.entries()) {
      const part = i === 0 ? (w === w.toUpperCase() ? w.toLowerCase() : w.charAt(0).toLowerCase() + w.slice(1)) : w.charAt(0).toUpperCase() + w.slice(1);
      // keep it readable in a call: whole words up to MAX_DERIVED_NAME characters (one long word is cut)
      if (camel !== '' && camel.length + part.length > MAX_DERIVED_NAME) break;
      camel = (camel + part).slice(0, MAX_DERIVED_NAME);
    }
    if (camel !== '') {
      const named = /^\d/.test(camel) ? `data${camel.charAt(0).toUpperCase()}${camel.slice(1)}` : camel;
      if (validateVariableName(named) === null && !AVOID_DERIVED.has(named)) base = named;
      else if (validateVariableName(`${named}Data`) === null) base = `${named}Data`;
    }
  }
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`) && validateVariableName(`${base}${n}`) === null) return `${base}${n}`;
}

/**
 * A hint when CSV text parsed into a single column although its first line holds a likely separator:
 * `Only 1 column found. Is the delimiter ";"?`. null when there is more than one column or no candidate.
 */
export function delimiterHint(text: string, columnCount: number): string | null {
  if (columnCount !== 1) return null;
  const first = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? '';
  if (/^\s*[[{]/.test(first)) return null;
  let best: string | null = null;
  let most = 0;
  for (const c of [';', ',', '\t', '|', ':']) {
    const k = first.split(c).length - 1;
    if (k > most) {
      most = k;
      best = c;
    }
  }
  if (!best) return 'Only 1 column found.';
  return `Only 1 column found. Is the delimiter ${best === '\t' ? 'a tab' : `"${best}"`}?`;
}

/** Suggested calls still worth offering: none whose function already exists, at most `max`. */
export function freshSuggestions<T extends { fn: string }>(list: readonly T[] | undefined, functions: Record<string, unknown>, max = 3): T[] {
  return (list ?? []).filter((s) => !Object.prototype.hasOwnProperty.call(functions, s.fn)).slice(0, max);
}

/**
 * The tooltip on a suggested call. Live mode: pressing Enter has it written. Replay mode (the public page): no draft
 * was recorded for a call on the user's data, so it must not promise one; it says what happens instead.
 */
export function suggestionTitle(s: { fn: string; what: string }, mode: 'live' | 'replay'): string {
  return mode === 'live'
    ? `Returns ${s.what}. ${s.fn} does not exist yet; press Enter and it is written for you.`
    : `Returns ${s.what}. ${s.fn} does not exist yet; writing it needs live mode (this page replays recorded drafts).`;
}

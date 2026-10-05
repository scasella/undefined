/**
 * "What the AI will see" (V3-Door-FirstRun right rail): the question, the column names and types, the example rows
 * (exactly the rows the engine would send: data/sample.ts sampleForModel with the engine's `send.sampleRows`), what
 * stays hidden, and the exact DATA text (shared/prompt.ts dataSection, the block the real prompt carries).
 *
 * In replay mode nothing is ever sent: the rows and text are what WOULD be sent when it runs on the user's computer,
 * and the view says so. After a run, `lastSentPrompt` gives the real prompt of the last candidate.
 */
import type { ColumnInfo, DatasetRef, FunctionRecord, GenerationView } from '@scasella/undefined-engine/types';
import { sampleForModel } from '../../data/sample';
import { dataSection } from '../../shared/prompt';

export interface PrivacyInput {
  /** The question in the user's words. */
  question: string;
  /** The bound dataset (DatasetRef) or the same fields from a DatasetPreview. */
  dataset: Pick<DatasetRef, 'name' | 'rowCount' | 'columns' | 'typeName'> & { filename?: string; typeDecl?: string };
  /** The dataset's rows (the same rows the engine holds). null when they are not available. */
  rows: readonly unknown[] | null;
  /** engine.state.send */
  send: { samples: boolean; sampleRows: number };
  mode: 'live' | 'replay';
}

export interface PrivacyView {
  /** The question, unquoted (the rail wraps it in quotes). */
  question: string;
  /** `id Number · orderDate Date · customer Text · …` */
  colsText: string;
  rowsOn: boolean;
  /** 'On' / 'Off' next to the switch. */
  rowsWord: 'On' | 'Off';
  /** `3 example rows` (the real sample size; struck through when off). */
  rowsTitle: string;
  /** aria-label of the switch: `Send 3 example rows to the AI`. */
  switchLabel: string;
  /** The sample rows, one line each, values joined with ' · ' (shown when rows are on). */
  exRows: string[];
  /** Replay only: these rows are not sent now. */
  rowsNote: string | null;
  /** The off-state copy. */
  offText: string;
  /** `Hidden from the AI: the other 329 rows in orders.csv.` */
  hiddenLine: string;
  /** The rest of the footer after hiddenLine. */
  footerRest: string;
  /** The exact text: question, file, columns, type, and the prompt's real DATA block. */
  sentText: string;
  /** Replay only: nothing is sent in this demo. Shown above the exact text. */
  sentNote: string | null;
}

export const OFF_TEXT = 'Off. The AI sees no rows from your file, only the column names and types. Answers can be a little less sure of your formats.';
export const FOOTER_REST = 'No account. No tracking. While example rows are on, if a draft is thrown out, the note we send back to the AI may quote up to 200 characters from your file.';
export const REPLAY_ROWS_NOTE = 'Would be sent when you run it on your computer. In this demo nothing leaves your browser.';
export const REPLAY_PROMPT_NOTE = 'In this demo nothing is sent now. This is the text the AI was sent when this answer was recorded.';
export const REPLAY_SENT_NOTE = 'In this demo nothing is sent: answers are recorded. This is the text that would be sent when you run it on your computer.';

/** The disclosure button's label. */
export function sentLabel(open: boolean, afterRun = false): string {
  if (open) return 'Hide the exact text';
  return afterRun ? 'See exactly what the AI was sent' : 'See exactly what the AI will be sent';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Plain word for a column's TS type: number → Number, string → Text (Date when every value looks like a date), boolean → Yes/no. */
export function columnTypeWord(col: ColumnInfo, rows: readonly unknown[] | null = null): string {
  const parts = col.type
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p !== 'null' && p !== 'undefined' && p !== '');
  if (parts.length !== 1) return parts.length === 0 ? 'Empty' : 'Mixed';
  const t = parts[0]!;
  if (t === 'number' || t === 'bigint') return 'Number';
  if (t === 'boolean') return 'Yes/no';
  if (t === 'Date') return 'Date';
  if (t === 'string') return rows && looksLikeDates(rows, col.name) ? 'Date' : 'Text';
  if (t.endsWith('[]')) return 'List';
  if (t.startsWith('{')) return 'Record';
  return t;
}

function looksLikeDates(rows: readonly unknown[], key: string): boolean {
  let seen = 0;
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue;
    const v = (r as Record<string, unknown>)[key];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'string' || !ISO_DATE.test(v.trim())) return false;
    if (++seen >= 200) break;
  }
  return seen > 0;
}

export function columnsText(columns: readonly ColumnInfo[], rows: readonly unknown[] | null = null): string {
  return columns.map((c) => `${c.name} ${columnTypeWord(c, rows)}`).join(' · ');
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** One sample row as a line: its values in column order, joined with ' · '. */
export function rowLine(row: unknown): string {
  if (row === null || typeof row !== 'object') return cellText(row);
  return Object.values(row as Record<string, unknown>).map(cellText).join(' · ');
}

function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function rowsWord(n: number): string {
  return `${fmt(n)} row${n === 1 ? '' : 's'}`;
}

export function privacyView(input: PrivacyInput): PrivacyView {
  const { dataset: d, rows, send, mode } = input;
  const file = d.filename ?? d.name;
  const sample = rows ? sampleForModel(rows, { count: send.sampleRows }) : null;
  const n = sample ? sample.rows.length : Math.min(send.sampleRows, d.rowCount);
  const rowsOn = send.samples;
  const colsText = columnsText(d.columns, rows);
  const replay = mode === 'replay';

  const hiddenLine = !rowsOn || n === 0
    ? `Hidden from the AI: all ${rowsWord(d.rowCount)} in ${file}.`
    : d.rowCount - n > 0
      ? `Hidden from the AI: the other ${rowsWord(d.rowCount - n)} in ${file}.`
      : `Hidden from the AI: nothing else. ${file} has only ${rowsWord(d.rowCount)}.`;

  const lines = [`Question: ${input.question}`, `File: ${file}`, `Columns: ${colsText}`];
  if (d.typeDecl) lines.push(`Type: ${d.typeDecl}`);
  lines.push(
    dataSection({
      name: d.name,
      typeName: d.typeName,
      rowCount: d.rowCount,
      ...(rowsOn && sample ? { sampleText: sample.text } : {}),
    }),
  );

  return {
    question: input.question,
    colsText,
    rowsOn,
    rowsWord: rowsOn ? 'On' : 'Off',
    rowsTitle: `${n} example row${n === 1 ? '' : 's'}`,
    switchLabel: `Send ${n} example row${n === 1 ? '' : 's'} to the AI`,
    exRows: rowsOn && sample ? sample.rows.map(rowLine) : [],
    rowsNote: replay && rowsOn ? REPLAY_ROWS_NOTE : null,
    offText: OFF_TEXT,
    hiddenLine,
    footerRest: FOOTER_REST,
    sentText: lines.join('\n'),
    sentNote: replay ? REPLAY_SENT_NOTE : null,
  };
}

/**
 * The real prompt of the most recent candidate: the last attempt of the current generation that carries one, else the
 * accepted candidate of the committed artifact. null before any run.
 */
export function lastSentPrompt(generation: GenerationView | null | undefined, record?: FunctionRecord | null): string | null {
  const attempts = generation?.attempts ?? [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    const p = attempts[i]!.candidate?.prompt;
    if (p) return p;
  }
  const cands = record?.artifact?.candidates ?? [];
  for (let i = cands.length - 1; i >= 0; i--) {
    const p = cands[i]!.prompt;
    if (p) return p;
  }
  return null;
}

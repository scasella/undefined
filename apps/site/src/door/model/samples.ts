/**
 * The two sample files of the first run (`#/start`): orders.csv and sales-q3.csv. Everything that can be computed is
 * computed from the real data, along the engine's own binding path (parseCsv → coerceCsvRows → inferDataset), and the
 * three "what the AI will see" rows are exactly the ones src/data/sample.ts sampleForModel picks. Only the
 * descriptions are copy. Also exports the column labeller and cell formatter the Start page uses for any file.
 */
import type { ColumnInfo, DatasetRef } from '@scasella/undefined-engine/types';
import { parseCsv } from '../../data/csv';
import { coerceCsvRows, inferDataset } from '../../data/infer';
import { BUNDLED_ORDERS_CSV } from '../../data/orders';
import { SALES_CSV, SALES_FILENAME } from '../../data/sales';
import { sampleForModel } from '../../data/sample';
import { formatCount, formatMoney, type DataRow } from './figures';

export type SampleId = 'orders' | 'sales';
export const SAMPLE_IDS: readonly SampleId[] = ['orders', 'sales'];

/** The plain-words type of a column, as the design labels it. */
export type ColumnKind = 'Number' | 'Date' | 'Text';

export interface SampleColumn {
  name: string;
  type: ColumnKind;
}

export interface SampleFile {
  id: SampleId;
  filename: string;
  /**
   * The REPL variable the rows are bound to (`rows`, `sales`): the argument of every suggested call. orders.csv is
   * bound as `rows` (the engine's default name, row type `Row`) because the bundled replay recording
   * (public/recordings/orders.json) was made that way: the row type's name is part of the hashed spec, so under any
   * other name the recorded answer would not replay. The page never shows the name except in the exact prompt.
   */
  datasetName: string;
  rowCount: number;
  /** Telemetry chip: `orders.csv · 332 rows · 10 columns` */
  label: string;
  /** Sample card: `332 rows · 10 columns · fictional` */
  meta: string;
  /** Sample card description (copy). */
  desc: string;
  /** `orders.csv · 332 rows · first 3 shown · types worked out from the values` */
  previewCaption: string;
  columns: SampleColumn[];
  /** `id Number · orderDate Date · …` (the "Columns:" line of what the AI is sent) */
  columnsLine: string;
  /** The first 3 rows, as bound (coerced). */
  previewRows: DataRow[];
  /** The first 3 rows as the preview table shows them (`3.50`, `empty` for a missing value). */
  previewCells: string[][];
  /** The rows sampleForModel sends, one line each: `Mx. Pemberwick · Germany · Self-Folding Napkin · 6 × $3.50 · paid` */
  exampleRows: string[];
  /** Rows the AI never sees: rowCount − exampleRows.length (329 / 45). */
  hiddenRows: number;
  /** The file's text, for Engine.loadDataset / previewDataset. */
  text(): string;
  /** The rows exactly as the engine binds them. A fresh copy on every call. */
  rows(): DataRow[];
}

// ───────────────────────── generic helpers (any file) ─────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** `number`, `number | null`, … → that base type; unions of two real types → null. */
function baseType(t: string): string | null {
  const parts = t.split('|').map((p) => p.trim()).filter((p) => p !== 'null' && p !== 'undefined');
  return parts.length === 1 ? parts[0]! : null;
}

/**
 * Number for numeric columns; Date for string columns whose every non-empty value is an ISO date (infer.ts keeps
 * dates as strings); Text otherwise.
 */
export function columnKind(type: string, values: readonly unknown[]): ColumnKind {
  const base = baseType(type);
  if (base === 'number') return 'Number';
  if (base === 'string') {
    const present = values.filter((v) => v !== null && v !== undefined && v !== '');
    if (present.length > 0 && present.every((v) => typeof v === 'string' && ISO_DATE.test(v.trim()))) return 'Date';
  }
  return 'Text';
}

export function describeColumns(columns: readonly ColumnInfo[], rows: readonly DataRow[]): SampleColumn[] {
  return columns.map((c) => ({ name: c.name, type: columnKind(c.type, rows.map((r) => r[c.name])) }));
}

export function columnsLine(columns: readonly SampleColumn[]): string {
  return columns.map((c) => `${c.name} ${c.type}`).join(' · ');
}

/** A number column whose values are amounts (some have cents, none has more than 2 decimals): shown with 2 decimals. */
function isMoneyLike(values: readonly unknown[]): boolean {
  const nums = values.filter((v): v is number => typeof v === 'number');
  return nums.some((n) => !Number.isInteger(n)) && nums.every((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6);
}

/** Display text of one cell: `empty` for a missing value, two decimals in an amount column. */
export function formatCell(v: unknown, moneyLike: boolean): string {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'number' && moneyLike) return v.toFixed(2);
  return String(v);
}

/** The first `n` rows as display cells, column by column. Amount detection looks at every row. */
export function previewCellsFor(columns: readonly SampleColumn[], rows: readonly DataRow[], n = 3): string[][] {
  const money = columns.map((c) => c.type === 'Number' && isMoneyLike(rows.map((r) => r[c.name])));
  return rows.slice(0, n).map((r) => columns.map((c, i) => formatCell(r[c.name], money[i]!)));
}

/** A row the model is sent, one line: every value joined by ` · ` (amount columns with 2 decimals). */
export function formatExampleRow(row: DataRow, columns: readonly SampleColumn[], rows: readonly DataRow[] = [row]): string {
  return columns.map((c) => formatCell(row[c.name], c.type === 'Number' && isMoneyLike(rows.map((r) => r[c.name])))).join(' · ');
}

// ───────────────────────── the two samples ─────────────────────────

/** orders.csv reads better as a sentence: who · where · what · how many × price · discount · status. */
function ordersExampleRow(r: DataRow): string {
  const discount = typeof r.discount === 'number' && r.discount > 0 ? ` · ${Math.round(r.discount * 100)}% off` : '';
  return `${String(r.customer)} · ${String(r.country)} · ${String(r.product)} · ${String(r.quantity)} × ${formatMoney(Number(r.unitPrice))}${discount} · ${String(r.status)}`;
}

interface Def {
  id: SampleId;
  filename: string;
  datasetName: string;
  desc: string;
  text: () => string;
  /** null: the generic formatExampleRow */
  example: ((r: DataRow) => string) | null;
}

const DEFS: Record<SampleId, Def> = {
  orders: {
    id: 'orders',
    filename: 'orders.csv',
    datasetName: 'rows',
    desc: 'A year of web-shop orders: customers, products, discounts, and paid, pending or refunded status.',
    text: BUNDLED_ORDERS_CSV,
    example: ordersExampleRow,
  },
  sales: {
    id: 'sales',
    filename: SALES_FILENAME,
    datasetName: 'sales',
    desc: 'One quarter of sales by region, with paid, refunded and pending orders.',
    text: SALES_CSV,
    example: null,
  },
};

const cache = new Map<SampleId, { file: SampleFile; rows: DataRow[] }>();

function build(def: Def): { file: SampleFile; rows: DataRow[] } {
  const parsed = parseCsv(def.text());
  const rows = coerceCsvRows(parsed.rows).rows;
  const inferred = inferDataset(rows);
  const columns = describeColumns(inferred.columns, rows);
  const n = formatCount(rows.length);
  const sent = sampleForModel(rows).rows as DataRow[];
  const file: SampleFile = {
    id: def.id,
    filename: def.filename,
    datasetName: def.datasetName,
    rowCount: rows.length,
    label: `${def.filename} · ${n} rows · ${columns.length} columns`,
    meta: `${n} rows · ${columns.length} columns · fictional`,
    desc: def.desc,
    previewCaption: `${def.filename} · ${n} rows · first 3 shown · types worked out from the values`,
    columns,
    columnsLine: columnsLine(columns),
    previewRows: rows.slice(0, 3).map((r) => ({ ...r })),
    previewCells: previewCellsFor(columns, rows),
    exampleRows: sent.map((r) => (def.example ? def.example(r) : formatExampleRow(r, columns, rows))),
    hiddenRows: rows.length - sent.length,
    text: def.text,
    rows: () => rows.map((r) => ({ ...r })),
  };
  return { file, rows };
}

/** The sample file `id` (built once, on first use). */
export function sampleFile(id: SampleId): SampleFile {
  let hit = cache.get(id);
  if (!hit) {
    hit = build(DEFS[id]);
    cache.set(id, hit);
  }
  return hit.file;
}

/** Both samples, orders first. */
export function sampleFiles(): SampleFile[] {
  return SAMPLE_IDS.map(sampleFile);
}

/**
 * Which sample a bound dataset is (null for the user's own file): loaded as `source: 'bundled'` with the sample's
 * filename and row count. A user's own file called orders.csv is never mistaken for the sample.
 */
export function sampleIdFor(ref: Pick<DatasetRef, 'source' | 'filename' | 'rowCount'>): SampleId | null {
  if (ref.source !== 'bundled') return null;
  return SAMPLE_IDS.find((id) => DEFS[id].filename === ref.filename && sampleFile(id).rowCount === ref.rowCount) ?? null;
}

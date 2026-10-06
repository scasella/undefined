/**
 * The answer card's view-model: shape a REAL engine result into the design's card (lead name + big number, the rest
 * of the list with bars, the "Fig. 1 · …" caption). Pure: no DOM, no engine calls.
 *
 * Where the value comes from (ReplEntry 'output' has no encoded value of its own):
 *   1. `pinnable.expected` (or any encoded Json the caller has, e.g. EvalOutcome.value.encoded) → decodeValue → shape;
 *   2. else the entry's `table` (show()-rendered string cells) → a labelled table, never parsed into numbers;
 *   3. else the entry's `value` (show() text) → a labelled raw fallback.
 * Nothing here invents a number: every figure on the card is a value the function returned.
 */
import type { Json, ReplEntry, TablePreview } from '@scasella/undefined-engine/types';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';

export type OutputEntry = Extract<ReplEntry, { kind: 'output' }>;

export interface AnswerRow {
  /** Two-digit place, e.g. '02'. */
  rank: string;
  name: string;
  /** Formatted value, e.g. '$2,148.72' or '47'. */
  amt: string;
  /** Bar width as a percentage of the largest value, one decimal, 0..100. */
  pct: number;
  /** The raw number (for tests and sorting by the caller; never shown unformatted). */
  value: number;
}

export interface AnswerLead {
  name: string;
  num: string;
  /** e.g. 'orders' after a count; '' for money or when nothing says what was counted. */
  unit: string;
  /** True when `num` is long text that would overflow the 56px mono figure: render it at heading size. */
  long: boolean;
}

export type AnswerKind = 'ranked' | 'scalar' | 'empty' | 'table' | 'raw';

export interface AnswerView {
  kind: AnswerKind;
  /** 'Fig. 1 · Top 5 customers by revenue · … · orders.csv · 332 rows · Version 4' */
  fig: string;
  /** e.g. 'Top 5 customers by revenue' (used in the card's aria-label: 'Answer: ' + title). */
  title: string;
  /** Present for 'ranked' and 'scalar'. */
  lead: AnswerLead | null;
  /** Places 2.. for 'ranked' (empty otherwise). */
  rest: AnswerRow[];
  /** Places beyond the ones listed in `rest` (the card says how many it left out; never silently dropped). */
  hiddenRows: number;
  /** Total number of places in a ranked answer (lead + rest + hidden). */
  places: number;
  money: boolean;
  /** For 'table': the columns and (string) cells exactly as returned. */
  table: { columns: string[]; rows: string[][]; total: number } | null;
  /** For 'raw': the value as the runtime printed it. */
  raw: string | null;
  /** For 'empty' / 'table' / 'raw': one plain sentence saying why there is no lead figure. */
  fallbackNote: string | null;
}

export interface AnswerContext {
  /** The question in the user's words, e.g. 'Who are our top customers by revenue?'. */
  question: string;
  /** e.g. 'orders.csv' ('' when there is no file). */
  fileName: string;
  rowCount: number | null;
  /** Head revision the answer came from (shown as 'Version N'); null to leave it out. */
  revision: number | null;
  /** The function that answered, e.g. 'topCustomersByRevenue'. */
  callName?: string;
  /**
   * What was counted, in the design's words ('paid orders only, each order number once', 'every row counted').
   * Only the caller can know this (from the house rules on the spec); omitted from the caption when absent.
   */
  counted?: string;
}

/** Places listed under the lead before the card says "+ N more". */
export const MAX_REST = 19;

const MONEY_FIELD = /revenue|amount|total|price|spend|spent|sales|cost|income|profit|money|dollar|usd|eur|gbp|value_?usd/i;
const MONEY_QUESTION = /revenue|amount|price|spend|spent|sales|cost|income|profit|money|dollar|\$|£|€/i;
const COUNT_QUESTION = /how many|\bcount\b|number of/i;

// ───────────────────────── formatting ─────────────────────────

/** '$2,252.07', '-$12.50' (en-US, always two decimals). */
export function formatMoney(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + s;
}

/** '258', '1,234', '3.1416' (en-US; up to 4 decimals, no trailing zeros). */
export function formatPlain(n: number): string {
  if (Object.is(n, -0)) return '-0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** Whether a figure is money: the field name says so, or the question does (and it is not a count). */
export function isMoney(field: string | null, question: string): boolean {
  if (field !== null && MONEY_FIELD.test(field) && !/count|qty|quantity|number|^n$/i.test(field)) return true;
  if (field !== null && /count|qty|quantity|^n$/i.test(field)) return false;
  return MONEY_QUESTION.test(question) && !COUNT_QUESTION.test(question);
}

/** 'orders' from 'How many orders are there by status?'; '' when the question names nothing. */
export function unitFromQuestion(question: string, callName?: string): string {
  const m = /how many\s+([a-z][a-z-]*)/i.exec(question) ?? /number of\s+([a-z][a-z-]*)/i.exec(question);
  if (m) return m[1]!.toLowerCase();
  const c = callName ? /^count([A-Z][a-z]+)By/.exec(callName) : null;
  return c ? c[1]!.toLowerCase() : '';
}

/** 'topCustomersByRevenue' → 'Top customers by revenue'; 'count_by_status' → 'Count by status'. */
export function humanizeName(name: string): string {
  const words = name
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
  if (words.length === 0) return '';
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The figure's title: the call name in words, with the list length after a leading 'Top' ('Top 5 customers …'). */
export function answerTitle(callName: string | undefined, question: string, places: number | null): string {
  let t = callName ? humanizeName(callName) : '';
  if (!t) t = question.trim().replace(/[?.!]+$/, '');
  if (places !== null && places > 0 && /^Top /.test(t) && !/^Top \d/.test(t)) t = `Top ${places} ${t.slice(4)}`;
  return t;
}

/** 'Fig. 1 · <title> · <counted> · <file> · <rows> rows · Version <n>' (segments without data are left out). */
export function figCaption(title: string, ctx: AnswerContext): string {
  const parts = ['Fig. 1'];
  if (title) parts.push(title);
  if (ctx.counted) parts.push(ctx.counted);
  if (ctx.fileName) parts.push(ctx.fileName);
  if (ctx.rowCount !== null && Number.isFinite(ctx.rowCount)) parts.push(`${ctx.rowCount.toLocaleString('en-US')} ${ctx.rowCount === 1 ? 'row' : 'rows'}`);
  if (ctx.revision !== null && Number.isFinite(ctx.revision)) parts.push(`Version ${ctx.revision}`);
  return parts.join(' · ');
}

const rank2 = (i: number): string => String(i).padStart(2, '0');

// ───────────────────────── recognising shapes ─────────────────────────

interface Pair {
  name: string;
  value: number;
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set) && !(v instanceof Date);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Case 1: [{label: string, n: number}, …] with the same two keys everywhere, or [[label, n], …] tuples. */
function rankedList(v: unknown): { pairs: Pair[]; field: string | null } | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && finite(x[1]))) {
    return { pairs: (v as Array<[string, number]>).map(([name, value]) => ({ name, value })), field: null };
  }
  if (!v.every(isPlainRecord)) return null;
  const first = v[0] as Record<string, unknown>;
  const keys = Object.keys(first);
  if (keys.length !== 2) return null;
  const labelKey = keys.find((k) => typeof first[k] === 'string');
  const numKey = keys.find((k) => finite(first[k]));
  if (labelKey === undefined || numKey === undefined || labelKey === numKey) return null;
  for (const x of v as Array<Record<string, unknown>>) {
    const ks = Object.keys(x);
    if (ks.length !== 2 || typeof x[labelKey] !== 'string' || !finite(x[numKey])) return null;
  }
  return { pairs: (v as Array<Record<string, unknown>>).map((x) => ({ name: x[labelKey] as string, value: x[numKey] as number })), field: numKey };
}

/** Case 2: {label: number, …} or Map<string, number> → sorted by value desc, ties alphabetical. */
function recordCounts(v: unknown): Pair[] | null {
  let entries: Array<[unknown, unknown]>;
  if (v instanceof Map) entries = [...v.entries()];
  else if (isPlainRecord(v)) entries = Object.entries(v);
  else return null;
  if (entries.length === 0) return null;
  if (!entries.every(([k, n]) => typeof k === 'string' && finite(n))) return null;
  return (entries as Array<[string, number]>)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function base(kind: AnswerKind, title: string, ctx: AnswerContext): AnswerView {
  return {
    kind, fig: figCaption(title, ctx), title, lead: null, rest: [], hiddenRows: 0, places: 0, money: false, table: null, raw: null, fallbackNote: null,
  };
}

function ranked(pairs: Pair[], field: string | null, ctx: AnswerContext): AnswerView {
  const money = isMoney(field, ctx.question);
  const fmt = money ? formatMoney : formatPlain;
  const max = Math.max(...pairs.map((p) => p.value));
  const pct = (n: number): number => (max > 0 && n > 0 ? Math.min(100, Number(((n / max) * 100).toFixed(1))) : 0);
  const title = answerTitle(ctx.callName, ctx.question, pairs.length);
  const view = base('ranked', title, ctx);
  const [lead, ...others] = pairs as [Pair, ...Pair[]];
  view.money = money;
  view.places = pairs.length;
  view.lead = { name: lead.name, num: fmt(lead.value), unit: money ? '' : unitFromQuestion(ctx.question, ctx.callName), long: false };
  view.rest = others.slice(0, MAX_REST).map((p, i) => ({ rank: rank2(i + 2), name: p.name, amt: fmt(p.value), pct: pct(p.value), value: p.value }));
  view.hiddenRows = Math.max(0, others.length - MAX_REST);
  return view;
}

function scalar(v: number | string | boolean | bigint, ctx: AnswerContext): AnswerView {
  const title = answerTitle(ctx.callName, ctx.question, null);
  const view = base('scalar', title, ctx);
  let num: string;
  if (typeof v === 'number') {
    view.money = isMoney(null, ctx.question);
    num = view.money ? formatMoney(v) : formatPlain(v);
  } else if (typeof v === 'bigint') num = v.toLocaleString('en-US');
  else num = String(v);
  view.lead = { name: '', num, unit: typeof v === 'string' || view.money ? '' : unitFromQuestion(ctx.question, ctx.callName), long: num.length > 18 };
  return view;
}

function tableFromRecords(rows: Array<Record<string, unknown>>): { columns: string[]; rows: string[][]; total: number } {
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  const cell = (x: unknown): string => {
    if (x === undefined) return '';
    if (typeof x === 'string') return x;
    if (typeof x === 'number' || typeof x === 'boolean' || typeof x === 'bigint' || x === null) return String(x);
    try {
      return JSON.stringify(x, (_k, val: unknown) => (typeof val === 'bigint' ? val.toString() : val)) ?? String(x);
    } catch {
      return String(x);
    }
  };
  return { columns, rows: rows.slice(0, 100).map((r) => columns.map((c) => cell(r[c]))), total: rows.length };
}

export const TABLE_NOTE = 'Shown as returned. This answer is a table, so there is no single figure to lead with.';
export const RAW_NOTE = 'Shown as returned. This answer has no single figure or list to lead with.';
export const EMPTY_NOTE = 'The answer is an empty list: nothing in the file matched.';

/** Shape a decoded value. Never throws; anything unrecognised becomes a labelled fallback. */
export function shapeValue(value: unknown, ctx: AnswerContext, fallback?: { shown?: string; table?: TablePreview }): AnswerView {
  try {
    if (typeof value === 'number' && !Number.isFinite(value)) return rawView(String(value), ctx);
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') return scalar(value, ctx);
    if (Array.isArray(value) && value.length === 0) {
      const v = base('empty', answerTitle(ctx.callName, ctx.question, null), ctx);
      v.fallbackNote = EMPTY_NOTE;
      return v;
    }
    const list = rankedList(value);
    if (list) return ranked(list.pairs, list.field, ctx);
    const rec = recordCounts(value);
    if (rec) return ranked(rec, null, ctx);
    if (Array.isArray(value) && value.length > 0 && value.every(isPlainRecord)) {
      const v = base('table', answerTitle(ctx.callName, ctx.question, null), ctx);
      v.table = tableFromRecords(value as Array<Record<string, unknown>>);
      v.fallbackNote = TABLE_NOTE;
      return v;
    }
  } catch {
    /* fall through to the fallback */
  }
  if (fallback?.table) return tableView(fallback.table, ctx);
  return rawView(fallback?.shown ?? safeShow(value), ctx);
}

function safeShow(v: unknown): string {
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v, (_k, val: unknown) => (typeof val === 'bigint' ? val.toString() : val instanceof Map ? Object.fromEntries(val) : val instanceof Set ? [...val] : val), 2) ?? String(v);
  } catch {
    return String(v);
  }
}

function tableView(t: TablePreview, ctx: AnswerContext): AnswerView {
  const v = base('table', answerTitle(ctx.callName, ctx.question, null), ctx);
  v.table = { columns: [...t.columns], rows: t.rows.map((r) => [...r]), total: t.total };
  v.fallbackNote = TABLE_NOTE;
  return v;
}

function rawView(shown: string, ctx: AnswerContext): AnswerView {
  const v = base('raw', answerTitle(ctx.callName, ctx.question, null), ctx);
  v.raw = shown;
  v.fallbackNote = RAW_NOTE;
  return v;
}

/** Shape an encoded value (EvalOutcome.value.encoded, Pin.expected, CallRecord.result). */
export function shapeEncoded(encoded: Json, ctx: AnswerContext, fallback?: { shown?: string; table?: TablePreview }): AnswerView {
  let value: unknown;
  try {
    value = decodeValue(encoded);
  } catch {
    if (fallback?.table) return tableView(fallback.table, ctx);
    return rawView(fallback?.shown ?? '', ctx);
  }
  return shapeValue(value, ctx, fallback);
}

/**
 * Shape a REPL output entry. Uses `pinnable.expected` (the real encoded result) when present, else the entry's
 * table, else its printed value. `callName` defaults to the pinnable function's name.
 */
export function shapeAnswer(entry: OutputEntry, ctx: AnswerContext): AnswerView {
  const c: AnswerContext = { ...ctx, callName: ctx.callName ?? entry.pinnable?.fn };
  const fallback = { shown: entry.value, ...(entry.table ? { table: entry.table } : {}) };
  if (entry.pinnable) return shapeEncoded(entry.pinnable.expected, c, fallback);
  if (entry.table) return tableView(entry.table, c);
  return rawView(entry.value, c);
}

/** The lead of a locked answer as `{ name: 'Chef Ravioli Starbright', num: '$2,252.07' }` (name '' for one figure); null without a lead. */
export function leadParts(encoded: Json, question: string): { name: string; num: string } | null {
  const v = shapeEncoded(encoded, { question, fileName: '', rowCount: null, revision: null });
  return v.lead ? { name: v.lead.name, num: v.lead.num } : null;
}

/** 'Chef Ravioli Starbright = $2,252.07' for a locked answer (lead of the pinned result); null without a lead. */
export function leadSummary(encoded: Json, question: string): string | null {
  const p = leadParts(encoded, question);
  if (!p) return null;
  return p.name ? `${p.name} = ${p.num}` : p.num;
}

/** The locked help text names how many rows a lock holds ('these same 5 rows'), else 'this same answer'. */
export function lockedRowsPhrase(view: AnswerView | null): string {
  if (view && view.kind === 'ranked') return view.places === 1 ? 'this same row' : `these same ${view.places} rows`;
  return 'this same answer';
}

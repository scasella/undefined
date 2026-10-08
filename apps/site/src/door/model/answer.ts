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
import type { Json, ReplEntry, RevisionKind, TablePreview } from '@scasella/undefined-engine/types';
import { decodeValue } from '@scasella/undefined-engine/shared/serialize';
import { breaksWord, sealHead, stressWords, type StressStatus } from './lanes';

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
  /** True when `num` is long text that would overflow the 56px figure: render it at heading size. */
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

/**
 * The words over the ranked list under the lead ("Places 2 to 5"), worked out from the rows' own places so they cannot say a
 * different range than the list shows: the list starts at "02" and nothing else says it is the places after the first. One place
 * left is "Place 2". No rows: null (nothing to label). The list's accessible name is these same words.
 */
export function placesLabel(rest: ReadonlyArray<Pick<AnswerRow, 'rank'>>): string | null {
  if (rest.length === 0) return null;
  const place = (r: Pick<AnswerRow, 'rank'>): number => Number.parseInt(r.rank, 10);
  const first = place(rest[0]!);
  const last = place(rest[rest.length - 1]!);
  return first === last ? `Place ${first}` : `Places ${first} to ${last}`;
}

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

// ───────────────────────── what the answer says, in words ─────────────────────────

/** A basic pass: the two checks that need nothing from you (runs without errors; never changes your data, finishes fast), of six. */
export const BASIC_CHECKS = 2;
export const TOTAL_CHECKS = 6;

/**
 * The one thing left unchecked that most decides whether the figure is right, as one plain line: the first item of the
 * not-checked list as given (the list is built most decisive first). Nothing is added: no items, no line.
 */
export function decisiveCaveat(notChecked: readonly string[]): string | null {
  const first = notChecked.map((t) => t.trim()).find((t) => t !== '');
  return first ?? null;
}

/** The next step the front door really has: the checked calculation, handed over as a download (start/RunPanel.tsx Handoff). */
export const HANDOFF_NEXT = 'if the number matters, hand the calculation to your data team';

export interface VerdictInput {
  level: 'full' | 'basic';
  /** The stress test's result (Full checks only), worded with the seal's own words (lanes.ts stressWords). */
  stress?: StressStatus | null;
  /** The checks that apply and how many passed: the seal's `ran` of `of`. Read only when the stress test did not finish. */
  ran?: number;
  of?: number;
  /** The "Not checked" list, most decisive first. */
  notChecked: readonly string[];
  /** The card offers the hand-off as its action: only then is it named as the next step. */
  handoff: boolean;
}

/**
 * The answer's verdict in at most two plain sentences, shown directly under the figure: how the checks went (the seal's
 * own words, lanes.ts sealHead and stressWords, with the ledger's unit), the one thing most worth knowing was not checked
 * (decisiveCaveat) and, when the card offers it, the one next step the product really has. The next step follows the
 * caveat with "so", not a semicolon: a semicolon reads as a second thing that was not checked. It never says the answer is
 * right: it says what ran and what did not.
 *
 * Length: about 34 words for every caveat the demo's own data produces (the first sentence is 13 words, the next step 12, the
 * caveat at most 7: "whether refunded and pending orders should count"); start/derive.test.ts and model/answer.test.ts compute
 * it from the real facts. It grows only with a caveat built from a viewer's own data (a status column with many values), and
 * then it is kept whole: cutting an item to fit would change what it says, and the ledger below is where the whole list is.
 */
export function verdictLine(i: VerdictInput): string {
  const sentences = [howItWent(i)];
  // the item as the list words it, less a closing explanation in brackets and its full stop: the ledger below keeps the whole
  // ("whether refunded and pending orders should count (your status column has paid, refunded and pending)")
  const first = decisiveCaveat(i.notChecked);
  const caveat = first === null ? null : caveatClause(first) || null;
  const next = i.handoff ? HANDOFF_NEXT : null;
  if (caveat) sentences.push(`Not checked: ${caveat}${next ? `, so ${next}` : ''}.`);
  else if (next) sentences.push(`${next.charAt(0).toUpperCase()}${next.slice(1)}.`);
  return sentences.join(' ');
}

/** Words that cannot end a clause: a trim that would leave one of them last is not a trim to trust. */
const DANGLING = /(?:^|[\s,;:])(?:and|or|but|of|the|a|an|to|for|with|that|than|whether|if|as)$/i;

/** Every bracket in `text` closes, and none closes before it opens. */
function bracketsBalanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * The not-checked item as one clause for the verdict: its full stop dropped and, when it ends with the explanation the list adds
 * about the viewer's own data ("(your status column has paid, refunded and pending)", notCheckedList), that explanation left to
 * the ledger below. Only that one shape is cut, and only when it is cut cleanly: a balanced group (a bracket inside it is part
 * of it) that opens after a space, with a clause left that is itself balanced and does not end on a joining word. Brackets in the
 * middle of an item, or any other kind at the end ("whether (a) and (b)"), belong to what it says and stay. When unsure, the item
 * comes back whole, never cut inside a word and never with a bracket left open.
 */
export function caveatClause(item: string): string {
  const text = item.trim().replace(/[.\s]+$/, '');
  if (!text.endsWith(')')) return text;
  // walk back from the final bracket to the one that opens its group
  let depth = 0;
  let open = -1;
  for (let at = text.length - 1; at >= 0; at--) {
    const c = text[at];
    if (c === ')') depth++;
    else if (c === '(' && --depth === 0) {
      open = at;
      break;
    }
  }
  if (open <= 0 || !/\s/.test(text[open - 1]!) || !text.startsWith('(your ', open)) return text;
  const head = text.slice(0, open).trimEnd();
  return head !== '' && bracketsBalanced(head) && !DANGLING.test(head) ? head : text;
}

function howItWent(i: VerdictInput): string {
  if (i.level === 'basic') return `Only the ${BASIC_CHECKS} basic checks ran, so nothing has tested the number yet.`;
  const stress: StressStatus = i.stress ?? { kind: 'none' };
  const ran = i.ran ?? 0;
  const of = i.of ?? 0;
  const unfinished = stress.kind === 'partial' || stress.kind === 'not-run';
  const head = unfinished && of <= 0 ? 'Passed the checks that ran' : sealHead({ stress, ran, of });
  const words = stressWords(stress);
  if (!words) return `${head}.`;
  const clean = stress.kind === 'done' && stress.missed === 0;
  // the unit is the ledger's and the lane's (lanes.ts breaksWord): "1 of 1 deliberate break", never "1 of 1 deliberate breaks"
  const detail = stress.kind === 'done' ? `${words} deliberate ${breaksWord(stress.total)}` : words;
  return `${head}, ${clean ? 'and' : 'though'} the ${detail}.`;
}

/**
 * The answer's lead as it is spoken: 'Chef Ravioli Starbright, $2,252.07' for a ranked list (the top name and its figure),
 * '$9,876.00' or '258 orders' for one figure; null when the answer has no lead (a table, text, an empty list).
 */
export function answerLead(view: AnswerView | null): string | null {
  const lead = view?.lead;
  if (!lead) return null;
  const num = lead.unit ? `${lead.num} ${lead.unit}` : lead.num;
  return lead.name ? `${lead.name}, ${num}` : num;
}

/**
 * Where a "Version N" that is not the first answer comes from, in one sentence, when it is only the demo being set up: every save
 * before it was the starting point, loading the file or installing the demo's agreement FOR THIS ANSWER'S FUNCTION (the engine
 * numbers every saved step, not only answers), so it names exactly those saves, in order, and says this is the first answer.
 * null for anything else (no earlier saves, a gap, or any save the viewer made, such as an earlier answer, a lock, a ruling or the
 * agreement of a question they typed themselves: a 'spec-edit' for another function, or one that names none, is theirs), so it
 * never claims more than the saved steps show. A first answer with no agreement among them (the demo's basic-checks fallback)
 * is explained the same way.
 */
export function versionNote(revisions: ReadonlyArray<{ id: number; kind: RevisionKind; fn?: string }>, version: number | null, fn: string): string | null {
  if (version === null || !Number.isFinite(version) || version < 2) return null;
  const earlier = revisions.filter((r) => r.id < version);
  if (earlier.length !== version - 1) return null;
  // what each earlier save was, in the order they happened (a kind once, however many times it was saved)
  const WHAT: Partial<Record<RevisionKind, string>> = { init: 'the starting point', dataset: 'the file', 'spec-edit': "the demo's agreement" };
  const what: string[] = [];
  for (const r of earlier) {
    const w = WHAT[r.kind];
    if (w === undefined) return null;
    // the demo's agreement is the answer's own function's spec; a spec saved for any other function is the viewer's (a typed question)
    if (r.kind === 'spec-edit' && r.fn !== fn) return null;
    if (!what.includes(w)) what.push(w);
  }
  const files = earlier.filter((r) => r.kind === 'dataset').length;
  const list = what.map((w) => (w === WHAT.dataset && files > 1 ? 'the files' : w));
  const range = version === 2 ? 'Version 1 was' : version === 3 ? 'Versions 1 and 2 were' : `Versions 1 to ${version - 1} were`;
  const said = list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${range} ${said}; this is the first answer.`;
}

/**
 * The version note as the answer card shows it: only in the demo (replay). A copy that runs on your computer gets no new line,
 * even though it installs the same agreement and so has the same saves (the contract: nothing new on a local copy).
 */
export function versionNoteFor(
  mode: 'live' | 'replay',
  revisions: ReadonlyArray<{ id: number; kind: RevisionKind; fn?: string }>,
  version: number | null,
  fn: string,
): string | null {
  return mode === 'replay' ? versionNote(revisions, version, fn) : null;
}

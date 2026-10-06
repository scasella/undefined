/**
 * A plain note about columns that LOOK like numbers or dates but were read as Text (a finance export's `1.234,50`,
 * `19%`, `31/01/2024`). The file's types are worked out from the values (model/samples.ts columnKind, data/infer.ts):
 * only plain digits become Number and only year-first ISO dates become Date, so these stay Text, nothing on the page
 * said so, and every question that needs a total or a date had nothing to use. The note says so, and what to export
 * instead. Pure: it never changes how anything is read, and it reads every value it is given, not a preview of them
 * (a column qualifies only when EVERY non-empty value has the shape, like columnKind's own rule for dates).
 *
 * Used by the first run's column preview (start/startView.ts previewModel); step by step can call the same functions.
 */
import type { DataRow } from './figures';
import type { ColumnKind } from './samples';

/** A column as this module reads it: its name, the type the page worked out, and its values (every row, if possible). */
export interface NoteColumn {
  name: string;
  type: ColumnKind;
  values: readonly unknown[];
}

/** What a Text column looks like it holds: an amount with separators or a currency sign, a percent, or a date. */
export type LookalikeKind = 'number' | 'percent' | 'date';

export interface Lookalike {
  name: string;
  kind: LookalikeKind;
}

// ───────────── the shapes ─────────────

/** What data/infer.ts already reads as a number (a column of only these is Number, never a lookalike). */
const PLAIN = /^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)$/;
/** `1,234` · `1,234.50` (comma thousands, point decimals). */
const US_THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
/** `1.234` · `1.234,50` (point thousands, comma decimals). */
const EU_THOUSANDS = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
/** `1 234,50` · `1 234.50` · `1'234.50` (space, no-break space or apostrophe thousands). */
const SPACED_THOUSANDS = /^\d{1,3}(?:[   ']\d{3})+(?:[.,]\d+)?$/;
/** `980,50` (a decimal comma with no thousands part). */
const DECIMAL_COMMA = /^\d+,\d+$/;
/** A leading or trailing currency sign, or one of the common currency codes (a closed list: `INV1001` is not an amount). */
const CODES = 'USD|EUR|GBP|JPY|CAD|AUD|NZD|CHF|INR|CNY|SEK|NOK|DKK|PLN|CZK|BRL|MXN|ZAR';
const CURRENCY_LEAD = new RegExp(`^(?:[$€£¥₹]\\s?|(?:${CODES})\\s?)`);
const CURRENCY_TAIL = new RegExp(`(?:\\s?[$€£¥₹]|\\s?(?:${CODES}))$`);
const PERCENT = /^[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s?%$/;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const TIME = '(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[ap]m)?)?';
/** `31/01/2024` · `01.31.2024` · `31-01-24` (two numbers and a year, either order). */
const NUMERIC_DATE = new RegExp(`^(\\d{1,2})([/.-])(\\d{1,2})\\2(\\d{2}|\\d{4})${TIME}$`, 'i');
/** `2024/01/31` · `2024.01.31` (year first, not the dashes the page already reads as dates). */
const YEAR_FIRST = new RegExp(`^\\d{4}[/.]\\d{1,2}[/.]\\d{1,2}${TIME}$`, 'i');
/** `2024-01-31` and `2024-01-31T14:05:00Z`: what the page reads as a Date; only counted as a date inside a mixed column. */
const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** `31 Jan 2024` · `31-Jan-24` · `Jan 31, 2024`. */
const DAY_MONTH_NAME = new RegExp(`^\\d{1,2}[ -]${MONTH}[ ,\\-]{1,2}(?:\\d{2}|\\d{4})${TIME}$`, 'i');
const MONTH_NAME_DAY = new RegExp(`^${MONTH} \\d{1,2},? \\d{4}${TIME}$`, 'i');

type ValueShape = 'plain' | 'amount' | 'percent' | 'date' | 'other';

function isDate(s: string): boolean {
  if (ISO.test(s) || YEAR_FIRST.test(s) || DAY_MONTH_NAME.test(s) || MONTH_NAME_DAY.test(s)) return true;
  const m = NUMERIC_DATE.exec(s);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[3])];
  const year = m[4]!;
  // a real date in at least one order, and a four-digit year (a two-digit one only after a slash or a dash: `1.2.10` is a version)
  if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) return false;
  return year.length === 4 || m[2] !== '.';
}

/** An amount: separators, a currency sign or brackets around a negative. Not a plain number (those are Numbers). */
function isAmount(raw: string): boolean {
  let s = raw;
  let decorated = false;
  const bracket = /^\((.*)\)$/.exec(s);
  if (bracket) {
    s = bracket[1]!.trim();
    decorated = true;
  }
  if (s.startsWith('-')) s = s.slice(1).trim();
  const lead = CURRENCY_LEAD.exec(s);
  if (lead) {
    s = s.slice(lead[0].length);
    decorated = true;
  }
  const tail = CURRENCY_TAIL.exec(s);
  if (tail) {
    s = s.slice(0, s.length - tail[0].length);
    decorated = true;
  }
  if (/^-/.test(s)) s = s.slice(1).trim(); // `$-5` or `€ -5`
  if (PLAIN.test(s)) return decorated;
  return US_THOUSANDS.test(s) || EU_THOUSANDS.test(s) || SPACED_THOUSANDS.test(s) || DECIMAL_COMMA.test(s);
}

function shapeOf(raw: string): ValueShape {
  const s = raw.trim();
  if (PLAIN.test(s)) return 'plain';
  if (PERCENT.test(s)) return 'percent';
  if (isDate(s)) return 'date';
  if (isAmount(s)) return 'amount';
  return 'other';
}

/** Whether a Text column holds one of the shapes in every non-empty value (and what), or null. */
function lookalikeKind(values: readonly unknown[]): LookalikeKind | null {
  let amount = 0;
  let percent = 0;
  let date = 0;
  let plain = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'string') return null;
    if (v.trim() === '') continue;
    switch (shapeOf(v)) {
      case 'amount':
        amount++;
        break;
      case 'percent':
        percent++;
        break;
      case 'date':
        date++;
        break;
      case 'plain':
        plain++;
        break;
      default:
        return null;
    }
  }
  // plain numbers may sit among amounts or percents (a column of `980`, `1,234.50`); a date column is only dates
  if (date > 0) return amount + percent + plain === 0 ? 'date' : null;
  if (percent > 0) return 'percent';
  if (amount > 0) return 'number';
  return null;
}

// ───────────── the note ─────────────

/** The Text columns that look like numbers (separators, currency, percent) or dates, in column order. */
export function textLookalikes(columns: readonly NoteColumn[]): Lookalike[] {
  const out: Lookalike[] = [];
  for (const c of columns) {
    if (c.type !== 'Text') continue;
    const kind = lookalikeKind(c.values);
    if (kind) out.push({ name: c.name, kind });
  }
  return out;
}

/** Columns with every row's value, ready for textLookalikes (the types are the ones the page already worked out). */
export function noteColumns(columns: ReadonlyArray<{ name: string; type: ColumnKind }>, rows: readonly DataRow[]): NoteColumn[] {
  return columns.map((c) => ({ name: c.name, type: c.type, values: c.type === 'Text' ? rows.map((r) => r[c.name]) : [] }));
}

/** At most this many names are listed; the rest are counted. */
export const NOTE_MAX_NAMES = 4;

function nameList(names: readonly string[]): string {
  if (names.length <= NOTE_MAX_NAMES) return names.join(', ');
  return `${names.slice(0, NOTE_MAX_NAMES).join(', ')} and ${names.length - NOTE_MAX_NAMES} more`;
}

/** The plain sentence for the columns found, or null when there are none. No claim beyond what the types say. */
export function lookalikeNote(found: readonly Lookalike[]): string | null {
  if (found.length === 0) return null;
  const numeric = found.some((f) => f.kind !== 'date');
  const dated = found.some((f) => f.kind === 'date');
  const about = numeric && dated ? 'totals or dates' : numeric ? 'totals' : 'dates';
  const them = found.length === 1 ? 'it' : 'them';
  const amounts = found.some((f) => f.kind === 'number');
  const percents = found.some((f) => f.kind === 'percent');
  const fixes: string[] = [];
  if (amounts && percents) fixes.push('Export numbers as plain digits, like 1234.50 or 19, with no thousands separators, currency signs or % signs.');
  else if (amounts) fixes.push('Export numbers as plain digits, like 1234.50, with no thousands separators or currency signs.');
  else if (percents) fixes.push('Export percents as plain numbers, like 19, with no % sign.');
  if (dated) fixes.push('Export dates as year-month-day, like 2024-01-31.');
  return `Read as text, so questions about ${about} can't use ${them} as they are: ${nameList(found.map((f) => f.name))}. ${fixes.join(' ')}`;
}

/** The note for a file's columns and rows, or null when every Text column really is text. */
export function columnNote(columns: ReadonlyArray<{ name: string; type: ColumnKind }>, rows: readonly DataRow[]): string | null {
  return lookalikeNote(textLookalikes(noteColumns(columns, rows)));
}

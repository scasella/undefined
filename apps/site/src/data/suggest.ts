/**
 * Suggested first calls on a dataset the user just loaded: deterministic, from the inferred column types and a sample
 * of the values (no model is asked). Each suggestion is a call of a function that does not exist yet, named so the
 * name alone says what it returns (the prompt writes a function whose name describes its result, and answers
 * NEEDS_SPEC for a meaningless one), e.g. `countByStatus(sales)`, `totalAmountByRegion(sales)`.
 *
 *   string column with 2–50 distinct sampled values (and repeats)  → countBy<Col>(name)
 *   that column + a number column                                  → total<Num>By<Col>(name)
 *   an id-like string column (names, ids) + a number column        → top5<Col>sBy<Num>(name)
 *   a number column                                                → average<Num>(name)
 *   ISO-date-like strings in a date/time/…At column                → <col>Range(name)
 *
 * At most three, in that order of preference. A name that would contain a vague verb or noun (BANNED) is never
 * offered, nor one built from a column whose name reads the same as another's (`Status`/`status`: ambiguous). Pure; unit-tested (suggest.test.ts).
 */
import type { ColumnInfo, DataSuggestion } from '@scasella/undefined-engine/types';

export const MAX_SUGGESTIONS = 3;
/** Rows looked at for distinct values (the first ones; the preview never scans more). */
export const SUGGEST_SAMPLE_ROWS = 500;
/** Words that make a function name say nothing about its result. */
export const BANNED_NAME = /process|handle|data|transform|clean|run/i;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_NAME = /date|time|day|month|(?:[a-z]At|_at)$/;
const CATEGORY_NAME = /status|state|category|type|kind|region|country|city|group|segment|channel|tier|plan|stage|level/i;
const ID_NAME = /(?:^|_|[a-z])(?:id|Id|ID)$|name|customer|user|product|email|sku|title|account|vendor|supplier|client|seller/i;
const MEASURE_NAME = /amount|total|revenue|sales|spend|profit|cost|value|quantity|qty|score|count|duration|weight|price/i;

/** `number`, `number | null`, `number | undefined` → 'number'; same for string; anything else → null. */
function baseType(t: string): 'number' | 'string' | null {
  const parts = t.split('|').map((p) => p.trim()).filter((p) => p !== 'null' && p !== 'undefined');
  if (parts.length !== 1) return null;
  return parts[0] === 'number' ? 'number' : parts[0] === 'string' ? 'string' : null;
}

/** A column name as one PascalCase identifier part (`unit_price` → `UnitPrice`, `Order Date` → `OrderDate`); '' when nothing usable is left. */
export function pascalPart(col: string): string {
  const ascii = col.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out = words.map((w) => (w === w.toUpperCase() && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  return /^[A-Za-z]/.test(out) ? out : '';
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (s: string): string => (/(s|x|ch|sh)$/i.test(s) ? s : /[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`);

interface Col {
  name: string;
  part: string;
  kind: 'number' | 'string';
  values: unknown[];
  distinct: number;
}

export function suggestCalls(input: { name: string; columns: readonly ColumnInfo[]; rows: ReadonlyArray<Record<string, unknown>> }): DataSuggestion[] {
  const { name } = input;
  if (!IDENT.test(name)) return [];
  const sample = input.rows.slice(0, SUGGEST_SAMPLE_ROWS);
  const cols: Col[] = [];
  for (const c of input.columns) {
    const kind = baseType(c.type);
    const part = pascalPart(c.name);
    if (!kind || !part) continue;
    const values = sample.map((r) => r[c.name]).filter((v) => v !== null && v !== undefined && v !== '');
    if (values.length === 0) continue;
    cols.push({ name: c.name, part, kind, values, distinct: new Set(values.map(String)).size });
  }
  // two columns that read the same in a name (`Status`/`status`, `order date`/`order_date`) would make it ambiguous: neither is used
  const partCount = new Map<string, number>();
  for (const c of input.columns) {
    const p = pascalPart(c.name).toLowerCase();
    if (p) partCount.set(p, (partCount.get(p) ?? 0) + 1);
  }
  for (let i = cols.length - 1; i >= 0; i--) if ((partCount.get(cols[i]!.part.toLowerCase()) ?? 0) > 1) cols.splice(i, 1);
  const n = sample.length;
  const isDate = (c: Col) => c.kind === 'string' && DATE_NAME.test(c.name) && c.values.filter((v) => ISO_DATE.test(String(v).trim())).length >= Math.ceil(c.values.length * 0.8);
  const isCategory = (c: Col) =>
    c.kind === 'string' && !isDate(c) && c.distinct >= 2 && c.distinct <= 50 && c.distinct < c.values.length && (n < 10 || c.distinct <= n / 2 || CATEGORY_NAME.test(c.name));
  const isIdLike = (c: Col) => c.kind === 'string' && !isDate(c) && (ID_NAME.test(c.name) || c.distinct > c.values.length / 2);
  const isIdNumber = (c: Col) => /(?:^|_|[a-z])(?:id|Id|ID)$/.test(c.name);

  // the column whose name hits the earliest word of `preferred` (status before country); else by `tieBreak`/order
  const pick = <T extends Col>(xs: T[], preferred: RegExp, tieBreak?: (a: T, b: T) => number): T | undefined => {
    const words = preferred.source.split('|');
    const rank = (c: Col) => {
      const i = words.findIndex((w) => new RegExp(w, 'i').test(c.name));
      return i < 0 ? words.length : i;
    };
    const best = Math.min(words.length, ...xs.map(rank));
    if (best < words.length) return xs.find((c) => rank(c) === best);
    return tieBreak ? [...xs].sort(tieBreak)[0] : xs[0];
  };
  const category = pick(cols.filter(isCategory), CATEGORY_NAME, (a, b) => a.distinct - b.distinct);
  const measure = pick(cols.filter((c) => c.kind === 'number' && !isIdNumber(c)), MEASURE_NAME);
  const who = pick(cols.filter((c) => isIdLike(c) && c !== category), /customer|name|user|account|client|vendor|seller|product/);
  const date = cols.find(isDate);

  const out: DataSuggestion[] = [];
  const add = (fn: string, what: string) => {
    if (out.length >= MAX_SUGGESTIONS || fn === name || BANNED_NAME.test(fn) || !IDENT.test(fn) || out.some((s) => s.fn === fn)) return;
    out.push({ fn, call: `${fn}(${name})`, what });
  };
  if (category) add(`countBy${category.part}`, `how many rows per ${category.name}`);
  if (category && measure) add(`total${measure.part}By${category.part}`, `the sum of ${measure.name} per ${category.name}`);
  if (who && measure) add(`top5${plural(who.part)}By${measure.part}`, `the five ${who.name} values with the highest ${measure.name}`);
  if (measure) add(`average${measure.part}`, `the mean of ${measure.name}`);
  if (date) add(`${lowerFirst(date.part)}Range`, `the earliest and latest ${date.name}`);
  return out;
}

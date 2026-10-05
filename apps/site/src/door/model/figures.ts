/**
 * Every number the landing page shows about the sample file, computed from the real rows (bundledOrders(), 332 rows)
 * so nothing is typed in twice. Pure; figures.test.ts pins the results to the design's strings and to
 * docs/FRONT-DOOR.md "Verified numbers".
 *
 * Revenue of a row = quantity × unitPrice × (1 − (discount ?? 0)); a customer's revenue is the plain sum over the
 * rows that count, rounded to cents at the end; ranked highest first, ties alphabetical by name.
 */

export type DataRow = Record<string, unknown>;

/** Which rows count: the two house rules of the definition ladder. */
export interface RevenueDefinition {
  /** Revenue counts paid orders only. */
  paidOnly: boolean;
  /** Each order number is counted once (its first row). */
  once: boolean;
}

export interface Ranked {
  name: string;
  /** Rounded to cents. */
  value: number;
}

// ───────────────────────── formatting ─────────────────────────

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `2252.07` → `$2,252.07`; `5527` → `$5,527.00`; negatives as `-$1.00`. */
export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const [whole, cents] = Math.abs(n).toFixed(2).split('.') as [string, string];
  return `${sign}$${group(whole)}.${cents}`;
}

/** `1214` → `1,214`. */
export function formatCount(n: number): string {
  return (n < 0 ? '-' : '') + group(String(Math.abs(Math.trunc(n))));
}

const cents = (v: number): number => Math.round(v * 100) / 100;
const byValueThenName = (a: Ranked, b: Ranked): number => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// ───────────────────────── counts ─────────────────────────

/** Rows per value of `key` (default `status`), most first, ties alphabetical. Every row counted. */
export function statusCounts(rows: readonly DataRow[], key = 'status'): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[key]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || (a.status < b.status ? -1 : a.status > b.status ? 1 : 0));
}

/** How many order numbers appear on more than one row (orders.csv: 12). */
export function repeatedOrderNumbers(rows: readonly DataRow[], idKey = 'id'): number {
  const seen = new Map<unknown, number>();
  for (const r of rows) seen.set(r[idKey], (seen.get(r[idKey]) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
}

/** Rows that carry a discount (orders.csv: 100). */
export function discountedRowCount(rows: readonly DataRow[]): number {
  return rows.filter((r) => r.discount !== null && r.discount !== undefined).length;
}

// ───────────────────────── revenue ─────────────────────────

/** quantity × unitPrice × (1 − (discount ?? 0)), unrounded. */
export function lineRevenue(r: DataRow): number {
  return Number(r.quantity) * Number(r.unitPrice) * (1 - (typeof r.discount === 'number' ? r.discount : 0));
}

/** The rows a definition counts, in file order: first occurrence of each order number (when `once`), then paid only. */
export function countedRows(rows: readonly DataRow[], def: RevenueDefinition, idKey = 'id'): DataRow[] {
  let out = [...rows];
  if (def.once) {
    const seen = new Set<unknown>();
    out = out.filter((r) => (seen.has(r[idKey]) ? false : (seen.add(r[idKey]), true)));
  }
  if (def.paidOnly) out = out.filter((r) => r.status === 'paid');
  return out;
}

function totals(rows: readonly DataRow[], key: string, value: (r: DataRow) => number): Ranked[] {
  const t = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[key]);
    t.set(k, (t.get(k) ?? 0) + value(r));
  }
  return [...t].map(([name, v]) => ({ name, value: cents(v) })).sort(byValueThenName);
}

/** Customers by revenue under a definition, highest first (all of them; slice for a top N). */
export function revenueByCustomer(rows: readonly DataRow[], def: RevenueDefinition): Ranked[] {
  return totals(countedRows(rows, def), 'customer', lineRevenue);
}

/** Top `n` customers by revenue under a definition. */
export function topCustomers(rows: readonly DataRow[], def: RevenueDefinition, n = 5): Ranked[] {
  return revenueByCustomer(rows, def).slice(0, n);
}

/** Top `n` countries by revenue, every row counted (as the design's "Revenue by country" answer). */
export function revenueByCountry(rows: readonly DataRow[], n = 5): Ranked[] {
  return totals(rows, 'country', lineRevenue).slice(0, n);
}

/** The answer the agreement locks: paid orders only, each order number once. */
export const AGREED: RevenueDefinition = { paidOnly: true, once: true };

// ───────────────────────── the definition ladder (Fig. 2) ─────────────────────────

export interface LadderRow {
  /** `#1` … `#5` */
  rank: string;
  name: string;
  /** `$2,599.13` */
  amount: string;
  value: number;
  /** `' ↓ from #2 to #5'` on the row that fell furthest from the previous column, else ''. */
  note: string;
}

export interface LadderColumn {
  tag: string;
  head: string;
  def: RevenueDefinition;
  rows: LadderRow[];
}

export const LADDER_DEFS: ReadonlyArray<{ tag: string; head: string; def: RevenueDefinition }> = [
  { tag: "THE AI'S FIRST ASSUMPTION", head: 'Every row counted', def: { paidOnly: false, once: false } },
  { tag: '+ ONE HOUSE RULE', head: 'Paid orders only', def: { paidOnly: true, once: false } },
  { tag: '+ TWO HOUSE RULES', head: 'Paid orders only, each order number once', def: { paidOnly: true, once: true } },
];

export interface Fall {
  name: string;
  /** 1-based ranks */
  from: number;
  to: number;
}

/** The customer in both lists whose rank dropped the most from `before` to `after` (null when nobody dropped). */
export function biggestFall(before: readonly Ranked[], after: readonly Ranked[]): Fall | null {
  let best: Fall | null = null;
  for (let i = 0; i < before.length; i++) {
    const name = before[i]!.name;
    const j = after.findIndex((a) => a.name === name);
    if (j > i && (best === null || j - i > best.to - best.from)) best = { name, from: i + 1, to: j + 1 };
  }
  return best;
}

/** Names in `before` that are not in `after`, in `before`'s order. */
export function leftTheList(before: readonly Ranked[], after: readonly Ranked[]): string[] {
  return before.filter((b) => !after.some((a) => a.name === b.name)).map((b) => b.name);
}

export interface Ladder {
  columns: [LadderColumn, LadderColumn, LadderColumn];
  /** Column 0 → column 1: who fell furthest (Kettlewhistle Farms, #2 → #5). */
  fall: Fall | null;
  /** Column 0 → column 1: who is no longer in the top 5 (Brambleskate Ltd). */
  left: string[];
  /** The figure caption under the ladder. */
  caption: string;
}

export function definitionLadder(rows: readonly DataRow[], file: { filename: string } = { filename: 'orders.csv' }): Ladder {
  const tops = LADDER_DEFS.map((d) => topCustomers(rows, d.def));
  const fall = biggestFall(tops[0]!, tops[1]!);
  const left = leftTheList(tops[0]!, tops[1]!);
  const columns = LADDER_DEFS.map((d, c) => ({
    tag: d.tag,
    head: d.head,
    def: d.def,
    rows: tops[c]!.map((r, i) => ({
      rank: `#${i + 1}`,
      name: r.name,
      amount: formatMoney(r.value),
      value: r.value,
      note: c === 1 && fall !== null && fall.name === r.name ? ` ↓ from #${fall.from} to #${fall.to}` : '',
    })),
  })) as Ladder['columns'];
  const sentences = [
    ...(fall ? [`${fall.name} falls from #${fall.from} to #${fall.to}.`] : []),
    ...left.map((n) => `${n} is no longer in the top 5.`),
  ];
  const caption =
    `Fig. 2 · Top 5 customers by revenue under three definitions · ${file.filename} · ${formatCount(rows.length)} rows · fictional sample.` +
    (sentences.length ? ` ${sentences.join(' ')}` : '');
  return { columns, fall, left, caption };
}

export interface Leader {
  /** Which ladder column these switches light (null: the "off the ladder" mix, every row counted but each order once). */
  column: 0 | 1 | 2 | null;
  name: string;
  /** `$2,252.07` */
  amount: string;
  value: number;
}

/** "#1 under these rules" for the two ladder switches. */
export function ladderLeader(rows: readonly DataRow[], def: RevenueDefinition): Leader {
  const top = topCustomers(rows, def, 1)[0] ?? { name: '', value: 0 };
  const column = !def.paidOnly && !def.once ? 0 : def.paidOnly && !def.once ? 1 : def.paidOnly && def.once ? 2 : null;
  return { column, name: top.name, amount: formatMoney(top.value), value: top.value };
}

/** The note shown when the switches pick the mix that is not a ladder column. */
export function offLadderNote(rows: readonly DataRow[]): string {
  const l = ladderLeader(rows, { paidOnly: false, once: true });
  return `That mix isn't one of the three columns below. Every row counted, each order number once: ${l.name} leads with ${l.amount}.`;
}

// ───────────────────────── the thrown-out first draft ─────────────────────────

export interface ThrownOutDraft {
  /** The first locked customer whose figure the draft got wrong. */
  customer: string;
  expected: string;
  got: string;
  /** `a refunded order` */
  counted: string;
  /** Hero ghost note, one sentence after the amounts: `The draft counted a refunded order.` */
  draftSentence: string;
  /** Evidence strip "Why": the full paragraph. */
  why: string;
}

/**
 * The landing's first draft counts every status (each order number once). Against the locked answer (paid only, each
 * order once) it gets one customer wrong; this says who, by how much and which rows made the difference.
 */
export function thrownOutDraft(rows: readonly DataRow[]): ThrownOutDraft | null {
  const draftDef: RevenueDefinition = { paidOnly: false, once: true };
  const locked = topCustomers(rows, AGREED);
  const draft = revenueByCustomer(rows, draftDef);
  for (const l of locked) {
    const d = draft.find((x) => x.name === l.name);
    if (!d || d.value === l.value) continue;
    const extra = countedRows(rows, draftDef).filter((r) => r.customer === l.name && r.status !== 'paid');
    const byStatus = statusCounts(extra).map(({ status, count }) => (count === 1 ? `a ${status} order` : `${count} ${status} orders`));
    const counted = byStatus.join(' and ');
    return {
      customer: l.name,
      expected: formatMoney(l.value),
      got: formatMoney(d.value),
      counted,
      draftSentence: `The draft counted ${counted}.`,
      why: `It didn't match the answer you locked: ${l.name} came out at ${formatMoney(d.value)}, not ${formatMoney(l.value)}, because it counted ${counted}. You never saw it.`,
    };
  }
  return null;
}

// ───────────────────────── evidence dots (ILLUSTRATIVE) ─────────────────────────

/** The design's default selected dot (0-based). */
export const DEFAULT_MADE_UP_TABLE = 36;

/** Accessible name of evidence dot `index` (0-based). */
export function madeUpTableLabel(index: number): string {
  return `Made-up table ${index + 1}, held up`;
}

/**
 * ILLUSTRATIVE, not a recorded run: the design's deterministic narrative for evidence dot `index` (0-based), ported
 * verbatim from the landing script. The counts are arithmetic on the index, not the real generated tables, so the
 * UI must keep it labelled "MADE-UP" / illustrative.
 */
export function madeUpTableNote(index: number): string {
  const k = index + 1;
  const nOrders = 4 + ((k * 7) % 9);
  const nRef = 1 + ((k * 5) % 3);
  const nPend = (k * 3) % 3;
  return `Made-up table #${k} · ${nOrders} orders · ${nRef} refunded${nPend ? ` · ${nPend} pending` : ''} · your rule left them out ✓`;
}

/** ILLUSTRATIVE (design copy, not a recorded mutation run): the 12 small breaks of the stress strip; the 12th is the one missed. */
export const ILLUSTRATIVE_BREAKS: readonly string[] = [
  'forgot discount', 'off-by-one top 5', 'kept refunds', 'double-counted', 'kept pending', 'wrong tie order',
  'dropped a customer', 'rounded early', 'top 4 only', 'reversed order', 'ignored quantity', 'single-item discount',
];

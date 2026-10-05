/**
 * The "agreement" the demo pre-loads for one question: orders.csv + "Top 5 customers by revenue".
 *
 * In engine terms (docs/FRONT-DOOR.md vocabulary map) it is a FunctionSpec for `topCustomersByRevenue` with
 *   - 6 examples      = 6 unit tests on made-up rows (test()/eq(), docs/DESIGN.md Test API), all paid, unique ids;
 *   - 2 house rules   = 2 fast-check properties over 100 made-up tables each, named with the rule's own words;
 *   - 1 locked answer = 1 pin of the real top 5 on the bound orders rows (Chef Ravioli Starbright = $2,252.07).
 * agreements.test.ts proves it with the real compiler and gate executor: a correct body passes every check; refund
 * counting, double counting, ignored discounts, the wrong tie order, a top 4 and the every-row version are rejected.
 *
 * Gate attribution: the pin runs in the Tests phase right after the examples, before the house rules (Properties).
 * So with the locked answer in place, a draft that counts refunded orders or double-counts is thrown out by the
 * locked answer first (as the landing's "Draft 1" shows); the house rules catch the same drafts on their own when
 * there is no locked answer. Note a trivial `return []` satisfies both house rules; the examples are what rule it out.
 */
import type { DatasetRef, FunctionSpec, Pin } from '@scasella/undefined-engine/types';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { bundledOrders } from '../../data/orders';
import { AGREED, formatMoney, topCustomers } from './figures';
import type { SampleId } from './samples';

export const AGREEMENT_FN = 'topCustomersByRevenue';
export const AGREEMENT_QUESTION_ID = 'top';
/** fast-check runs per house rule: "on 100 made-up tables". */
export const MADE_UP_TABLES = 100;

/** Design copy: who wrote each item and when (the demo's seeded provenance, not a clock reading). */
const BY = 'you';
const EXAMPLES_DATE = '4 Oct 2026';
const RULES_DATE = '5 Oct 2026';
/** Fixed, so the seeded spec (and its hashes) never depend on the clock. 5 Oct 2026, 00:00 UTC. */
export const SEEDED_PINNED_AT = Date.UTC(2026, 9, 5);
export const SEEDED_PIN_ID = 'seeded-locked-top5';

export const AGREEMENT_DOC =
  'Returns the 5 customers with the highest revenue as { customer, revenue }, highest first; customers tied on revenue are listed in alphabetical order. ' +
  'Only orders with status "paid" count: refunded and pending orders are not revenue yet. ' +
  'Each order number (id) is counted once: when the export repeats an order number, only its first row counts. ' +
  "A row's revenue is quantity × unitPrice × (1 − discount), where a missing (null) discount means no discount; a customer's revenue is the sum over their counted rows, rounded to cents. " +
  'Customers are grouped by name exactly as written. With fewer than 5 customers all of them come back; with no rows, an empty list.';

/** The 6 examples: name (the design's words), how many made-up rows, and the test body. */
const EXAMPLES: ReadonlyArray<{ name: string; rows: number; body: string }> = [
  {
    name: 'One order of 2 × $10.00 gives $20.00',
    rows: 1,
    body: `eq(${AGREEMENT_FN}([row(1, 'Customer A', 2, 10)]), [{ customer: 'Customer A', revenue: 20 }]);`,
  },
  {
    name: 'A 25% discount on 4 × $5.00 gives $15.00',
    rows: 1,
    body: `eq(${AGREEMENT_FN}([row(1, 'Customer A', 4, 5, { discount: 0.25 })]), [{ customer: 'Customer A', revenue: 15 }]);`,
  },
  {
    name: 'Two customers tied at $50.00 are listed A to Z',
    rows: 2,
    body: `eq(${AGREEMENT_FN}([row(1, 'Customer B', 5, 10), row(2, 'Customer A', 2, 25)]), [
    { customer: 'Customer A', revenue: 50 },
    { customer: 'Customer B', revenue: 50 },
  ]);`,
  },
  {
    name: 'Seven customers: only the top 5 come back',
    rows: 7,
    body: `const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => row(i + 1, 'Customer ' + c, i + 1, 10));
  eq(${AGREEMENT_FN}(seven), [
    { customer: 'Customer G', revenue: 70 },
    { customer: 'Customer F', revenue: 60 },
    { customer: 'Customer E', revenue: 50 },
    { customer: 'Customer D', revenue: 40 },
    { customer: 'Customer C', revenue: 30 },
  ]);`,
  },
  {
    name: 'An empty file gives an empty list',
    rows: 0,
    body: `eq(${AGREEMENT_FN}([]), []);`,
  },
  {
    name: 'One customer in two countries is one line',
    rows: 2,
    body: `eq(${AGREEMENT_FN}([row(1, 'Customer A', 1, 10, { country: 'France' }), row(2, 'Customer A', 2, 10, { country: 'Japan' })]), [
    { customer: 'Customer A', revenue: 30 },
  ]);`,
  },
];

/** The 2 house rules: name (the design's words) and why (design copy). */
export const HOUSE_RULES: ReadonlyArray<{ name: string; why: string }> = [
  { name: 'Revenue counts paid orders only', why: "refunds and pending orders aren't revenue yet" },
  { name: 'Each order number is counted once', why: 'the export repeats some orders' },
];

const TESTS_HEADER = String.raw`// Made-up rows: every example order is paid and has its own order number, so the examples test the arithmetic,
// the ranking and the grouping; the house rules (properties) test refunds and repeated order numbers.
const row = (id: number, customer: string, quantity: number, unitPrice: number, more: { discount?: number | null; country?: string } = {}) => ({
  id,
  orderDate: '2024-01-01',
  customer,
  email: 'made.up@example.com',
  country: more.country ?? 'France',
  product: 'Made-up item',
  quantity,
  unitPrice,
  discount: more.discount ?? null,
  status: 'paid',
});
`;

export const AGREEMENT_TESTS =
  TESTS_HEADER + EXAMPLES.map((e) => `\ntest(${JSON.stringify(e.name)}, () => {\n  ${e.body}\n});\n`).join('');

export const AGREEMENT_PROPERTIES = String.raw`// Made-up tables: up to 12 orders from at most 5 customers (so every customer is in the top 5), prices in whole
// cents, the discounts the real file uses, and a mix of paid, refunded and pending orders with unique order numbers.
const madeUpRow = fc.record({
  customer: fc.constantFrom('Customer A', 'Customer B', 'Customer C', 'Customer D', 'Customer E'),
  country: fc.constantFrom('France', 'Japan', 'Brazil'),
  quantity: fc.integer({ min: 1, max: 9 }),
  priceCents: fc.integer({ min: 1, max: 20000 }),
  discount: fc.constantFrom(null, null, 0.05, 0.1, 0.15, 0.2, 0.25),
  status: fc.constantFrom('paid', 'paid', 'paid', 'refunded', 'pending'),
});
const madeUpTable = fc.array(madeUpRow, { minLength: 1, maxLength: 12 }).map((rs) =>
  rs.map((r, i) => ({
    id: 7001 + i,
    orderDate: '2024-01-01',
    customer: r.customer,
    email: 'made.up@example.com',
    country: r.country,
    product: 'Made-up item',
    quantity: r.quantity,
    unitPrice: r.priceCents / 100,
    discount: r.discount,
    status: r.status,
  })),
);

property(${JSON.stringify(HOUSE_RULES[0]!.name)}, [madeUpTable], (table) => {
  // leaving out every refunded and pending order must not change the answer
  const paidOnly = ${AGREEMENT_FN}(table.filter((r) => r.status === 'paid'));
  eq(${AGREEMENT_FN}(table), paidOnly);
}, { numRuns: ${MADE_UP_TABLES} });

property(${JSON.stringify(HOUSE_RULES[1]!.name)}, [madeUpTable, fc.array(fc.nat(), { minLength: 1, maxLength: 4 })], (table, picks) => {
  // the export repeating some orders (same order number, email written differently) must not change the answer
  const repeats = picks.map((p) => ({ ...table[p % table.length], email: 'MADE.UP@example.com ' }));
  const once = ${AGREEMENT_FN}(table);
  eq(${AGREEMENT_FN}(table.concat(repeats)), once);
}, { numRuns: ${MADE_UP_TABLES} });
`;

export interface AgreementItem {
  /** What the chip says. */
  name: string;
  /** Provenance line, design copy: `made-up · 1 row · you · 4 Oct 2026`. */
  note: string;
}

export interface LockedAnswer extends AgreementItem {
  customer: string;
  /** `$2,252.07` */
  amount: string;
  value: number;
  /** The pin's label: the call it locks, e.g. `topCustomersByRevenue(orders)`. */
  call: string;
  /** The whole locked list (the pin checks all 5 rows). */
  expected: Array<{ customer: string; revenue: number }>;
}

export interface AgreementSummary {
  examples: AgreementItem[];
  locked: LockedAnswer[];
  houseRules: Array<AgreementItem & { why: string }>;
  /** fast-check runs per house rule. */
  tables: number;
  /** `6 examples · 1 locked answer · 2 house rules` */
  countLine: string;
}

export interface SeededAgreement {
  spec: FunctionSpec;
  /** === spec.pins */
  pins: Pin[];
  summary: AgreementSummary;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The locked top 5 of the real orders: paid orders only, each order number once. */
export function lockedTop5(): Array<{ customer: string; revenue: number }> {
  return topCustomers(bundledOrders(), AGREED).map((r) => ({ customer: r.name, revenue: r.value }));
}

/**
 * The seeded agreement for (sample, question) on the bound dataset, or null when the demo has none (every question
 * but orders.csv · top customers by revenue). `dataset` must be the orders sample as bound (its hash is what the pin
 * refers to; its type is the parameter's type).
 */
export function seedAgreement(sampleId: SampleId | null, questionId: string, dataset: DatasetRef): SeededAgreement | null {
  if (sampleId !== 'orders' || questionId !== AGREEMENT_QUESTION_ID) return null;
  const needed = ['id', 'customer', 'quantity', 'unitPrice', 'discount', 'status'];
  if (!needed.every((c) => dataset.columns.some((col) => col.name === c))) return null;

  const expected = lockedTop5();
  const call = `${AGREEMENT_FN}(${dataset.name})`;
  const pin: Pin = {
    id: SEEDED_PIN_ID,
    label: call,
    args: [{ kind: 'dataset', name: dataset.name, hash: dataset.hash }],
    expected: encodeValue(expected),
    pinnedAt: SEEDED_PINNED_AT,
  };
  const spec: FunctionSpec = {
    name: AGREEMENT_FN,
    params: [{ name: 'rows', type: `${dataset.typeName}[]` }],
    returns: 'Array<{ customer: string; revenue: number }>',
    doc: AGREEMENT_DOC,
    tests: AGREEMENT_TESTS,
    properties: AGREEMENT_PROPERTIES,
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'user',
    pins: [pin],
    typeDecls: dataset.typeDecl,
  };
  const first = expected[0]!;
  const summary: AgreementSummary = {
    examples: EXAMPLES.map((e) => ({ name: e.name, note: `made-up · ${plural(e.rows, 'row')} · ${BY} · ${EXAMPLES_DATE}` })),
    locked: [
      {
        name: `${first.customer} = ${formatMoney(first.revenue)}`,
        note: `Locked · ${BY} · ${RULES_DATE}`,
        customer: first.customer,
        amount: formatMoney(first.revenue),
        value: first.revenue,
        call,
        expected,
      },
    ],
    houseRules: HOUSE_RULES.map((h) => ({ name: h.name, why: h.why, note: `${BY} · ${RULES_DATE} · Why: ${h.why}` })),
    tables: MADE_UP_TABLES,
    countLine: `${plural(EXAMPLES.length, 'example')} · ${plural(1, 'locked answer')} · ${plural(HOUSE_RULES.length, 'house rule')}`,
  };
  return { spec, pins: spec.pins!, summary };
}

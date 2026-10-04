import type { FunctionSpec } from '../types';
import { specFromCall } from '../gates/source';
import type { ExampleDef } from './index';

/*
 * orders — the data scratchpad's example, and the spec-less path.
 *
 * Clicking it binds the bundled, fictional orders.csv (332 rows: 320 orders plus 12 duplicate rows; some orders are
 * refunded, about a third carry a discount, the rest have none) to `rows`, and pre-types
 * `topCustomersByRevenue(rows)`. There is NO spec: the function is grown from the call alone. The model sees the name,
 * the type of `rows` (`Row[]`, with `type Row = {…}` inferred from the data) and, in live mode with samples on, three
 * sample rows spread across the data. Only Compile and Invariants gate it (pure, bounded, on the real rows), so the
 * result is the user's to judge: "Pin as test" turns it into a unit test the next regeneration must reproduce.
 *
 * "Break it" then states the contract the call never had: refunds don't count, a discount reduces revenue, money is
 * rounded to cents, ties break alphabetically. A body that sums quantity × unitPrice over every row (the natural
 * guess from the name) is now wrong on the real data; examples.test.ts proves it with the actual numbers.
 */

export const ORDERS_FN = 'topCustomersByRevenue';

/**
 * The spec a call over the bundled rows produces (what the engine builds with specFromCall from the argument's
 * dataset type), tagged with this example. `typeDecls` is the dataset's `type Row = {…}`.
 */
export function ordersCallSpec(typeDecls: string): FunctionSpec {
  const spec = specFromCall(ORDERS_FN, ['Row[]'], { typeDecls });
  spec.exampleId = 'orders';
  return spec;
}

const DOC_AFTER_BREAK =
  'Returns the 5 customers with the highest revenue as { customer, revenue }, highest first, ties broken alphabetically by customer. A line\'s revenue is quantity × unitPrice × (1 − discount), where a missing discount means no discount; revenue is rounded to cents; orders with status "refunded" do not count.';

/** The natural reading of the name alone: every row counts at full price. Fine before the break, wrong after it. */
export const ORDERS_NAIVE = `const totals = new Map<string, number>();
for (const r of arg0) totals.set(r.customer, (totals.get(r.customer) ?? 0) + r.quantity * r.unitPrice);
return [...totals]
  .map(([customer, revenue]) => ({ customer, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue)
  .slice(0, 5);`;

/** What the broken spec asks for: refunds skipped, discounts applied, cents, alphabetical ties. */
export const ORDERS_GOOD = `const totals = new Map<string, number>();
for (const r of arg0) {
  if (r.status === "refunded") continue;
  const discount = r.discount ?? 0;
  totals.set(r.customer, (totals.get(r.customer) ?? 0) + r.quantity * r.unitPrice * (1 - discount));
}
return [...totals]
  .map(([customer, revenue]) => ({ customer, revenue: Math.round(revenue * 100) / 100 }))
  .sort((a, b) => b.revenue - a.revenue || (a.customer < b.customer ? -1 : a.customer > b.customer ? 1 : 0))
  .slice(0, 5);`;

export const orders: ExampleDef = {
  id: 'orders',
  title: 'orders',
  blurb:
    'Loads a bundled orders.csv into rows. There is no spec: the model sees only the type of rows and three sample rows, and only Compile and Invariants gate it, so the result is yours to judge. Pin it as a test.',
  call: `${ORDERS_FN}(rows)`,
  fn: ORDERS_FN,
  dataset: { name: 'rows', filename: 'orders.csv' },
  breakIt: {
    label: 'Break it: refunds and discounts',
    description:
      'The doc now says what revenue means: refunded orders do not count and discounts reduce it, rounded to cents, ties alphabetical. A body that summed every row at full price is now wrong on the real data, so the function must be regenerated (and a result you pinned earlier may disagree with it).',
  },
  breakPatch: { doc: DOC_AFTER_BREAK },
  goodBodies: [
    ORDERS_NAIVE,
    // no spec yet: any honest reading of the name is acceptable to the gates
    ORDERS_GOOD,
  ],
  badBodies: [
    {
      body: `arg0.sort((a, b) => b.quantity * b.unitPrice - a.quantity * a.unitPrice);
return arg0.slice(0, 5).map((r) => ({ customer: r.customer, revenue: r.quantity * r.unitPrice }));`,
      rejectedBy: 'invariants',
      why: 'Sorts the caller\'s rows in place; the Invariants replay runs it on frozen rows and the mutation throws (pure).',
    },
    {
      body: `const picked = arg0.filter(() => Math.random() < 0.5);
return picked.slice(0, 5).map((r) => ({ customer: r.customer, revenue: r.quantity * r.unitPrice }));`,
      rejectedBy: 'invariants',
      why: 'Samples the rows with Math.random; the masked global throws (pure).',
    },
    {
      body: `return arg0.slice(0, 5).map((r) => ({ customer: r.customer, revenue: r.quantity * r.price }));`,
      rejectedBy: 'compile',
      why: 'Reads a column that is not in the data (`price`); the Row type makes it a compile error.',
    },
  ],
  goodBodiesAfterBreak: [ORDERS_GOOD],
};

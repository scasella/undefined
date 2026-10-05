/**
 * Pins every landing figure, computed from the real bundledOrders(), to the design's strings (V3-Door-Landing) and to
 * docs/FRONT-DOOR.md "Verified numbers". The literals live here only; the page reads figures.ts.
 */
import { describe, expect, it } from 'vitest';
import { bundledOrders, BUNDLED_ORDERS_CSV } from '../../data/orders';
import { parseCsv } from '../../data/csv';
import { coerceCsvRows } from '../../data/infer';
import {
  AGREED,
  biggestFall,
  DEFAULT_MADE_UP_TABLE,
  definitionLadder,
  discountedRowCount,
  formatCount,
  formatMoney,
  ILLUSTRATIVE_BREAKS,
  ladderLeader,
  leftTheList,
  madeUpTableLabel,
  madeUpTableNote,
  offLadderNote,
  repeatedOrderNumbers,
  revenueByCountry,
  statusCounts,
  thrownOutDraft,
  topCustomers,
  type Ranked,
} from './figures';

const rows = bundledOrders();
const show = (xs: Ranked[]) => xs.map((r) => `${r.name} ${formatMoney(r.value)}`);

describe('formatting', () => {
  it('money and counts', () => {
    expect(formatMoney(2252.07)).toBe('$2,252.07');
    expect(formatMoney(5527)).toBe('$5,527.00');
    expect(formatMoney(1909.9)).toBe('$1,909.90');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(-1)).toBe('-$1.00');
    expect(formatMoney(1234567.891)).toBe('$1,234,567.89');
    expect(formatCount(1214)).toBe('1,214');
    expect(formatCount(332)).toBe('332');
  });
});

describe('orders.csv figures', () => {
  it('the same figures from the CSV path the engine binds', () => {
    const bound = coerceCsvRows(parseCsv(BUNDLED_ORDERS_CSV()).rows).rows;
    expect(bound).toHaveLength(332);
    expect(topCustomers(bound, AGREED)).toEqual(topCustomers(rows, AGREED));
    expect(revenueByCountry(bound)).toEqual(revenueByCountry(rows));
  });

  it('status over all 332 rows: paid 258, pending 47, refunded 27; 12 repeated order numbers; 100 discounted rows', () => {
    expect(rows).toHaveLength(332);
    expect(statusCounts(rows)).toEqual([
      { status: 'paid', count: 258 },
      { status: 'pending', count: 47 },
      { status: 'refunded', count: 27 },
    ]);
    expect(repeatedOrderNumbers(rows)).toBe(12);
    expect(discountedRowCount(rows)).toBe(100);
  });

  it('top 5 by revenue under the three ladder definitions', () => {
    expect(show(topCustomers(rows, { paidOnly: false, once: false }))).toEqual([
      'Puddlesworth Inc $2,599.13',
      'Kettlewhistle Farms $2,359.63',
      'Brambleskate Ltd $2,355.91',
      'Chef Ravioli Starbright $2,260.06',
      'Grommet & Gasket LLC $2,175.72',
    ]);
    expect(show(topCustomers(rows, { paidOnly: true, once: false }))).toEqual([
      'Puddlesworth Inc $2,387.13',
      'Chef Ravioli Starbright $2,252.07',
      'Grommet & Gasket LLC $2,148.72',
      'Thistlewhump Bakery $1,909.90',
      'Kettlewhistle Farms $1,870.33',
    ]);
    expect(show(topCustomers(rows, AGREED))).toEqual([
      'Chef Ravioli Starbright $2,252.07',
      'Grommet & Gasket LLC $2,148.72',
      'Puddlesworth Inc $2,114.13',
      'Thistlewhump Bakery $1,909.90',
      'Kettlewhistle Farms $1,870.33',
    ]);
  });

  it('revenue by country, every row: United States … Brazil', () => {
    expect(show(revenueByCountry(rows))).toEqual([
      'United States $9,987.42',
      'Netherlands $8,882.80',
      'India $6,817.11',
      'France $6,223.27',
      'Brazil $5,527.00',
    ]);
  });
});

describe('definition ladder (Fig. 2)', () => {
  const ladder = definitionLadder(rows);

  it('three columns with the design tags, heads and rows', () => {
    expect(ladder.columns.map((c) => [c.tag, c.head])).toEqual([
      ["THE AI'S FIRST ASSUMPTION", 'Every row counted'],
      ['+ ONE HOUSE RULE', 'Paid orders only'],
      ['+ TWO HOUSE RULES', 'Paid orders only, each order number once'],
    ]);
    expect(ladder.columns.map((c) => c.rows.map((r) => [r.rank, r.name, r.amount, r.note]))).toEqual([
      [
        ['#1', 'Puddlesworth Inc', '$2,599.13', ''],
        ['#2', 'Kettlewhistle Farms', '$2,359.63', ''],
        ['#3', 'Brambleskate Ltd', '$2,355.91', ''],
        ['#4', 'Chef Ravioli Starbright', '$2,260.06', ''],
        ['#5', 'Grommet & Gasket LLC', '$2,175.72', ''],
      ],
      [
        ['#1', 'Puddlesworth Inc', '$2,387.13', ''],
        ['#2', 'Chef Ravioli Starbright', '$2,252.07', ''],
        ['#3', 'Grommet & Gasket LLC', '$2,148.72', ''],
        ['#4', 'Thistlewhump Bakery', '$1,909.90', ''],
        ['#5', 'Kettlewhistle Farms', '$1,870.33', ' ↓ from #2 to #5'],
      ],
      [
        ['#1', 'Chef Ravioli Starbright', '$2,252.07', ''],
        ['#2', 'Grommet & Gasket LLC', '$2,148.72', ''],
        ['#3', 'Puddlesworth Inc', '$2,114.13', ''],
        ['#4', 'Thistlewhump Bakery', '$1,909.90', ''],
        ['#5', 'Kettlewhistle Farms', '$1,870.33', ''],
      ],
    ]);
  });

  it('the caption says who fell and who left, computed', () => {
    expect(ladder.fall).toEqual({ name: 'Kettlewhistle Farms', from: 2, to: 5 });
    expect(ladder.left).toEqual(['Brambleskate Ltd']);
    expect(ladder.caption).toBe(
      'Fig. 2 · Top 5 customers by revenue under three definitions · orders.csv · 332 rows · fictional sample. Kettlewhistle Farms falls from #2 to #5. Brambleskate Ltd is no longer in the top 5.',
    );
  });

  it('biggestFall / leftTheList on small lists', () => {
    const a = [{ name: 'A', value: 3 }, { name: 'B', value: 2 }, { name: 'C', value: 1 }];
    expect(biggestFall(a, a)).toBeNull();
    expect(biggestFall(a, [a[1]!, a[2]!, a[0]!])).toEqual({ name: 'A', from: 1, to: 3 });
    expect(leftTheList(a, [a[0]!])).toEqual(['B', 'C']);
  });

  it('#1 under each switch setting (Version 1 / 2 / 3 leaders) and the off-ladder mix', () => {
    const at = (paidOnly: boolean, once: boolean) => {
      const l = ladderLeader(rows, { paidOnly, once });
      return [l.column, l.name, l.amount];
    };
    expect(at(false, false)).toEqual([0, 'Puddlesworth Inc', '$2,599.13']);
    expect(at(true, false)).toEqual([1, 'Puddlesworth Inc', '$2,387.13']);
    expect(at(true, true)).toEqual([2, 'Chef Ravioli Starbright', '$2,252.07']);
    expect(at(false, true)).toEqual([null, 'Kettlewhistle Farms', '$2,359.63']);
    expect(offLadderNote(rows)).toBe(
      "That mix isn't one of the three columns below. Every row counted, each order number once: Kettlewhistle Farms leads with $2,359.63.",
    );
  });
});

describe('the thrown-out first draft', () => {
  it('Chef Ravioli Starbright: expected $2,252.07, got $2,260.06, because it counted a refunded order', () => {
    const d = thrownOutDraft(rows)!;
    expect(d).not.toBeNull();
    expect([d.customer, d.expected, d.got, d.counted]).toEqual(['Chef Ravioli Starbright', '$2,252.07', '$2,260.06', 'a refunded order']);
    expect(d.draftSentence).toBe('The draft counted a refunded order.');
    expect(d.why).toBe(
      "It didn't match the answer you locked: Chef Ravioli Starbright came out at $2,260.06, not $2,252.07, because it counted a refunded order. You never saw it.",
    );
  });
});

describe('evidence dots (illustrative narrative, ported verbatim)', () => {
  it('matches the design formula, including the default dot #37', () => {
    expect(DEFAULT_MADE_UP_TABLE).toBe(36);
    expect(madeUpTableNote(36)).toBe('Made-up table #37 · 11 orders · 3 refunded · your rule left them out ✓');
    expect(madeUpTableNote(0)).toBe('Made-up table #1 · 11 orders · 3 refunded · your rule left them out ✓');
    expect(madeUpTableNote(1)).toBe('Made-up table #2 · 9 orders · 2 refunded · your rule left them out ✓');
    expect(madeUpTableLabel(0)).toBe('Made-up table 1, held up');
    for (let i = 0; i < 100; i++) expect(madeUpTableNote(i)).toMatch(/^Made-up table #\d+ · \d+ orders · \d refunded( · \d pending)? · your rule left them out ✓$/);
  });

  it('the stress strip lists 12 illustrative breaks, the last one missed', () => {
    expect(ILLUSTRATIVE_BREAKS).toHaveLength(12);
    expect(ILLUSTRATIVE_BREAKS[11]).toBe('single-item discount');
  });
});

import { describe, expect, it } from 'vitest';
import { inferDataset } from './infer';
import { bundledOrders } from './orders';
import { BANNED_NAME, pascalPart, suggestCalls } from './suggest';

const suggest = (name: string, rows: Array<Record<string, unknown>>) => suggestCalls({ name, columns: inferDataset(rows).columns, rows });

describe('suggested first calls on loaded data', () => {
  it('reads column names as identifier parts', () => {
    expect(pascalPart('unit_price')).toBe('UnitPrice');
    expect(pascalPart('Order Date')).toBe('OrderDate');
    expect(pascalPart('status')).toBe('Status');
    expect(pascalPart('ID')).toBe('Id');
    expect(pascalPart('été')).toBe('Ete');
    expect(pascalPart('2024')).toBe('');
    expect(pascalPart('名前')).toBe('');
  });

  it('suggests count, total and top-5 calls over the bundled orders, named after what they return', () => {
    const s = suggest('sales', bundledOrders() as unknown as Array<Record<string, unknown>>);
    expect(s.map((x) => x.call)).toEqual(['countByStatus(sales)', 'totalQuantityByStatus(sales)', 'top5CustomersByQuantity(sales)']);
    for (const x of s) {
      expect(x.call).toBe(`${x.fn}(sales)`);
      expect(x.fn).not.toMatch(BANNED_NAME);
      expect(x.what.length).toBeGreaterThan(5);
    }
  });

  it('prefers a measure-named number column, and is deterministic', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, region: ['north', 'south', 'east'][i % 3], seller: `s${i}`, amount: (i * 7) % 50 }));
    const a = suggest('deals', rows);
    expect(a.map((x) => x.fn)).toEqual(['countByRegion', 'totalAmountByRegion', 'top5SellersByAmount']);
    expect(suggest('deals', rows)).toEqual(a);
  });

  it('falls back to average and date range when there is no category', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ createdAt: `2024-0${(i % 9) + 1}-1${i % 10}`, score: i * 1.5 }));
    expect(suggest('events', rows).map((x) => x.call)).toEqual(['averageScore(events)', 'createdAtRange(events)']);
  });

  it('never suggests a name with a vague word, and nothing for data it cannot read', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ dataSource: i % 2 ? 'a' : 'b', runtime: i }));
    const s = suggest('logs', rows);
    for (const x of s) expect(x.fn).not.toMatch(BANNED_NAME);
    expect(s).toEqual([]);
    expect(suggest('t', [{ note: 'x' }, { note: 'y' }])).toEqual([]);
    expect(suggestCalls({ name: 'not valid', columns: [{ name: 'a', type: 'number' }], rows: [{ a: 1 }] })).toEqual([]);
  });

  it('treats a column whose values are all different as names, not categories', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ customer: `c${i}`, spend: i }));
    expect(suggest('buyers', rows).map((x) => x.fn)).toEqual(['top5CustomersBySpend', 'averageSpend']);
  });
});

describe('suggested calls: adversarial headers (review)', () => {
  it('columns whose names read the same (Status/status, order date/order_date) are never used: the name would be ambiguous', () => {
    const rows = [
      { Status: 'a', status: 'b', STATUS: 'c', amount: 1 },
      { Status: 'a', status: 'b', STATUS: 'c', amount: 2 },
      { Status: 'b', status: 'c', STATUS: 'd', amount: 3 },
    ];
    expect(suggest('sales', rows).map((x) => x.fn)).toEqual(['averageAmount']);
    const dated = [
      { 'order date': '2024-01-01', order_date: '2024-02-01', region: 'n', amount: 1 },
      { 'order date': '2024-01-02', order_date: '2024-02-02', region: 'n', amount: 2 },
      { 'order date': '2024-01-03', order_date: '2024-02-03', region: 's', amount: 3 },
    ];
    expect(suggest('sales', dated).some((x) => /OrderDate|orderDate/.test(x.fn))).toBe(false);
  });
  it('never suggests a function named like the dataset itself; names stay valid, unique and free of banned words', () => {
    const rows = [{ amount: 1 }, { amount: 2 }];
    expect(suggest('averageAmount', rows).map((x) => x.fn)).not.toContain('averageAmount');
    const weird = [
      { '': 'x', '😀': 'a', '1': 'p', class: 'k', __proto__x: 'q', amount: 1 },
      { '': 'y', '😀': 'b', '1': 'p', class: 'k', __proto__x: 'q', amount: 2 },
      { '': 'x', '😀': 'a', '1': 'r', class: 'j', __proto__x: 'z', amount: 3 },
    ];
    const out = suggest('sales', weird);
    expect(new Set(out.map((x) => x.fn)).size).toBe(out.length);
    for (const s of out) {
      expect(s.fn).toMatch(/^[A-Za-z_$][\w$]*$/);
      expect(s.fn).not.toMatch(BANNED_NAME);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { bundledSales, SALES_COLUMNS, SALES_CSV, SALES_FILENAME, SALES_ROW_COUNT } from './sales';
import { parseCsv } from './csv';
import { coerceCsvRows, inferDataset } from './infer';
import { sampleForModel } from './sample';

type Row = { orderId: number; orderDate: string; customer: string; region: string; status: string; amount: number };

/** Sum in integer cents, so the checks are exact. */
function centsBy(rows: Row[], key: 'region' | 'customer'): Array<[string, number]> {
  const t = new Map<string, number>();
  for (const r of rows) t.set(r[key], (t.get(r[key]) ?? 0) + Math.round(r.amount * 100));
  return [...t].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

describe('sales-q3.csv (the second sample)', () => {
  // exactly what the engine binds: CSV parsed, columns coerced
  const parsed = parseCsv(SALES_CSV());
  const { rows: bound, coerced } = coerceCsvRows(parsed.rows);
  const rows = bound as unknown as Row[];

  it('has 48 rows and 6 columns, and the CSV round-trips to bundledSales()', () => {
    expect(SALES_FILENAME).toBe('sales-q3.csv');
    expect(rows).toHaveLength(48);
    expect(SALES_ROW_COUNT).toBe(48);
    expect(parsed.headers).toEqual(['orderId', 'orderDate', 'customer', 'region', 'status', 'amount']);
    expect(parsed.headers).toEqual([...SALES_COLUMNS]);
    expect(parsed.warnings).toEqual([]);
    expect(bound).toEqual(bundledSales());
    expect(new Set(rows.map((r) => r.orderId)).size).toBe(48);
    expect(rows.map((r) => r.orderId)).toEqual(Array.from({ length: 48 }, (_, i) => 5001 + i));
  });

  it('first rows, middle row and last row are the published ones', () => {
    const line = (r: Row) => [r.orderId, r.orderDate, r.customer, r.region, r.status, r.amount.toFixed(2)].join(' ');
    expect(rows.slice(0, 3).map(line)).toEqual([
      '5001 2024-07-17 Puddlesworth Inc west refunded 279.34',
      '5002 2024-07-15 Thistlewhump Bakery north pending 792.90',
      '5003 2024-07-06 Thistlewhump Bakery north paid 184.02',
    ]);
    expect(line(rows[24]!)).toBe('5025 2024-08-27 Puddlesworth Inc west paid 710.88');
    expect(line(rows[47]!)).toBe('5048 2024-09-08 Puddlesworth Inc west paid 583.54');
    expect(SALES_CSV().split('\n')[2]).toBe('5002,2024-07-15,Thistlewhump Bakery,north,pending,792.90');
  });

  it('statuses: paid 32, refunded 10, pending 6', () => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    expect(c).toEqual({ paid: 32, refunded: 10, pending: 6 });
    // "16 of the 48 rows are refunded or pending"
    expect(rows.filter((r) => r.status !== 'paid')).toHaveLength(16);
  });

  it('total amount by region (every row): west 6,978.10 · north 6,462.07 · south 3,593.90 · east 2,732.19', () => {
    expect(centsBy(rows, 'region')).toEqual([
      ['west', 697810],
      ['north', 646207],
      ['south', 359390],
      ['east', 273219],
    ]);
  });

  it('top 5 customers by total amount (every row), and nobody else reaches #5', () => {
    const all = centsBy(rows, 'customer');
    expect(all.slice(0, 5)).toEqual([
      ['Puddlesworth Inc', 416337],
      ['Brambleskate Ltd', 400023],
      ['Nimbus Pickle Works', 353737],
      ['Kettlewhistle Farms', 344073],
      ['Thistlewhump Bakery', 238137],
    ]);
    for (const [, c] of all.slice(5)) expect(c).toBeLessThan(238137);
  });

  it('dates are in Q3 2024; amounts are positive whole cents', () => {
    for (const r of rows) {
      expect(r.orderDate >= '2024-07-01' && r.orderDate <= '2024-09-30', r.orderDate).toBe(true);
      expect(Number.isNaN(Date.parse(r.orderDate))).toBe(false);
      expect(r.amount).toBeGreaterThan(0);
      expect(Math.round(r.amount * 100) / 100).toBe(r.amount);
    }
  });

  it('the rows the AI is shown are orders 5001, 5025 and 5048', () => {
    const s = sampleForModel(bound);
    expect((s.rows as Row[]).map((r) => r.orderId)).toEqual([5001, 5025, 5048]);
  });

  it('infers the column types the design shows (orderId and amount numbers, the rest text, dates kept as strings)', () => {
    expect(coerced).toEqual({ orderId: 'number', orderDate: 'string', customer: 'string', region: 'string', status: 'string', amount: 'number' });
    const { columns, typeDecl } = inferDataset(bound);
    expect(columns.map((c) => `${c.name}:${c.type}`)).toEqual([
      'orderId:number',
      'orderDate:string',
      'customer:string',
      'region:string',
      'status:string',
      'amount:number',
    ]);
    expect(typeDecl).toBe('type Row = { orderId: number; orderDate: string; customer: string; region: string; status: string; amount: number }');
  });
});

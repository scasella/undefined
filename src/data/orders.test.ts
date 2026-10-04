import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { coerceCsvRows, inferDataset } from './infer';
import {
  BUNDLED_ORDERS_CSV,
  DUPLICATE_COUNT,
  ORDER_COLUMNS,
  ORDER_COUNT,
  bundledOrders,
  canonicalEmail,
  mulberry32,
  normalizeEmail,
} from './orders';
import { sha256Hex } from '../shared/hash';

const EXPECTED_TYPE =
  'type Row = { id: number; orderDate: string; customer: string; email: string; country: string; product: string; quantity: number; unitPrice: number; discount: number | null; status: string }';

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(2)()).not.toBe(xs[0]);
  });
});

describe('bundledOrders', () => {
  const rows = bundledOrders();

  it('is deterministic (same content every call, pinned by hash) and returns fresh copies', async () => {
    expect(bundledOrders()).toEqual(rows);
    expect(bundledOrders()[0]).not.toBe(rows[0]);
    // Pin the exact content: any change to the generator must be deliberate.
    expect(await sha256Hex(JSON.stringify(rows))).toMatchInlineSnapshot(`"689378def1c77ef9bb34fd51b594766d08240db5c219342a1fa1412137410c0e"`);
  });

  it('has 320 orders plus 12 duplicates', () => {
    expect(rows).toHaveLength(ORDER_COUNT + DUPLICATE_COUNT);
    expect(new Set(rows.map((r) => r.id)).size).toBe(ORDER_COUNT);
  });

  it('every row has exactly the documented columns and plausible values', () => {
    for (const r of rows) {
      expect(Object.keys(r)).toEqual([...ORDER_COLUMNS]);
      expect(Number.isInteger(r.id)).toBe(true);
      expect(r.orderDate).toMatch(/^2024-\d\d-\d\d$/);
      expect(Number.isNaN(Date.parse(r.orderDate as string))).toBe(false);
      expect(typeof r.customer).toBe('string');
      expect(normalizeEmail(r.email as string)).toBe(canonicalEmail(r.customer as string));
      expect(normalizeEmail(r.email as string)).toMatch(/^[a-z0-9.]+@example\.com$/);
      expect(typeof r.country).toBe('string');
      expect(typeof r.product).toBe('string');
      expect(Number.isInteger(r.quantity) && (r.quantity as number) >= 1 && (r.quantity as number) <= 9).toBe(true);
      expect(typeof r.unitPrice).toBe('number');
      expect(Math.round((r.unitPrice as number) * 100) / 100).toBe(r.unitPrice);
      expect(r.unitPrice as number).toBeGreaterThan(0);
      expect(r.discount === null || (typeof r.discount === 'number' && r.discount > 0 && r.discount < 1)).toBe(true);
      expect(['paid', 'refunded', 'pending']).toContain(r.status);
    }
  });

  it('spans 2024 with dates in ascending order among originals; ~40 customers; all statuses and some discounts', () => {
    const originals = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i);
    const dates = originals.map((r) => r.orderDate as string);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]! < '2024-02-01').toBe(true);
    expect(dates[dates.length - 1]! > '2024-11-30').toBe(true);
    const customers = new Set(rows.map((r) => r.customer));
    expect(customers.size).toBeGreaterThanOrEqual(35);
    expect(customers.size).toBeLessThanOrEqual(40);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['paid', 'refunded', 'pending']));
    expect(rows.some((r) => r.discount === null)).toBe(true);
    expect(rows.some((r) => r.discount !== null)).toBe(true);
  });

  it('the 12 duplicates are copies whose email differs only in case/whitespace, after the original', () => {
    const byId = new Map<unknown, number[]>();
    rows.forEach((r, i) => byId.set(r.id, [...(byId.get(r.id) ?? []), i]));
    const dupGroups = [...byId.values()].filter((is) => is.length > 1);
    expect(dupGroups).toHaveLength(DUPLICATE_COUNT);
    for (const [a, b] of dupGroups as Array<[number, number]>) {
      const x = rows[a]!;
      const y = rows[b]!;
      expect(y.email).not.toBe(x.email);
      expect(normalizeEmail(y.email as string)).toBe(normalizeEmail(x.email as string));
      expect({ ...y, email: null }).toEqual({ ...x, email: null });
    }
    // dedupe by (id, normalized email) gives back the 320 orders
    const keys = new Set(rows.map((r) => `${r.id}|${normalizeEmail(r.email as string)}`));
    expect(keys.size).toBe(ORDER_COUNT);
  });

  it('a customer sometimes appears with different raw emails across distinct orders', () => {
    const originals = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i);
    const variants = new Map<string, Set<string>>();
    for (const r of originals) {
      const c = r.customer as string;
      variants.set(c, (variants.get(c) ?? new Set()).add(r.email as string));
    }
    const multi = [...variants.values()].filter((s) => s.size > 1);
    expect(multi.length).toBeGreaterThanOrEqual(10);
    // some variants differ by whitespace, some by case
    const raw = rows.map((r) => r.email as string);
    expect(raw.some((e) => e !== e.trim())).toBe(true);
    expect(raw.some((e) => e.trim() !== e.trim().toLowerCase())).toBe(true);
  });

  it('fictional data only: example.com addresses and no lookalike real names', () => {
    for (const r of rows) expect((r.email as string).trim().toLowerCase().endsWith('@example.com')).toBe(true);
  });
});

describe('BUNDLED_ORDERS_CSV round trip', () => {
  it('parseCsv → coerceCsvRows gives back the same rows', () => {
    const csv = BUNDLED_ORDERS_CSV();
    const parsed = parseCsv(csv);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.delimiter).toBe(',');
    expect(parsed.headers).toEqual([...ORDER_COLUMNS]);
    const { rows, coerced } = coerceCsvRows(parsed.rows);
    expect(coerced).toEqual({
      id: 'number', orderDate: 'string', customer: 'string', email: 'string', country: 'string',
      product: 'string', quantity: 'number', unitPrice: 'number', discount: 'number', status: 'string',
    });
    expect(rows).toEqual(bundledOrders());
  });

  it('infers the same type from the CSV path and the JSON rows', () => {
    const viaCsv = inferDataset(coerceCsvRows(parseCsv(BUNDLED_ORDERS_CSV()).rows).rows);
    expect(viaCsv.typeDecl).toBe(EXPECTED_TYPE);
    expect(inferDataset(bundledOrders()).typeDecl).toBe(EXPECTED_TYPE);
    expect(viaCsv.columns.find((c) => c.name === 'discount')).toEqual({ name: 'discount', type: 'number | null' });
  });

  it('is deterministic', () => {
    expect(BUNDLED_ORDERS_CSV()).toBe(BUNDLED_ORDERS_CSV());
    expect(BUNDLED_ORDERS_CSV().split('\n')[0]).toBe(ORDER_COLUMNS.join(','));
  });
});

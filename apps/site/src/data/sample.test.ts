import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DatasetRef } from '@scasella/undefined-engine/types';
import { describeSend, sampleForModel, sampleIndices } from './sample';
import { bundledOrders } from './orders';

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

describe('sampleIndices', () => {
  it('is evenly spaced: first, middle, last', () => {
    expect(sampleIndices(101, 3)).toEqual([0, 50, 100]);
    expect(sampleIndices(10, 4)).toEqual([0, 3, 6, 9]);
    expect(sampleIndices(2, 3)).toEqual([0, 1]);
    expect(sampleIndices(5, 1)).toEqual([0]);
    expect(sampleIndices(0, 3)).toEqual([]);
    expect(sampleIndices(5, 0)).toEqual([]);
  });
});

describe('sampleForModel', () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ i, name: `n${i}` }));

  it('picks first, middle and last by default; text is exactly the compact JSON', () => {
    const s = sampleForModel(rows);
    expect(s.rows).toEqual([rows[0], rows[50], rows[100]]);
    expect(s.text).toBe(JSON.stringify(s.rows));
    expect(s.truncated).toBe(true); // rows were left out
    expect(s.valuesCut).toBe(false);
  });

  it('is deterministic', () => {
    expect(sampleForModel(bundledOrders())).toEqual(sampleForModel(bundledOrders()));
  });

  it('all rows when there are few; not truncated', () => {
    const s = sampleForModel([{ a: 1 }, { a: 2 }]);
    expect(s).toEqual({ rows: [{ a: 1 }, { a: 2 }], truncated: false, valuesCut: false, text: '[{"a":1},{"a":2}]' });
  });

  it('cuts long strings to maxCell code points ending in …, without splitting surrogate pairs', () => {
    const s = sampleForModel([{ s: 'a'.repeat(100), e: '😀'.repeat(10), short: 'ok' }], { maxCell: 5 });
    expect(s.rows).toEqual([{ s: 'aaaa…', e: '😀😀😀😀…', short: 'ok' }]);
    expect(s.truncated).toBe(true);
    expect(s.valuesCut).toBe(true);
  });

  it('cuts nested strings and long arrays', () => {
    const s = sampleForModel([{ o: { deep: 'x'.repeat(200) }, tags: Array.from({ length: 30 }, (_, i) => i) }]);
    const row = s.rows[0] as { o: { deep: string }; tags: number[] };
    expect(Array.from(row.o.deep)).toHaveLength(80);
    expect(row.o.deep.endsWith('…')).toBe(true);
    expect(row.tags).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('shrinks cells, then drops rows, to fit maxBytes', () => {
    const wide = Array.from({ length: 50 }, (_, i) => ({ id: i, a: 'α'.repeat(300), b: 'β'.repeat(300), c: 'γ'.repeat(300) }));
    const s = sampleForModel(wide, { maxBytes: 600 });
    expect(bytes(s.text)).toBeLessThanOrEqual(600);
    expect(s.truncated).toBe(true);
    expect(s.rows.length).toBeGreaterThanOrEqual(1);
    expect((s.rows[0] as { id: number }).id).toBe(0);
    expect(s.text).toBe(JSON.stringify(s.rows));
  });

  it('falls back to no rows when even one tiny row cannot fit', () => {
    const s = sampleForModel([{ a: 1, b: 2, c: 3, d: 4 }], { maxBytes: 10 });
    expect(s).toEqual({ rows: [], truncated: true, valuesCut: false, text: '[]' });
  });

  it('never throws on non-JSON values and produces valid JSON', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const s = sampleForModel([{ n: NaN, big: 5n, d: new Date(0), u: undefined, f: () => 1, cyclic }]);
    expect(JSON.parse(s.text)).toEqual([
      { n: 'NaN', big: '5n', d: '1970-01-01T00:00:00.000Z', f: null, cyclic: { a: 1, self: '[Circular]' } },
    ]);
  });

  it('text always fits maxBytes (property)', () => {
    const row = fc.dictionary(fc.string({ maxLength: 6 }), fc.jsonValue({ maxDepth: 3 }), { maxKeys: 8 });
    fc.assert(
      fc.property(
        fc.array(row, { maxLength: 40 }),
        fc.integer({ min: 2, max: 2000 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 6 }),
        (rs, maxBytes, maxCell, count) => {
          const s = sampleForModel(rs, { maxBytes, maxCell, count });
          expect(bytes(s.text)).toBeLessThanOrEqual(maxBytes);
          expect(s.text).toBe(JSON.stringify(s.rows));
          expect(s.rows.length).toBeLessThanOrEqual(Math.min(count, rs.length));
          if (s.rows.length < rs.length) expect(s.truncated).toBe(true);
        },
      ),
      { numRuns: 300, seed: 99 },
    );
  });
});

describe('describeSend', () => {
  const ref: DatasetRef = {
    name: 'rows',
    hash: 'h',
    typeName: 'Row',
    typeDecl: 'type Row = { id: number; customer: string }',
    rowCount: 1234,
    columns: [],
    source: 'paste',
    bytes: 99_999,
  };

  it('says exactly what is sent and what stays', () => {
    const s = sampleForModel([{ id: 1, customer: 'x'.repeat(200) }, { id: 2, customer: 'y' }], {});
    const text = describeSend(ref, s);
    expect(text).toBe(
      `Sent to the model: the type Row (43 bytes: \`type Row = { id: number; customer: string }\`) and 2 sample rows (${bytes(s.text)} bytes of JSON, long values cut) of the 1,234 rows in rows. The other 1,232 rows stay in your browser.`,
    );
  });

  it('handles the whole dataset and an empty sample', () => {
    const all = sampleForModel([{ id: 1, customer: 'a' }]);
    expect(describeSend({ ...ref, rowCount: 1 }, all)).toBe(
      `Sent to the model: the type Row (43 bytes: \`type Row = { id: number; customer: string }\`) and 1 sample row (${bytes(all.text)} bytes of JSON) of the 1 row in rows. That is every row.`,
    );
    const none = { rows: [], truncated: true, valuesCut: false, text: '[]' };
    expect(describeSend(ref, none)).toBe(
      'Sent to the model: the type Row (43 bytes: `type Row = { id: number; customer: string }`) and no sample rows. All 1,234 rows in rows stay in your browser.',
    );
  });
});

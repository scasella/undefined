import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../data/dataset';
import { BUNDLED_ORDERS_CSV } from '../../data/orders';
import { SALES_CSV } from '../../data/sales';
import { columnKind, formatCell, formatExampleRow, sampleFile, sampleFiles, sampleIdFor, SAMPLE_IDS } from './samples';

describe('the two sample files', () => {
  it('orders first, then sales', () => {
    expect(SAMPLE_IDS).toEqual(['orders', 'sales']);
    expect(sampleFiles().map((f) => [f.id, f.filename, f.datasetName])).toEqual([
      ['orders', 'orders.csv', 'rows'],
      ['sales', 'sales-q3.csv', 'sales'],
    ]);
  });

  it('orders.csv: chip, meta, caption, columns and the first 3 rows as the design shows them', () => {
    const f = sampleFile('orders');
    expect(f.rowCount).toBe(332);
    expect(f.label).toBe('orders.csv · 332 rows · 10 columns');
    expect(f.meta).toBe('332 rows · 10 columns · fictional');
    expect(f.desc).toBe('A year of web-shop orders: customers, products, discounts, and paid, pending or refunded status.');
    expect(f.previewCaption).toBe('orders.csv · 332 rows · first 3 shown · types worked out from the values');
    expect(f.columnsLine).toBe(
      'id Number · orderDate Date · customer Text · email Text · country Text · product Text · quantity Number · unitPrice Number · discount Number · status Text',
    );
    expect(f.previewCells).toEqual([
      ['1001', '2024-01-01', 'Mx. Pemberwick', 'mx.pemberwick@example.com', 'Germany', 'Self-Folding Napkin', '6', '3.50', 'empty', 'paid'],
      ['1002', '2024-01-01', 'Glimmerbank Co-op', 'glimmerbank.co.op@example.com', 'United Kingdom', 'Silent Alarm Clock', '1', '27.30', 'empty', 'paid'],
      ['1003', '2024-01-02', 'Professor Snodgrass-Vee', 'PROFESSOR.SNODGRASS.VEE@EXAMPLE.COM', 'India', 'Solar-Powered Flashlight', '3', '23.50', 'empty', 'paid'],
    ]);
    expect(f.previewRows.map((r) => r.id)).toEqual([1001, 1002, 1003]);
  });

  it('orders.csv: the 3 rows the AI sees are the ones sampleForModel picks, written as the design writes them', () => {
    const f = sampleFile('orders');
    expect(f.exampleRows).toEqual([
      'Mx. Pemberwick · Germany · Self-Folding Napkin · 6 × $3.50 · paid',
      'Glimmerbank Co-op · United Kingdom · Whispering Kettle · 2 × $55.34 · paid',
      'Sergeant Fluffernut · Brazil · Glow-in-the-Dark Cheese Grater · 9 × $18.40 · 20% off · paid',
    ]);
    expect(f.hiddenRows).toBe(329);
  });

  it('sales-q3.csv: chip, meta, caption, columns, first 3 rows and what the AI sees', () => {
    const f = sampleFile('sales');
    expect(f.label).toBe('sales-q3.csv · 48 rows · 6 columns');
    expect(f.meta).toBe('48 rows · 6 columns · fictional');
    expect(f.desc).toBe('One quarter of sales by region, with paid, refunded and pending orders.');
    expect(f.previewCaption).toBe('sales-q3.csv · 48 rows · first 3 shown · types worked out from the values');
    expect(f.columnsLine).toBe('orderId Number · orderDate Date · customer Text · region Text · status Text · amount Number');
    expect(f.previewCells).toEqual([
      ['5001', '2024-07-17', 'Puddlesworth Inc', 'west', 'refunded', '279.34'],
      ['5002', '2024-07-15', 'Thistlewhump Bakery', 'north', 'pending', '792.90'],
      ['5003', '2024-07-06', 'Thistlewhump Bakery', 'north', 'paid', '184.02'],
    ]);
    expect(f.exampleRows).toEqual([
      '5001 · 2024-07-17 · Puddlesworth Inc · west · refunded · 279.34',
      '5025 · 2024-08-27 · Puddlesworth Inc · west · paid · 710.88',
      '5048 · 2024-09-08 · Puddlesworth Inc · west · paid · 583.54',
    ]);
    expect(f.hiddenRows).toBe(45);
  });

  it('text() is the bundled CSV and rows() a fresh copy each time', () => {
    expect(sampleFile('orders').text()).toBe(BUNDLED_ORDERS_CSV());
    expect(sampleFile('sales').text()).toBe(SALES_CSV());
    const a = sampleFile('sales').rows();
    a[0]!.amount = -1;
    expect(sampleFile('sales').rows()[0]!.amount).toBe(279.34);
  });

  it('sampleIdFor recognises a bundled sample by source, filename and row count only', async () => {
    const built = await buildDataset('orders', sampleFile('orders').rows(), { source: 'bundled', filename: 'orders.csv' });
    if (!('ref' in built)) throw new Error(built.message);
    expect(sampleIdFor(built.ref)).toBe('orders');
    expect(sampleIdFor({ source: 'bundled', filename: 'sales-q3.csv', rowCount: 48 })).toBe('sales');
    expect(sampleIdFor({ ...built.ref, source: 'file' })).toBeNull(); // the user's own orders.csv
    expect(sampleIdFor({ source: 'bundled', filename: 'orders.csv', rowCount: 10 })).toBeNull();
  });
});

describe('generic column helpers', () => {
  it('columnKind', () => {
    expect(columnKind('number', [1, 2])).toBe('Number');
    expect(columnKind('number | null', [1, null])).toBe('Number');
    expect(columnKind('string', ['2024-01-01', '2024-02-03T10:00:00Z', ''])).toBe('Date');
    expect(columnKind('string', ['2024-01-01', 'soon'])).toBe('Text');
    expect(columnKind('string', [''])).toBe('Text');
    expect(columnKind('boolean', [true])).toBe('Text');
    expect(columnKind('string | number', ['a', 1])).toBe('Text');
  });

  it('formatCell and formatExampleRow', () => {
    expect(formatCell(null, false)).toBe('empty');
    expect(formatCell(3.5, true)).toBe('3.50');
    expect(formatCell(1001, false)).toBe('1001');
    const cols = [
      { name: 'id', type: 'Number' as const },
      { name: 'price', type: 'Number' as const },
      { name: 'note', type: 'Text' as const },
    ];
    const rows = [{ id: 1, price: 2.5, note: 'a' }, { id: 2, price: 3, note: null }];
    expect(formatExampleRow(rows[1]!, cols, rows)).toBe('2 · 3.00 · empty');
  });
});

import { describe, expect, it } from 'vitest';
import { introSteps, previewModel, radioKeyIndex, rememberedSample, showOwnFileNote } from './startView';

describe('introSteps', () => {
  it("draws step 3's chip dark in every state, as the board does", () => {
    expect(introSteps().map((s) => s.lit)).toEqual([false, false, true]);
    expect(introSteps().map((s) => s.text)).toEqual([
      'Bring a file. It stays in this browser.',
      'Ask in plain words.',
      "Your rules check the AI's work before you see it.",
    ]);
  });
});

describe('rememberedSample', () => {
  it('comes back to the sample last picked; anything else is orders.csv', () => {
    expect(rememberedSample('sales')).toBe('sales');
    expect(rememberedSample('orders')).toBe('orders');
    expect(rememberedSample(null)).toBe('orders');
    expect(rememberedSample(undefined)).toBe('orders');
    expect(rememberedSample('rows')).toBe('orders');
  });
});

describe('showOwnFileNote', () => {
  it('shows only for an own file in replay mode', () => {
    expect(showOwnFileNote('own', 'replay')).toBe(true);
    expect(showOwnFileNote('own', 'live')).toBe(false);
    expect(showOwnFileNote('sample', 'replay')).toBe(false);
    expect(showOwnFileNote('none', 'replay')).toBe(false);
  });
});

describe('radioKeyIndex', () => {
  it('wraps and handles no selection', () => {
    expect(radioKeyIndex('ArrowDown', 0, 2)).toBe(1);
    expect(radioKeyIndex('ArrowRight', 1, 2)).toBe(0);
    expect(radioKeyIndex('ArrowUp', 0, 2)).toBe(1);
    expect(radioKeyIndex('ArrowDown', -1, 2)).toBe(0);
    expect(radioKeyIndex('ArrowUp', -1, 2)).toBe(1);
    expect(radioKeyIndex('End', 0, 2)).toBe(1);
    expect(radioKeyIndex('Home', 1, 2)).toBe(0);
    expect(radioKeyIndex('Tab', 0, 2)).toBe(-1);
  });
});

describe('previewModel', () => {
  it('reproduces the design for orders.csv', () => {
    const m = previewModel({
      sampleId: 'orders',
      dataset: null,
      rows: null,
      fileName: '',
    })!;
    expect(m.caption).toBe('orders.csv · 332 rows · first 3 shown · types worked out from the values');
    expect(m.srCaption).toBe('First 3 rows of orders.csv');
    expect(m.columns.map((c) => `${c.name} ${c.type}`).join(' · ')).toBe(
      'id Number · orderDate Date · customer Text · email Text · country Text · product Text · quantity Number · unitPrice Number · discount Number · status Text',
    );
    expect(m.cells[0]).toEqual([
      '1001',
      '2024-01-01',
      'Mx. Pemberwick',
      'mx.pemberwick@example.com',
      'Germany',
      'Self-Folding Napkin',
      '6',
      '3.50',
      'empty',
      'paid',
    ]);
    expect(m.columns[0]!.right).toBe(true);
    expect(m.columns[1]!.right).toBe(false);
  });

  it('reproduces the design for sales-q3.csv', () => {
    const m = previewModel({
      sampleId: 'sales',
      dataset: null,
      rows: null,
      fileName: '',
    })!;
    expect(m.caption).toBe('sales-q3.csv · 48 rows · first 3 shown · types worked out from the values');
    expect(m.cells.map((r) => r.join(','))).toEqual([
      '5001,2024-07-17,Puddlesworth Inc,west,refunded,279.34',
      '5002,2024-07-15,Thistlewhump Bakery,north,pending,792.90',
      '5003,2024-07-06,Thistlewhump Bakery,north,paid,184.02',
    ]);
  });

  it('derives an own file from the bound dataset and rows', () => {
    const rows = [
      { city: 'Oslo', when: '2024-01-02', amount: 12.5 },
      { city: 'Lima', when: '2024-01-03', amount: null },
    ];
    const m = previewModel({
      sampleId: null,
      dataset: {
        name: 'cities',
        filename: 'cities.csv',
        rowCount: 2,
        columns: [
          { name: 'city', type: 'string' },
          { name: 'when', type: 'string' },
          { name: 'amount', type: 'number | null' },
        ],
      },
      rows,
      fileName: 'cities.csv',
    })!;
    expect(m.caption).toBe('cities.csv · 2 rows · first 2 shown · types worked out from the values');
    expect(m.srCaption).toBe('First 2 rows of cities.csv');
    expect(m.columns.map((c) => c.type)).toEqual(['Text', 'Date', 'Number']);
    expect(m.cells).toEqual([
      ['Oslo', '2024-01-02', '12.50'],
      ['Lima', '2024-01-03', 'empty'],
    ]);
  });

  it('is null when nothing is bound', () => {
    expect(previewModel({ sampleId: null, dataset: null, rows: null, fileName: '' })).toBeNull();
  });
});

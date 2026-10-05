import { describe, expect, it } from 'vitest';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import type { ReplEntry } from '@scasella/undefined-engine/types';
import {
  answerTitle, figCaption, formatMoney, formatPlain, humanizeName, isMoney, leadSummary, lockedRowsPhrase, MAX_REST,
  shapeAnswer, shapeEncoded, shapeValue, unitFromQuestion, type AnswerContext,
} from './answer';

const ctx: AnswerContext = {
  question: 'Who are our top customers by revenue?', fileName: 'orders.csv', rowCount: 332, revision: 3,
  callName: 'topCustomersByRevenue', counted: 'paid orders only, each order number once',
};

const TOP5 = [
  { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
  { customer: 'Grommet & Gasket LLC', revenue: 2148.72 },
  { customer: 'Puddlesworth Inc', revenue: 2114.13 },
  { customer: 'Thistlewhump Bakery', revenue: 1909.9 },
  { customer: 'Kettlewhistle Farms', revenue: 1870.33 },
];

describe('formatting', () => {
  it('formats money and plain numbers in en-US', () => {
    expect(formatMoney(2252.07)).toBe('$2,252.07');
    expect(formatMoney(1909.9)).toBe('$1,909.90');
    expect(formatMoney(-12.5)).toBe('-$12.50');
    expect(formatPlain(258)).toBe('258');
    expect(formatPlain(12345)).toBe('12,345');
    expect(formatPlain(3.14159265)).toBe('3.1416');
  });
  it('decides money from the field name or the question', () => {
    expect(isMoney('revenue', '')).toBe(true);
    expect(isMoney('amount', '')).toBe(true);
    expect(isMoney('count', 'revenue by status')).toBe(false);
    expect(isMoney(null, 'How many orders are there by status?')).toBe(false);
    expect(isMoney(null, 'What is our revenue by country?')).toBe(true);
    expect(isMoney('n', 'What is our revenue?')).toBe(false);
  });
  it('finds a unit and a title', () => {
    expect(unitFromQuestion('How many orders are there by status?')).toBe('orders');
    expect(unitFromQuestion('anything', 'countOrdersByStatus')).toBe('orders');
    expect(unitFromQuestion('What is our revenue?')).toBe('');
    expect(humanizeName('topCustomersByRevenue')).toBe('Top customers by revenue');
    expect(humanizeName('count_by_status')).toBe('Count by status');
    expect(answerTitle('topCustomersByRevenue', '', 5)).toBe('Top 5 customers by revenue');
    expect(answerTitle(undefined, 'How many orders?', null)).toBe('How many orders');
  });
});

describe('fig caption', () => {
  it('matches the design voice', () => {
    expect(figCaption('Top 5 customers by revenue', ctx)).toBe(
      'Fig. 1 · Top 5 customers by revenue · paid orders only, each order number once · orders.csv · 332 rows · Version 3',
    );
  });
  it('leaves out what it does not know', () => {
    expect(figCaption('Median', { question: '', fileName: '', rowCount: null, revision: null })).toBe('Fig. 1 · Median');
    expect(figCaption('X', { question: '', fileName: 'a.csv', rowCount: 1, revision: 1 })).toBe('Fig. 1 · X · a.csv · 1 row · Version 1');
  });
});

describe('ranked list (array of objects)', () => {
  const v = shapeValue(TOP5, ctx);
  it('leads with rank 1 and money formatting', () => {
    expect(v.kind).toBe('ranked');
    expect(v.title).toBe('Top 5 customers by revenue');
    expect(v.lead).toEqual({ name: 'Chef Ravioli Starbright', num: '$2,252.07', unit: '', long: false });
    expect(v.money).toBe(true);
    expect(v.places).toBe(5);
  });
  it('lists the rest with bars scaled to the leader', () => {
    expect(v.rest.map((r) => [r.rank, r.name, r.amt])).toEqual([
      ['02', 'Grommet & Gasket LLC', '$2,148.72'],
      ['03', 'Puddlesworth Inc', '$2,114.13'],
      ['04', 'Thistlewhump Bakery', '$1,909.90'],
      ['05', 'Kettlewhistle Farms', '$1,870.33'],
    ]);
    // the design's (r / 2252.07 * 100).toFixed(1)
    expect(v.rest.map((r) => r.pct)).toEqual([95.4, 93.9, 84.8, 83]);
  });
  it('keeps the order the function returned', () => {
    const w = shapeValue([{ k: 'b', n: 1 }, { k: 'a', n: 5 }], { ...ctx, question: 'list', callName: 'f' });
    expect(w.lead!.name).toBe('b');
    expect(w.lead!.num).toBe('1');
    expect(w.rest[0]!.pct).toBe(100);
  });
  it('accepts [label, number] tuples', () => {
    const w = shapeValue(TOP5.map((r) => [r.customer, r.revenue]), ctx);
    expect(w.kind).toBe('ranked');
    expect(w.lead!.num).toBe('$2,252.07');
  });
  it('caps a long list and says how many it left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, total: 100 - i }));
    const w = shapeValue(many, { ...ctx, callName: 'totals' });
    expect(w.rest).toHaveLength(MAX_REST);
    expect(w.hiddenRows).toBe(30 - 1 - MAX_REST);
    expect(w.places).toBe(30);
  });
});

describe('record of counts', () => {
  const sctx: AnswerContext = { question: 'How many orders are there by status?', fileName: 'orders.csv', rowCount: 332, revision: 1, callName: 'countByStatus', counted: 'every row counted' };
  it('sorts desc with a unit and plain integers', () => {
    const v = shapeValue({ refunded: 27, paid: 258, pending: 47 }, sctx);
    expect(v.kind).toBe('ranked');
    expect(v.lead).toEqual({ name: 'paid', num: '258', unit: 'orders', long: false });
    expect(v.rest.map((r) => [r.rank, r.name, r.amt])).toEqual([['02', 'pending', '47'], ['03', 'refunded', '27']]);
    expect(v.fig).toBe('Fig. 1 · Count by status · every row counted · orders.csv · 332 rows · Version 1');
  });
  it('breaks ties alphabetically and accepts a Map', () => {
    const v = shapeValue(new Map([['b', 2], ['a', 2], ['c', 9]]), sctx);
    expect([v.lead!.name, ...v.rest.map((r) => r.name)]).toEqual(['c', 'a', 'b']);
  });
});

describe('scalars and fallbacks', () => {
  it('a single number is a lead value only', () => {
    const v = shapeValue(258, { ...ctx, question: 'How many orders are paid?', callName: 'countPaid' });
    expect(v.kind).toBe('scalar');
    expect(v.lead).toEqual({ name: '', num: '258', unit: 'orders', long: false });
    expect(v.rest).toEqual([]);
  });
  it('a money scalar', () => {
    expect(shapeValue(9987.42, { ...ctx, question: 'Total revenue?' }).lead!.num).toBe('$9,987.42');
  });
  it('a string', () => {
    const v = shapeValue('Chef Ravioli Starbright', { ...ctx, question: 'Best customer?' });
    expect(v.lead!.num).toBe('Chef Ravioli Starbright');
    expect(v.lead!.long).toBe(true);
  });
  it('an empty list says so', () => {
    const v = shapeValue([], ctx);
    expect(v.kind).toBe('empty');
    expect(v.lead).toBeNull();
    expect(v.fallbackNote).toMatch(/empty list/);
  });
  it('wider objects become a labelled table', () => {
    const v = shapeValue([{ a: 1, b: 'x', c: true }], ctx);
    expect(v.kind).toBe('table');
    expect(v.table).toEqual({ columns: ['a', 'b', 'c'], rows: [['1', 'x', 'true']], total: 1 });
    expect(v.fallbackNote).toMatch(/Shown as returned/);
  });
  it('anything else is raw, never a crash', () => {
    expect(shapeValue(null, ctx).kind).toBe('raw');
    expect(shapeValue(NaN, ctx).kind).toBe('raw');
    expect(shapeValue(new Set([1]), ctx, { shown: 'Set(1) { 1 }' }).raw).toBe('Set(1) { 1 }');
    expect(shapeValue({ a: 'x' }, ctx).kind).toBe('raw');
  });
  it('decodes the engine encoding', () => {
    expect(shapeEncoded(encodeValue(TOP5) , ctx).lead!.num).toBe('$2,252.07');
    expect(shapeEncoded(encodeValue(10n), ctx).lead!.num).toBe('10');
    expect(shapeEncoded({ $t: 'unserializable', show: 'fn' }, ctx, { shown: '[Function]' }).raw).toBe('[Function]');
  });
});

describe('shapeAnswer(entry)', () => {
  const entry: Extract<ReplEntry, { kind: 'output' }> = {
    kind: 'output', id: 'out1', value: '[…]', ms: 3, label: 'generated',
    pinnable: { fn: 'topCustomersByRevenue', call: 'topCustomersByRevenue(rows)', args: [], expected: encodeValue(TOP5) },
  };
  it('uses the real encoded result and the pinnable fn name', () => {
    const v = shapeAnswer(entry, { question: ctx.question, fileName: 'orders.csv', rowCount: 332, revision: 3 });
    expect(v.title).toBe('Top 5 customers by revenue');
    expect(v.lead!.name).toBe('Chef Ravioli Starbright');
  });
  it('falls back to the table without parsing numbers', () => {
    const { pinnable: _p, ...noPin } = entry;
    const v = shapeAnswer({ ...noPin, table: { columns: ['customer', 'revenue'], rows: [['A', '1']], total: 1 } }, ctx);
    expect(v.kind).toBe('table');
    expect(v.lead).toBeNull();
  });
  it('falls back to the printed value', () => {
    const { pinnable: _p, ...noPin } = entry;
    const v = shapeAnswer({ ...noPin, value: '42' }, ctx);
    expect(v.kind).toBe('raw');
    expect(v.raw).toBe('42');
  });
});

describe('helpers', () => {
  it('summarises a locked answer', () => {
    expect(leadSummary(encodeValue(TOP5), 'top customers by revenue')).toBe('Chef Ravioli Starbright = $2,252.07');
    expect(leadSummary(encodeValue([{ a: 1, b: 2, c: 3 }]), '')).toBeNull();
  });
  it('names the rows a lock holds', () => {
    expect(lockedRowsPhrase(shapeValue(TOP5, ctx))).toBe('these same 5 rows');
    expect(lockedRowsPhrase(shapeValue(3, ctx))).toBe('this same answer');
    expect(lockedRowsPhrase(null)).toBe('this same answer');
  });
});

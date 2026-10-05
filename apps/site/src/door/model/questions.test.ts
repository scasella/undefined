import { describe, expect, it } from 'vitest';
import type { DatasetRef } from '@scasella/undefined-engine/types';
import { buildDataset } from '../../data/dataset';
import { suggestCalls } from '../../data/suggest';
import type { DataRow } from './figures';
import { customQuestion, customSpec, DEFAULT_QUESTION_ID, fnNameFor, questionFromWhat, suggestedQuestions } from './questions';
import { sampleFile, sampleIdFor, type SampleId } from './samples';

async function bound(id: SampleId): Promise<{ ref: DatasetRef; rows: DataRow[] }> {
  const f = sampleFile(id);
  const rows = f.rows();
  const built = await buildDataset(f.datasetName, rows, { source: 'bundled', filename: f.filename });
  if (!('ref' in built)) throw new Error(built.message);
  return { ref: built.ref, rows };
}

describe('suggested questions', () => {
  it('orders.csv: the design list, mapped to calls on `rows` (the name the replay recording needs); only "Top 5 customers by revenue" has full checks', async () => {
    const { ref, rows } = await bound('orders');
    expect(sampleIdFor(ref)).toBe('orders');
    expect(suggestedQuestions(ref, rows, 'orders')).toEqual([
      { id: 'status', label: 'Count orders by status', text: 'How many orders are there by status?', call: 'countByStatus(rows)', fn: 'countByStatus', level: 'basic' },
      { id: 'top', label: 'Top 5 customers by revenue', text: 'Who are our top customers by revenue?', call: 'topCustomersByRevenue(rows)', fn: 'topCustomersByRevenue', level: 'full' },
      { id: 'country', label: 'Revenue by country', text: 'What is our revenue by country?', call: 'revenueByCountry(rows)', fn: 'revenueByCountry', level: 'basic' },
    ]);
    expect(DEFAULT_QUESTION_ID.orders).toBe('top');
  });

  it('sales-q3.csv: the design list on `sales`, all basic checks', async () => {
    const { ref, rows } = await bound('sales');
    const qs = suggestedQuestions(ref, rows, 'sales');
    expect(qs.map((q) => [q.id, q.label, q.text, q.call, q.level])).toEqual([
      ['status', 'Count orders by status', 'How many orders are there by status?', 'countByStatus(sales)', 'basic'],
      ['region', 'Total amount by region', 'What is the total amount by region?', 'totalAmountByRegion(sales)', 'basic'],
      ['top', 'Top 5 customers by amount', 'Who are our top 5 customers by amount?', 'top5CustomersByAmount(sales)', 'basic'],
    ]);
    expect(DEFAULT_QUESTION_ID.sales).toBe('region');
    // the hand-picked names follow suggest.ts's own naming scheme
    const auto = suggestCalls({ name: 'sales', columns: ref.columns, rows }).map((s) => s.fn);
    expect(auto).toContain('countByStatus');
    expect(auto).toContain('top5CustomersByAmount');
  });

  it("the user's own file: suggest.ts calls with plain-words questions, basic checks", async () => {
    const rows = [
      { region: 'west', rep: 'Ann', amount: 10 },
      { region: 'east', rep: 'Bo', amount: 20 },
      { region: 'west', rep: 'Cy', amount: 5 },
      { region: 'east', rep: 'Ann', amount: 7 },
    ];
    const built = await buildDataset('deals', rows, { source: 'file', filename: 'orders.csv' });
    if (!('ref' in built)) throw new Error(built.message);
    expect(sampleIdFor(built.ref)).toBeNull();
    const qs = suggestedQuestions(built.ref, rows, null);
    expect(qs.length).toBeGreaterThan(0);
    const expected = suggestCalls({ name: 'deals', columns: built.ref.columns, rows });
    expect(qs.map((q) => [q.id, q.call, q.fn, q.level])).toEqual(expected.map((s) => [s.fn, s.call, s.fn, 'basic']));
    expect(qs[0]).toMatchObject({ label: 'How many rows per region', text: 'How many rows are there per region?', call: 'countByRegion(deals)' });
  });

  it('questionFromWhat covers every shape suggest.ts writes', () => {
    expect(questionFromWhat('how many rows per status')).toBe('How many rows are there per status?');
    expect(questionFromWhat('the sum of amount per region')).toBe('What is the sum of amount per region?');
    expect(questionFromWhat('the five customer values with the highest amount')).toBe('What are the five customer values with the highest amount?');
    expect(questionFromWhat('the mean of amount')).toBe('What is the mean of amount?');
    expect(questionFromWhat('the earliest and latest orderDate')).toBe('What are the earliest and latest orderDate?');
  });
});

describe('typed questions', () => {
  it('names the function after the first words', () => {
    expect(fnNameFor('How many orders were refunded?')).toBe('howManyOrdersWereRefunded');
    expect(fnNameFor('  what is the 2nd biggest order, ever, by far?! ')).toBe('whatIsThe2ndBiggestOrder');
    expect(fnNameFor('42 things')).toBe('question42Things');
    expect(fnNameFor('¿Cuántos?')).toBe('cuantos');
    expect(fnNameFor('???')).toBe('customQuestion');
  });
  it('builds a call on the bound table, avoiding names already taken', () => {
    const q = customQuestion('How many orders were refunded?', { name: 'rows' }, (fn) => fn === 'howManyOrdersWereRefunded')!;
    expect(q.fn).toBe('howManyOrdersWereRefunded2');
    expect(q.call).toBe('howManyOrdersWereRefunded2(rows)');
    expect(q.level).toBe('basic');
    expect(q.doc).toBe('How many orders were refunded?');
  });
  it('refuses empty or tiny text and caps long text', () => {
    expect(customQuestion('  ', { name: 'rows' })).toBeNull();
    expect(customQuestion('hi', { name: 'rows' })).toBeNull();
    expect(customQuestion('x'.repeat(1000), { name: 'rows' })!.text.length).toBe(300);
  });
  it('gives the model the words as the contract, with no checks of its own', () => {
    const q = customQuestion('How many orders were refunded?', { name: 'rows' })!;
    const spec = customSpec(q, { name: 'rows', typeName: 'Row', typeDecl: 'type Row = { a: number };' });
    expect(spec.doc).toContain('How many orders were refunded?');
    expect(spec.params).toEqual([{ name: 'rows', type: 'Row[]' }]);
    expect(spec.tests).toBe('');
    expect(spec.properties).toBe('');
    expect(spec.typeDecls).toContain('type Row');
  });
});

import { describe, expect, it } from 'vitest';
import type { Candidate, FunctionRecord, GenerationView } from '@scasella/undefined-engine/types';
import { BUNDLED_ORDERS_CSV, bundledOrders } from '../../data/orders';
import { sampleForModel } from '../../data/sample';
import { buildData, datasetPreview } from '../../core/engine';
import { columnTypeWord, columnsText, lastSentPrompt, privacyView, rowLine, sentLabel, type PrivacyInput } from './privacy';

async function ordersInput(over: Partial<PrivacyInput> = {}): Promise<PrivacyInput> {
  const built = await buildData({ text: BUNDLED_ORDERS_CSV(), filename: 'orders.csv', name: 'orders' });
  if (!built.ok) throw new Error(built.error);
  return {
    question: 'Who are our top customers by revenue?',
    dataset: built.ref,
    rows: built.rows,
    send: { samples: true, sampleRows: 3 },
    mode: 'live',
    ...over,
  };
}

describe('columnTypeWord', () => {
  it('maps TS types to plain words', () => {
    expect(columnTypeWord({ name: 'q', type: 'number' })).toBe('Number');
    expect(columnTypeWord({ name: 'd', type: 'number | null' })).toBe('Number');
    expect(columnTypeWord({ name: 's', type: 'string' })).toBe('Text');
    expect(columnTypeWord({ name: 'b', type: 'boolean' })).toBe('Yes/no');
    expect(columnTypeWord({ name: 'x', type: 'number | string' })).toBe('Mixed');
  });
  it('calls a string column a Date only when every value looks like one', () => {
    const rows = [{ d: '2024-07-17', s: 'x' }, { d: null, s: '2024-01-01' }];
    expect(columnTypeWord({ name: 'd', type: 'string | null' }, rows)).toBe('Date');
    expect(columnTypeWord({ name: 's', type: 'string' }, rows)).toBe('Text');
  });
});

describe('privacyView on the bundled orders', () => {
  it('lists the columns as the design does', async () => {
    const v = privacyView(await ordersInput());
    expect(v.colsText).toBe(
      'id Number · orderDate Date · customer Text · email Text · country Text · product Text · quantity Number · unitPrice Number · discount Number · status Text',
    );
    // without rows there is nothing to tell a date from text by
    expect(columnsText((await ordersInput()).dataset.columns)).toContain('orderDate Text');
  });

  it('shows exactly the rows the engine would send, and the rest is hidden', async () => {
    const input = await ordersInput();
    const v = privacyView(input);
    const preview = await datasetPreview({ text: BUNDLED_ORDERS_CSV(), filename: 'orders.csv', name: 'orders' }, input.send);
    if (!preview.ok) throw new Error(preview.error);
    const sample = sampleForModel(input.rows!, { count: 3 });
    expect(sample.text).toBe(preview.sampleText);
    expect(v.exRows).toEqual(sample.rows.map(rowLine));
    expect(v.exRows).toHaveLength(3);
    expect(v.rowsTitle).toBe('3 example rows');
    expect(v.switchLabel).toBe('Send 3 example rows to the AI');
    expect(v.rowsWord).toBe('On');
    expect(v.hiddenLine).toBe('Hidden from the AI: the other 329 rows in orders.csv.');
    expect(v.sentText).toContain(preview.sampleText);
    expect(v.sentText.startsWith('Question: Who are our top customers by revenue?\nFile: orders.csv\nColumns: id Number')).toBe(true);
    expect(v.sentNote).toBeNull();
    expect(v.rowsNote).toBeNull();
    expect(bundledOrders()).toHaveLength(332);
  });

  it('sends no rows when the switch is off', async () => {
    const v = privacyView(await ordersInput({ send: { samples: false, sampleRows: 3 } }));
    expect(v.rowsOn).toBe(false);
    expect(v.rowsWord).toBe('Off');
    expect(v.exRows).toEqual([]);
    expect(v.hiddenLine).toBe('Hidden from the AI: all 332 rows in orders.csv.');
    expect(v.sentText).toContain('(The user chose not to share sample rows; only the type is shared.)');
    expect(v.sentText).not.toContain('"customer"');
  });

  it('says nothing is sent in replay mode', async () => {
    const v = privacyView(await ordersInput({ mode: 'replay' }));
    expect(v.rowsNote).toMatch(/Would be sent when you run it on your computer/);
    expect(v.sentNote).toMatch(/nothing is sent/);
    expect(v.exRows).toHaveLength(3);
  });

  it('works without rows (counts only)', async () => {
    const input = await ordersInput({ rows: null });
    const v = privacyView(input);
    expect(v.exRows).toEqual([]);
    expect(v.rowsTitle).toBe('3 example rows');
    expect(v.sentText).toContain('(The user chose not to share sample rows; only the type is shared.)');
  });
});

describe('sentLabel', () => {
  it('matches the design and the after-run wording', () => {
    expect(sentLabel(false)).toBe('See exactly what the AI will be sent');
    expect(sentLabel(false, true)).toBe('See exactly what the AI was sent');
    expect(sentLabel(true)).toBe('Hide the exact text');
  });
});

describe('lastSentPrompt', () => {
  const cand = (prompt?: string): Candidate =>
    ({ id: 'c', attempt: 1, body: '', notes: '', source: 'replay', generationMs: 0, gates: [], verdict: 'accepted', ...(prompt ? { prompt } : {}) }) as Candidate;
  it('prefers the latest attempt with a prompt, then the artifact', () => {
    const gen = { attempts: [{ candidate: cand('first') }, { candidate: cand('second') }, { candidate: cand() }] } as unknown as GenerationView;
    expect(lastSentPrompt(gen)).toBe('second');
    const rec = { artifact: { candidates: [cand('art')] } } as unknown as FunctionRecord;
    expect(lastSentPrompt(null, rec)).toBe('art');
    expect(lastSentPrompt(null, null)).toBeNull();
  });
});

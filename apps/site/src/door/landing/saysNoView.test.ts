import { describe, expect, it } from 'vitest';
import { FOOTER_REST } from '../model/privacy';
import { DECLINES, DEFAULT_DECLINE, declineById, LANDING_REPLAY_NOTE, privacyCardView } from './saysNoView';

describe('declines', () => {
  it('has the design three chips, the first selected by default', () => {
    expect(DECLINES.map((d) => d.label)).toEqual(['Flag suspicious orders', 'Orders from the last 7 days', 'Clean up this file']);
    expect(declineById(DEFAULT_DECLINE).label).toBe('Flag suspicious orders');
    expect(declineById('week').help).toBe('Give the dates, for example "orders from 1 Dec to 7 Dec 2024".');
  });
});

describe('privacyCardView', () => {
  it('computes the design column line and the 3 example rows from the real orders sample', () => {
    const v = privacyCardView(true, 'live');
    expect(v.columnsLine).toBe(
      'id Number · orderDate Date · customer Text · email Text · country Text · product Text · quantity Number · unitPrice Number · discount Number · status Text',
    );
    expect(v.exampleRows).toEqual([
      'Mx. Pemberwick · Germany · Self-Folding Napkin · 6 × $3.50 · paid',
      'Glimmerbank Co-op · United Kingdom · Whispering Kettle · 2 × $55.34 · paid',
      'Sergeant Fluffernut · Brazil · Glow-in-the-Dark Cheese Grater · 9 × $18.40 · 20% off · paid',
    ]);
    expect(v.rowsTitle).toBe('3 example rows');
    expect(v.switchLabel).toBe('Send 3 example rows to the AI');
    expect(v.rowsWord).toBe('On · one click to turn off');
    expect(v.replayNote).toBeNull();
    expect(v.finePrint).toBe('Everything else in your file stays in this browser. ' + FOOTER_REST);
  });

  it('off state and replay mode', () => {
    const v = privacyCardView(false, 'replay');
    expect(v.rowsOn).toBe(false);
    expect(v.rowsWord).toBe('Off');
    expect(v.offText).toBe('Off. The AI sees no rows from your file, only the column names and types.');
    expect(v.replayNote).toBe(LANDING_REPLAY_NOTE);
  });
});

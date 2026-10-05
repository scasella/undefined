import { describe, expect, it } from 'vitest';
import { zenPrivacyLine } from './Zen';

describe('zenPrivacyLine', () => {
  it('says the demo sends nothing', () => {
    expect(zenPrivacyLine('replay', true)).toMatch(/sends nothing/);
  });
  it('says exactly what the AI sees in live mode', () => {
    expect(zenPrivacyLine('live', false)).toMatch(/column names \+ types only/);
    expect(zenPrivacyLine('live', true)).toMatch(/3 example rows/);
  });
});

import { describe, expect, it } from 'vitest';
import { receiptLink } from './HonestyBar';

describe('HonestyBar receipt link', () => {
  it('the landing goes to the first run, as the design does', () => {
    expect(receiptLink('landing')).toEqual({ href: '#/start' });
  });
  it('the first run never links to itself: it has no receipt view, so no link', () => {
    expect(receiptLink('start')).toBeNull();
  });
});

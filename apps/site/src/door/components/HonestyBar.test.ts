import { describe, expect, it } from 'vitest';
import { receiptLink, WORKBENCH_HREF } from './HonestyBar';

describe('HonestyBar receipt link', () => {
  it('the landing goes to the first run, as the design does', () => {
    expect(receiptLink('landing')).toEqual({ href: '#/start' });
  });
  it('the first run never links to itself: it opens the workbench, and the title says what is there', () => {
    const l = receiptLink('start');
    expect(l.href).toBe(WORKBENCH_HREF);
    expect(l.href).not.toBe('#/start');
    expect(l.title).toMatch(/workbench/);
    expect(l.title).toMatch(/Eject/);
  });
});

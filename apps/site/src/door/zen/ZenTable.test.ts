import { describe, expect, it } from 'vitest';
import { ROW_H, windowOf } from './ZenTable';

describe('windowOf', () => {
  it('starts at the top with a short overscan', () => {
    const w = windowOf(0, 20000);
    expect(w.from).toBe(0);
    expect(w.to).toBeLessThan(40);
  });
  it('follows the scroll position and never leaves the table', () => {
    const w = windowOf(ROW_H * 1000, 20000);
    expect(w.from).toBeGreaterThan(900);
    expect(w.from).toBeLessThan(1000);
    expect(windowOf(ROW_H * 1e6, 50).to).toBe(50);
    expect(windowOf(0, 3).to).toBe(3);
  });
});

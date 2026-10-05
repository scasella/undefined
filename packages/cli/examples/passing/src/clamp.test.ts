import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { clamp } from './clamp';

describe('clamp', () => {
  it('keeps a value inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('raises a value below the range to min', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('lowers a value above the range to max', () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('keeps the bounds themselves', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('always lands inside the range', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (v, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const r = clamp(v, lo, hi);
        return r >= lo && r <= hi;
      }),
    );
  });

  it('leaves values already in range unchanged', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (v) => clamp(v, -100, 100) === v),
    );
  });
});

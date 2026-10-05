import { expect, it } from 'vitest';
import fc from 'fast-check';
import { median } from './stats';

it('odd length', () => {
  expect(median([3, 1, 2])).toBe(2);
});

it('even length', () => {
  expect(median([4, 1, 3, 2])).toBe(2.5);
});

it('order does not matter', () => {
  fc.assert(fc.property(fc.array(fc.integer(), { minLength: 1 }), (xs) => median(xs) === median([...xs].reverse())));
});

/**
 * @silentOn what the median of nothing is
 * @reasonable NaN (nothing to take the middle of) and throwing are also defensible.
 */
it('empty list', () => {
  expect(median([])).toBe(0);
});

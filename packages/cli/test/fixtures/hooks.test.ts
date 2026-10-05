import { beforeEach, expect, it } from 'vitest';
import { inc } from './hooks';

let base = 0;
beforeEach(() => {
  base = 1;
});

it('adds one', () => {
  expect(inc(base)).toBe(2);
});

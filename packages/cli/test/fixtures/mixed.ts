/** Absolute value. */
export function abs(n: number): number {
  return n < 0 ? -n : n;
}

/** Sign of a number: -1, 0 or 1. */
export const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 1);

/** The larger of two numbers. */
export function max2(a: number, b: number): number {
  return a > b ? a : b;
}

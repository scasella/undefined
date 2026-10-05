/** The median of a list of numbers: the middle value once sorted, or the mean of the two middle values. */
export function median(numbers: number[]): number {
  const s = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Keyboard movement in the evidence strip's 10 × 10 grid of made-up tables (one tab stop, arrows move the pick).
 * Pure. Returns the new 0-based index, or null when the key is not a grid key.
 */
export function dotGridKey(index: number, key: string, count = 100, cols = 10): number | null {
  const last = count - 1;
  const clamp = (n: number): number => Math.max(0, Math.min(last, n));
  switch (key) {
    case 'ArrowRight': return clamp(index + 1);
    case 'ArrowLeft': return clamp(index - 1);
    case 'ArrowDown': return index + cols <= last ? index + cols : index;
    case 'ArrowUp': return index - cols >= 0 ? index - cols : index;
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}

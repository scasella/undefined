/**
 * The per-worker nonce that authenticates sandbox worker messages (moved out of the site's sandbox/spawn.ts so the
 * engine's gate runner needs no browser code). Uses only `crypto.getRandomValues`, global in browsers and Node >= 20.
 */

/** 128 random bits as hex, from crypto.getRandomValues. */
export function newNonce(): string {
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  return Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
}

/** A message carries the expected nonce (constant-time-ish comparison is unnecessary: the nonce never leaves this realm pair). */
export function hasNonce(m: unknown, nonce: string): boolean {
  return typeof m === 'object' && m !== null && (m as { nonce?: unknown }).nonce === nonce;
}

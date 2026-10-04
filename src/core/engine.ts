import type { Engine } from '../types';

/** Stub so the UI type-checks; replaced by the real engine. */
export function createEngine(): Engine {
  throw new Error('engine not implemented');
}

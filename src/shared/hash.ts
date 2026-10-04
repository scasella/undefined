/**
 * Content hashes for specs. Only what changes the function's meaning is hashed: maxAttempts (retry budget),
 * origin and exampleId are deliberately excluded, so editing them never makes an artifact stale.
 */
import type { FunctionSpec, Hash } from '../types';

export async function sha256Hex(text: string): Promise<Hash> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function specHash(spec: FunctionSpec): Promise<Hash> {
  return sha256Hex(
    JSON.stringify([spec.name, spec.params.map((p) => [p.name, p.type]), spec.returns, spec.doc, spec.budgetMs]),
  );
}

export function testsHash(spec: FunctionSpec): Promise<Hash> {
  return sha256Hex(JSON.stringify([spec.tests, spec.properties]));
}

export async function hashesFor(spec: FunctionSpec): Promise<{ specHash: Hash; testsHash: Hash }> {
  const [s, t] = await Promise.all([specHash(spec), testsHash(spec)]);
  return { specHash: s, testsHash: t };
}

/** Fixed fast-check seed for a (spec, tests) pair: same candidate ⇒ same verdict and counterexample. */
export function gateSeed(specHash: Hash, testsHash: Hash): number {
  return (parseInt(specHash.slice(0, 8), 16) ^ parseInt(testsHash.slice(0, 8), 16)) | 0;
}

/**
 * One-click sharing to an optional, self-deployed endpoint (server/share/worker.ts, docs/SHARE-DEPLOY.md). Only used
 * when the site was built with VITE_SHARE_ENDPOINT; otherwise the Share dialog is the manual download-and-host flow.
 * Browser-safe; every exported function returns a result value and never throws.
 */
import type { Recording } from '@scasella/undefined-engine/types';

const HASH = /^[0-9a-f]{64}$/;

/** The endpoint as `https://host[/path]` without a trailing slash, or null when unset or not https (http only for localhost). */
export function shareEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const u = new URL(raw.trim());
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (u.protocol !== 'https:' && !local) return null;
    if (u.search || u.hash || u.username || u.password) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** The endpoint this build was configured with (VITE_SHARE_ENDPOINT at build time), or null. */
export const CONFIGURED_SHARE_ENDPOINT: string | null = shareEndpoint(import.meta.env?.VITE_SHARE_ENDPOINT);

export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export type UploadResult = { ok: true; hash: string; recordingUrl: string } | { ok: false; error: string };

/** POST the recording; the stored file is then at `<endpoint>/<hash>`. */
export async function uploadRecording(endpoint: string, rec: Recording, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<UploadResult> {
  const host = endpointHost(endpoint);
  try {
    const res = await fetchImpl(`${endpoint}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
      credentials: 'omit',
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const b = (body ?? {}) as { hash?: unknown; error?: unknown };
    if (!res.ok) {
      const why = typeof b.error === 'string' ? `: ${b.error.slice(0, 300)}` : '.';
      return { ok: false, error: `${host} refused the upload (${res.status})${why}` };
    }
    if (typeof b.hash !== 'string' || !HASH.test(b.hash)) return { ok: false, error: `${host} did not answer with a recording hash.` };
    return { ok: true, hash: b.hash, recordingUrl: `${endpoint}/${b.hash}` };
  } catch (e) {
    return { ok: false, error: `Could not reach ${host} (${e instanceof Error ? e.message : String(e)}).` };
  }
}

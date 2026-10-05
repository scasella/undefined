/**
 * Optional one-click share endpoint: a Cloudflare Worker you deploy yourself (docs/SHARE-DEPLOY.md). The static site
 * never needs it; it is used only when the site was built with VITE_SHARE_ENDPOINT.
 *
 *   POST /        body: a recording (≤ 2 MB). Checked with the site's own loader (src/share/source.ts), stored in R2
 *                 under the sha-256 of its canonical bytes (canonicalText), answered with {"hash", "url"}. Same recording ⇒ same hash.
 *   GET  /<hash>  the stored recording (64 lowercase hex), immutable, CORS-readable from any origin.
 *   OPTIONS       CORS preflight.
 *
 * Nothing about the uploader is stored or logged: no IP, no headers, no metadata on the object, no console output.
 */
import { parseRecordingText } from '../../src/share/source';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const HASH_PATH = /^\/([0-9a-f]{64})$/;

/** The part of an R2 bucket binding this Worker uses (structurally compatible with Cloudflare's R2Bucket). */
export interface ShareBucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream | null } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface Env {
  RECORDINGS: ShareBucket;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const JSON_TYPE = 'application/json; charset=utf-8';

function reply(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

const fail = (status: number, error: string, extra?: Record<string, string>) => reply(status, { error }, extra);

/**
 * The bytes that are stored and hashed: the loader's validated copy (known fields only, in the validator's order),
 * serialized compactly. Keys are deliberately not sorted: dataset rows keep their column order.
 */
export function canonicalText(rec: unknown): string {
  return JSON.stringify(rec);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The body as UTF-8 text, or null once it passes `max` bytes (counted while streaming). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

async function upload(req: Request, env: Env, origin: string): Promise<Response> {
  const text = await readCapped(req, MAX_UPLOAD_BYTES);
  if (text === null) return fail(413, `The recording is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`);
  const parsed = parseRecordingText(text, { maxChars: Number.MAX_SAFE_INTEGER });
  if (!parsed.ok) return fail(422, parsed.error);
  const canonical = canonicalText(parsed.recording);
  const hash = await sha256Hex(canonical);
  const exists = (await env.RECORDINGS.head(hash)) !== null;
  if (!exists) await env.RECORDINGS.put(hash, canonical, { httpMetadata: { contentType: JSON_TYPE } });
  return reply(exists ? 200 : 201, { hash, url: `${origin}/${hash}` });
}

async function download(env: Env, hash: string, head: boolean): Promise<Response> {
  const obj = await env.RECORDINGS.get(hash);
  if (!obj) return fail(404, 'No recording with that hash.');
  return new Response(head ? null : obj.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': JSON_TYPE,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${hash}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handle(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method === 'POST') {
      if (url.pathname !== '/') return fail(404, 'POST a recording to /.');
      return await upload(req, env, url.origin);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const m = HASH_PATH.exec(url.pathname);
      if (!m) return fail(404, 'Not found. Recordings are at /<64 lowercase hex characters>.');
      return await download(env, m[1]!, req.method === 'HEAD');
    }
    return fail(405, 'Method not allowed.', { Allow: 'GET, HEAD, POST, OPTIONS' });
  } catch {
    return fail(500, 'The share endpoint failed.');
  }
}

export default { fetch: handle };

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRecordingText } from '../../src/share/source';
import { canonicalText, handle, MAX_UPLOAD_BYTES, sha256Hex, type Env, type ShareBucket } from './worker';

class MemoryBucket implements ShareBucket {
  readonly objects = new Map<string, { value: string; contentType?: string }>();
  puts = 0;
  async head(key: string) {
    return this.objects.has(key) ? { key } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { body: new Response(o.value).body } : null;
  }
  async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) {
    this.puts++;
    this.objects.set(key, { value, contentType: options?.httpMetadata?.contentType });
    return { key };
  }
}

const ORIGIN = 'https://share.example.workers.dev';
const fib = readFileSync(new URL('../../public/recordings/fibonacci.json', import.meta.url), 'utf8');

function setup() {
  const bucket = new MemoryBucket();
  const env: Env = { RECORDINGS: bucket };
  const call = (method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
    handle(new Request(`${ORIGIN}${path}`, { method, body, headers }), env);
  return { bucket, call };
}

describe('share worker', () => {
  it('stores a valid recording under the sha-256 of its canonical bytes and serves it back', async () => {
    const { bucket, call } = setup();
    const res = await call('POST', '/', fib, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const { hash, url } = (await res.json()) as { hash: string; url: string };
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(url).toBe(`${ORIGIN}/${hash}`);
    const stored = bucket.objects.get(hash)!;
    expect(await sha256Hex(stored.value)).toBe(hash);
    expect(stored.contentType).toBe('application/json; charset=utf-8');

    const got = await call('GET', `/${hash}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(got.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(got.headers.get('access-control-allow-origin')).toBe('*');
    const text = await got.text();
    // what the site's loader reads back is a valid recording, and re-canonicalizes to the same bytes
    const back = parseRecordingText(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(canonicalText(back.recording)).toBe(text);
  });

  it('is idempotent: the same recording (even re-formatted) gets the same hash and is written once', async () => {
    const { bucket, call } = setup();
    const a = (await (await call('POST', '/', fib)).json()) as { hash: string };
    const again = await call('POST', '/', fib);
    expect(again.status).toBe(200);
    const reformatted = await call('POST', '/', JSON.stringify(JSON.parse(fib)));
    expect(((await again.json()) as { hash: string }).hash).toBe(a.hash);
    expect(((await reformatted.json()) as { hash: string }).hash).toBe(a.hash);
    expect(bucket.puts).toBe(1);
    expect(bucket.objects.size).toBe(1);
  });

  it('refuses a body over the size cap, by declared length or by streamed bytes', async () => {
    const { bucket, call } = setup();
    const big = ' '.repeat(MAX_UPLOAD_BYTES + 1);
    const declared = await call('POST', '/', '{}', { 'Content-Length': String(MAX_UPLOAD_BYTES + 1) });
    expect(declared.status).toBe(413);
    const streamed = await call('POST', '/', big);
    expect(streamed.status).toBe(413);
    expect(streamed.headers.get('access-control-allow-origin')).toBe('*');
    expect(bucket.objects.size).toBe(0);
  });

  it('refuses what the site would not load, with the loader’s own message', async () => {
    const { bucket, call } = setup();
    for (const body of ['not json', '[]', '{"format":"undefined-image"}', JSON.stringify({ ...JSON.parse(fib), sessions: 'x' })]) {
      const res = await call('POST', '/', body);
      expect(res.status).toBe(422);
      const parsed = parseRecordingText(body);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(((await res.json()) as { error: string }).error).toBe(parsed.error);
    }
    expect(bucket.objects.size).toBe(0);
  });

  it('serves only 64-hex paths', async () => {
    const { call } = setup();
    for (const p of ['/', '/abc', `/${'A'.repeat(64)}`, `/${'a'.repeat(63)}`, `/${'a'.repeat(65)}`, `/${'a'.repeat(64)}/x`, `/${'a'.repeat(64)}.json`]) {
      const res = await call('GET', p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
    expect((await call('POST', `/${'a'.repeat(64)}`, fib)).status).toBe(404);
  });

  it('answers a GET miss with 404, not cached', async () => {
    const { call } = setup();
    const res = await call('GET', `/${'0'.repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers CORS preflight and rejects other methods', async () => {
    const { call } = setup();
    const pre = await call('OPTIONS', '/', undefined, { Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'POST' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(pre.headers.get('access-control-allow-headers')).toContain('Content-Type');
    const del = await call('DELETE', `/${'0'.repeat(64)}`);
    expect(del.status).toBe(405);
  });

  it('stores nothing about the uploader', async () => {
    const { bucket, call } = setup();
    await call('POST', '/', fib, { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'secret-agent' });
    const [only] = [...bucket.objects.values()];
    expect(only!.value).not.toContain('203.0.113.9');
    expect(only!.value).not.toContain('secret-agent');
    expect(Object.keys(only!)).toEqual(['value', 'contentType']);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import {
  CORS_HINT,
  fetchRecording,
  normalizeShareUrl,
  parseRecordingText,
  recordingParamFromLocation,
  seedFromRecording,
  shareLink,
} from './source';

const DIR = join(process.cwd(), 'public', 'recordings');
const BUNDLED = (JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as string[]).map((name) => ({
  name,
  text: readFileSync(join(DIR, name), 'utf8'),
}));
const MEDIAN = BUNDLED.find((b) => b.name === 'median.json')!.text;

function load(text: string): Recording {
  const r = parseRecordingText(text);
  if (!r.ok) throw new Error(r.error);
  return r.recording;
}

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
function ref(name: string, hash: string) {
  return { name, hash, typeName: 'Row', typeDecl: 'type Row = { a: number }', rowCount: 1, columns: [{ name: 'a', type: 'number' }], source: 'paste', bytes: 10 };
}

/** A synthetic multi-function v2 recording built from the bundled ones, with datasets. */
function combined(): Record<string, unknown> {
  const recs = BUNDLED.map((b) => JSON.parse(b.text) as Record<string, any>);
  const base = recs[0];
  const sessions = recs.flatMap((r) => r.sessions);
  sessions[0].datasets = { [H1]: [{ a: 1 }] };
  sessions[0].datasetRefs = [ref('rows', H1)];
  sessions[1].datasets = { [H1]: [{ a: 999 }], [H2]: [{ a: 2 }] };
  sessions[1].datasetRefs = [ref('rows', H2), ref('more', H2)];
  return { ...base, sessions };
}

describe('parseRecordingText', () => {
  it.each(BUNDLED.map((b) => [b.name, b.text]))('accepts and seeds the bundled %s', (_name, text) => {
    const r = parseRecordingText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.canSeed).toBe(true);
    const seed = seedFromRecording(r.recording);
    const fns = [...new Set(r.recording.sessions.map((s) => s.fn))];
    expect(seed.specs.map((s) => s.name)).toEqual(fns);
    expect(seed.specs[0]).toEqual(r.recording.sessions[0].spec);
    const keys = new Set(r.recording.sessions.map((s) => `${s.fn}|${s.specHash}|${s.testsHash}`));
    const variants = keys.size - fns.length;
    expect(seed.calls).toEqual([...new Set(r.recording.sessions.flatMap((s) => s.calls ?? []))]);
    expect(seed.canSeed).toBe(true);
    expect(seed.summary).toContain(`1 function (${fns[0]})`);
    if (variants > 0) expect(seed.summary).toContain(`${variants} later spec variant`);
    expect(seed.summary).toContain(`recorded with ${r.recording.model} via Codex ${r.recording.codexVersion} on 2026-10-04`);
    expect(seed.summary).toMatch(/the gates will run live in your browser\.$/);
  });

  it('gives precise errors for empty, non-JSON and wrong-shape input', () => {
    expect(parseRecordingText('')).toEqual({ ok: false, error: 'The file is empty.' });
    const nj = parseRecordingText('{"format": ');
    expect(nj.ok).toBe(false);
    if (!nj.ok) expect(nj.error).toMatch(/^The file is not JSON \(/);
    const arr = parseRecordingText('[1,2]');
    if (!arr.ok) expect(arr.error).toMatch(/JSON array/);
    const num = parseRecordingText('42');
    if (!num.ok) expect(num.error).toMatch(/JSON number/);
    const bad = parseRecordingText(JSON.stringify({ ...JSON.parse(MEDIAN), version: 3 }));
    expect(bad).toEqual({ ok: false, error: 'This is not a valid recording: version must be 1 or 2 (got number 3).' });
    const fmt = parseRecordingText('{"format":"something-else"}');
    if (!fmt.ok) expect(fmt.error).toMatch(/format must be "undefined-recording"/);
  });

  it('accepts a byte-order mark', () => {
    expect(parseRecordingText(`﻿${MEDIAN}`).ok).toBe(true);
  });

  it('explains a dropped program image', () => {
    const r = parseRecordingText(JSON.stringify({ format: 'undefined-image', version: 1, exportedAt: '2026-10-04T00:00:00Z' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exported program image.*not a recording/);
  });

  it('rejects huge input without parsing it', () => {
    const r = parseRecordingText(' '.repeat(5 * 1024 * 1024 + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/);
  });

  it('accepts a v1 recording without specs but reports canSeed: false', () => {
    const rec = JSON.parse(MEDIAN);
    rec.version = 1;
    for (const s of rec.sessions) {
      delete s.spec;
      delete s.calls;
    }
    const r = parseRecordingText(JSON.stringify(rec));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.canSeed).toBe(false);
    const seed = seedFromRecording(r.recording);
    expect(seed).toMatchObject({ specs: [], calls: [], canSeed: false, datasets: {}, datasetRefs: [] });
    expect(seed.summary).toMatch(/^1 function \(median\), 0 calls, recorded with .*does not carry its specs/);
  });

  it('never throws on deeply nested JSON', () => {
    const deep = `${'['.repeat(100000)}${']'.repeat(100000)}`;
    const r = parseRecordingText(deep);
    expect(r.ok).toBe(false);
  });

  it('does not let "__proto__" keys pollute anything', () => {
    const rec = combined() as Record<string, any>;
    const text = JSON.stringify(rec)
      .replace('"format":', '"__proto__":{"polluted":1},"format":')
      .replace('"fn":', '"__proto__":{"polluted":2},"fn":')
      .replace('[{"a":1}]', '[{"__proto__":{"polluted":3},"a":1}]')
      .replace(`"datasets":{"${H1}"`, `"datasets":{"__proto__":{"polluted":4},"${H1}"`);
    // The __proto__ dataset key is not a hash: the validator refuses it.
    const refused = parseRecordingText(text);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/hashes/);
    const ok = parseRecordingText(text.replace('"__proto__":{"polluted":4},', ''));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const seed = seedFromRecording(ok.recording);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(seed.datasets)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(ok.recording)).toBe(Object.prototype);
    const rows = seed.datasets[H1] as Record<string, unknown>[];
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
    expect((rows[0] as { polluted?: unknown }).polluted).toBeUndefined();

    // A hand-built (unvalidated) Recording with a __proto__ dataset key cannot reach the prototype either.
    const hostile = JSON.parse('{"__proto__":[{"polluted":5}]}');
    const s = seedFromRecording({ ...ok.recording, sessions: [{ ...ok.recording.sessions[0], datasets: hostile }] });
    expect(Object.getPrototypeOf(s.datasets)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('seedFromRecording', () => {
  it('merges functions, variants, calls and datasets across sessions', () => {
    const r = parseRecordingText(JSON.stringify(combined()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const seed = seedFromRecording(r.recording);
    const fns = [...new Set(r.recording.sessions.map((s) => s.fn))];
    expect(seed.specs.map((s) => s.name)).toEqual(fns);
    expect(seed.specs).toHaveLength(BUNDLED.length); // one function per bundled recording (the count follows public/recordings)
    expect(seed.datasets[H1]).toEqual([{ a: 1 }]); // first wins
    expect(seed.datasets[H2]).toEqual([{ a: 2 }]);
    expect(seed.datasetRefs.map((d) => [d.name, d.hash])).toEqual([
      ['rows', H1],
      ['more', H2],
    ]);
    expect(seed.calls).toEqual([...new Set(r.recording.sessions.flatMap((s) => s.calls ?? []))]);
    expect(seed.summary).toBe(
      `${BUNDLED.length} functions (${fns.join(', ')}), ${BUNDLED.length} later spec variants not loaded, ${Object.keys(seed.datasets).length} datasets, ${seed.calls.length} calls, recorded with gpt-6-luna via Codex 0.159.2 on 2026-10-04; the gates will run live in your browser.`,
    );
  });

  it('counts a repeated identical spec as the same, not a variant', () => {
    const rec = load(MEDIAN);
    const twice: Recording = { ...rec, sessions: [rec.sessions[0], rec.sessions[0]] };
    expect(seedFromRecording(twice).summary).not.toMatch(/variant/);
  });

  it('survives garbage without throwing', () => {
    expect(() => seedFromRecording({} as Recording)).not.toThrow();
    expect(seedFromRecording(null as unknown as Recording).canSeed).toBe(false);
  });
});

describe('normalizeShareUrl', () => {
  it('turns a GitHub blob URL into the raw URL', () => {
    expect(normalizeShareUrl('https://github.com/scasella/undefined/blob/main/public/recordings/median.json')).toBe(
      'https://raw.githubusercontent.com/scasella/undefined/main/public/recordings/median.json',
    );
    expect(normalizeShareUrl(' https://github.com/octo/repo/blob/3f2a1c9/a/b%20c.json?plain=1#L10 ')).toBe(
      'https://raw.githubusercontent.com/octo/repo/3f2a1c9/a/b%20c.json',
    );
  });

  it('turns a gist page into its raw URL', () => {
    expect(normalizeShareUrl('https://gist.github.com/scasella/4f1d2a0b9c8e7d6f5a4b3c2d1e0f9a8b')).toBe(
      'https://gist.githubusercontent.com/scasella/4f1d2a0b9c8e7d6f5a4b3c2d1e0f9a8b/raw',
    );
    expect(normalizeShareUrl('https://gist.github.com/scasella/4f1d2a0b9c8e7d6f5a4b3c2d1e0f9a8b#file-median-json')).toBe(
      'https://gist.githubusercontent.com/scasella/4f1d2a0b9c8e7d6f5a4b3c2d1e0f9a8b/raw',
    );
  });

  it('leaves other URLs alone', () => {
    for (const u of [
      'https://raw.githubusercontent.com/scasella/undefined/main/public/recordings/median.json',
      'https://gist.githubusercontent.com/scasella/4f1d2a0b/raw/median.json',
      'https://github.com/scasella/undefined',
      'https://github.com/scasella/undefined/tree/main/public',
      'https://example.com/rec.json',
      'not a url',
    ]) {
      expect(normalizeShareUrl(u)).toBe(u);
    }
  });
});

describe('recordingParamFromLocation / shareLink', () => {
  it('round-trips awkward URLs', () => {
    for (const rec of [
      'https://raw.githubusercontent.com/scasella/undefined/main/public/recordings/median.json',
      'https://example.com/a b/c+d.json?x=1&y=2#frag',
      'https://example.com/r%C3%A9sum%C3%A9/crème.json',
      'http://localhost:5173/recordings/median.json',
    ]) {
      for (const base of ['https://scasella.github.io/undefined/', 'https://scasella.github.io/undefined/?theme=dark#top', 'http://localhost:5173/?recording=old']) {
        const link = shareLink(base, rec);
        const u = new URL(link);
        expect(u.hash).toBe('');
        expect(recordingParamFromLocation(u.search, u.hash)).toBe(rec);
        expect(link.match(/recording=/g)).toHaveLength(1);
      }
    }
    expect(shareLink('https://scasella.github.io/undefined/?theme=dark', 'https://e.com/r.json')).toBe(
      'https://scasella.github.io/undefined/?theme=dark&recording=https%3A%2F%2Fe.com%2Fr.json',
    );
  });

  it('reads the hash form and a hand-typed "+" literally', () => {
    expect(recordingParamFromLocation('', '#recording=https%3A%2F%2Fe.com%2Fr.json')).toBe('https://e.com/r.json');
    expect(recordingParamFromLocation('?recording=https://e.com/a+b.json', '')).toBe('https://e.com/a+b.json');
    expect(recordingParamFromLocation('?other=1', '#recording=https://e.com/x.json')).toBe('https://e.com/x.json');
    expect(recordingParamFromLocation('?recording=', '#recording=https://e.com/x.json')).toBe('https://e.com/x.json');
  });

  it('ignores empty and garbage values', () => {
    for (const [s, h] of [
      ['', ''],
      ['?recording=', ''],
      ['?recording=%20%20', ''],
      ['?recording=not%20a%20url', ''],
      ['?recording=javascript%3Aalert(1)', ''],
      ['?recording=%E0%A4%A', ''],
      ['?other=https%3A%2F%2Fe.com', '#nothing'],
    ]) {
      expect(recordingParamFromLocation(s, h)).toBeNull();
    }
  });
});

// ───────────────────────── fetchRecording ─────────────────────────

type Fetch = typeof fetch;

function streamOf(chunks: Uint8Array[], opts: { hang?: boolean } = {}): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else if (!opts.hang) controller.close();
      else return new Promise(() => undefined);
    },
  });
}

function fakeFetch(make: (url: string) => Response | Promise<Response>, seen: string[] = []): Fetch {
  return (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return make(String(input));
  }) as Fetch;
}

describe('fetchRecording', () => {
  it('loads a valid recording, normalizing a GitHub blob URL first', async () => {
    const seen: string[] = [];
    const r = await fetchRecording('https://github.com/scasella/undefined/blob/main/public/recordings/median.json', {
      fetchImpl: fakeFetch(() => new Response(MEDIAN, { headers: { 'content-type': 'application/json' } }), seen),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canSeed).toBe(true);
    expect(seen).toEqual(['https://raw.githubusercontent.com/scasella/undefined/main/public/recordings/median.json']);
  });

  it('allows only https and local http', async () => {
    const f = fakeFetch(() => new Response(MEDIAN));
    expect((await fetchRecording('http://localhost:5173/r.json', { fetchImpl: f })).ok).toBe(true);
    expect((await fetchRecording('http://127.0.0.1/r.json', { fetchImpl: f })).ok).toBe(true);
    const cases: [string, RegExp][] = [
      ['http://example.com/r.json', /Only https:\/\/ links.*got http:\/\/example\.com/],
      ['file:///etc/passwd', /Only https:\/\/ links.*file: link/],
      ['javascript:alert(1)', /Only https:\/\/ links/],
      ['data:application/json,{}', /Only https:\/\/ links.*data: link/],
      ['example.com/r.json', /not a web address/],
      ['', /No recording URL/],
    ];
    for (const [url, re] of cases) {
      const r = await fetchRecording(url, { fetchImpl: f });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    }
  });

  it('maps non-2xx, non-JSON, HTML pages and invalid recordings', async () => {
    const notFound = await fetchRecording('https://e.com/r.json', { fetchImpl: fakeFetch(() => new Response('nope', { status: 404, statusText: 'Not Found' })) });
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.error).toMatch(/^The server answered 404 Not Found for e\.com\./);

    const text = await fetchRecording('https://e.com/r.json', { fetchImpl: fakeFetch(() => new Response('hello')) });
    if (!text.ok) expect(text.error).toMatch(/not JSON/);

    const html = await fetchRecording('https://e.com/r.json', {
      fetchImpl: fakeFetch(() => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })),
    });
    expect(html).toMatchObject({ ok: false, error: 'e.com sent a web page, not the recording file.' });

    const invalid = await fetchRecording('https://e.com/r.json', { fetchImpl: fakeFetch(() => new Response('{"format":"undefined-recording","version":2}')) });
    if (!invalid.ok) expect(invalid.error).toMatch(/^This is not a valid recording: recordedAt must be a string/);

    const image = await fetchRecording('https://e.com/r.json', { fetchImpl: fakeFetch(() => new Response('{"format":"undefined-image"}')) });
    if (!image.ok) expect(image.error).toMatch(/program image/);
  });

  it('rejects an oversize Content-Length before reading the body', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled = true;
      },
    }, { highWaterMark: 0 });
    const r = await fetchRecording('https://e.com/r.json', {
      maxBytes: 1000,
      fetchImpl: fakeFetch(() => new Response(body, { headers: { 'content-length': '5000' } })),
    });
    expect(r).toMatchObject({ ok: false, error: 'The recording is too large (4.9 KB; the limit is 1000 bytes).' });
    expect(pulled).toBe(false);
  });

  it('enforces the cap while streaming when Content-Length is absent or lies', async () => {
    const chunk = new Uint8Array(400).fill(0x20);
    let served = 0;
    const r = await fetchRecording('https://e.com/r.json', {
      maxBytes: 1000,
      fetchImpl: fakeFetch(() => {
        const s = new ReadableStream<Uint8Array>({
          pull(c) {
            served++;
            c.enqueue(chunk);
          },
        });
        return new Response(s, { headers: { 'content-length': '10' } });
      }),
    });
    expect(r).toMatchObject({ ok: false, error: 'The recording is larger than the 1000 bytes limit.' });
    expect(served).toBeLessThan(10);
  });

  it('counts bytes, not characters, and decodes UTF-8 split across chunks', async () => {
    const rec = JSON.parse(MEDIAN);
    rec.title = 'Crème brûlée — ünïcödé';
    const bytes = new TextEncoder().encode(JSON.stringify(rec));
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
    const ok = await fetchRecording('https://e.com/r.json', { fetchImpl: fakeFetch(() => new Response(streamOf(chunks))) });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.recording.title).toBe(rec.title);
    const capped = await fetchRecording('https://e.com/r.json', { maxBytes: bytes.length - 1, fetchImpl: fakeFetch(() => new Response(streamOf(chunks))) });
    expect(capped.ok).toBe(false);
  });

  it('falls back to text() when there is no body stream', async () => {
    const res = { ok: true, status: 200, statusText: 'OK', headers: new Headers(), body: null, text: async () => 'x'.repeat(2000) } as unknown as Response;
    const r = await fetchRecording('https://e.com/r.json', { maxBytes: 1000, fetchImpl: fakeFetch(() => res) });
    expect(r).toMatchObject({ ok: false, error: 'The recording is larger than the 1000 bytes limit.' });
  });

  it('times out when the server never answers (even if fetch ignores the signal)', async () => {
    const r = await fetchRecording('https://slow.example/r.json', { timeoutMs: 30, fetchImpl: (() => new Promise(() => undefined)) as Fetch });
    expect(r).toEqual({ ok: false, error: 'slow.example did not send the recording within 30 ms.' });
  });

  it('times out while the body is streaming, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const r = await fetchRecording('https://slow.example/r.json', {
      timeoutMs: 50,
      fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Response(streamOf([new TextEncoder().encode('{"for')], { hang: true }));
      }) as Fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not send the recording within/);
    expect(signal?.aborted).toBe(true);
  });

  it('maps a signal-honouring abort on timeout to the timeout message', async () => {
    const r = await fetchRecording('https://slow.example/r.json', {
      timeoutMs: 20,
      fetchImpl: ((_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as Fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not send the recording/);
  });

  it('maps a network/CORS failure (TypeError) to an error with the CORS hint', async () => {
    const r = await fetchRecording('https://cors.example/r.json', {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as Fetch,
    });
    expect(r).toEqual({
      ok: false,
      error: 'The recording at cors.example could not be loaded: the request was blocked or the network failed.',
      hint: CORS_HINT,
    });
  });

  it('never throws, whatever fetch does', async () => {
    const weird = [
      (() => {
        throw new Error('sync boom');
      }) as unknown as Fetch,
      (async () => {
        throw 'a string';
      }) as unknown as Fetch,
      (async () => null) as unknown as Fetch,
      (async () => ({ ok: true, headers: null, body: { getReader: () => ({ read: async () => { throw new Error('read boom'); } }) } })) as unknown as Fetch,
    ];
    for (const f of weird) {
      const r = await fetchRecording('https://e.com/r.json', { fetchImpl: f, timeoutMs: 50 });
      expect(r.ok).toBe(false);
    }
    await expect(fetchRecording(undefined as unknown as string)).resolves.toMatchObject({ ok: false });
  });
});

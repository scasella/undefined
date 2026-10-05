import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handle, type ShareBucket } from '../../server/share/worker';
import { fetchRecording, parseRecordingText, recordingParamFromLocation } from './source';
import { shareEndpoint, uploadRecording } from './upload';

const parsed = parseRecordingText(readFileSync(new URL('../../public/recordings/fibonacci.json', import.meta.url), 'utf8'));
if (!parsed.ok) throw new Error(parsed.error);
const rec = parsed.recording;

describe('shareEndpoint', () => {
  it('accepts https (and http on localhost) and drops a trailing slash', () => {
    expect(shareEndpoint('https://share.example.workers.dev/')).toBe('https://share.example.workers.dev');
    expect(shareEndpoint(' https://example.com/r// ')).toBe('https://example.com/r');
    expect(shareEndpoint('http://localhost:8787')).toBe('http://localhost:8787');
  });
  it('is off when unset or unusable', () => {
    for (const v of [undefined, '', '  ', 'share.example.dev', 'http://example.com', 'ftp://x', 'https://x/?a=1', 'https://u:p@x']) {
      expect(shareEndpoint(v)).toBeNull();
    }
  });
});

describe('uploadRecording against the worker', () => {
  it('round-trips: upload, then the site loader fetches <endpoint>/<hash> from the link', async () => {
    const objects = new Map<string, string>();
    const bucket: ShareBucket = {
      head: async (k) => (objects.has(k) ? {} : null),
      get: async (k) => (objects.has(k) ? { body: new Response(objects.get(k)).body } : null),
      put: async (k, v) => void objects.set(k, v),
    };
    const worker = ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init), { RECORDINGS: bucket })) as typeof fetch;
    const up = await uploadRecording('https://share.example.workers.dev', rec, worker);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.recordingUrl).toBe(`https://share.example.workers.dev/${up.hash}`);
    expect(recordingParamFromLocation(`?recording=${encodeURIComponent(up.recordingUrl)}`, '')).toBe(up.recordingUrl);
    const loaded = await fetchRecording(up.recordingUrl, { fetchImpl: worker });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.recording).toEqual(rec);
  });

  it('reports refusals and network failures without throwing', async () => {
    const refused = (async () => new Response(JSON.stringify({ error: 'too big' }), { status: 413 })) as unknown as typeof fetch;
    expect(await uploadRecording('https://s.example', rec, refused)).toEqual({ ok: false, error: 's.example refused the upload (413): too big' });
    const garbled = (async () => new Response('{"hash":"nope"}', { status: 201 })) as unknown as typeof fetch;
    expect((await uploadRecording('https://s.example', rec, garbled)).ok).toBe(false);
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await uploadRecording('https://s.example', rec, down)).toEqual({ ok: false, error: 'Could not reach s.example (Failed to fetch).' });
  });
});

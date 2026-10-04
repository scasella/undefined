import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSaveRequest, handleSaveRecording, MAX_RECORDING_BYTES } from './saveRecording';

const RECORDING = JSON.stringify({ format: 'undefined-recording', version: 1, id: 'x', sessions: [] });

describe('checkSaveRequest', () => {
  const ok = { host: 'localhost:5173', origin: 'http://localhost:5173', 'content-type': 'application/json' };
  it('accepts a same-origin JSON POST to a loopback host', () => {
    expect(checkSaveRequest({ method: 'POST', headers: ok })).toBeNull();
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, 'content-type': 'application/json; charset=utf-8' } })).toBeNull();
  });
  it('requires an Origin matching the Host', () => {
    const { origin: _o, ...noOrigin } = ok;
    expect(checkSaveRequest({ method: 'POST', headers: noOrigin })).toEqual({ status: 403, reason: 'missing Origin header' });
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, origin: 'http://evil.example' } })?.status).toBe(403);
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, origin: 'http://localhost:9999' } })?.status).toBe(403);
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, origin: 'null' } })?.status).toBe(403);
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, host: 'evil.example', origin: 'http://evil.example' } })?.status).toBe(403);
  });
  it('requires application/json, POST and a body within the cap', () => {
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, 'content-type': 'text/plain' } })?.status).toBe(415);
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, 'content-type': undefined } })?.status).toBe(415);
    expect(checkSaveRequest({ method: 'GET', headers: ok })?.status).toBe(405);
    expect(checkSaveRequest({ method: 'POST', headers: { ...ok, 'content-length': String(MAX_RECORDING_BYTES + 1) } })?.status).toBe(413);
  });
});

describe('POST /__save-recording over HTTP', () => {
  let root: string;
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'undefined-save-rec-'));
    server = http.createServer((req, res) => handleSaveRecording(root, req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });

  const post = (id: string, headers: Record<string, string>, chunks: string[]) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: `/?id=${id}`, method: 'POST', headers: { host: `localhost:${port}`, ...headers } },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
        },
      );
      req.on('error', reject);
      for (const c of chunks.slice(0, -1)) req.write(c);
      req.end(chunks[chunks.length - 1]);
    });
  const same = () => ({ origin: `http://localhost:${port}`, 'content-type': 'application/json' });
  const saved = (id: string) => readFile(join(root, 'public', 'recordings', `${id}.json`), 'utf8').catch(() => null);

  it('saves a same-origin JSON recording', async () => {
    expect(await post('good', same(), [RECORDING])).toEqual({ status: 200, text: 'saved' });
    expect(JSON.parse((await saved('good'))!)).toMatchObject({ format: 'undefined-recording' });
  });

  it('rejects a missing or foreign Origin and a non-JSON content type without writing', async () => {
    expect((await post('noorigin', { 'content-type': 'application/json' }, [RECORDING])).status).toBe(403);
    expect((await post('foreign', { ...same(), origin: 'http://evil.example' }, [RECORDING])).status).toBe(403);
    expect((await post('textplain', { ...same(), 'content-type': 'text/plain' }, [RECORDING])).status).toBe(415);
    for (const id of ['noorigin', 'foreign', 'textplain']) expect(await saved(id)).toBeNull();
  });

  it('caps the body at 2 MB, also for a chunked upload without Content-Length', async () => {
    const half = 'x'.repeat(MAX_RECORDING_BYTES / 2 + 10);
    const r = await post('big', same(), [`{"format":"undefined-recording","pad":"`, half, half, '"}']);
    expect(r.status).toBe(413);
    expect(await saved('big')).toBeNull();
  });
});

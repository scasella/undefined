import type { Plugin } from 'vite';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

/**
 * Maintainer tooling, dev server only: POST /__save-recording?id=<name> with a Recording JSON body writes
 * public/recordings/<name>.json and refreshes public/recordings/index.json. Same-origin requests to a loopback
 * host only: an `Origin` header whose host equals the `Host` header is required (a page on another site, or a
 * DNS-rebound name, cannot write files), the body must be `Content-Type: application/json` (so a cross-site
 * "simple" form/text POST is never accepted) and at most MAX_RECORDING_BYTES.
 * (Visitors use the app's "Download recording" button instead.)
 */
export const MAX_RECORDING_BYTES = 2 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** null when the request may write; otherwise the status and reason. */
export function checkSaveRequest(req: Pick<IncomingMessage, 'method' | 'headers'>): { status: number; reason: string } | null {
  if (req.method !== 'POST') return { status: 405, reason: 'use POST' };
  const host = req.headers.host;
  if (!host) return { status: 403, reason: 'missing Host header' };
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return { status: 403, reason: 'bad Host header' };
  }
  if (!LOCAL_HOSTS.has(hostname)) return { status: 403, reason: `host ${hostname} is not a loopback name` };
  const origin = req.headers.origin;
  if (!origin) return { status: 403, reason: 'missing Origin header' };
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { status: 403, reason: 'bad Origin header' };
  }
  if (originHost !== host) return { status: 403, reason: `origin ${origin} does not match host ${host}` };
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') return { status: 415, reason: 'Content-Type must be application/json' };
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_RECORDING_BYTES) return { status: 413, reason: `body exceeds ${MAX_RECORDING_BYTES} bytes` };
  return null;
}

/** Handles one request to the route; `root` is the project root (recordings go to <root>/public/recordings). */
export function handleSaveRecording(root: string, req: IncomingMessage, res: ServerResponse): void {
  const refused = checkSaveRequest(req);
  if (refused) {
    res.statusCode = refused.status;
    res.end(refused.status === 403 ? `forbidden: ${refused.reason}` : refused.reason);
    req.resume();
    return;
  }
  const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
  if (!/^[a-z0-9-]{1,40}$/.test(id)) {
    res.statusCode = 400;
    res.end('bad id');
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (c: Buffer) => {
    if (tooLarge) return;
    size += c.length;
    if (size > MAX_RECORDING_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      res.statusCode = 413;
      res.end(`body exceeds ${MAX_RECORDING_BYTES} bytes`);
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (json?.format !== 'undefined-recording') throw new Error('not a recording');
      const dir = join(root, 'public', 'recordings');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(json, null, 1) + '\n');
      const names = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
      writeFileSync(join(dir, 'index.json'), JSON.stringify(names, null, 1) + '\n');
      res.end('saved');
    } catch (e) {
      res.statusCode = 400;
      res.end(String(e));
    }
  });
}

export function saveRecording(): Plugin {
  return {
    name: 'undefined-save-recording',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-recording', (req, res) => handleSaveRecording(server.config.root, req, res));
    },
  };
}

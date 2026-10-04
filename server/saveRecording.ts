import type { Plugin } from 'vite';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Maintainer tooling, dev server only: POST /__save-recording?id=<name> with a Recording JSON body writes
 * public/recordings/<name>.json and refreshes public/recordings/index.json. Same-host requests only.
 * (Visitors use the app's "Download recording" button instead.)
 */
export function saveRecording(): Plugin {
  return {
    name: 'undefined-save-recording',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-recording', (req, res) => {
        const host = (req.headers.host ?? '').split(':')[0];
        if (req.method !== 'POST' || !['localhost', '127.0.0.1', '[::1]'].includes(host!)) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        if (!/^[a-z0-9-]{1,40}$/.test(id)) {
          res.statusCode = 400;
          res.end('bad id');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (json?.format !== 'undefined-recording') throw new Error('not a recording');
            const dir = join(server.config.root, 'public', 'recordings');
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
      });
    },
  };
}

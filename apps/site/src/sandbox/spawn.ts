/**
 * How the main thread starts the two sandbox workers (gate worker, runtime worker), and the per-worker nonce that
 * authenticates their messages.
 *
 * Content-Security-Policy: the static site cannot send headers (GitHub Pages), so its policy is a <meta> tag
 * (vite.config.ts). A worker loaded from an ordinary URL does NOT inherit the page's policy; it would run with no
 * CSP at all, so `import('https://anywhere/…')` from candidate or test code would work. A worker whose script is a
 * blob: URL DOES inherit the creating document's policy container (HTML "policy container" inheritance for local
 * schemes; verified in Chrome by scripts/sandbox-check.mjs). So each worker is started from a one-line blob module
 * that statically imports the real (bundled, same-origin) worker script: the import is allowed by script-src 'self',
 * and every later import() inside the worker is checked against the page's script-src (no remote hosts, no data:,
 * no blob:).
 */

const wrappers = new Map<string, string>();

/** Resolve a bundler-provided worker URL (absolute path in dev, import.meta.url-based in the build) to an absolute URL. */
export function absoluteUrl(url: string): string {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  return new URL(url, base).href;
}

/** The text of the blob module that loads `absUrl`. Exported for tests. */
export function wrapperSource(absUrl: string): string {
  return `import ${JSON.stringify(absUrl)};\n`;
}

/**
 * Start a module worker running `workerUrl` through a blob: wrapper, so the worker inherits this page's CSP.
 * The blob URL is created once per worker script and kept (two small entries for the page's lifetime): revoking it
 * while a worker may still be resolving it would be a race for no gain.
 */
export function spawnModuleWorker(workerUrl: string): Worker {
  const abs = absoluteUrl(workerUrl);
  let blobUrl = wrappers.get(abs);
  if (!blobUrl) {
    blobUrl = URL.createObjectURL(new Blob([wrapperSource(abs)], { type: 'text/javascript' }));
    wrappers.set(abs, blobUrl);
  }
  return new Worker(blobUrl, { type: 'module' });
}

// The run nonce (crypto-random, per worker) is shared with the engine's gate runner; re-exported for runtime.ts.
export { hasNonce, newNonce } from '@scasella/undefined-engine/sandbox/nonce';

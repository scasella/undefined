/**
 * Content-Security-Policy for the app (vite.config.ts applies it).
 *
 * Why: candidate code (written by a model, possibly in a recording a stranger sent you) and spec test code run in
 * the two sandbox workers. String-built code (`(()=>0).constructor('return import(u)')`) can reach `import()`, which
 * no JS-level mask can remove from a worker. The policy is what refuses it: script-src has no remote hosts, no data:
 * and no blob:, so a dynamic import of anything but this site's own scripts is a CSP violation.
 *
 * The workers get the page's policy by inheritance (src/sandbox/spawn.ts starts them from blob: URLs).
 *
 * - PRODUCTION_CSP: a <meta> in the built index.html (GitHub Pages cannot send headers), and the response header of
 *   `vite preview`. connect-src allows https: because the user may load a recording from any https URL (the only
 *   cross-origin request the main thread makes); the workers inherit that too, which is why scrubWorkerGlobals still
 *   removes fetch/XHR/WebSocket/… from them.
 * - DEV_CSP: the response header of `vite dev`. Adds what Vite's dev client needs (the HMR websocket) and plain-http
 *   localhost, which share/source.ts accepts for recordings during development. Same script-src: no remote hosts.
 */

type Policy = Record<string, string[]>;

const base: Policy = {
  'default-src': ["'self'"],
  // 'unsafe-eval': the sandbox evaluates compiled candidates and test code with `new Function` (mask.ts, testApi.ts).
  'script-src': ["'self'", "'unsafe-eval'"],
  // blob: starts the sandbox workers through their wrapper (spawn.ts); it is NOT in script-src, so code inside a
  // worker cannot import a blob it made itself.
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'font-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'https:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

function render(p: Policy): string {
  return Object.entries(p)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

export const PRODUCTION_CSP = render(base);

export const DEV_CSP = render({
  ...base,
  // Same script-src as production: Vite's dev client and @preact/preset-vite load as external same-origin modules
  // (no inline scripts; verified by scripts/sandbox-check.mjs, which fails on any CSP violation by the app itself).
  // IPv6 literals such as http://[::1]:* are not valid CSP sources (Chrome ignores them with an error), so a
  // recording at http://[::1]:… cannot be loaded in dev; use localhost.
  'connect-src': [
    ...base['connect-src']!,
    'ws://localhost:*',
    'ws://127.0.0.1:*',
    'http://localhost:*',
    'http://127.0.0.1:*',
  ],
});

/**
 * `html` with the policy as a <meta http-equiv> inserted right after its <meta charset> (else at the start of <head>).
 * Throws when there is no <head>: a build without the policy must fail, not ship silently.
 */
export function cspMetaHtml(html: string, policy = PRODUCTION_CSP): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />`;
  if (html.includes('http-equiv="Content-Security-Policy"')) throw new Error('index.html already has a Content-Security-Policy meta');
  const charset = /<meta\s+charset=[^>]*>/i.exec(html);
  if (charset) return html.slice(0, charset.index + charset[0].length) + '\n    ' + tag + html.slice(charset.index + charset[0].length);
  const head = /<head[^>]*>/i.exec(html);
  if (!head) throw new Error('index.html has no <head>: cannot add the Content-Security-Policy');
  return html.slice(0, head.index + head[0].length) + '\n    ' + tag + html.slice(head.index + head[0].length);
}

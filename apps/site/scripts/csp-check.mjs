// node scripts/csp-check.mjs  — run after `npm run build`. Static guard: both production pages (index.html, the front
// door, and workbench.html, the REPL) must ship a Content-Security-Policy that keeps both sandbox workers (which inherit it through their blob: wrapper) from loading script from anywhere but this
// site, and the dev-only hooks must not be in the bundle. It does not simulate an attack; it fails when the policy is weakened.
import { readFileSync, readdirSync } from 'node:fs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site, wherever this is run from
const fails = [];
// Two pages ship (vite.config.ts build.rollupOptions.input): the front door and the workbench. Each must carry the policy.
for (const page of ['index.html', 'workbench.html']) {
  let html;
  try { html = readFileSync(`dist/${page}`, 'utf8'); } catch { fails.push(`dist/${page} is missing (run \`npm run build\` first)`); continue; }
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  if (!m) { fails.push(`no Content-Security-Policy <meta> in dist/${page}`); continue; }
  const at = (msg) => fails.push(`dist/${page}: ${msg}`);
  const pol = Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
  const has = (dir, tok) => (pol[dir] ?? []).includes(tok);
  const any = (dir, re) => (pol[dir] ?? []).some((t) => re.test(t));
  if (!has('default-src', "'self'")) at("default-src must be 'self'");
  if (!has('script-src', "'self'")) at("script-src must include 'self'");
  if (any('script-src', /^(https?:|\*|data:|blob:|'unsafe-inline'|'unsafe-hashes'|'strict-dynamic')$/)) at('script-src allows a remote, data:, blob: or inline source: import() of remote code would work in the workers');
  if (!has('object-src', "'none'")) at("object-src must be 'none'");
  if (!has('base-uri', "'none'")) at("base-uri must be 'none'");
  if (any('connect-src', /^(\*|http:|ws:|wss:|data:|blob:)$/)) at('connect-src must not allow * / http: / ws: / data: / blob:');
  if (!has('worker-src', 'blob:')) at('worker-src must allow blob: (the sandbox workers start from a blob wrapper so they inherit this policy)');
  // a meta policy governs only what follows it: it must come before every script and stylesheet
  const first = html.search(/<script|<link[^>]+rel="(stylesheet|modulepreload)"/);
  if (first !== -1 && first < m.index) at('the CSP <meta> comes after a script or stylesheet, which it then does not govern');
}
for (const f of readdirSync('dist/assets').filter((n) => n.endsWith('.js'))) {
  const t = readFileSync(`dist/assets/${f}`, 'utf8');
  if (/window\.__undefined|createFixtureEngine/.test(t)) fails.push(`dev-only code found in dist/assets/${f}`);
}
if (fails.length) { console.error('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('PASS: production CSP (index.html, workbench.html) and bundle contents');

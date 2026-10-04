// node scripts/csp-check.mjs  — run after `npm run build`. Static guard: the production page must ship a Content-Security-Policy
// that keeps both sandbox workers (which inherit it through their blob: wrapper) from loading script from anywhere but this
// site, and the dev-only hooks must not be in the bundle. It does not simulate an attack; it fails when the policy is weakened.
import { readFileSync, readdirSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
const fails = [];
if (!m) fails.push('no Content-Security-Policy <meta> in dist/index.html');
else {
  const pol = Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
  const has = (dir, tok) => (pol[dir] ?? []).includes(tok);
  const any = (dir, re) => (pol[dir] ?? []).some((t) => re.test(t));
  if (!has('default-src', "'self'")) fails.push("default-src must be 'self'");
  if (!has('script-src', "'self'")) fails.push("script-src must include 'self'");
  if (any('script-src', /^(https?:|\*|data:|blob:|'unsafe-inline'|'unsafe-hashes'|'strict-dynamic')$/)) fails.push('script-src allows a remote, data:, blob: or inline source: import() of remote code would work in the workers');
  if (!has('object-src', "'none'")) fails.push("object-src must be 'none'");
  if (!has('base-uri', "'none'")) fails.push("base-uri must be 'none'");
  if (any('connect-src', /^(\*|http:|ws:|wss:|data:|blob:)$/)) fails.push('connect-src must not allow * / http: / ws: / data: / blob:');
  if (!has('worker-src', 'blob:')) fails.push('worker-src must allow blob: (the sandbox workers start from a blob wrapper so they inherit this policy)');
}
for (const f of readdirSync('dist/assets').filter((n) => n.endsWith('.js'))) {
  const t = readFileSync(`dist/assets/${f}`, 'utf8');
  if (/window\.__undefined|createFixtureEngine/.test(t)) fails.push(`dev-only code found in dist/assets/${f}`);
}
if (fails.length) { console.error('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('PASS: production CSP and bundle contents');

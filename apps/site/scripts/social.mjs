// node scripts/social.mjs [--skip-build] [--scheme=light|dark]  — the 1200x630 link-preview image (og:image).
// Replays the median opening on the production build's workbench page (workbench.html), screenshots the REAL rejection
// card and wordmark at 3x, reads the two argument sentences from the page, and composes them on a 1200x630 canvas (a small static page of our own, rendered
// at 2x and downscaled). Writes docs/social.png and copies it to public/social.png (served by the site; index.html and
// workbench.html point og:image / twitter:image at it).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { startServer, launch, workbench } from './lib/drive.mjs';

const root = new URL('../', import.meta.url).pathname; // apps/site/
const repo = new URL('../../../', import.meta.url).pathname; // docs/ and the hoisted node_modules/ live here
const scheme = process.argv.find((a) => a.startsWith('--scheme='))?.slice('--scheme='.length) ?? 'light';
if (scheme !== 'light' && scheme !== 'dark') throw new Error(`--scheme: light or dark, not ${scheme}`);
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
const OUT = `${root}.tmp/social`;
mkdirSync(OUT, { recursive: true });

const srv = await startServer({ mode: 'preview', port: 5203 });
const b = await launch({ width: 1440, height: 900, dsf: 3 });
const p = b.page;
let parts;
try {
  await p.emulateMedia({ colorScheme: scheme });
  await p.goto(workbench(srv.url));
  await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('undefined-image'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); }); });
  await p.goto(workbench(srv.url));
  await p.waitForSelector('#repl-input');
  const argument = await p.$$eval('.argument span', (s) => s.map((e) => e.textContent.trim()));
  if (argument.length !== 2) throw new Error('expected the two argument sentences under the masthead');
  const colors = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { paper: cs.getPropertyValue('--paper').trim(), ink: cs.getPropertyValue('--ink').trim(), muted: cs.getPropertyValue('--muted').trim() }; });
  await p.locator('#repl-input').press('Enter');
  await p.waitForSelector('.headline-fail', { timeout: 90000 });
  await p.waitForTimeout(700); // let the card's entrance settle
  // transparent page behind the elements, so they sit on our canvas without a seam (the elements keep their own surfaces)
  await p.addStyleTag({ content: 'html, body, .stage, .panel-gates { background: transparent !important; }' });
  const shot = async (sel, pad) => {
    const box = await p.locator(sel).first().boundingBox();
    const clip = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
    const buf = await p.screenshot({ clip, omitBackground: true });
    return { src: `data:image/png;base64,${buf.toString('base64')}`, w: clip.width, h: clip.height };
  };
  parts = { card: await shot('.headline-fail', 6), mark: await shot('.wordmark', 4), argument, colors };
} finally {
  await b.close();
  srv.stop();
}

const font = `file://${repo}node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2`;
const cardW = 640;
const cardH = (parts.card.h * cardW) / parts.card.w;
const markW = parts.mark.w * 1.55;
const { paper, ink, muted } = parts.colors;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Plex; src: url('${font}') format('woff2'); font-weight: 100 700; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; background: ${paper}; overflow: hidden; }
body { display: grid; grid-template-columns: 1fr ${cardW}px; gap: 44px; align-items: center; padding: 0 48px 0 56px; font-family: Plex, sans-serif; color: ${ink}; }
.mark { width: ${markW}px; display: block; margin-left: -6px; }
.rule { height: 3px; border-top: 1px solid ${ink}; border-bottom: 1px solid ${ink}; margin: 18px 0 26px; width: 100%; }
p { font-size: 27px; line-height: 1.38; font-weight: 450; }
p + p { margin-top: 16px; color: ${muted}; }
.card { width: ${cardW}px; height: ${cardH}px; display: block; }
</style></head><body>
<div><img class="mark" src="${parts.mark.src}" alt=""><div class="rule"></div><p>${parts.argument[0]}</p><p>${parts.argument[1]}</p></div>
<img class="card" src="${parts.card.src}" alt="">
</body></html>`;
writeFileSync(`${OUT}/social-${scheme}.html`, html);

const c = await launch({ width: 1200, height: 630, dsf: 2 });
try {
  await c.page.goto(`file://${OUT}/social-${scheme}.html`);
  await c.page.evaluate(() => document.fonts.ready);
  await c.page.waitForTimeout(200);
  await c.page.screenshot({ path: `${OUT}/social-${scheme}@2x.png` });
} finally {
  await c.close();
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/social-${scheme}@2x.png`, '-vf', 'scale=1200:630:flags=lanczos', `${OUT}/social-${scheme}.png`]);
if (!process.argv.includes('--preview-only')) {
  copyFileSync(`${OUT}/social-${scheme}.png`, `${repo}docs/social.png`);
  copyFileSync(`${OUT}/social-${scheme}.png`, `${root}public/social.png`);
  console.log(`wrote docs/social.png and public/social.png (${scheme}, ${readFileSync(`${repo}docs/social.png`).length} bytes)`);
} else console.log(`wrote .tmp/social/social-${scheme}.png`);

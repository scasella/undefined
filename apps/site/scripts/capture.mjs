// node scripts/capture.mjs [--skip-build]  — records the demo from the PRODUCTION build in replay mode (repeatable timings)
// with real Chrome frames (2x device pixels), re-times them (dead time while the model "thinks" is sped up, the
// rejection card is held) and writes:
//   docs/opening.gif   the opening sequence (Enter -> rejection -> retry -> commit), 1440 px wide
//   docs/demo.mp4      ~40 s: the opening sequence, Decide on median([]) (the spec was silent; rule NaN; the committed
//                      median is re-certified in place, no model call), then the data flow (orders: data drawer,
//                      spec-less call, table, pin), 2880x1800
// node scripts/capture.mjs --opener=<id> [--skip-build]  — the opening sequence only, loaded with `?opener=<id>`, written
// to docs/opening-<id>.gif (docs/opening.gif and docs/demo.mp4 are left alone)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { startServer, launch, workbench } from './lib/drive.mjs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site, wherever this is run from

const DOCS = new URL('../../../docs/', import.meta.url).pathname; // the repository's docs/, not apps/site

const opener = process.argv.find((a) => a.startsWith('--opener='))?.slice('--opener='.length) ?? null;
if (opener !== null && !/^[a-z]+$/.test(opener)) throw new Error(`--opener: not an example id: ${opener}`);
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
const OUT = opener ? `.tmp/capture-${opener}` : '.tmp/capture';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const srv = await startServer({ mode: 'preview', port: 5202 });
const b = await launch({ width: 1440, height: 900, dsf: 2 });
const p = b.page;
const frames = []; // { i, t }
let n = 0;
let capturing = false;
const t0 = performance.now();
// Real frames at 2x device pixels: a sequential JPEG screenshot loop (~20 fps at 2880x1800 here; CDP screencast
// ignores the device scale factor).
async function captureLoop() {
  while (capturing) {
    const buf = await p.screenshot({ type: 'jpeg', quality: 90 });
    const i = n++;
    frames.push({ i, t: (performance.now() - t0) / 1000 });
    writeFileSync(`${OUT}/f${String(i).padStart(5, '0')}.jpg`, buf);
  }
}
const marks = []; // state timeline sampled from the page: { t, state }
const stateNow = () => p.evaluate(() => {
  const g = document.querySelector('.panel-gates');
  const verdict = g?.getAttribute('data-verdict') ?? 'none';
  const attempt = document.querySelector('[data-attempt][data-status]');
  const statuses = [...document.querySelectorAll('[data-status]')].map((e) => e.getAttribute('data-status'));
  const text = document.body.innerText;
  return { verdict, statuses: statuses.join(','), busy: !!document.querySelector('.r-live'), typing: statuses.includes('typing'), generating: statuses.includes('generating'), committed: /Accepted · saved as r\d+/.test(text) };
});
let sampling = true;
(async () => { while (sampling) { try { marks.push({ t: (performance.now() - t0) / 1000, ...(await stateNow()) }); } catch { /* navigating */ } await new Promise((r) => setTimeout(r, 120)); } })();
const now = () => (performance.now() - t0) / 1000;
const at = {}; // named moments for segmenting

await p.goto(workbench(srv.url));
await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('undefined-image'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); }); });
await p.goto(workbench(srv.url, opener ? `?opener=${opener}` : ''));
await p.waitForSelector('#repl-input');
if (opener) await p.waitForFunction(() => !!document.querySelector('.opener-fn') && !!document.querySelector('#repl-input')?.value, null, { timeout: 30000 });
capturing = true;
const loop = captureLoop();
await p.waitForTimeout(1600); at.idleEnd = now(); // the opening line and the pre-typed call
await p.locator('#repl-input').press('Enter'); at.enter = now();
if (opener !== 'orders') { await p.waitForFunction(() => document.querySelector('.panel-gates')?.getAttribute('data-verdict') === 'fail', null, { timeout: 90000 }); at.rejected = now(); }
await p.waitForFunction(() => /Accepted · saved as r\d+/.test(document.body.innerText), null, { timeout: 90000 }); at.committed = now();
await p.waitForTimeout(2600); at.openingEnd = now();
if (!opener) {
// Decide (docs/FEATURES.md "Decide"): the accepted card's "The spec was silent on median([]) (draft #1). Decide" opens
// the question on the rejected draft; rule NaN; the committed median is re-certified at r3 with no model call. Then
// back to the accepted card, whose evidence line now counts the decision.
await p.locator('.silent-decide').click(); at.decideOpen = now();
await p.waitForSelector('details.decide[open]', { timeout: 10000 }); await p.waitForTimeout(1700); // the alternatives
await p.locator('details.decide label.decide-alt', { hasText: 'returns NaN' }).first().click(); await p.waitForTimeout(1100); // "Adds a test: ..."
await p.locator('details.decide .decide-confirm').click();
await p.waitForSelector('details.decide[data-decide="recertified"]', { timeout: 60000 }); at.recertified = now();
await p.waitForTimeout(1900);
await p.locator('button[data-attempt="2"]').click(); await p.waitForTimeout(300);
await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await p.waitForFunction(() => /including 1 decision\./.test(document.body.innerText) && document.scrollingElement.scrollTop === 0, null, { timeout: 10000 }); at.evidence = now();
await p.waitForTimeout(1900); at.decideEnd = now();
// data flow
await p.locator('button.example', { hasText: 'topCustomersByRevenue(' }).click(); await p.waitForTimeout(900);
await p.locator('.menu summary').click(); await p.waitForTimeout(250); await p.getByRole('menuitem', { name: /^Data/ }).click(); at.drawerOpen = now(); await p.waitForTimeout(3200);
await p.keyboard.press('Escape'); await p.waitForTimeout(500); at.drawerClosed = now();
await p.locator('#repl-input').press('Enter'); at.enter2 = now();
await p.waitForFunction(() => document.querySelectorAll('table').length > 0 && /Pin result as test/.test(document.body.innerText), null, { timeout: 90000 }); at.table = now();
await p.waitForTimeout(1300);
await p.getByRole('button', { name: /Pin result as test/ }).last().click(); at.pinned = now();
await p.waitForTimeout(2600); at.end = now();
}
sampling = false;
capturing = false;
await loop;
await b.close(); srv.stop();

// ---- re-time: the duration each frame is shown = real gap / speed(state at that moment)
const stateAt = (t) => { let s = marks[0]; for (const m of marks) { if (m.t <= t) s = m; else break; } return s; };
function speed(t) {
  const s = stateAt(t);
  if (t < at.enter) return 1;
  if (t >= at.enter && !s.typing && s.generating && s.statuses === 'generating') return 3.2; // waiting for the model
  if (t >= at.rejected && t < at.rejected + 3.4 && s.verdict === 'fail') return 0.55; // hold on the rejection card
  if (t >= at.committed && t < at.committed + 2.4) return 0.7; // hold on the commit
  if (t >= at.recertified && t < at.recertified + 1.9) return 0.85; // hold on "Re-certified"
  if (t >= at.evidence && t < at.decideEnd) return 0.9; // hold on the evidence line counting the decision
  if (t >= at.drawerOpen && t < at.drawerClosed) return 1.1;
  if (t >= at.enter2 && t < at.table && s.generating) return 3.2;
  return 1.15;
}
function build(from, to, name, fps, extra) {
  const sel = frames.filter((f) => f.t >= from && f.t <= to);
  const lines = [];
  let total = 0;
  sel.forEach((f, k) => {
    const next = k + 1 < sel.length ? sel[k + 1].t : to;
    const d = Math.max(0.001, (next - f.t) / speed(f.t));
    total += d;
    lines.push(`file 'f${String(f.i).padStart(5, '0')}.jpg'`, `duration ${d.toFixed(4)}`);
  });
  lines.push(`file 'f${String(sel.at(-1).i).padStart(5, '0')}.jpg'`);
  writeFileSync(`${OUT}/${name}.txt`, lines.join('\n') + '\n');
  console.log(name, 'frames', sel.length, 'duration', total.toFixed(1) + 's');
  return total;
}
mkdirSync(DOCS, { recursive: true });
const gifOut = opener ? `${DOCS}opening-${opener}.gif` : `${DOCS}opening.gif`;
const dMp4 = opener ? null : build(at.idleEnd - 1.2, at.end, 'mp4', 30);
if (!opener) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/mp4.txt`, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', `${DOCS}demo.mp4`]);
const dGif = build(at.idleEnd - 1.2, at.openingEnd, 'gif', 12);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/gif.txt`, '-vf', 'fps=12,scale=1440:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', gifOut]);
const real = (a, b) => (a !== undefined && b !== undefined ? (b - a).toFixed(1) + ' s' : 'n/a');
console.log(`opening (real time): Enter -> rejected ${real(at.enter, at.rejected)}, Enter -> committed ${real(at.enter, at.committed)}; ${gifOut} ${dGif.toFixed(1)} s`);
console.log(opener ? `wrote ${gifOut}` : 'wrote docs/demo.mp4 (' + dMp4.toFixed(1) + ' s) and docs/opening.gif');

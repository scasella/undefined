// node scripts/capture.mjs [--skip-build]  — records the demo from the PRODUCTION build in replay mode (repeatable timings)
// with real Chrome frames (2x device pixels), re-times them (dead time while the model "thinks" is sped up, the
// rejection card is held) and writes:
//   docs/opening.gif   the opening sequence (Enter -> rejection -> retry -> commit), 1440 px wide
//   docs/demo.mp4      ~30 s: the opening sequence + the data flow (orders: data drawer, spec-less call, table, pin), 2880x1800
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { startServer, launch } from './lib/drive.mjs';

if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' });
const OUT = '.tmp/capture';
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
  return { verdict, statuses: statuses.join(','), busy: /BUSY/.test(text) && !/Accepted — committed/.test(text), typing: statuses.includes('typing'), generating: statuses.includes('generating'), committed: /Accepted — committed as r\d+/.test(text) };
});
let sampling = true;
(async () => { while (sampling) { try { marks.push({ t: (performance.now() - t0) / 1000, ...(await stateNow()) }); } catch { /* navigating */ } await new Promise((r) => setTimeout(r, 120)); } })();
const now = () => (performance.now() - t0) / 1000;
const at = {}; // named moments for segmenting

await p.goto(srv.url);
await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('undefined-image'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); }); });
await p.goto(srv.url);
await p.waitForSelector('#repl-input');
capturing = true;
const loop = captureLoop();
await p.waitForTimeout(1600); at.idleEnd = now(); // the opening line and the pre-typed call
await p.locator('#repl-input').press('Enter'); at.enter = now();
await p.waitForFunction(() => document.querySelector('.panel-gates')?.getAttribute('data-verdict') === 'fail', null, { timeout: 90000 }); at.rejected = now();
await p.waitForFunction(() => /Accepted — committed as r\d+/.test(document.body.innerText), null, { timeout: 90000 }); at.committed = now();
await p.waitForTimeout(2600); at.openingEnd = now();
// data flow
await p.locator('button.example', { hasText: 'topCustomersByRevenue(' }).click(); await p.waitForTimeout(900);
await p.getByRole('button', { name: /^Data/ }).click(); at.drawerOpen = now(); await p.waitForTimeout(3200);
await p.keyboard.press('Escape'); await p.waitForTimeout(500); at.drawerClosed = now();
await p.locator('#repl-input').press('Enter'); at.enter2 = now();
await p.waitForFunction(() => document.querySelectorAll('table').length > 0 && /Pin as test/.test(document.body.innerText), null, { timeout: 90000 }); at.table = now();
await p.waitForTimeout(1300);
await p.getByRole('button', { name: /Pin as test/ }).first().click(); at.pinned = now();
await p.waitForTimeout(2600); at.end = now();
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
mkdirSync('docs', { recursive: true });
const dMp4 = build(at.idleEnd - 1.2, at.end, 'mp4', 30);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/mp4.txt`, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', 'docs/demo.mp4']);
build(at.idleEnd - 1.2, at.openingEnd, 'gif', 12);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/gif.txt`, '-vf', 'fps=12,scale=1440:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', 'docs/opening.gif']);
console.log('wrote docs/demo.mp4 (' + dMp4.toFixed(1) + ' s) and docs/opening.gif');

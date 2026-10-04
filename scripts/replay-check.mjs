// node scripts/replay-check.mjs — builds nothing; run `npm run build` first. Serves dist/ with `vite preview` (no
// backend => replay mode), drives the REAL UI in headless Chrome, and asserts each example replays from its recording:
// the recorded first candidate is rejected by the recorded gate (gates run live) and the retry commits.
import { startServer, launch } from './lib/drive.mjs';
const EXPECT = {
  median: { gate: 'PROPERTIES', text: 'median([])' },
  slugify: { gate: 'TESTS', text: 'slugify(' },
  fibonacci: { gate: 'INVARIANTS', text: 'fibonacci(1000000)' },
  // spec-less over a dataset: no tests, so nothing to reject; it must commit, render a table and offer the pin
  orders: { button: 'topCustomersByRevenue(', text: 'Pin as test', noRejection: true },
};
const srv = await startServer({ mode: 'preview', port: 5194 });
const b = await launch({ width: 1440, height: 900 });
let failed = 0;
try {
  for (const [id, want] of Object.entries(EXPECT)) {
    const p = b.page;
    await p.goto(srv.url);
    await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('undefined-image'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); }); });
    await p.goto(srv.url);
    await p.waitForSelector('#repl-input');
    if (id !== 'median') await p.locator('button.example', { hasText: (want.button ?? id + '(') }).click();
    await p.locator('#repl-input').press('Enter');
    let rejected = '';
    try {
      await p.waitForFunction(() => /Accepted — committed as r\d+/.test(document.body.innerText), null, { timeout: 120000 });
      rejected = await p.evaluate(() => [...document.querySelectorAll('.candidates *, [class*="strip"] *')].map((e) => e.textContent).join(' '));
    } catch { rejected = 'TIMEOUT'; }
    const text = await p.evaluate(() => document.body.innerText);
    const ok = /Accepted — committed as r\d+/.test(text) && text.includes(want.text) && (want.noRejection ? !/rejected by/i.test(text) && (await p.locator('table').count()) > 0 : /rejected by/i.test(text) && text.toLowerCase().includes(want.gate.toLowerCase()));
    console.log(ok ? 'PASS' : 'FAIL', id, ok ? '' : text.slice(0, 400));
    if (!ok) failed++;
  }
  // also the opener must show the replay banner
  const banner = await b.page.evaluate(() => document.body.innerText.includes('Replaying a recorded gpt-6-luna session; gates are running live'));
  console.log(banner ? 'PASS' : 'FAIL', 'replay banner');
  if (!banner) failed++;
} finally {
  await b.close();
  srv.stop();
}
process.exit(failed ? 1 : 0);

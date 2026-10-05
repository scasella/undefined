// node scripts/replay-check.mjs — builds nothing; run `npm run build` first. Serves dist/ with `vite preview` (no
// backend => replay mode), drives the REAL UI in headless Chrome, and asserts each example replays from its recording:
// the recorded first candidate is rejected by the recorded gate (gates run live) and the retry commits. Then the
// opener matrix: each `?opener=<id>` pre-types that example on a fresh load (orders: `rows` bound), and pressing
// Enter on it replays to commit with the same expectations.
import { startServer, launch } from './lib/drive.mjs';
const EXPECT = {
  median: { gate: 'PROPERTIES', text: 'median([])', call: 'median([3, 1, 4, 2])' },
  slugify: { gate: 'TESTS', text: 'slugify(', call: 'slugify("Hello, World! Crème Brûlée")' },
  fibonacci: { gate: 'INVARIANTS', text: 'fibonacci(1000000)', call: 'fibonacci(90)' },
  // spec-less over a dataset: no tests, so nothing to reject; it must commit, render a table and offer the pin
  orders: { button: 'topCustomersByRevenue(', text: 'Pin result as test', noRejection: true, call: 'topCustomersByRevenue(rows)', bound: 'rows is bound' },
};
const srv = await startServer({ mode: 'preview', port: 5194 });
const b = await launch({ width: 1440, height: 900 });
let failed = 0;
const timings = [];

async function fresh(p, url) {
  await p.goto(srv.url);
  await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('undefined-image'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); }); });
  await p.goto(url);
  await p.waitForSelector('#repl-input');
}

/** Enter on what is typed; true when it replays to commit as `want` says. Records Enter -> rejected / committed. */
async function enterAndCheck(p, id, want, label) {
  await p.locator('#repl-input').press('Enter');
  const t0 = Date.now();
  let rejectedAt = null;
  if (!want.noRejection) {
    try {
      await p.waitForFunction(() => document.querySelector('.panel-gates')?.getAttribute('data-verdict') === 'fail', null, { timeout: 120000 });
      rejectedAt = Date.now() - t0;
    } catch { /* reported below */ }
  }
  let committedAt = null;
  try {
    await p.waitForFunction(() => /Accepted · saved as r\d+/.test(document.body.innerText), null, { timeout: 120000 });
    committedAt = Date.now() - t0;
  } catch { /* reported below */ }
  const text = await p.evaluate(() => document.body.innerText);
  const ok = /Accepted · saved as r\d+/.test(text) && text.includes(want.text) && (want.noRejection ? !/rejected by/i.test(text) && (await p.locator('table').count()) > 0 : /rejected by/i.test(text) && text.toLowerCase().includes(want.gate.toLowerCase()));
  console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : text.slice(0, 400));
  if (!ok) failed++;
  timings.push({ label, rejectedMs: rejectedAt, committedMs: committedAt });
}

try {
  for (const [id, want] of Object.entries(EXPECT)) {
    const p = b.page;
    await fresh(p, srv.url);
    if (id !== 'median') await p.locator('button.example', { hasText: (want.button ?? id + '(') }).click();
    await enterAndCheck(p, id, want, id);
  }
  // also the header must show the replay mode pill (its tooltip names the recorded model)
  const banner = await b.page.evaluate(() => document.querySelector('.mode-badge')?.innerText.includes('Replay · gates run live') && document.querySelector('.mode-badge')?.title.includes('recorded gpt-6-luna session'));
  console.log(banner ? 'PASS' : 'FAIL', 'replay banner');
  if (!banner) failed++;

  // opener matrix: no chip click; the pre-typed state itself is checked before Enter
  for (const [id, want] of Object.entries(EXPECT)) {
    const p = b.page;
    await fresh(p, `${srv.url}?opener=${id}`);
    let pre = false;
    try {
      await p.waitForFunction(({ call, bound }) => document.querySelector('#repl-input')?.value === call && document.querySelector('.opener-fn')?.textContent === call.slice(0, call.indexOf('(')) && (!bound || (document.body.innerText.includes(bound) && [...document.querySelectorAll('.env-var')].some((e) => e.textContent.startsWith('rows = [')))), { call: want.call, bound: want.bound ?? null }, { timeout: 30000 });
      pre = true;
    } catch { /* reported below */ }
    const shown = await p.evaluate(() => ({ input: document.querySelector('#repl-input')?.value, opener: document.querySelector('.opener')?.textContent }));
    console.log(pre ? 'PASS' : 'FAIL', `opener=${id} pre-typed`, pre ? '' : JSON.stringify(shown));
    if (!pre) { failed++; continue; }
    await enterAndCheck(p, id, want, `opener=${id}`);
  }
  // an unknown opener falls back to median
  await fresh(b.page, `${srv.url}?opener=nope`);
  await b.page.waitForFunction(() => !!document.querySelector('#repl-input')?.value, null, { timeout: 30000 }).catch(() => {});
  const fallback = await b.page.evaluate(() => document.querySelector('#repl-input')?.value);
  console.log(fallback === EXPECT.median.call ? 'PASS' : 'FAIL', 'opener=nope falls back to median', fallback === EXPECT.median.call ? '' : fallback);
  if (fallback !== EXPECT.median.call) failed++;
  console.log('timings (ms after Enter):', JSON.stringify(timings));

  // Decide (docs/DECIDE-DESIGN.md §5.3) on median, after the opening commits: ruling NaN (what the recorded tests
  // expect) re-certifies in replay mode; ruling "throws" needs live mode, says how to switch, and Remove recovers.
  {
    const p = b.page;
    const check = (ok, label, extra = '') => {
      console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : extra);
      if (!ok) failed++;
    };
    const waitText = (re, timeout = 60000) => p.waitForFunction((src) => new RegExp(src).test(document.body.innerText), re.source, { timeout }).then(() => true, () => false);
    await fresh(p, srv.url);
    await p.locator('#repl-input').press('Enter');
    await waitText(/Accepted · saved as r\d+/, 120000);
    const pick = async (labelText) => {
      if (!(await p.locator('details.decide[open]').count())) await p.locator('.silent-decide').click();
      await p.waitForSelector('details.decide[open]', { timeout: 10000 });
      await p.locator('details.decide label.decide-alt', { hasText: labelText }).first().click();
      await p.locator('details.decide .decide-confirm').click();
    };
    try {
      await pick('returns NaN');
      const recert = await p.waitForSelector('details.decide[data-decide="recertified"]', { timeout: 60000 }).then(() => true, () => false);
      check(recert && (await waitText(/re-certified at r\d+, nothing regenerated/, 5000)), 'decide median([]) → NaN re-certifies in replay mode', (await p.evaluate(() => document.body.innerText)).slice(0, 600));
      await pick('throws an error');
      const live = await p.waitForSelector('[data-decide="needs-live"]', { timeout: 60000 }).then(() => true, () => false);
      const text = await p.evaluate(() => document.body.innerText);
      check(live && /differs from what the recorded session was checked against/.test(text) && /How to run live/.test(text) && /npm run dev/.test(text), 'decide median([]) → throws says it needs live mode, with how to switch', text.slice(0, 600));
      await p.locator('[data-decide="needs-live"] button', { hasText: 'Remove the decision' }).click();
      check(await p.waitForSelector('[data-decide="removed"]', { timeout: 60000 }).then(() => true, () => false), 'removing the decision brings median back', '');
    } catch (e) {
      check(false, 'decide flow', e.message.split('\n')[0]);
    }
  }
} finally {
  await b.close();
  srv.stop();
}
process.exit(failed ? 1 : 0);

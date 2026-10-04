// Dev tool (never bundled): capture the UI in its key states for a visual review, and measure what a screenshot can hide.
//
//   node scripts/shots.mjs                       build, then everything (replay sequence + fixture states)
//   node scripts/shots.mjs --skip-build          reuse dist/
//   node scripts/shots.mjs --only=rejected,strip --sizes=desktop --schemes=light
//   node scripts/shots.mjs --no-replay           fixture states only (dev server, ?fixture=<name>)
//
// PNGs go to .tmp/shots/<name>-<size>-<scheme>.png (stable names). Per shot it prints: horizontal overflow, words that
// must not be visible, requests that left the page's origin, and for the opening sequence whether anything is clipped.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './lib/drive.mjs';

const root = new URL('../', import.meta.url).pathname;
const OUT = `${root}.tmp/shots`;
mkdirSync(OUT, { recursive: true });

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3).split(',') : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const only = arg('only', null);
const SIZES = {
  desktop: { width: 1440, height: 900, dsf: 1, mobile: false },
  mobile: { width: 390, height: 844, dsf: 2, mobile: true },
  m360: { width: 360, height: 780, dsf: 2, mobile: true },
  m430: { width: 430, height: 932, dsf: 2, mobile: true },
};
const sizes = arg('sizes', ['desktop', 'mobile']);
const schemes = arg('schemes', ['light', 'dark']);
const want = (name) => !only || only.some((o) => name.includes(o));

/** Fixture states (dev server). name → { fixture, prep?(page), element?: selector for an extra close-up, full?: true } */
const FIXTURES = {
  'table-pinrow': { fixture: 'table-result' },
  pinned: { fixture: 'pinned' },
  revisions: { fixture: 'many-revisions', element: '.lower', scrollTo: '.lower' },
  strip: { fixture: 'committed', element: '.panel-strip' },
  'strip-rejected': { fixture: 'rejected-properties', element: '.panel-strip' },
  'card-silent': { fixture: 'rejected-silent', element: '.panel-gates' },
  'card-timeout': { fixture: 'invariant-timeout', element: '.panel-gates' },
  'card-compile': { fixture: 'compile-rejected' },
  declined: { fixture: 'declined-pure' },
  'declined-spec': { fixture: 'declined-spec' },
  'data-drawer': { fixture: 'data-drawer-open', prep: pasteData },
  share: { fixture: 'share-dialog' },
  'load-recording': { fixture: 'load-recording' },
  'session-log': { fixture: 'session-log' },
  evidence: { fixture: 'committed-evidence' },
  'repo-evidence': { fixture: 'committed-evidence', element: '.lower', scrollTo: '.lower' },
  suggestions: { fixture: 'suggestions' },
  'recheck-failed': { fixture: 'recheck-failed' },
  exhausted: { fixture: 'budget-exhausted' },
  'no-tests': { fixture: 'no-tests' },
  'spec-less': { fixture: 'spec-less-accept' },
  'service-error': { fixture: 'service-error' },
  'fault-restart': { fixture: 'fault-restart' },
  cached: { fixture: 'cached' },
  'recording-loaded': { fixture: 'recording-loaded' },
  'repo-stale': { fixture: 'repo-stale', element: '.lower', scrollTo: '.lower' },
  'image-menu': { fixture: 'committed', prep: (page) => page.locator('.menu summary').click() },
};

async function pasteData(page) {
  await page.fill('#data-text', 'customer,amount,status\nAda,10,paid\nGrace,22.5,refunded\nLinus,7,paid\n');
  await page.waitForTimeout(700);
}

const BANNED = /property-based|\binvariant\b|\bmutants?\b|\bshrunk\b|fast-check|counterexample/gi;

async function measure(page, origin, label, extra = {}) {
  const m = await page.evaluate((x) => {
    const de = document.documentElement;
    const out = { overflowX: de.scrollWidth - de.clientWidth };
    const text = document.body.innerText;
    out.text = text;
    if (x.clip) {
      const stage = document.querySelector('.stage');
      out.stageBottom = stage ? Math.round(stage.getBoundingClientRect().bottom) : null;
      out.pageH = de.scrollHeight;
      for (const sel of ['.gates-body', '.panel-strip .panel-body', '.code-scroll']) {
        const el = document.querySelector(sel);
        if (el) out[`clip ${sel}`] = el.scrollHeight - el.clientHeight;
      }
    }
    if (x.touch) {
      const small = [];
      for (const el of document.querySelectorAll('button, input, summary, a, select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest('dialog:not([open])')) continue;
        // a checkbox inside its <label> is hit through the label; text inputs and textareas are tall enough by content
        if (el.matches('input[type=checkbox]') && el.closest('label')) continue;
        if (r.height < 43.5) small.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      out.smallTargets = [...new Set(small)].slice(0, 12);
      const inp = document.querySelector('#repl-input');
      out.replInputFont = inp ? getComputedStyle(inp).fontSize : null;
    }
    return out;
  }, extra);
  const banned = [...new Set((m.text.match(BANNED) ?? []).map((s) => s.toLowerCase()))];
  const notes = [];
  if (m.overflowX > 0) notes.push(`OVERFLOW-X ${m.overflowX}px`);
  if (banned.length) notes.push(`VISIBLE JARGON: ${banned.join(', ')}`);
  if (extra.clip) notes.push(`stageBottom=${m.stageBottom} pageH=${m.pageH} ${Object.entries(m).filter(([k]) => k.startsWith('clip')).map(([k, v]) => `${k.slice(5)}:${v}`).join(' ')}`);
  if (extra.touch) notes.push(`repl font ${m.replInputFont}; small targets: ${m.smallTargets.join(' | ') || 'none'}`);
  console.log(`  ${label}${notes.length ? '  ' + notes.join('  ·  ') : '  ok'}`);
  return m;
}

async function shot(page, name, size, scheme, { full = false, element = null } = {}) {
  await page.evaluate(() => document.fonts.ready);
  const file = `${OUT}/${name}-${size}-${scheme}.png`;
  await page.screenshot({ path: file, fullPage: full });
  if (element) {
    const el = page.locator(element).first();
    if (await el.count()) await el.screenshot({ path: `${OUT}/${name}-${size}-${scheme}-detail.png` });
  }
  return file;
}

async function newPage(browser, size, scheme, origin, external) {
  const s = SIZES[size];
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.dsf,
    isMobile: s.mobile,
    hasTouch: s.mobile,
    colorScheme: scheme,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.add(u);
  });
  page.on('pageerror', (e) => console.log(`  PAGE ERROR ${e.message}`));
  return { context, page };
}

async function fresh(page, url) {
  await page.goto(url);
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((r) => {
      const q = indexedDB.deleteDatabase('undefined-image');
      q.onsuccess = q.onerror = q.onblocked = () => r();
      setTimeout(r, 1500);
    });
  });
  await page.goto(url);
  await page.waitForSelector('#repl-input', { timeout: 30000 });
}

const attemptStatus = (page, n) => page.evaluate((k) => document.querySelector(`.cand[data-attempt="${k}"]`)?.getAttribute('data-status') ?? null, n);

async function replaySequence(browser, url, size, scheme) {
  const external = new Set();
  const origin = new URL(url).origin;
  const { context, page } = await newPage(browser, size, scheme, origin, external);
  const mobile = SIZES[size].mobile;
  const full = mobile;
  const clip = !mobile;
  try {
    await fresh(page, url);
    await page.waitForTimeout(300);
    if (want('opening')) {
      await shot(page, '01-opening', size, scheme, { full });
      await measure(page, origin, `01-opening ${size} ${scheme}`, { clip, touch: mobile });
    }
    await page.locator('#repl-input').press('Enter');
    await page.waitForSelector('.r-live', { timeout: 20000 });
    await page.waitForTimeout(900);
    if (want('generating')) {
      await shot(page, '02-generating', size, scheme, { full });
      await measure(page, origin, `02-generating ${size} ${scheme}`, { clip });
    }
    await page.waitForSelector('.headline-fail', { timeout: 60000 });
    await page.waitForTimeout(450);
    if (want('rejected')) {
      await shot(page, '03-rejected', size, scheme, { full, element: '.headline-fail' });
      await measure(page, origin, `03-rejected ${size} ${scheme}`, { clip, touch: mobile });
      if (mobile) {
        await page.locator('.headline-fail').scrollIntoViewIfNeeded();
        await shot(page, '03-rejected-scrolled', size, scheme);
      }
    }
    // the second candidate on its way to (or at) the gates
    for (let i = 0; i < 400; i++) {
      const st = await attemptStatus(page, 2);
      if (st === 'gating') break;
      if (st === 'accepted' || st === 'rejected') break;
      await page.waitForTimeout(25);
    }
    if (want('second')) {
      await shot(page, '04-second-gating', size, scheme, { full });
      await measure(page, origin, `04-second-gating ${size} ${scheme} (attempt 2: ${await attemptStatus(page, 2)})`, { clip });
    }
    await page.waitForFunction(() => /Accepted — committed as r\d+/.test(document.body.innerText), null, { timeout: 90000 });
    await page.waitForTimeout(300);
    if (want('committed')) {
      await shot(page, '05-committed', size, scheme, { full });
      await measure(page, origin, `05-committed ${size} ${scheme}`, { clip });
      await page.waitForSelector('[data-mutation="done"]', { timeout: 60000 }).catch(() => console.log('  (mutation check did not finish in 60 s)'));
      await page.waitForTimeout(200);
      await shot(page, '06-committed-evidence', size, scheme, { full, element: '.panel-gates' });
      await measure(page, origin, `06-committed-evidence ${size} ${scheme}`, { clip });
    }
    // the orders example: a table result with the pin row (the replay recording ships for it)
    if (want('orders')) {
      await page.locator('button.example', { hasText: 'topCustomersByRevenue(' }).click();
      await page.waitForTimeout(400);
      await page.locator('#repl-input').press('Enter');
      await page.waitForSelector('.r-table', { timeout: 90000 });
      await page.waitForTimeout(300);
      await shot(page, '07-orders-table', size, scheme, { full, element: '.r-table' });
      await measure(page, origin, `07-orders-table ${size} ${scheme}`, { clip });
    }
  } catch (e) {
    console.log(`  FAILED replay ${size} ${scheme}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/zz-failure-${size}-${scheme}.png` }).catch(() => {});
  } finally {
    if (external.size) console.log(`  EXTERNAL REQUESTS: ${[...external].join(' ')}`);
    await context.close();
  }
}

async function fixtureShots(browser, url, size, scheme) {
  const origin = new URL(url).origin;
  for (const [name, f] of Object.entries(FIXTURES)) {
    if (!want(name)) continue;
    const external = new Set();
    const { context, page } = await newPage(browser, size, scheme, origin, external);
    try {
      await page.goto(`${url}?fixture=${f.fixture}`);
      await page.waitForSelector('#repl-input', { timeout: 30000 });
      await page.waitForTimeout(350);
      if (f.prep) await f.prep(page);
      if (f.scrollTo) await page.locator(f.scrollTo).first().scrollIntoViewIfNeeded();
      const mobile = SIZES[size].mobile;
      await shot(page, `f-${name}`, size, scheme, { full: mobile && !f.scrollTo, element: f.element });
      await measure(page, origin, `f-${name} ${size} ${scheme}`, { touch: mobile });
    } catch (e) {
      console.log(`  FAILED f-${name} ${size} ${scheme}: ${e.message.split('\n')[0]}`);
    } finally {
      if (external.size) console.log(`  EXTERNAL REQUESTS: ${[...external].join(' ')}`);
      await context.close();
    }
  }
}

const servers = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  if (!flag('no-replay')) {
    if (!flag('skip-build')) execSync('npm run build', { cwd: root, stdio: 'ignore' });
    const prev = await startServer({ mode: 'preview', port: 5197 });
    servers.push(prev);
    for (const size of sizes) for (const scheme of schemes) {
      console.log(`replay · ${size} · ${scheme}`);
      await replaySequence(browser, prev.url, size, scheme);
    }
  }
  if (!flag('no-fixtures')) {
    const dev = await startServer({ mode: 'dev', port: 5198 });
    servers.push(dev);
    for (const size of sizes) for (const scheme of schemes) {
      console.log(`fixtures · ${size} · ${scheme}`);
      await fixtureShots(browser, dev.url, size, scheme);
    }
  }
} finally {
  await browser?.close();
  for (const s of servers) s.stop();
}
console.log(`screenshots in ${OUT}`);
process.exit(0);

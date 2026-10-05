// node apps/site/scripts/parity-measure.mjs [--write] — the BROWSER side of the Node/CLI parity check
// (docs/EVIDENCE.md "Node and CLI parity"). `npm run build` first.
//
// Replays every session of every shipped recording through the production build (vite preview: no backend, replay mode,
// the real Worker watchdog) in headless Chrome, the way a visitor does: session 1 by clicking the example and pressing
// Enter; session 2 by the Repo tab's "Break it" button, then Enter. For every attempt it reads what the page shows:
//   - a rejection: the gate rows, the rejecting gate's label and the headline text;
//   - the accepted attempt: the gate rows, then (after the lazy broken-copy check) the "What was checked" sentence
//     (ui/evidence.ts plainEvidence), its tooltip (engine shared/evidence.ts describeEvidence: the evidence line the
//     CLI and eject print) and each surviving mutant's tooltip (survivorLine).
// The recordings themselves carry only the model's bodies (prompt/body/notes/durationMs/progress), not gate results, so
// this is the only source of the site's measured values. --write saves them to
// apps/site/src/examples/parity.browser.json, which both parity suites read (src/examples/parity.node.test.ts and
// packages/cli/test/parity/parity.cli.test.ts). Re-run with --write whenever the recordings change.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, launch } from './lib/drive.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const WRITE = process.argv.includes('--write');
const OUT = fileURLToPath(new URL('../src/examples/parity.browser.json', import.meta.url));
const EX = {
  median: { button: 'median(', fn: 'median' },
  slugify: { button: 'slugify(', fn: 'slugify' },
  fibonacci: { button: 'fibonacci(', fn: 'fibonacci' },
  orders: { button: 'topCustomersByRevenue(', fn: 'topCustomersByRevenue' },
};

const srv = await startServer({ mode: 'preview', port: 5207 });
const b = await launch({ width: 1440, height: 900 });
const p = b.page;
const chrome = b.browser.version();

const GATES = () =>
  [...document.querySelectorAll('.panel-gates .gate-row')].map((li) => ({
    gate: li.querySelector('.gate-name')?.textContent?.trim() ?? '',
    status: (li.className.match(/\bg-(pass|fail|skipped|pending|running|idle|notrun)\b/) ?? [])[1] ?? li.className,
  }));
const REJECTION = () => {
  const a = document.querySelector('.panel-gates .headline-fail');
  return {
    gateLine: a?.querySelector('.headline-gate')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    headline: a?.querySelector('.headline-text')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
  };
};
const ACCEPTED = () => {
  const c = document.querySelector('.panel-gates .confidence');
  return {
    text: c?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    evidenceLine: c?.getAttribute('title') ?? null,
    survivors: [...document.querySelectorAll('.panel-gates details.survivors li')].map((li) => li.getAttribute('title')),
    committed: (document.body.innerText.match(/Accepted · saved as (r\d+)/) ?? [])[1] ?? null,
  };
};
const revisionNow = () => p.evaluate(() => (document.body.innerText.match(/Accepted · saved as (r\d+)/g) ?? []).at(-1) ?? null);

/** Press Enter on what is typed; record every attempt until a NEW "Accepted · saved as rN" and the finished mutation check. */
async function enterAndMeasure(before) {
  await p.locator('#repl-input').press('Enter');
  const attempts = [];
  const t0 = Date.now();
  // attempt by attempt: a fail verdict (then the next attempt replaces it) or the new commit
  for (;;) {
    const st = await p
      .waitForFunction(
        ({ before, n }) => {
          const last = (document.body.innerText.match(/Accepted · saved as r\d+/g) ?? []).at(-1) ?? null;
          if (last && last !== before) return 'accepted';
          const v = document.querySelector('.panel-gates')?.getAttribute('data-verdict');
          const h = document.querySelector('.panel-gates .headline-fail .headline-gate')?.innerText ?? '';
          // the next attempt's rejection, by its number (#1, #2, …), once its headline is rendered
          if (v === 'fail' && new RegExp(`#${n}\\b`).test(h) && document.querySelector('.panel-gates .headline-fail .headline-text')) return 'fail';
          return false;
        },
        { before, n: attempts.length + 1 },
        { timeout: 180000, polling: 50 },
      )
      .then((h) => h.jsonValue());
    if (st === 'fail') {
      attempts.push({ verdict: 'rejected', gates: await p.evaluate(GATES), rejection: await p.evaluate(REJECTION) });
      continue;
    }
    break;
  }
  const gates = await p.evaluate(GATES);
  const committedMs = Date.now() - t0;
  // the lazy broken-copy check starts after the commit and an idle pause: wait for its finished sentence
  await p.waitForFunction(() => document.querySelector('.panel-gates [data-mutation="done"]'), null, { timeout: 180000 });
  await p.waitForTimeout(300);
  attempts.push({ verdict: 'accepted', gates, ...(await p.evaluate(ACCEPTED)) });
  return { attempts, committedMs };
}

const out = {};
try {
  for (const [id, ex] of Object.entries(EX)) {
    await p.goto(srv.url);
    await p.evaluate(async () => {
      localStorage.clear();
      await new Promise((r) => {
        const q = indexedDB.deleteDatabase('undefined-image');
        q.onsuccess = q.onerror = q.onblocked = () => r();
        setTimeout(r, 1500);
      });
    });
    await p.goto(srv.url);
    await p.waitForSelector('#repl-input');
    if (id !== 'median') await p.locator('button.example', { hasText: ex.button }).click();
    const s1 = await enterAndMeasure(await revisionNow());
    console.log(id, 'session 1', JSON.stringify(s1.attempts.map((a) => a.verdict === 'rejected' ? a.rejection.gateLine : a.text)));
    // session 2: the Repo tab's Break it button for this function, then Enter on the call it pre-types
    await p.locator('#tab-repo').click();
    const before = await revisionNow();
    await p.locator(`article.fn-card[aria-labelledby="fn-${ex.fn}"] .breakit button`).click();
    await p.waitForFunction(() => document.querySelector('#repl-input')?.value?.length > 0, null, { timeout: 30000 });
    const s2 = await enterAndMeasure(before);
    console.log(id, 'session 2', JSON.stringify(s2.attempts.map((a) => a.verdict === 'rejected' ? a.rejection.gateLine : a.text)));
    out[id] = [s1.attempts, s2.attempts];
  }
} finally {
  await b.close();
  srv.stop();
}

const doc = {
  measuredAt: new Date().toISOString(),
  how: 'node apps/site/scripts/parity-measure.mjs --write (production build, vite preview, replay mode, headless Chrome, real Worker watchdog)',
  head: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
  dirtyTree: execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0,
  chrome,
  recordings: Object.fromEntries(Object.keys(EX).map((id) => [id, JSON.parse(readFileSync(`public/recordings/${id}.json`, 'utf8')).sessions.map((s) => s.specHash)])),
  examples: out,
};
if (WRITE) {
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
} else console.log(JSON.stringify(doc, null, 2));

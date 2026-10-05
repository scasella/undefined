// node scripts/replay-check.mjs — run `npm run build:check` first (`npm run check:replay` does both). Serves dist-check/
// (the shipped sources built in development mode so the engine hook window.__undefined exists; same CSP, no backend =>
// replay mode, no model calls) with `vite preview`, in headless Chrome, and asserts:
//   1. engine: each bundled recording example (median, slugify, fibonacci, orders) loaded through the engine replays
//      from its recording: the recorded first candidate is rejected by the recorded gate (gates run live) and the
//      retry commits a new revision; orders (spec-less, over the bound `rows`) commits on the first attempt with a table.
//   2. engine: Decide on median after it commits (NaN re-certifies with no model call; "throws" needs live mode; removing
//      the decision brings median back), a multi-statement line, and a CSV of your own (writing on it needs live mode).
//   3. the front door: '/' renders its claim with no console errors (besides replay's /generate/health 404); '#/start'
//      binds orders.csv, "Top 5 customers by revenue" answers Puddlesworth Inc $2,599.13 with 2 basic checks, locking
//      and asking again says it was already checked, and the two unrecorded questions say so honestly.
import { startServer, launch, openApp, SUMMARY, gapRefInPage } from './lib/drive.mjs';

const EXPECT = {
  median: { gate: 'properties', call: 'median([3, 1, 4, 2])' },
  slugify: { gate: 'tests', call: 'slugify("Hello, World! Crème Brûlée")' },
  fibonacci: { gate: 'invariants', call: 'fibonacci(90)' },
  // spec-less over a dataset: no tests, so nothing to reject; it must commit, show a table and be pinnable
  orders: { gate: null, call: 'topCustomersByRevenue(rows)', bound: 'rows' },
};
const srv = await startServer({ mode: 'preview', port: 5194, outDir: 'dist-check' });
const b = await launch({ width: 1440, height: 900 });
const p = b.page;
let failed = 0;
const timings = [];
const check = (ok, label, extra = '') => {
  console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra));
  if (!ok) failed++;
};
const idle = (timeout = 120000) => p.waitForFunction(() => !window.__undefined.state.value.busy, null, { timeout, polling: 100 });
/** Call an engine method; wait until it has started and the engine is idle again; return the summary. */
async function engine(method, ...args) {
  await p.evaluate(([m, a]) => void window.__undefined[m](...a), [method, args]);
  await p.waitForTimeout(150);
  await idle();
  return p.evaluate(SUMMARY);
}
const state = (fn) => p.evaluate(fn);

// console errors: replay mode probes the (absent) generation service once; that 404 is expected, nothing else is
const consoleErrors = [];
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/\/generate\/health/.test(m.location()?.url ?? '') || /\/generate\/health/.test(m.text())) return;
  consoleErrors.push(m.text());
});
p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  // ── 1. every bundled recording replays to commit ──
  for (const [id, want] of Object.entries(EXPECT)) {
    await openApp(p, srv.url);
    if (id === 'median') {
      const first = await state(() => ({ mode: window.__undefined.state.value.mode, input: window.__undefined.state.value.replInput, examples: window.__undefined.state.value.examples.map((e) => e.id) }));
      check(first.mode === 'replay', 'the preview runs in replay mode (no generation service)', first);
      check(['median', 'slugify', 'fibonacci', 'orders'].every((x) => first.examples.includes(x)), 'the four bundled examples are listed', first);
    }
    await engine('loadExample', id);
    const typed = await state(() => ({ input: window.__undefined.state.value.replInput, datasets: window.__undefined.state.value.datasets.map((d) => d.name), head: window.__undefined.state.value.headRevision }));
    check(typed.input === want.call && (!want.bound || typed.datasets.includes(want.bound)), `${id}: loadExample types ${want.call}${want.bound ? ` with ${want.bound} bound` : ''}`, typed);
    const t0 = Date.now();
    const s = await engine('submit');
    const ms = Date.now() - t0;
    const g = s.generation;
    const fn = want.call.slice(0, want.call.indexOf('('));
    const statuses = g?.attempts.map((a) => a.status) ?? [];
    const committed = g?.phase === 'committed' && s.head > typed.head && s.functions[fn]?.artifact && !s.functions[fn].stale;
    if (want.gate) {
      const first = g?.attempts[0];
      const rejectedBy = first?.rejectedBy ?? first?.gates.find((x) => x.status === 'fail')?.gate ?? null;
      check(committed && statuses[0] === 'rejected' && rejectedBy === want.gate && statuses.at(-1) === 'accepted', `${id}: recorded #1 rejected by ${want.gate}, the retry commits r${s.head}`, { phase: g?.phase, statuses, rejectedBy, head: s.head, error: g?.error });
    } else {
      const out = await state(() => window.__undefined.state.value.repl.filter((e) => e.kind === 'output').at(-1) ?? null);
      const shown = !!out?.table && !!out.pinnable && out.value.includes('Puddlesworth Inc');
      check(committed && statuses.length === 1 && statuses[0] === 'accepted' && shown, `${id}: spec-less, commits r${s.head} on the first attempt with a pinnable table`, { phase: g?.phase, statuses, out: JSON.stringify(out).slice(0, 300) });
    }
    timings.push({ id, ms });
  }
  console.log('timings (ms from submit to idle):', JSON.stringify(timings));

  // ── 2a. Decide (docs/DECIDE-DESIGN.md §5.3) on median: NaN (what the recorded tests expect) re-certifies in replay
  // mode; "throws" needs live mode (nothing recorded for that spec); removing the decision brings median back ──
  try {
    await openApp(p, srv.url);
    await engine('submit');
    const ref = await p.evaluate(gapRefInPage, 0);
    const q = await p.evaluate((r) => window.__undefined.gapQuestion(r), ref);
    const alt = (re) => q?.alternatives.find((a) => re.test(a.label) && !a.disabled);
    const nan = alt(/^NaN$/);
    const throws = alt(/throw/i);
    check(!!ref && !!q && q.call === 'median([])' && !!nan && !!throws, 'median: the rejected #1 is a gap question about median([]) offering NaN and throws', { ref: !!ref, call: q?.call, alts: q?.alternatives.map((a) => a.label) });
    const revs = await state(() => window.__undefined.state.value.revisions.length);
    const genBefore = await state(() => window.__undefined.state.value.generation?.id ?? null);
    await p.evaluate(([r, a]) => void window.__undefined.decide(r, { alternative: a }, { reason: 'replay-check' }), [ref, nan.id]);
    await p.waitForTimeout(150);
    await idle();
    const afterNan = await state((n) => {
      const s = window.__undefined.state.value;
      const rec = s.program.functions.median;
      return { live: !!rec.artifact && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash, decisions: rec.spec.decisions?.length ?? 0, kinds: s.revisions.slice(n).map((r) => r.kind), gen: s.generation && { id: s.generation.id, kind: s.generation.kind ?? null, phase: s.generation.phase } };
    }, revs);
    check(afterNan.live && afterNan.decisions === 1 && afterNan.kinds.at(-1) === 'decision' && (afterNan.gen?.id === genBefore || afterNan.gen?.kind === 'recheck'), 'decide median([]) → NaN re-certifies in replay mode, nothing regenerated', afterNan);

    const ref2 = await p.evaluate(gapRefInPage, 0).catch(() => null);
    const q2 = ref2 ? await p.evaluate((r) => window.__undefined.gapQuestion(r), ref2) : null;
    const thr = q2?.alternatives.find((a) => /throw/i.test(a.label) && !a.disabled) ?? null;
    // the gap is still reachable from the committed revision's history (the rejected candidate of the grow)
    const refT = ref2 && thr ? ref2 : ref;
    const thrId = thr?.id ?? throws.id;
    await p.evaluate(([r, a]) => void window.__undefined.decide(r, { alternative: a }, { reason: 'replay-check' }), [refT, thrId]);
    await p.waitForTimeout(150);
    await idle();
    const afterThrows = await state(() => {
      const s = window.__undefined.state.value;
      const rec = s.program.functions.median;
      const g = s.generation;
      return { live: !!rec.artifact && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash, decisions: (rec.spec.decisions ?? []).map((d) => ({ id: d.id, waives: d.waives })), gen: g && { kind: g.kind, phase: g.phase, error: g.error?.message ?? null, code: g.error?.code ?? null }, notice: s.notice?.text ?? null };
    });
    check(!afterThrows.live && afterThrows.decisions.some((d) => d.waives) && (afterThrows.gen?.phase === 'failed' || !!afterThrows.gen?.error || !!afterThrows.notice), 'decide median([]) → throws: median goes out of date and the regrow needs live mode', afterThrows);
    const waiving = afterThrows.decisions.find((d) => d.waives);
    if (waiving) {
      await p.evaluate((id) => void window.__undefined.removeDecision('median', id), waiving.id);
      await p.waitForTimeout(150);
      await idle();
    }
    const afterRemove = await state(() => {
      const rec = window.__undefined.state.value.program.functions.median;
      return { live: !!rec.artifact && rec.artifact.specHash === rec.specHash && rec.artifact.testsHash === rec.testsHash, decisions: rec.spec.decisions?.length ?? 0 };
    });
    check(afterRemove.live && afterRemove.decisions === 0, 'removing the decision brings median back', afterRemove);
  } catch (e) {
    check(false, 'decide flow', e.message.split('\n')[0]);
  }

  // ── 2b. multi-statement lines (docs/COMPOSE-DESIGN.md §B2): median grows in statement 4 of 4; only that statement runs
  // again after the commit (n stays 1); then a destructuring line calls the committed median twice ──
  try {
    await openApp(p, srv.url);
    const head0 = await state(() => window.__undefined.state.value.headRevision);
    await p.evaluate((t) => window.__undefined.setInput(t), 'n = 0; xs = [3, 1, 4, 2]; n = n + 1; m = median(xs)');
    const s1 = await engine('submit');
    const env1 = await state(() => window.__undefined.state.value.env);
    const text1 = await state(() => JSON.stringify(window.__undefined.state.value.repl));
    check(s1.head > head0 && s1.generation?.phase === 'committed' && env1.n === '1' && env1.m === '2.5' && /Re-ran statement 4 of 4/.test(text1), 'multi-statement line: median grows in statement 4 of 4; earlier statements ran once (n = 1, m = 2.5)', { head: s1.head, env: env1, rerun: /Re-ran statement 4 of 4/.test(text1) });
    await p.evaluate((t) => window.__undefined.setInput(t), 'const [lo, hi] = [median([5, 5, 1]), median(xs)]; lo + hi');
    const s2 = await engine('submit');
    const env2 = await state(() => window.__undefined.state.value.env);
    const last = s2.repl.at(-1);
    check(String(last?.value) === '7.5' && env2.lo === '5' && env2.hi === '2.5', 'destructuring line calls the committed median twice: 7.5, lo = 5, hi = 2.5', { last, env: env2 });
  } catch (e) {
    check(false, 'multi-statement flow', e.message.split('\n')[0]);
  }

  // ── 2c. your own data in replay mode: a CSV loads under its file name and a call on it needs live mode, before any
  // attempt ──
  try {
    await openApp(p, srv.url);
    const csv = 'customer,status,amount\nAda,paid,10\nGrace,refunded,22.5\nAda,paid,7\nLinus,pending,3\nGrace,paid,12\n';
    await engine('loadDataset', { text: csv, filename: 'sales.csv', name: 'sales', source: 'file' });
    const ds = await state(() => window.__undefined.state.value.datasets.map((d) => ({ name: d.name, rows: d.rowCount })));
    check(ds.some((d) => d.name === 'sales' && d.rows === 5), 'a CSV file loads, bound as sales (5 rows)', ds);
    await p.evaluate((t) => window.__undefined.setInput(t), 'countByStatus(sales)');
    const s = await engine('submit');
    const g = await state(() => {
      const x = window.__undefined.state.value.generation;
      return x && { fn: x.fn, phase: x.phase, attempts: x.attempts.length, needsLive: x.needsLive ?? null, error: x.error?.message ?? null };
    });
    if (!g) console.log('  (no generation)', JSON.stringify(s).slice(0, 800));
    check(!!g?.needsLive && g.attempts === 0 && /none exists for countByStatus on your data\. Writing it needs live mode\./.test(g.error ?? JSON.stringify(s)), 'a call on your data in replay mode: the dataset-specific needs-live message, no attempt', g);
  } catch (e) {
    check(false, 'your-own-data flow', e.message.split('\n')[0]);
  }

  // ── 3. the front door ──
  consoleErrors.length = 0;
  await openApp(p, srv.url);
  await p.waitForTimeout(1500); // let the landing's first paint and lazy work settle before reading the console
  const h1 = await p.evaluate(() => [...document.querySelectorAll('h1')].map((h) => h.innerText.replace(/\s+/g, ' ').trim()));
  check(h1.some((t) => t.includes('The AI writes it.')), "'/' renders the claim h1 'The AI writes it.'", h1);
  check(consoleErrors.length === 0, "'/' logs no console errors (besides the replay /generate/health 404)", consoleErrors);

  await openApp(p, srv.url + '#/start');
  const body = () => p.evaluate(() => document.body.innerText);
  const waitText = (re, timeout = 30000) => p.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), re.source, { timeout }).then(() => true, () => false);
  const chip = (label) => p.getByRole('group', { name: 'Suggested questions' }).getByRole('button', { name: new RegExp(label) });
  const askBtn = p.locator('#fd-ask-btn');
  /** The chip, then Ask once the session can ask; then wait for the engine to finish. */
  async function ask(label) {
    if (label) {
      await chip(label).click();
      await p.waitForFunction((l) => [...document.querySelectorAll('[aria-label="Suggested questions"] button')].some((b) => b.textContent.includes(l) && b.getAttribute('aria-pressed') === 'true'), label, { timeout: 15000 });
    }
    await p.waitForFunction(() => { const b = document.getElementById('fd-ask-btn'); return !!b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 30000 });
    await askBtn.click();
    await p.waitForTimeout(300);
    await idle();
  }
  const bound = await p.waitForFunction(() => window.__undefined.state.value.datasets.some((d) => d.name === 'rows') && document.body.innerText.includes('orders.csv'), null, { timeout: 30000 }).then(() => true, () => false);
  check(bound, "'#/start' binds the sample orders.csv (as rows)", (await body()).slice(0, 400));

  await ask('Top 5 customers by revenue');
  const answered = await waitText(/Puddlesworth Inc[\s\S]*\$2,599\.13/, 60000);
  const text = await body();
  check(answered && /Passed 2 basic checks/i.test(text) && !consoleErrors.length, "'Top 5 customers by revenue' → Ask: Puddlesworth Inc $2,599.13, 'Passed 2 basic checks'", { answered, basic: /Passed 2 basic checks/i.test(text), errors: consoleErrors, text: text.slice(0, 600) });

  const lockBtn = p.getByRole('button', { name: /Lock this answer/ });
  await lockBtn.first().click();
  await p.waitForTimeout(300);
  await idle();
  const locked = await waitText(/Locked/, 15000);
  const pins = await state(() => window.__undefined.state.value.program.functions.topCustomersByRevenue?.spec.pins?.length ?? 0);
  check(locked && pins === 1, 'Lock this answer locks it (one locked answer in the spec)', { locked, pins });
  await ask(null);
  const cached = await waitText(/Already checked in this session\./, 30000);
  check(cached, 'Ask again after locking shows the cached line', (await body()).slice(0, 600));

  for (const label of ['Count orders by status', 'Revenue by country']) {
    await ask(label);
    const none = await waitText(/No recorded answer for this one\./, 30000);
    const t = await body();
    check(none && /In this demo, answers are recorded/.test(t) && /Nothing was checked\./.test(t), `'${label}' → Ask: the honest no-recording state`, t.slice(0, 600));
  }
  check(consoleErrors.length === 0, "'#/start' logs no console errors (besides the replay /generate/health 404)", consoleErrors);
} catch (e) {
  check(false, 'replay-check aborted', e.stack ?? String(e));
} finally {
  await b.close();
  srv.stop();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);

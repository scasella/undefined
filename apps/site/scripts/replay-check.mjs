// node scripts/replay-check.mjs — run `npm run build:check` first (`npm run check:replay` does both). Serves dist-check/
// (the shipped sources built in development mode so the engine hook window.__undefined exists; same CSP, no backend =>
// replay mode, no model calls) with `vite preview`, in headless Chrome, and asserts:
//   1. engine: each bundled recording example (median, slugify, fibonacci, orders) loaded through the engine replays
//      from its recording: the recorded first candidate is rejected by the recorded gate (gates run live) and the
//      retry commits a new revision; orders (spec-less, over the bound `rows`) commits on the first attempt with a table.
//   2. engine: Decide on median after it commits (NaN re-certifies with no model call; "throws" needs live mode; removing
//      the decision brings median back), a multi-statement line, and a CSV of your own (writing on it needs live mode).
//   3. the front door: '/' renders its claim with no console errors (besides replay's /generate/health 404); '#/start'
//      binds orders.csv and, because public/recordings/orders-agreement.json exists (docs/FRONT-DOOR.md "Adaptive
//      seeding"), installs the seeded agreement (6 examples, 1 locked answer, 2 house rules): "Top 5 customers by
//      revenue" replays with FULL checks and answers Chef Ravioli Starbright $2,252.07, already locked, the engine's
//      spec/gates/answer agree with what the page shows, asking again says it was already checked, the lock toggles,
//      and the two unrecorded questions say so honestly. While the AI's draft is replayed the trace shows the
//      indeterminate writing mark in its FOOTER, by the "drafting · checks start next" label (the header, its title and the
//      seconds counter, is untouched), and the mark is gone when the checks start.
//   3b. step by step (#/zen): the pane is in the URL (#/zen/N, a bare #/zen gets its number, deep links are clamped to what
//      the session allows), nothing moves by itself (the finished trace stays on the "Checking" pane, focus goes to
//      "See the answer", also after a stray Tab to the skip link), the browser's Back and Forward step one pane at a time,
//      Back during a run keeps pane 4, and the page's own Back still shows the pane before after that Back and a Forward.
//   3c-3d. fresh again: deep links are clamped to what the session allows, the writing mark under reduced motion and at six widths
//      (inside the trace, in the footer, no row added to the footer, no sideways scroll, the header the same with or without it),
//      Back during a run, a Back pressed before the run has started, a run carried over from the Full view (focus on "See the answer"),
//      and the landing's logo scrolling to the top from an anchored address.
//   3e. history.scrollRestoration, hop by hop through five sequences (landing -> Step by step -> back; -> Full view -> Back, Back,
//      Forward, Forward; landing -> zen -> start -> zen -> landing three times; a reload on #/zen/2; a cold load of #/zen/1 in a fresh
//      tab): 'manual' exactly while Step by step is on screen, 'auto' on the landing and on the Full view, never carried over (an entry
//      made from a walk-through pane inherits 'manual'), and every Back and Forward onto Step by step lands at scrollY 0.
//      Also the router's cross-route behaviour: landing -> Step by step focuses #main, a pane change does not, and an anchor on a pane
//      ('#/zen/3#main') neither scrolls nor focuses.
//   4. the same page with orders-agreement.json unavailable (the request for the recordings index is answered without it:
//      what a re-spec'd agreement whose recording no longer matches looks like; the page's own seed switch is not
//      reachable from the built bundle). The seeded agreement is then not installed and the question falls back to the
//      spec-less orders.json recording: BASIC checks, Puddlesworth Inc $2,599.13, locking offered, then locked, and
//      asking again says it was already checked.
import { startServer, launch, openApp, SUMMARY, gapRefInPage } from './lib/drive.mjs';

const EXPECT = {
  median: { gate: 'properties', call: 'median([3, 1, 4, 2])' },
  slugify: { gate: 'tests', call: 'slugify("Hello, World! Crème Brûlée")' },
  fibonacci: { gate: 'invariants', call: 'fibonacci(90)' },
  // spec-less over a dataset: no tests, so nothing to reject; it must commit, show a table and be pinnable
  orders: { gate: null, call: 'topCustomersByRevenue(rows)', bound: 'rows' },
};
const srv = await startServer({ mode: 'preview', port: Number(process.env.REPLAY_CHECK_PORT) || 5194, outDir: process.env.REPLAY_CHECK_OUT || 'dist-check' });
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

  const body = () => p.evaluate(() => document.body.innerText);
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  /** innerText of every element matching `sel`, whitespace collapsed. */
  const texts = (sel) => p.evaluate((x) => [...document.querySelectorAll(x)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), sel);
  const waitText = (re, timeout = 30000) => p.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), re.source, { timeout }).then(() => true, () => false);
  const waitFor = (fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
  const chip = (label) => p.getByRole('group', { name: 'Suggested questions' }).getByRole('button', { name: new RegExp(label) });
  const askBtn = p.locator('#fd-ask-btn');
  const lockBtn = p.locator('.fd-ac__lock');
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
  /** The drafting mark by the footer's label, as the page shows it right now (null when there is none). */
  const markNow = () =>
    p.evaluate(() => {
      const m = document.querySelector('.fd-trace__pen');
      if (!m) return null;
      const kids = [...m.children].map((k) => getComputedStyle(k));
      return {
        ticks: kids.length,
        ariaHidden: m.getAttribute('aria-hidden'),
        inLive: !!m.closest('[aria-live]'),
        inFoot: !!m.closest('.fd-trace__foot-meta') && !!m.closest('.fd-trace__foot'),
        inHead: !!m.closest('.fd-trace__head'),
        counterKids: document.querySelector('.fd-trace__timer-a')?.children.length ?? -1,
        animation: [...new Set(kids.map((c) => c.animationName))].join(),
        duration: [...new Set(kids.map((c) => c.animationDuration))].join(),
        easing: [...new Set(kids.map((c) => c.animationTimingFunction))].join(),
        opacities: kids.map((c) => Number(Number(c.opacity).toFixed(2))),
        transforms: kids.map((c) => c.transform),
        counter: document.querySelector('.fd-trace__timer')?.innerText.replace(/\s+/g, ' ').trim(),
        footer: document.querySelector('.fd-trace__foot-text')?.innerText.replace(/\s+/g, ' ').trim(),
        words: [...document.querySelectorAll('.fd-trace [aria-live]')].map((e) => e.innerText).join(' '),
      };
    });
  const REPLAY_COUNTER = /^replaying the recorded draft · \d+ s$/;
  /** Run `start()` (an ask that waits for the run to settle) and sample the drafting mark while it is going: seen, its look, and gone once the checks start. */
  async function observeDrafting(start) {
    const done = start();
    const seen = await waitFor(() => document.querySelectorAll('.fd-trace__pen > span').length === 3, null, 20000);
    const during = await markNow();
    const gone = await waitFor(() => !document.querySelector('.fd-trace__pen') && /checking…/.test(document.querySelector('.fd-trace__timer')?.innerText ?? ''), null, 40000);
    await done;
    return { seen, during, gone };
  }
  /** The answer card's lock button, once it shows exactly `label`. */
  const waitLock = (label) => waitFor((l) => document.querySelector('.fd-ac__lock')?.innerText.trim() === l, label, 15000);
  /** What the engine holds for topCustomersByRevenue, in the terms the page uses (examples / house rules / locked answers). */
  const fnState = () =>
    p.evaluate(() => {
      const s = window.__undefined.state.value;
      const f = s.program.functions.topCustomersByRevenue;
      const g = s.generation;
      const last = g?.attempts.at(-1);
      const out = s.repl.filter((e) => e.kind === 'output').at(-1) ?? null;
      return {
        head: s.headRevision,
        has: !!f,
        examples: (f?.spec.tests.match(/^test\(/gm) ?? []).length,
        houseRules: (f?.spec.properties.match(/^property\(/gm) ?? []).length,
        pins: (f?.spec.pins ?? []).map((x) => ({ id: x.id, label: x.label })),
        live: !!f?.artifact && f.artifact.specHash === f.specHash && f.artifact.testsHash === f.testsHash,
        gen: g && { id: g.id, phase: g.phase, statuses: g.attempts.map((a) => a.status), gates: (last?.candidate?.gates ?? last?.gates ?? []).map((x) => ({ gate: x.gate, status: x.status, summary: x.summary })) },
        rows: out?.table?.rows.map((r) => [JSON.parse(r[0]), Number(r[1])]) ?? null,
        mutation: s.mutation && { fn: s.mutation.fn, phase: s.mutation.phase, total: s.mutation.total },
      };
    });
  const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** Is every `rows` customer, in order, followed by its amount in the answer card's text? */
  const cardShows = (card, rows) => {
    let at = 0;
    for (const [name, amount] of rows) {
      const i = card.indexOf(name, at);
      if (i < 0) return false;
      const j = card.indexOf(money(amount), i + name.length);
      if (j < 0) return false;
      at = j + 1;
    }
    return rows.length > 0;
  };
  /** The two questions with nothing recorded say so, honestly, in the current mode of the page. */
  async function unrecorded(tag) {
    for (const label of ['Count orders by status', 'Revenue by country']) {
      await ask(label);
      const none = await waitText(/No recorded answer for this one\./, 30000);
      const t = await body();
      check(none && /In this demo, answers are recorded/.test(t) && /Nothing was checked\./.test(t), `${tag}: '${label}' → Ask: the honest no-recording state`, t.slice(0, 600));
    }
  }
  const bindOrders = async () =>
    waitFor(() => window.__undefined.state.value.datasets.some((d) => d.name === 'rows') && document.body.innerText.includes('orders.csv'), null, 30000);
  const LEAD = ['Chef Ravioli Starbright', 2252.07];

  // ── 3. seeded: the recording of the agreement is bundled, so the page installs it and the answer is Full checks ──
  await openApp(p, srv.url + '#/start');
  check(await bindOrders(), "'#/start' binds the sample orders.csv (as rows)", (await body()).slice(0, 400));

  await chip('Top 5 customers by revenue').click();
  await p.waitForFunction(() => [...document.querySelectorAll('[aria-label="Suggested questions"] button')].some((b) => b.textContent.includes('Top 5 customers by revenue') && b.getAttribute('aria-pressed') === 'true'), null, { timeout: 15000 });
  await p.waitForFunction(() => { const b = document.getElementById('fd-ask-btn'); return !!b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 30000 });
  const chips = await texts('[aria-label="Suggested questions"] button');
  const pre = await fnState();
  const preText = norm(await body());
  check(
    chips.some((c) => /^Top 5 customers by revenue Full checks$/.test(c)) &&
      preText.includes('Full checks: this demo file comes with 6 examples, 1 locked answer and 2 house rules for this question.') &&
      preText.includes('6 examples · 1 locked answer · 2 house rules') &&
      pre.has && pre.examples === 6 && pre.houseRules === 2 && pre.pins.length === 1 && pre.pins[0].id === 'seeded-locked-top5',
    "seeded: the question is tagged 'Full checks' and the agreement (6 examples · 1 locked answer · 2 house rules) is installed in the engine before asking",
    { chips, pre: { examples: pre.examples, houseRules: pre.houseRules, pins: pre.pins }, text: preText.slice(0, 500) },
  );

  // the question with a recorded answer comes first, the two that need your computer after it, and one line says what 'needs live' means
  const legend = await texts('.fd-ask__legend');
  check(
    chips.length === 3 && /^Top 5 customers by revenue /.test(chips[0]) && !/needs live/.test(chips[0]) && chips.slice(1).every((c) => /^(Count orders by status|Revenue by country) needs live$/.test(c)) && legend.length === 1 && legend[0].startsWith('needs live: this demo has recorded answers for one question; the others need the version on your computer.'),
    "seeded: the question that has a recorded answer comes first, the two that need your computer after it are tagged 'needs live' alone (no 'Basic checks' claim), and one line says what 'needs live' means",
    { chips, legend },
  );

  const drafted = await observeDrafting(() => ask(null));
  const dm = drafted.during;
  check(
    drafted.seen && drafted.gone && dm?.ticks === 3 && dm.ariaHidden === 'true' && !dm.inLive && dm.inFoot && !dm.inHead && dm.counterKids === 0 && dm.animation === 'tpen' && dm.duration === '1.8s' && /ease-in-out/.test(dm.easing) &&
      REPLAY_COUNTER.test(dm.counter) && dm.footer.includes("The seconds count this replay, not the AI's own writing time.") && /^Replaying the recorded draft 1\. Checking starts when it is done\.$/.test(dm.words),
    "full view: while the AI's draft is replayed the trace shows an indeterminate mark (three ticks, 1.8 s, ease-in-out, aria-hidden) in its footer by the drafting label, the seconds counter in the header is its words alone, the replay wording is unchanged, and the mark is gone when the checks start",
    drafted,
  );
  const shown = await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), LEAD[0], 60000);
  const lead = (await texts('.fd-ac__lead-name, .fd-ac__lead-num')).join(' | ');
  const eyebrow = await texts('.fd-ac__eyebrow');
  const trace = norm(await body());
  check(shown && lead === `${LEAD[0]} | ${money(LEAD[1])}` && !consoleErrors.length, "'Top 5 customers by revenue' → Ask: Chef Ravioli Starbright $2,252.07 first", { shown, lead, errors: consoleErrors });
  // the seal arrives with the answer, after the stress test: its count is the engine's own mutation report (killed + killedByBound of total)
  const report = await state(() => {
    const m = window.__undefined.state.value.program.functions.topCustomersByRevenue?.artifact?.evidence?.mutation;
    return m ? { total: m.total, caught: m.killed + m.killedByBound, missed: m.survived } : null;
  });
  const sealWords = report ? `Passed every check · stress test caught ${report.caught} of ${report.total}` : null;
  const verdict = await texts('.fd-trace__hl-b');
  check(
    !!report && report.total > 0 && eyebrow.length === 1 && eyebrow[0] === sealWords.toUpperCase() && verdict.length === 1 && verdict[0].startsWith(sealWords + ' ') && !/BASIC CHECKS/i.test(await texts('.fd-ac').then((t) => t.join(' '))),
    "seeded: the answer says 'PASSED EVERY CHECK · STRESS TEST CAUGHT N OF M' (Full checks, with N and M the engine's own stress-test report), the trace's verdict says the same, not the basic seal",
    { eyebrow, verdict, report },
  );
  check(
    trace.includes('Matches your 6 examples') && trace.includes('Matches your locked answer · Chef Ravioli Starbright = $2,252.07') && trace.includes('Follows your 2 house rules on 100 made-up tables') && trace.includes('Checked against: 6 examples · 1 locked answer · 2 house rules on 100 made-up tables'),
    'seeded: the check trace lists the 6 examples, the locked answer and the 2 house rules that ran',
    trace.slice(trace.indexOf('CHECK TRACE'), trace.indexOf('CHECK TRACE') + 900),
  );

  const post = await fnState();
  const gate = (name) => post.gen?.gates.find((x) => x.gate === name);
  check(
    post.gen?.phase === 'committed' && post.gen.statuses.length === 1 && post.gen.statuses[0] === 'accepted' && post.head > pre.head && post.live &&
      post.gen.gates.every((x) => x.status === 'pass') && /^6 unit tests \+ 1 pinned passed/.test(gate('tests')?.summary ?? '') && /^2\/2 properties held/.test(gate('properties')?.summary ?? ''),
    'seeded: the engine agrees — the first recorded draft was accepted by the live tests (6 + the locked answer) and properties (2/2), r' + post.head,
    post,
  );
  check(
    post.examples === 6 && post.houseRules === 2 && post.pins.length === 1 && post.pins[0].id === 'seeded-locked-top5' && post.rows?.length === 5 && post.rows[0][0] === LEAD[0] && post.rows[0][1] === LEAD[1],
    "seeded: the engine's answer is the page's: the spec holds 6 examples, 2 house rules, 1 locked answer; the output table starts Chef Ravioli Starbright 2252.07",
    post,
  );
  const card = norm((await texts('.fd-ac')).join(' '));
  check(cardShows(card, post.rows ?? []), "seeded: the answer card lists the engine's five customers and amounts in order", { rows: post.rows, card: card.slice(0, 500) });

  // the answer is already locked (the agreement's locked answer): the button says so, and no 'Lock this answer' is offered
  const lockText = await texts('.fd-ac__lock');
  const lockHelp = await texts('.fd-ac__help');
  check(lockText.length === 1 && lockText[0] === 'Locked' && !/Lock this answer/.test(card) && lockHelp[0] === "Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same list." && post.pins.length === 1, "seeded: the answer is already locked ('Locked', no 'Lock this answer' offered, one locked answer in the spec)", { lockText, lockHelp, pins: post.pins });

  // the sixth check, the stress test, finishes on its own; the lane reports what the engine counted
  const stressed = await waitFor(() => { const m = window.__undefined.state.value.mutation; return !!m && m.fn === 'topCustomersByRevenue' && m.phase === 'done' && m.total > 0; }, null, 60000);
  const mut = (await fnState()).mutation;
  check(stressed && (await waitText(new RegExp(`we broke it ${mut?.total} small ways on purpose`), 15000)), 'seeded: the stress test finishes and the sixth check reports what the engine counted', mut);

  // asking again answers from the certified function: nothing re-runs, no new draft
  await ask(null);
  const cachedSeeded = await waitFor(() => /Already checked in this session\./.test(document.querySelector('.fd-rs__cached')?.innerText ?? ''), null, 30000);
  const again = await fnState();
  check(cachedSeeded && again.gen?.id === post.gen?.id && again.head === post.head, 'seeded: asking again shows the cached line ("Already checked in this session."), no new draft or revision', { cachedSeeded, before: post.gen?.id, after: again.gen?.id, heads: [post.head, again.head] });

  // the lock toggles: unlock the seeded one (the engine drops it), lock the answer again (a new locked answer, same list)
  await lockBtn.first().click();
  const unlocked = await waitLock('Does this look right? Lock this answer');
  await idle();
  const off = await fnState();
  check(unlocked && off.pins.length === 0 && off.examples === 6 && off.houseRules === 2, "seeded: 'Locked' unlocks it (no locked answer left in the spec), the examples and house rules stay", { unlocked, pins: off.pins });
  await lockBtn.first().click();
  const relocked = await waitLock('Locked');
  await idle();
  const on = await fnState();
  check(relocked && on.pins.length === 1 && on.pins[0].label === 'topCustomersByRevenue(rows)' && on.pins[0].id !== 'seeded-locked-top5', "seeded: 'Lock this answer' locks it again (one locked answer in the spec)", { relocked, pins: on.pins });
  await ask(null);
  const cachedAfterLock = await waitText(/Already checked in this session\./, 30000);
  check(cachedAfterLock, 'seeded: ask again after locking shows the cached line', (await body()).slice(0, 600));

  await unrecorded('seeded');
  check(consoleErrors.length === 0, "seeded: '#/start' logs no console errors (besides the replay /generate/health 404)", consoleErrors);

  // ── 3b. step by step (#/zen), the first-run path: the same session, checks and answer, one pane at a time ──
  consoleErrors.length = 0;
  try {
    await openApp(p, srv.url + '#/zen');
    const h1Is = (t, timeout = 60000) => waitFor((x) => document.querySelector('h1')?.innerText === x, t, timeout);
    const cont = p.locator('#zen-continue');
    const zenChips = () => texts('.zp__chip');
    await waitFor(() => !!document.getElementById('zen-continue'), null, 15000);
    const off = await p.evaluate(() => {
      const c = document.getElementById('zen-continue');
      return { disabled: c.getAttribute('aria-disabled'), by: c.getAttribute('aria-describedby'), why: document.getElementById('zen-why')?.innerText };
    });
    check(off.disabled === 'true' && off.by === 'zen-why' && off.why === 'Choose a sample or bring a file to continue.', "step by step 1: with no data Continue is off and says why ('Choose a sample or bring a file to continue.'), tied to the button", off);
    const hashNow = () => p.evaluate(() => location.hash);
    check((await hashNow()) === '#/zen/1', "step by step: a bare '#/zen' opens the first pane and is rewritten to '#/zen/1'", await hashNow());
    await p.getByRole('button', { name: 'orders.csv', exact: true }).focus();
    await p.keyboard.press('Enter');
    check(await bindOrders(), 'step by step 1: a sample binds orders.csv (as rows)', (await body()).slice(0, 300));
    check(await waitFor(() => document.activeElement?.id === 'zen-continue', null, 10000), 'step by step 1: choosing a sample leaves focus on Continue, not <body>', await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
    await cont.click();
    check(await h1Is('Ask a question') && (await hashNow()) === '#/zen/2', "step by step: Continue opens pane 2 (Ask a question) at '#/zen/2'", { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() });
    await waitFor(() => document.querySelectorAll('.zp__chip .zp__live').length === 2, null, 30000);
    const geo = await p.evaluate(() => {
      const r = document.getElementById('zen-continue').getBoundingClientRect();
      const d = document.querySelector('.zp__data')?.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), vh: innerHeight, dataTop: d ? Math.round(d.top) : null };
    });
    check(geo.bottom <= geo.vh && geo.dataTop !== null && geo.dataTop > geo.bottom, "step by step 2: Continue is on screen without scrolling (1440x900) and 'Your data' comes after it", geo);
    const c0 = await zenChips();
    check(c0.length === 3 && /^Top 5 customers by revenue /.test(c0[0]) && c0.slice(1).every((c) => /^(Count orders by status|Revenue by country) needs live$/.test(c)), "step by step 2: the question with a recorded answer comes first, the ones that need live after it are tagged 'needs live' alone (no 'Basic checks' claim)", c0);
    // typing a suggestion's own words selects it: no second chip
    await p.locator('#zen-question').fill('top 5 customers by revenue?');
    await p.getByRole('button', { name: 'Use this question' }).click();
    await p.waitForTimeout(400);
    const dup = await p.evaluate(() => ({ chips: document.querySelectorAll('.zp__chip').length, on: [...document.querySelectorAll('.zp__chip.is-on')].map((b) => b.innerText.replace(/\s+/g, ' ')), box: document.getElementById('zen-question').value }));
    check(dup.chips === 3 && dup.on.length === 1 && dup.on[0].startsWith('Top 5 customers by revenue') && dup.box === '', "step by step 2: typing 'top 5 customers by revenue?' selects that chip and adds no second one", dup);
    // a typed question the demo cannot answer: 'needs live' and no level claim; Continue stays off with the reason and a try-it button
    await p.locator('#zen-question').fill('What is the weather in Paris?');
    await p.getByRole('button', { name: 'Use this question' }).click();
    await waitFor(() => document.querySelectorAll('.zp__chip').length === 4, null, 10000);
    const wx = await p.evaluate(() => {
      const chip = [...document.querySelectorAll('.zp__chip')].find((b) => /weather/.test(b.innerText));
      const c = document.getElementById('zen-continue');
      return { chip: chip?.innerText.replace(/\s+/g, ' '), disabled: c.getAttribute('aria-disabled'), why: document.getElementById('zen-why')?.innerText.replace(/\s+/g, ' '), tryIt: !!document.querySelector('#zen-why button'), link: document.querySelector('#zen-why a')?.href };
    });
    check(wx.chip === 'What is the weather in Paris? needs live' && !/checks/i.test(wx.chip) && wx.disabled === 'true' && /^In this demo, answers are recorded/.test(wx.why) && wx.tryIt && /#run-it-on-your-computer$/.test(wx.link ?? ''), "step by step 2: a typed question the demo cannot answer reads 'needs live' alone (no level), Continue is off, and the reason has a try-it button and the way to run it on your computer", wx);
    await p.locator('#zen-why button').click();
    const tried = await waitFor(() => document.activeElement?.id === 'zen-continue' && document.getElementById('zen-continue').getAttribute('aria-disabled') !== 'true', null, 10000);
    check(tried, "step by step 2: 'try it' selects the question that has a recorded answer and makes Continue available (focus on it)", await p.evaluate(() => ({ active: document.activeElement?.id, picked: document.querySelector('.zp__picked')?.innerText })));
    await cont.click();
    check(await h1Is('What your answer must pass') && (await hashNow()) === '#/zen/3', "step by step: Continue opens pane 3 at '#/zen/3'", { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() });
    const marks = await p.evaluate(() => ({ rows: document.querySelectorAll('.zp__check').length, dashed: document.querySelectorAll('.zp__ico circle[stroke-dasharray]').length, green: [...document.querySelectorAll('.zp__checks *')].filter((e) => /17A36B|33C793/i.test(`${e.getAttribute('fill')} ${e.getAttribute('stroke')}`) || /rgb\(23, 163, 107\)|rgb\(51, 199, 147\)/.test(`${getComputedStyle(e).color} ${getComputedStyle(e).backgroundColor}`)).length, sum: document.querySelector('.zp__sum')?.innerText }));
    check(marks.rows === 6 && marks.dashed === 6 && marks.green === 0 && /^Full checks: all six apply\. The answer appears after all six have run/.test(marks.sum), 'step by step 3: six dashed will-run markers and nothing green before anything has run; the summary follows the seal rule', marks);
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    // the page owns focus and scroll: a hash change that stays on this route (a ?query on the same pane) moves neither
    await waitFor(() => document.activeElement?.id === 'zen-title', null, 5000); // the new pane has spoken its heading; now take focus away from it
    await p.evaluate(() => document.getElementById('zen-continue').focus());
    const y0 = await p.evaluate(() => scrollY);
    await p.evaluate(() => (location.hash = '#/zen/3?x=1'));
    await p.waitForTimeout(400);
    const same = await p.evaluate(() => ({ active: document.activeElement?.id, y: scrollY, hash: location.hash, h1: document.querySelector('h1')?.innerText }));
    check(same.active === 'zen-continue' && same.y === y0 && same.hash === '#/zen/3' && same.h1 === 'What your answer must pass', "step by step: a same-route hash change ('#/zen/3?x=1') moves neither focus nor scroll (the router leaves them to the page), and the address is put back to '#/zen/3'", same);
    // an in-page anchor after the pane ('#/zen/3#x') is still a request for pane 3, not a request for nothing (which would send the viewer to the opening pane, 2)
    await p.evaluate(() => (location.hash = '#/zen/3#x'));
    await p.waitForTimeout(400);
    const anch = await p.evaluate(() => ({ h1: document.querySelector('h1')?.innerText, hash: location.hash }));
    check(anch.h1 === 'What your answer must pass' && anch.hash === '#/zen/3', "step by step: '#/zen/3#x' (an in-page anchor after the pane) stays on pane 3 and the address is put back to '#/zen/3'", anch);
    // a bare in-page hash typed by hand ('#main') names no route: the router puts back the pane the viewer was on, not the bare route (which would open pane 2)
    await p.evaluate(() => (location.hash = '#main'));
    await p.waitForTimeout(400);
    const bare = await p.evaluate(() => ({ h1: document.querySelector('h1')?.innerText, hash: location.hash }));
    check(bare.h1 === 'What your answer must pass' && bare.hash === '#/zen/3', "step by step: a bare '#main' typed into the address puts back '#/zen/3' (the pane it was on), not '#/zen'", bare);
    // the URL only asks: with data but no answer, pane 5 and pane 4 are not allowed, and the address says where the viewer really is
    const lenAsk = await p.evaluate(() => history.length);
    await p.evaluate(() => (location.hash = '#/zen/5'));
    const clamp5 = await h1Is('Ask a question', 5000);
    const at5 = await hashNow();
    await p.evaluate(() => (location.hash = '#/zen/4'));
    await p.waitForTimeout(400);
    const at4 = { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow(), len: await p.evaluate(() => history.length) };
    check(clamp5 && at5 === '#/zen/2' && at4.h1 === 'Ask a question' && at4.hash === '#/zen/2', "step by step: asking for '#/zen/5' or '#/zen/4' with no answer opens the question pane and the address is rewritten to '#/zen/2'", { clamp5, at5, at4 });
    // the clamp rewrites the entry the viewer just made (replaceState): the two hashes typed above made two entries, the clamps made none (a push would make four and cut off Forward)
    check(at4.len === lenAsk + 2, "step by step: the clamp of an address that asks for too much rewrites that entry (replaceState) and pushes no entry of its own", { before: lenAsk, after: at4.len });
    await p.evaluate(() => (location.hash = '#/zen/3'));
    check(await h1Is('What your answer must pass', 5000) && (await hashNow()) === '#/zen/3', "step by step: '#/zen/3' with data bound opens pane 3", await hashNow());
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    let strayTab = null;
    const ran = await observeDrafting(async () => {
      await cont.click();
      check(await h1Is('Checking') && (await hashNow()) === '#/zen/4', "step by step: 'Run the checks' opens pane 4 at '#/zen/4'", { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() });
      // one stray Tab during the draft: nothing on the pane takes focus while it runs, so it leaves the page's main area (the skip link)
      await p.waitForTimeout(1500);
      await p.keyboard.press('Tab');
      await p.waitForTimeout(150);
      strayTab = await p.evaluate(() => ({ el: `${document.activeElement?.tagName}#${document.activeElement?.id}`, text: document.activeElement?.innerText?.trim().slice(0, 30), inMain: !!document.getElementById('main')?.contains(document.activeElement) }));
      await p.waitForSelector('#zen-see-answer', { timeout: 90000 });
    });
    check(!!strayTab && !strayTab.inMain, "step by step 4: a stray Tab during the draft puts focus outside the page's main area (so the focus check below means it)", strayTab);
    const rm = ran.during;
    check(
      ran.seen && ran.gone && rm?.ticks === 3 && rm.ariaHidden === 'true' && !rm.inLive && rm.inFoot && !rm.inHead && rm.counterKids === 0 && rm.animation === 'tpen' && REPLAY_COUNTER.test(rm.counter) && rm.footer.includes("The seconds count this replay, not the AI's own writing time.") && /^Replaying the recorded draft 1\. /.test(rm.words),
      "step by step 4: the same indeterminate mark sits in the footer by the drafting label while the draft is replayed (nothing added to the header's seconds counter), with the replay wording unchanged, and is gone when the checks start",
      ran,
    );
    // nothing moves by itself: the finished trace stays, focus is on "See the answer", and a plain line says how the checks went
    check(await waitFor(() => document.activeElement?.id === 'zen-see-answer', null, 10000), "step by step 4: when the run settles, focus moves to 'See the answer' (not the heading), even after a stray Tab to the skip link", await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
    await p.waitForTimeout(5000);
    const held = await p.evaluate(() => ({
      h1: document.querySelector('h1')?.innerText,
      hash: location.hash,
      active: document.activeElement?.id,
      line: document.querySelector('.zen__verdict')?.innerText,
      words: [...document.querySelectorAll('.fd-trace [aria-live]')].map((e) => e.innerText).join(' '),
      buttons: [...document.querySelectorAll('.zen__nav button')].map((b) => ({ text: b.innerText.trim(), primary: b.classList.contains('fd-btn--primary'), secondary: b.classList.contains('fd-btn--secondary') })),
      lanes: document.querySelectorAll('.fd-trace .fd-lane').length,
      seal: document.querySelector('.fd-trace__hl-b')?.innerText,
      answer: !!document.querySelector('.fd-ac__lead-name'),
    }));
    const heldWords = /^Passed every check · stress test caught \d+ of \d+ · real run \d+\.\d\d s$/;
    check(
      held.h1 === 'Checking' && held.hash === '#/zen/4' && held.active === 'zen-see-answer' && held.lanes === 6 && !held.answer && heldWords.test(held.line) && held.words === held.line && !/showing the answer/i.test(held.words) &&
        held.buttons.length === 2 && held.buttons[0].text === 'Back' && held.buttons[0].secondary && held.buttons[1].text === 'See the answer' && held.buttons[1].primary && held.seal.startsWith(held.line.split(' · real run')[0]),
      "step by step 4: five seconds after the run settled the pane is still 'Checking' with the finished trace, one plain line saying how it went (the trace's own words, said once by the live region, never 'Showing the answer'), Back (secondary) and 'See the answer' (primary, focused)",
      held,
    );
    await p.keyboard.press('Enter');
    check(await h1Is('Your answer', 10000) && (await hashNow()) === '#/zen/5', "step by step: pressing 'See the answer' opens pane 5 at '#/zen/5'", { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() });
    check(await waitFor(() => document.activeElement?.id === 'zen-title', null, 5000), "step by step 5: focus goes to the pane's heading", await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
    await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), LEAD[0], 30000);
    const rep = await state(() => {
      const m = window.__undefined.state.value.program.functions.topCustomersByRevenue?.artifact?.evidence?.mutation;
      return m ? { total: m.total, caught: m.killed + m.killedByBound } : null;
    });
    const want = rep ? `Passed every check · stress test caught ${rep.caught} of ${rep.total}` : '';
    const five = await p.evaluate(() => ({
      line: document.querySelector('.zpr__line')?.innerText,
      btn: document.querySelector('.zpr__btn')?.innerText,
      expanded: document.querySelector('.zpr__btn')?.getAttribute('aria-expanded'),
      lanes: document.querySelectorAll('#zen-proof .fd-lane').length,
      lockNote: document.querySelector('.fd-ac__lock-note')?.innerText,
    }));
    check(!!rep && five.line?.startsWith(want + ' · real run ') && /^Passed every check · stress test caught \d+ of \d+ · real run \d+\.\d\d s$/.test(five.line) && five.btn === 'See the checks' && five.expanded === 'false' && five.lanes === 0, "step by step 5: the answer keeps its proof: one collapsed line with the seal words (the engine's own count) and the real run, behind 'See the checks'", { want, five });
    check(five.lockNote === 'Saved with this demo file from an earlier session.', "step by step 5: the answer that came with the demo's locked answer says so", five.lockNote);
    await p.locator('.zpr__btn').focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    const open = await p.evaluate(() => ({ expanded: document.querySelector('.zpr__btn')?.getAttribute('aria-expanded'), lanes: document.querySelectorAll('#zen-proof .fd-lane').length, hidden: document.getElementById('zen-proof').hidden }));
    await p.keyboard.press('Space');
    await p.waitForTimeout(300);
    const shut = await p.evaluate(() => ({ expanded: document.querySelector('.zpr__btn')?.getAttribute('aria-expanded'), hidden: document.getElementById('zen-proof').hidden, lanes: document.querySelectorAll('#zen-proof .fd-lane').length }));
    check(open.expanded === 'true' && open.lanes === 6 && !open.hidden && shut.expanded === 'false' && shut.hidden && shut.lanes === 0, "step by step 5: 'See the checks' opens the six-check trace by keyboard (Enter) and closes it again (Space)", { open, shut });
    // the browser's Back and Forward step one pane at a time and land on the pane's heading (the router leaves focus and scroll to the page)
    // every entry is left scrolled a little, so there is an offset the browser could put back: the page, not the browser, owns the scroll here
    const nudge = () => p.evaluate(() => scrollTo({ top: 300, left: 0, behavior: 'instant' }));
    const restoration = () => p.evaluate(() => history.scrollRestoration);
    check((await restoration()) === 'manual', "step by step: while the walk-through is on screen the page owns the scroll (history.scrollRestoration is 'manual')", await restoration());
    const where = () =>
      p.evaluate(() => ({
        h1: document.querySelector('h1')?.innerText,
        hash: location.hash,
        active: document.activeElement?.id,
        y: Math.round(scrollY),
        rest: history.scrollRestoration,
        lanes: document.querySelectorAll('.fd-trace .fd-lane').length,
        seeAnswer: !!document.getElementById('zen-see-answer'),
        len: history.length,
      }));
    await nudge();
    await p.goBack();
    await h1Is('Checking', 5000);
    await p.waitForTimeout(1500); // the finished trace mounts again: it must not pull focus to 'See the answer' (nobody watched this run)
    const back4 = await where();
    await nudge();
    await p.goBack();
    await h1Is('What your answer must pass', 5000);
    const back3 = await where();
    check(
      back4.hash === '#/zen/4' && back4.lanes === 6 && back4.seeAnswer && back4.active === 'zen-title' && back4.y === 0 && back4.rest === 'manual' && back3.hash === '#/zen/3' && back3.active === 'zen-title' && back3.y === 0 && back3.rest === 'manual',
      "step by step: the browser's Back from pane 5 shows the finished pane 4 (heading focused, focus not pulled to 'See the answer'), Back again shows pane 3; each lands at the top with the scroll still the page's own ('manual')",
      { back4, back3 },
    );
    await nudge();
    await p.goForward();
    await h1Is('Checking', 5000);
    // the in-app Back goes through the browser's history when the entry before is the pane before (no new entry)
    const lenBefore = (await where()).len;
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    const inApp = (await h1Is('What your answer must pass', 5000)) && (await where());
    check(!!inApp && inApp.hash === '#/zen/3' && inApp.len === lenBefore && inApp.y === 0 && inApp.rest === 'manual', "step by step: the page's own 'Back' steps back through the browser's history when the previous entry is the previous pane (no new entry), at the top, scroll still 'manual'", { inApp, lenBefore });
    // what the in-app Back asked of the browser was settled when it landed: a Forward afterwards is the viewer's own and must not be taken for the Back's answer (it would push pane 3)
    await nudge();
    await p.goForward();
    const fwd4 = (await h1Is('Checking', 5000)) && (await where());
    check(!!fwd4 && fwd4.hash === '#/zen/4' && fwd4.len === lenBefore && fwd4.y === 0 && fwd4.rest === 'manual', "step by step: the browser's Forward after the page's own 'Back' returns to pane 4 and pushes no entry (the Back's request was spent when the browser landed), at the top, scroll still 'manual'", { fwd4, lenBefore });
    await nudge();
    await p.goForward();
    const fwd5 = (await h1Is('Your answer', 5000)) && (await waitFor(() => document.activeElement?.id === 'zen-title', null, 3000)) && (await where());
    check(!!fwd5 && fwd5.hash === '#/zen/5' && fwd5.active === 'zen-title' && fwd5.y === 0 && fwd5.rest === 'manual', "step by step: the browser's Forward returns to pane 4 and then pane 5 with the answer (scroll at the top, 'manual')", fwd5);
    // coming from further away, the same button pushes the pane before instead
    await p.getByRole('button', { name: 'Ask another question' }).click();
    await h1Is('Ask a question', 5000);
    const askedAgain = await where();
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    const pushed = (await h1Is('Bring your data', 5000)) && (await where());
    check(askedAgain.hash === '#/zen/2' && !!pushed && pushed.hash === '#/zen/1' && pushed.len === askedAgain.len + 1, "step by step: 'Ask another question' then 'Back' goes to pane 1 by pushing it (the entry before is pane 5, not pane 1)", { askedAgain, pushed });
    await p.goBack();
    await p.goBack();
    check(await h1Is('Your answer', 5000) && (await hashNow()) === '#/zen/5', "step by step: the browser's Back from there returns to the answer (pane 2, then pane 5)", await where());
    // the session carries the run to the other page, and back: the answer is still there, and Step by step opens on it
    await p.evaluate(() => (location.hash = '#/start'));
    const carried = await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), LEAD[0], 20000);
    // the walk-through leaves another page's address alone, and gives the browser its scroll restoration back
    // (the answer card is on both pages, so wait until the walk-through has really gone)
    await waitFor(() => !document.querySelector('.zen') && !!document.getElementById('fd-ask-btn'), null, 10000);
    // (Preact runs an unmounted component's effect cleanup after the next paint, so the hold is given back a moment after the page is gone)
    await waitFor(() => history.scrollRestoration === 'auto', null, 1500);
    const onFull = await p.evaluate(() => ({ hash: location.hash, restoration: history.scrollRestoration }));
    check(onFull.hash === '#/start' && onFull.restoration === 'auto', "step by step -> full view: the address stays '#/start' (the walk-through does not rewrite another page's address) and the browser's scroll restoration is back ('auto')", onFull);
    await p.evaluate(() => (location.hash = '#/zen'));
    const back = await h1Is('Your answer', 20000);
    const numbered = await waitFor(() => location.hash === '#/zen/5', null, 5000); // the pane is on screen a moment before its number is written to the address
    await waitFor(() => history.scrollRestoration === 'manual', null, 1500); // the hold is set in an effect, after the paint
    check((await restoration()) === 'manual', "full view -> step by step: the page owns the scroll again ('manual')", await restoration());
    check(carried && back && numbered, "step by step <-> full view: the file, the question and the answer travel both ways (a bare '#/zen' opens on 'Your answer' and is rewritten to '#/zen/5')", { carried, back, h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() });
    check(consoleErrors.length === 0, "step by step: '#/zen' logs no console errors (besides the replay /generate/health 404)", consoleErrors);
  } catch (e) {
    check(false, 'step by step flow', e.message.split('\n')[0]);
  }

  // ── 3c. step by step again, fresh: a deep link is held to what the session allows; under reduced motion the writing mark is a
  // static one and the seconds still tick as text; Back during a run keeps pane 4 (there is no cancel) and nothing moves by itself ──
  consoleErrors.length = 0;
  try {
    const h1Is = (t, timeout = 60000) => waitFor((x) => document.querySelector('h1')?.innerText === x, t, timeout);
    const hashNow = () => p.evaluate(() => location.hash);
    const where = () => p.evaluate(() => ({ h1: document.querySelector('h1')?.innerText, hash: location.hash, back: [...document.querySelectorAll('.zen__nav button')].map((b) => b.innerText.trim()) }));
    for (const asked of ['#/zen/5', '#/zen/4', '#/zen/3', '#/zen/9', '#/zen/x', '#/zen/2?x=1']) {
      await openApp(p, srv.url + asked);
      await h1Is('Bring your data', 15000);
      const at = await where();
      check(at.h1 === 'Bring your data' && at.hash === '#/zen/1', `step by step: a fresh load at '${asked}' (nothing bound, nothing answered) opens the first pane and the address becomes '#/zen/1'`, at);
    }
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(p, srv.url + '#/zen');
    await waitFor(() => !!document.getElementById('zen-continue'), null, 15000);
    await p.getByRole('button', { name: 'orders.csv', exact: true }).click();
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.locator('#zen-continue').click();
    await h1Is('Ask a question', 15000);
    await waitFor(() => document.querySelectorAll('.zp__chip .zp__live').length === 2, null, 30000);
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.locator('#zen-continue').click();
    await h1Is('What your answer must pass', 15000);
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.locator('#zen-continue').click();
    await h1Is('Checking', 15000);
    check(await waitFor(() => document.querySelectorAll('.fd-trace__pen > span').length === 3, null, 15000), 'step by step 4 (reduced motion): the writing mark is there', await markNow());
    const still = await markNow();
    const tick1 = still?.counter;
    check(
      !!still && still.animation === 'none' && still.opacities.join() === '0.35,0.65,1' && still.transforms.every((t) => t === 'none') && REPLAY_COUNTER.test(tick1),
      'step by step 4 (reduced motion): the writing mark is static (no animation, a trail of three ticks at their resting look) in the footer by the drafting label',
      still,
    );
    // the mark at six widths, with the draft still being replayed: it is in the footer, inside the trace's content edge (the trace clips
    // beyond it), it adds no row to the footer and nothing to the header (hidden, the footer and the header measure the same), and the
    // page does not scroll sideways. The header's own words are the counter alone, whatever the width
    const markGeo = () =>
      p.evaluate(() => {
        const q = (x) => document.querySelector(x);
        const pen = q('.fd-trace__pen');
        const head = q('.fd-trace__head');
        const foot = q('.fd-trace__foot');
        if (!pen || !head || !foot) return null;
        const h = (el) => Math.round(el.getBoundingClientRect().height * 100) / 100;
        const shown = { head: h(head), foot: h(foot) };
        pen.style.display = 'none';
        const hidden = { head: h(head), foot: h(foot) };
        pen.style.display = '';
        const edge = q('.fd-trace').getBoundingClientRect().right - 24;
        return {
          vw: innerWidth,
          shown,
          hidden,
          penRight: Math.round(pen.getBoundingClientRect().right * 10) / 10,
          edge: Math.round(edge * 10) / 10,
          inFoot: !!pen.closest('.fd-trace__foot-meta'),
          inHead: !!pen.closest('.fd-trace__head'),
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          counter: q('.fd-trace__timer-a')?.innerText.replace(/\s+/g, ' ').trim(),
        };
      });
    const geoMark = [];
    for (const w of [320, 390, 520, 600, 768, 1440]) {
      await p.setViewportSize({ width: w, height: 900 });
      await p.waitForTimeout(150);
      geoMark.push(await markGeo());
    }
    check(
      geoMark.length === 6 && geoMark.every((g) => g && g.inFoot && !g.inHead && g.penRight <= g.edge + 0.5 && g.shown.head === g.hidden.head && g.shown.foot === g.hidden.foot && g.sideways <= 0 && REPLAY_COUNTER.test(g.counter)),
      'step by step 4: at 320, 390, 520, 600, 768 and 1440 px the mark is in the footer, inside the trace, adds no row to the footer (it is no taller with the mark than without) and nothing to the header, and the page does not scroll sideways',
      geoMark,
    );
    await p.setViewportSize({ width: 1440, height: 900 });
    await waitFor((t1) => { const c = document.querySelector('.fd-trace__timer-a')?.innerText.replace(/\s+/g, ' ').trim() ?? ''; return c !== t1 && /^replaying the recorded draft/.test(c); }, tick1, 4000);
    const tick2 = (await markNow())?.counter;
    check(!!tick2 && tick2 !== tick1 && REPLAY_COUNTER.test(tick2), 'step by step 4 (reduced motion): the seconds counter still ticks as text', { tick1, tick2 });
    // Back during the draft, and again once the checks are running: the pane stays 'Checking' and the address says so
    await p.goBack();
    await p.waitForTimeout(400);
    const duringDraft = await where();
    check(duringDraft.h1 === 'Checking' && duringDraft.hash === '#/zen/4' && duringDraft.back.length === 0, "step by step: the browser's Back during the draft keeps pane 4 ('#/zen/4', no Back button: there is no cancel)", duringDraft);
    await waitFor(() => /checking…/.test(document.querySelector('.fd-trace__timer')?.innerText ?? ''), null, 30000);
    await p.goBack();
    await p.waitForTimeout(400);
    const duringChecks = await where();
    check(duringChecks.h1 === 'Checking' && duringChecks.hash === '#/zen/4' && duringChecks.back.length === 0, "step by step: the browser's Back while the checks run keeps pane 4 too", duringChecks);
    await p.waitForSelector('#zen-see-answer', { timeout: 90000 });
    check(await waitFor(() => document.activeElement?.id === 'zen-see-answer', null, 10000), "step by step 4 (reduced motion): focus is on 'See the answer' once the run settles", await p.evaluate(() => document.activeElement?.id));
    await p.waitForTimeout(1500);
    const afterBack = await where();
    check(afterBack.h1 === 'Checking' && afterBack.hash === '#/zen/4' && afterBack.back.join() === 'Back,See the answer', "step by step: after Back during a run the run still settles on pane 4 with its trace and 'See the answer', and nothing moves by itself", afterBack);
    // Forward twice, to the entries the two Backs above rewrote to pane 4 and then to the one pushed after them (it still remembers
    // pane 3 as the pane before it, but what is before it now says pane 4): one press of the page's own 'Back' still shows pane 3
    await p.goForward();
    await p.goForward();
    await p.waitForTimeout(500);
    const forwardAgain = await where();
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    const oneBack = (await h1Is('What your answer must pass', 5000)) && (await where());
    const oneBackFocus = (await waitFor(() => document.activeElement?.id === 'zen-title', null, 3000)) ? 'zen-title' : await p.evaluate(() => document.activeElement?.id);
    check(
      forwardAgain.h1 === 'Checking' && forwardAgain.hash === '#/zen/4' && !!oneBack && oneBack.hash === '#/zen/3' && oneBackFocus === 'zen-title',
      "step by step: after a browser Back during the run and Forward again, one press of the page's own 'Back' shows pane 3 (the entry before it had been rewritten to pane 4), heading focused",
      { forwardAgain, oneBack, oneBackFocus },
    );
    // and the answer is still one press away on the settled pane 4
    await p.goBack();
    await h1Is('Checking', 5000);
    await p.locator('#zen-see-answer').focus();
    await p.keyboard.press('Enter');
    check(await h1Is('Your answer', 10000) && (await hashNow()) === '#/zen/5', "step by step: 'See the answer' (by keyboard) opens the answer at '#/zen/5'", await where());
    check(consoleErrors.length === 0, "step by step (fresh, reduced motion): no console errors (besides the replay /generate/health 404)", consoleErrors);
  } catch (e) {
    check(false, 'step by step flow (deep links, reduced motion, Back during a run)', e.message.split('\n')[0]);
  } finally {
    await p.emulateMedia({ reducedMotion: null });
  }

  // ── 3d. the edges: the landing's logo on an anchored address scrolls to the top (the walk-through's rule for a same-route hash change is
  // not the landing's); a Back pressed while the ask is still getting ready, and a run carried over from the Full view, both end on the
  // finished trace with focus on "See the answer" ──
  consoleErrors.length = 0;
  try {
    const h1Is = (t, timeout = 60000) => waitFor((x) => document.querySelector('h1')?.innerText === x, t, timeout);
    const hashNow = () => p.evaluate(() => location.hash);
    const focusId = () => p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`);
    // the landing, at an anchored address: the logo ('#/') goes to the top again (as it did before the walk-through's panes were in the address)
    await openApp(p, srv.url + '#/#asks');
    await waitFor(() => window.scrollY > 300, null, 15000);
    let still = -1;
    for (let i = 0; i < 24; i++) {
      const y = await p.evaluate(() => Math.round(scrollY));
      if (y === still) break;
      still = y;
      await p.waitForTimeout(250);
    }
    await p.locator('.fd-tele__home').click();
    await waitFor(() => window.scrollY === 0 && document.activeElement?.id === 'main', null, 5000);
    const home = await p.evaluate(() => ({ y: Math.round(scrollY), hash: location.hash, active: document.activeElement?.id }));
    check(still > 300 && home.y === 0 && home.hash === '#/' && home.active === 'main', "landing at '#/#asks': a click on the logo (href '#/') scrolls to the top and focuses #main (a same-route hash change is only the walk-through's own business)", { anchoredAt: still, home });

    // a Back pressed while the ask is still getting ready (the engine has not started the run yet) lands on pane 3; once the run starts the viewer is put back on pane 4
    // (the run is the page's, there is no cancel), and the run still ends with focus on 'See the answer'. The gap is opened by holding the hashing the ask starts with.
    await openApp(p, srv.url + '#/zen');
    await waitFor(() => !!document.getElementById('zen-continue'), null, 15000);
    await p.getByRole('button', { name: 'orders.csv', exact: true }).click();
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.locator('#zen-continue').click();
    await h1Is('Ask a question', 15000);
    await waitFor(() => document.querySelectorAll('.zp__chip .zp__live').length === 2, null, 30000);
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.locator('#zen-continue').click();
    await h1Is('What your answer must pass', 15000);
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.evaluate(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = async (...a) => {
        await new Promise((r) => setTimeout(r, 1500));
        return digest(...a);
      };
    });
    await p.locator('#zen-continue').click();
    await p.waitForTimeout(400);
    await p.goBack();
    await p.waitForTimeout(300);
    const early = { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() };
    const pulled = await h1Is('Checking', 15000);
    await p.evaluate(() => void delete crypto.subtle.digest);
    const late = { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() };
    check(early.h1 === 'What your answer must pass' && pulled && late.hash === '#/zen/4', "step by step: a Back pressed before the run has started lands on pane 3 (the engine has no run yet), and the viewer is put back on pane 4 once it starts ('#/zen/4')", { early, pulled, late });
    await p.waitForSelector('#zen-see-answer', { timeout: 90000 });
    check(await waitFor(() => document.activeElement?.id === 'zen-see-answer', null, 10000), "step by step 4: a run that began while the viewer was away from the pane still ends with focus on 'See the answer'", await focusId());

    // a run started on the Full view and carried over: Step by step opens on the live trace, and when it settles focus goes to 'See the answer'
    await openApp(p, srv.url + '#/start');
    await waitFor(() => { const b = document.getElementById('fd-ask-btn'); return !!b && b.getAttribute('aria-disabled') !== 'true'; }, null, 30000);
    await p.locator('#fd-ask-btn').click();
    const drafting = await waitFor(() => document.querySelectorAll('.fd-trace__pen > span').length === 3, null, 15000);
    await p.evaluate(() => (location.hash = '#/zen'));
    const opened = (await h1Is('Checking', 15000)) && (await waitFor(() => location.hash === '#/zen/4', null, 5000)); // the pane is on screen a moment before its number is written
    check(drafting && opened, "full view -> step by step: a run still going opens Step by step on 'Checking' ('#/zen/4')", { drafting, opened, hash: await hashNow() });
    await p.waitForSelector('#zen-see-answer', { timeout: 90000 });
    check(await waitFor(() => document.activeElement?.id === 'zen-see-answer', null, 10000), "step by step 4: a run carried over from the Full view ends with focus on 'See the answer' (this visit saw it running)", await focusId());
    check(consoleErrors.length === 0, "landing / step by step edges: no console errors (besides the replay /generate/health 404)", consoleErrors);
  } catch (e) {
    check(false, 'landing logo, run carried over, Back before the run starts', e.message.split('\n')[0]);
  }

  // ── 3e. history.scrollRestoration, hop by hop: 'manual' exactly while Step by step is on screen, 'auto' on the landing and on the Full view,
  // however the viewer got there. An entry made by pushState or a fragment navigation from a walk-through pane INHERITS 'manual', so a walk-through
  // that put back "what it found" would find 'manual' on its next visit and hand it to the landing and the Full view for good (the first two
  // sequences below, and the third three times round, are the ones that expose it). The viewport is short so every page can be scrolled, and each
  // page is left scrolled, so there is an offset for the browser to put back on a Back or Forward onto Step by step: it must land at scrollY 0 ──
  consoleErrors.length = 0;
  try {
    await p.setViewportSize({ width: 1440, height: 500 });
    const settleOn = (pg) => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    /** Which page is on screen: Step by step, the landing (its claim) or the Full view (the ask button, no walk-through). */
    const WHICH = (w) => {
      const zen = !!document.querySelector('.zen');
      const landing = [...document.querySelectorAll('h1')].some((h) => h.innerText.includes('The AI writes it.'));
      return w === 'zen' ? zen : w === 'landing' ? !zen && landing : !zen && !landing && !!document.getElementById('fd-ask-btn');
    };
    const sample = (pg) =>
      pg.evaluate(() => ({
        page: document.querySelector('.zen') ? 'zen' : [...document.querySelectorAll('h1')].some((h) => h.innerText.includes('The AI writes it.')) ? 'landing' : 'start',
        hash: location.hash,
        rest: history.scrollRestoration,
        y: Math.round(scrollY),
      }));
    /** Wait for `want` to be on screen, give the effect that sets or releases the hold time to run, read. `viaHistory`: Back or Forward brought us here. */
    const arrive = async (pg, log, want, label, viaHistory = false) => {
      const ok = await pg.waitForFunction(`(${WHICH.toString()})(${JSON.stringify(want)})`, null, { timeout: 15000, polling: 50 }).then(() => true, () => false);
      // the hold is set (and given back) in an effect, which Preact runs after the next paint: allow for that, then read. A leak never goes away, so it still fails
      await pg.waitForFunction((w) => history.scrollRestoration === (w === 'zen' ? 'manual' : 'auto'), want, { timeout: 1500, polling: 25 }).catch(() => {});
      await settleOn(pg);
      const s = await sample(pg);
      log.push({ label, want, ok, viaHistory, ...s });
      return s;
    };
    const nudge = (pg) => pg.evaluate(() => scrollTo({ top: 300, left: 0, behavior: 'instant' }));
    /** What a sequence got wrong: the wrong page, the wrong mode (manual only on Step by step) or, after a Back or Forward onto Step by step, an offset. */
    const wrong = (log) => log.filter((r) => !r.ok || r.page !== r.want || r.rest !== (r.page === 'zen' ? 'manual' : 'auto') || (r.page === 'zen' && r.viaHistory && r.y !== 0));
    const hero = p.locator('a.fd-btn--primary[href="#/zen"]').first(); // the landing's "Try the demo"
    const toLanding = async () => {
      await openApp(p, srv.url + '#/');
      await waitFor(WHICH, 'landing', 15000);
    };

    // a. landing -> Step by step -> Back to the landing
    {
      const log = [];
      await toLanding();
      await arrive(p, log, 'landing', 'a: open the landing');
      await hero.click();
      await arrive(p, log, 'zen', 'a: Try the demo');
      await nudge(p);
      await p.goBack();
      await arrive(p, log, 'landing', 'a: Back to the landing', true);
      check(wrong(log).length === 0 && log.length === 3, "scrollRestoration a: landing -> Step by step -> Back: 'auto', 'manual', 'auto'", log);
    }
    // b. landing -> Step by step -> its Full view link -> Back -> Back, then Forward -> Forward
    {
      const log = [];
      await toLanding();
      await hero.click();
      await arrive(p, log, 'zen', 'b: Try the demo');
      await nudge(p);
      await p.locator('a.zen__full').click();
      await arrive(p, log, 'start', 'b: the Full view link');
      await nudge(p);
      await p.goBack();
      await arrive(p, log, 'zen', 'b: Back onto Step by step', true);
      await p.goBack();
      await arrive(p, log, 'landing', 'b: Back to the landing', true);
      await p.goForward();
      await arrive(p, log, 'zen', 'b: Forward onto Step by step', true);
      await p.goForward();
      await arrive(p, log, 'start', 'b: Forward onto the Full view', true);
      check(wrong(log).length === 0 && log.length === 6, "scrollRestoration b: landing -> Step by step -> Full view -> Back -> Back -> Forward -> Forward: 'manual' only on Step by step (at the top after every Back and Forward onto it), 'auto' on the landing and the Full view", log);
    }
    // c. landing -> Step by step -> Full view -> Step by step -> landing, three laps, each ending with a Back onto Step by step and a Forward to the
    // landing (a leak ratchets: a visit that arrives on an entry the walk-through already made finds 'manual' on a page that never set it, and the
    // next page it leaves for gets 'manual' too)
    {
      const log = [];
      await toLanding();
      for (let lap = 1; lap <= 3; lap++) {
        await hero.click();
        await arrive(p, log, 'zen', `c${lap}: landing -> Step by step`);
        await nudge(p);
        await p.locator('a.zen__full').click();
        await arrive(p, log, 'start', `c${lap}: Step by step -> Full view`);
        await nudge(p);
        await p.locator('a.fd-tele__step').click();
        await arrive(p, log, 'zen', `c${lap}: Full view -> Step by step`);
        await nudge(p);
        await p.locator('a.zen__home').click();
        await arrive(p, log, 'landing', `c${lap}: Step by step -> landing`);
        await p.goBack();
        await arrive(p, log, 'zen', `c${lap}: Back onto Step by step`, true);
        await nudge(p);
        await p.goForward();
        await arrive(p, log, 'landing', `c${lap}: Forward to the landing`, true);
      }
      check(wrong(log).length === 0 && log.length === 18, "scrollRestoration c: landing -> Step by step -> Full view -> Step by step -> landing -> Back -> Forward, three laps: 'manual' on every Step by step visit (at the top after a Back), 'auto' on every landing and Full view visit (it never ratchets)", wrong(log).length ? wrong(log) : log.map((r) => `${r.page}:${r.rest}`).join(' '));
    }
    // d. a reload on #/zen/2: the session is gone, the page comes back on the first pane with the hold, and the way out is 'auto'
    {
      const log = [];
      await openApp(p, srv.url + '#/zen');
      await p.getByRole('button', { name: 'orders.csv', exact: true }).click();
      await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
      await p.locator('#zen-continue').click();
      await waitFor(() => location.hash === '#/zen/2', null, 10000);
      await p.reload();
      await waitFor(() => !!window.__undefined && window.__undefined.state.value.ready && !!document.querySelector('.zen'), null, 30000);
      await arrive(p, log, 'zen', 'd: reload on #/zen/2');
      await p.locator('a.zen__home').click();
      await arrive(p, log, 'landing', 'd: logo to the landing');
      await hero.click();
      await arrive(p, log, 'zen', 'd: Try the demo again');
      check(wrong(log).length === 0 && log.length === 3 && log[0].hash === '#/zen/1', "scrollRestoration d: a reload on #/zen/2 reopens Step by step (first pane, no session) with 'manual', the way out is 'auto', and the next visit is 'manual' again", log);
    }
    // e. a cold load of #/zen/1 straight from a fresh tab (its own browser context), then out and back through the history
    {
      const log = [];
      const ctx2 = await b.browser.newContext({ viewport: { width: 1440, height: 500 } });
      const p2 = await ctx2.newPage();
      try {
        await openApp(p2, srv.url + '#/zen/1', { fresh: false });
        await arrive(p2, log, 'zen', 'e: cold load of #/zen/1');
        await nudge(p2);
        await p2.locator('a.zen__full').click();
        await arrive(p2, log, 'start', 'e: Full view');
        await p2.locator('a.fd-tele__home').click();
        await arrive(p2, log, 'landing', 'e: the logo');
        await p2.goBack();
        await arrive(p2, log, 'start', 'e: Back onto the Full view', true);
        await p2.goBack();
        await arrive(p2, log, 'zen', 'e: Back onto Step by step', true);
      } finally {
        await ctx2.close();
      }
      check(wrong(log).length === 0 && log.length === 5 && log[0].hash === '#/zen/1', "scrollRestoration e: a cold load of #/zen/1 in a fresh tab holds 'manual'; the Full view and the landing after it are 'auto', and Back onto the Full view is 'auto' again", log);
    }

    // the router, across routes (router.ts planHashChange): from the landing to Step by step is a change of route (to the top, focus on #main); one pane to
    // the next is the page's own (focus on the pane's heading, which only the page moves); an anchor on a pane ('#/zen/3#main') is neither scrolled to
    // nor focused (the page rewrites the address to the plain pane before the router reads it)
    {
      await toLanding();
      await p.evaluate(() => scrollTo({ top: 1200, left: 0, behavior: 'instant' }));
      const scrolledDown = await p.evaluate(() => Math.round(scrollY));
      await p.evaluate(() => document.querySelector('a.fd-btn--primary[href="#/zen"]').click()); // a script click: it does not scroll the link into view first
      await waitFor(() => !!document.querySelector('.zen'), null, 15000);
      const entered = await waitFor(() => window.scrollY === 0 && document.activeElement?.id === 'main', null, 5000);
      check(scrolledDown > 600 && entered, "router: landing (scrolled down) -> Step by step (a change of route) scrolls to the top and focuses #main", { scrolledDown, ...(await p.evaluate(() => ({ y: scrollY, active: document.activeElement?.id || document.activeElement?.tagName }))) });
      await p.getByRole('button', { name: 'orders.csv', exact: true }).click();
      await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
      await p.locator('#zen-continue').click();
      await waitFor(() => document.querySelector('h1')?.innerText === 'Ask a question', null, 15000);
      await waitFor(() => document.activeElement?.id === 'zen-title', null, 5000);
      const pane2 = await p.evaluate(() => ({ active: document.activeElement?.id, hash: location.hash }));
      check(pane2.active === 'zen-title' && pane2.hash === '#/zen/2', "router: a pane change on Step by step moves focus to the pane's heading only (not to #main)", pane2);
      await p.evaluate(() => (document.activeElement && document.activeElement.blur(), scrollTo({ top: 150, left: 0, behavior: 'instant' })));
      const y0 = await p.evaluate(() => Math.round(scrollY));
      await p.evaluate(() => (location.hash = '#/zen/2#main'));
      await p.waitForTimeout(700);
      const anchor = await p.evaluate(() => ({ y: Math.round(scrollY), active: document.activeElement?.id || document.activeElement?.tagName, hash: location.hash, h1: document.querySelector('h1')?.innerText }));
      check(y0 > 0 && anchor.y === y0 && anchor.active === 'BODY' && anchor.hash === '#/zen/2' && anchor.h1 === 'Ask a question', "router: an anchor after a Step by step pane ('#/zen/2#main', an id that is on the page) is not scrolled to and takes no focus; the address is put back to '#/zen/2'", { y0, anchor });
    }
    check(consoleErrors.length === 0, "scrollRestoration and router sequences: no console errors (besides the replay /generate/health 404)", consoleErrors);
  } catch (e) {
    check(false, 'scrollRestoration sequences and router behaviour', e.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e));
  } finally {
    await p.setViewportSize({ width: 1440, height: 900 });
  }

  // ── 4. seed off: no recording of the agreement (the recordings index is served without it), so the spec-less answer ──
  consoleErrors.length = 0;
  await p.route('**/recordings/index.json', async (route) => {
    const res = await route.fetch();
    const names = await res.json();
    await route.fulfill({ response: res, json: names.filter((n) => n !== 'orders-agreement.json') });
  });
  try {
    await openApp(p, srv.url + '#/start');
    check(await bindOrders(), "seed off: '#/start' binds the sample orders.csv (as rows)", (await body()).slice(0, 400));
    await chip('Top 5 customers by revenue').click();
    await waitFor(() => [...document.querySelectorAll('[aria-label="Suggested questions"] button')].some((b) => b.textContent.includes('Top 5 customers by revenue') && b.getAttribute('aria-pressed') === 'true'), null, 15000);
    await p.waitForFunction(() => { const b = document.getElementById('fd-ask-btn'); return !!b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 30000 });
    const chips0 = await texts('[aria-label="Suggested questions"] button');
    const text0 = norm(await body());
    const pre0 = await fnState();
    check(
      chips0.some((c) => /^Top 5 customers by revenue Basic checks$/.test(c)) && text0.includes('Basic checks only: no examples, locked answers or house rules for this question yet.') && text0.includes('0 examples · 0 locked answers · 0 house rules') && !pre0.has,
      "seed off: the question is tagged 'Basic checks' and no agreement is installed (the seeded one has no recording to play)",
      { chips0, pre0: pre0.has, text: text0.slice(0, 500) },
    );

    await ask(null);
    const shown0 = await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), 'Puddlesworth Inc', 60000);
    const lead0 = (await texts('.fd-ac__lead-name, .fd-ac__lead-num')).join(' | ');
    const eyebrow0 = await texts('.fd-ac__eyebrow');
    check(shown0 && lead0 === 'Puddlesworth Inc | $2,599.13' && eyebrow0.length === 1 && eyebrow0[0] === 'PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET' && !consoleErrors.length, "seed off: 'Top 5 customers by revenue' → Ask: Puddlesworth Inc $2,599.13, 'PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET'", { shown0, lead0, eyebrow0, errors: consoleErrors });
    const post0 = await fnState();
    check(
      post0.gen?.phase === 'committed' && post0.gen.statuses.length === 1 && post0.gen.statuses[0] === 'accepted' && post0.live && post0.examples === 0 && post0.houseRules === 0 && post0.pins.length === 0 && post0.rows?.length === 5 && post0.rows[0][0] === 'Puddlesworth Inc' && money(post0.rows[0][1]) === '$2,599.13' &&
        post0.gen.gates.filter((x) => x.status === 'pass').map((x) => x.gate).join() === 'compile,invariants' && post0.gen.gates.filter((x) => x.status === 'skipped').map((x) => x.gate).join() === 'tests,properties',
      "seed off: the engine agrees — the spec-less recorded draft was accepted: only the 2 basic checks ran (compile, invariants; tests and properties skipped, no examples, house rules or locked answer); the output table starts Puddlesworth Inc (2599.131, shown as $2,599.13)",
      post0,
    );
    const card0 = norm((await texts('.fd-ac')).join(' '));
    check(cardShows(card0, post0.rows ?? []), "seed off: the answer card lists the engine's five customers and amounts in order", { rows: post0.rows, card: card0.slice(0, 500) });

    // locking is offered here (nothing is locked yet), and it locks
    const offered = await texts('.fd-ac__lock');
    check(offered.length === 1 && offered[0] === 'Does this look right? Lock this answer', "seed off: 'Does this look right? Lock this answer' is offered", offered);
    await lockBtn.first().click();
    const locked0 = await waitLock('Locked');
    await idle();
    const lockHelp0 = await texts('.fd-ac__help');
    const pins0 = (await fnState()).pins;
    check(locked0 && pins0.length === 1 && pins0[0].label === 'topCustomersByRevenue(rows)' && /^Locked\. This demo can't re-run with it, so asking again shows this same answer/.test(lockHelp0[0] ?? ''), "seed off: 'Lock this answer' locks it (one locked answer in the spec; the demo says it cannot re-run with it)", { locked0, pins0, lockHelp0 });
    await ask(null);
    const cached0 = await waitText(/Already checked in this session\./, 30000);
    check(cached0, 'seed off: ask again after locking shows the cached line', (await body()).slice(0, 600));

    await unrecorded('seed off');
    check(consoleErrors.length === 0, "seed off: '#/start' logs no console errors (besides the replay /generate/health 404)", consoleErrors);
  } finally {
    await p.unroute('**/recordings/index.json');
  }
} catch (e) {
  check(false, 'replay-check aborted', e.stack ?? String(e));
} finally {
  await b.close();
  srv.stop();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);

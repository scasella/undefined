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
//      and the two unrecorded questions say so honestly.
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

  await ask(null);
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
    await p.getByRole('button', { name: 'orders.csv', exact: true }).focus();
    await p.keyboard.press('Enter');
    check(await bindOrders(), 'step by step 1: a sample binds orders.csv (as rows)', (await body()).slice(0, 300));
    check(await waitFor(() => document.activeElement?.id === 'zen-continue', null, 10000), 'step by step 1: choosing a sample leaves focus on Continue, not <body>', await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
    await cont.click();
    check(await h1Is('Ask a question'), 'step by step: Continue opens pane 2 (Ask a question)', await p.evaluate(() => document.querySelector('h1')?.innerText));
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
    check(await h1Is('What your answer must pass'), 'step by step: Continue opens pane 3', await p.evaluate(() => document.querySelector('h1')?.innerText));
    const marks = await p.evaluate(() => ({ rows: document.querySelectorAll('.zp__check').length, dashed: document.querySelectorAll('.zp__ico circle[stroke-dasharray]').length, green: [...document.querySelectorAll('.zp__checks *')].filter((e) => /17A36B|33C793/i.test(`${e.getAttribute('fill')} ${e.getAttribute('stroke')}`) || /rgb\(23, 163, 107\)|rgb\(51, 199, 147\)/.test(`${getComputedStyle(e).color} ${getComputedStyle(e).backgroundColor}`)).length, sum: document.querySelector('.zp__sum')?.innerText }));
    check(marks.rows === 6 && marks.dashed === 6 && marks.green === 0 && /^Full checks: all six apply\. The answer appears after all six have run/.test(marks.sum), 'step by step 3: six dashed will-run markers and nothing green before anything has run; the summary follows the seal rule', marks);
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await cont.click();
    check(await h1Is('Your answer', 90000), "step by step: 'Run the checks' runs them and hands over to the answer", await p.evaluate(() => document.querySelector('h1')?.innerText));
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
    // the session carries the run to the other page, and back: the answer is still there, and Step by step opens on it
    await p.evaluate(() => (location.hash = '#/start'));
    const carried = await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), LEAD[0], 20000);
    await p.evaluate(() => (location.hash = '#/zen'));
    const back = await h1Is('Your answer', 20000);
    check(carried && back, "step by step <-> full view: the file, the question and the answer travel both ways (Step by step opens on 'Your answer')", await p.evaluate(() => document.querySelector('h1')?.innerText));
    check(consoleErrors.length === 0, "step by step: '#/zen' logs no console errors (besides the replay /generate/health 404)", consoleErrors);
  } catch (e) {
    check(false, 'step by step flow', e.message.split('\n')[0]);
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

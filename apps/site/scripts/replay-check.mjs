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
//      seeding"), installs the seeded agreement (6 examples, 1 locked answer, 2 house rules): "Who are our top
//      customers by revenue?" replays with FULL checks and answers Chef Ravioli Starbright $2,252.07, already locked, the engine's
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
//   3g. the answer card (contract A): under the figure, in body text, one verdict line (how the checks went in the seal's own words with the engine's
//      own stress-test count, the one thing most worth knowing was not checked, and the hand-off as the next step), replacing the old standalone "Not
//      checked:" line; the hand-off is the card's one filled control (the lock is a quiet ring; the landing's illustration, which has no hand-off,
//      keeps its filled lock and names no next step); the pre-set lock says where it came from and "Version 4" is explained from the engine's own
//      saved steps (demo only, never when a save before the answer is the viewer's own; the basic fallback gets its two set-up saves named too); Confirm says what it really does and does nothing
//      more (no engine change, no request); the Full view's live sentence names the answer once, and on Step by step the answer pane's heading is
//      described by the answer's lead (read from the browser's accessibility tree: the name stays "Your answer", no live region repeats it).
//   3g (landing). the illustration's answer card is a compact skeleton while it plays and is released at its natural height; the release moves
//      the section under it down once, and a viewer whose window starts below the card's top (the evidence 20, 60 and 300 px down at 1440, 1180 and 390,
//      the agreement under the card at 390 and 768) sees it move 0 to 2 px, one fresh page per case, every frame sampled; a viewer who can see the card's
//      top watches it fill (its top holds); "Run again" from the released card never shows a tall frame.
//   3h. typeset (critique step 5), on the landing, the Full view and Step by step's answer pane: the lead amount and the amounts under it are Geist tabular figures
//      (no monospaced face, no gap round the comma and the point, a column level digit by digit), the ranked list is named 'Places 2 to 5' by one visible plain
//      label above it (first-run pages), the labels that stay mono capitals are 22 characters or fewer and every longer one is a sentence-case Geist line with no
//      tracking, no text over 22 characters is capitals or tracked outside the seal, and no block of text ends on a single word, body text holds to the reading measure, and the money in a thrown-out note is a Geist figure.
//   3a/3b/3f. the own-file path (docs/FRONT-DOOR.md "Your own file in the demo"): both pickers (Full view, Step by step) say what the
//      demo cannot do with a file of your own under the drop zone BEFORE one is dropped (one caveat, the same words); once an
//      own CSV is bound (a pasted one on Step by step, a dropped one on the Full view) the picker stays open, the sample
//      files stay in sight, a short note sits directly above them, and the forward button on Step by step reads "See
//      what's in your file" (secondary, enabled, focused); the note about columns read as text is said once, above the
//      suggestions (before the buttons), not under them; the dead end has the steps inline and OPEN (what you need, the three
//      commands exactly, where it opens, the README link) with no horizontal scroll at 390 px, and a fold the viewer made
//      survives typing a question; the own-file note names orders.csv (the sample that has recordings); a refusal holds Step
//      by step's picker open in the demo; the landing's limits card lists the same steps and the columns come out level;
//      the sample path is unchanged ("Continue" primary, the picker folded). A copy that runs on your computer (the
//      generation service's health stubbed as up) draws none of it, and a refusal there folds the picker as it always did.
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
// The orders sample's three questions, in their own words: the chip, the "Asking:" line, the trace header and every sentence that points at
// one say exactly this (model/questions.ts: label is text). "Top 5 customers by revenue" is the old button wording, kept as an alias a viewer can still type.
const Q_TOP = 'Who are our top customers by revenue?';
const Q_STATUS = 'How many orders are there by status?';
const Q_COUNTRY = 'What is our revenue by country?';
/** The chip tag for a question the demo cannot answer (start/AskCard.tsx NEEDS_YOUR_COMPUTER): the sentences' own phrase, not "live". */
const NEEDS_TAG = 'needs your computer';
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const chip = (label) => p.getByRole('group', { name: 'Suggested questions' }).getByRole('button', { name: new RegExp(esc(label)) });
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
    for (const label of [Q_STATUS, Q_COUNTRY]) {
      await ask(label);
      const none = await waitText(/No recorded answer for this one\./, 30000);
      const t = await body();
      check(none && /In this demo, answers are recorded/.test(t) && /Nothing was checked\./.test(t), `${tag}: '${label}' → Ask: the honest no-recording state`, t.slice(0, 600));
    }
  }
  const bindOrders = async () =>
    waitFor(() => window.__undefined.state.value.datasets.some((d) => d.name === 'rows') && document.body.innerText.includes('orders.csv'), null, 30000);
  const LEAD = ['Chef Ravioli Starbright', 2252.07];
  /**
   * Typeset (critique step 5), read from whatever page is up: how its figures are set (Geist tabular figures, no gappy comma and point; a column of
   * amounts level digit by digit), the places label over a ranked list, every label (short noun labels in mono capitals, anything longer a sentence-case
   * line in Geist), any capitals or tracking on a long text, and any block of text (a paragraph, a heading, a div or span sentence, a list item, a button
   * label) of five words or more whose last line is one lone word.
   */
  const TYPESET_FACTS = () => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('.fd-sr, [hidden], [aria-hidden="true"], [inert]');
    };
    const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const charRects = (el) => {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn) return [];
      const t = tn.textContent;
      const out = [];
      for (let i = 0; i < t.length; i++) {
        const r = document.createRange();
        r.setStart(tn, i);
        r.setEnd(tn, i + 1);
        const b = r.getBoundingClientRect();
        out.push({ c: t[i], l: b.left, r: b.right });
      }
      return out;
    };
    const font = (e) => {
      const cs = getComputedStyle(e);
      const fs = parseFloat(cs.fontSize);
      return { family: cs.fontFamily, nums: cs.fontVariantNumeric, tt: cs.textTransform, ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) / fs, size: cs.fontSize, mono: /mono/i.test(cs.fontFamily) };
    };
    const level = (rows) => {
      if (rows.length < 2) return false;
      const len = Math.min(...rows.map((r) => r.length));
      for (let k = 1; k <= len; k++) {
        const rights = rows.map((r) => r[r.length - k].r);
        if (Math.max(...rights) - Math.min(...rights) > 0.51) return false;
      }
      return true;
    };
    const leadEl = [...document.querySelectorAll('.fd-ac__lead-num')].find(vis);
    const lc = leadEl ? charRects(leadEl) : [];
    const ci = lc.findIndex((x) => x.c === ',');
    const lead = leadEl && ci > 0 ? { text: lc.map((x) => x.c).join(''), ...font(leadEl), commaAdvance: lc[ci].r - lc[ci].l, digitAdvance: lc[1].r - lc[1].l, gapAfterComma: lc[ci + 1].l - lc[ci].r } : null;
    const amtEls = [...document.querySelectorAll('.fd-ac__amt, .fd-ac__td-amt')].filter(vis);
    const amounts = { n: amtEls.length, level: level(amtEls.map(charRects)), mono: amtEls.some((e) => font(e).mono), nums: [...new Set(amtEls.map((e) => font(e).nums))] };
    const ladderEls = [...document.querySelectorAll('.fd-ld-col:nth-of-type(1) .fd-ld-row__amt')].filter(vis);
    // (the lit column's first row is the bold one: its digits must still line up with the rest)
    const litEls = [...document.querySelectorAll('.fd-ld-col.is-lit .fd-ld-row__amt')].filter(vis);
    const ladder = ladderEls.length ? { n: ladderEls.length, level: level(ladderEls.map(charRects)), litN: litEls.length, litLevel: level(litEls.map(charRects)), mono: [...ladderEls, ...litEls].some((e) => font(e).mono) } : null;
    // the visible label is aria-hidden on purpose (the list's own name says the same words, so a screen reader says them once): found by its box, not by `vis`
    const pl = [...document.querySelectorAll('.fd-ac__places')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.fd-sr, [hidden], [inert]'); });
    const ol = pl?.nextElementSibling;
    const ranks = ol ? [...ol.querySelectorAll('.fd-ac__rank')].map((e) => e.innerText.trim()) : [];
    const places = pl ? { text: pl.innerText.trim(), hidden: pl.getAttribute('aria-hidden'), label: ol?.getAttribute('aria-label') ?? null, first: ranks[0] ?? null, last: ranks[ranks.length - 1] ?? null, ...font(pl), beforeList: !!ol && ol.tagName === 'OL' } : null;
    const lines = [...document.querySelectorAll('.fd-label-line')].filter(vis).map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), ...font(e) }));
    const eyebrows = [...document.querySelectorAll('.fd-eyebrow')].filter(vis).map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), ...font(e) }));
    // every block of running text, not only p and h1-h3: a sentence in a div, a span, a list item or a button label ends on a lone word just the same.
    // A block's words are its own and those of its inline children (an inline-block button inside a sentence is part of its last line). Data cells,
    // code and the trace's own mono header are not prose and are left out.
    const flowWords = (el) => {
      const ws = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) {
            for (const m of c.textContent.matchAll(/\S+/g)) {
              const rg = document.createRange();
              rg.setStart(c, m.index);
              rg.setEnd(c, m.index + m[0].length);
              const rs = [...rg.getClientRects()];
              if (rs.length) ws.push({ w: m[0], c: (rs[0].top + rs[0].bottom) / 2, h: rs[0].height });
            }
          } else if (c.nodeType === 1 && !c.closest('.fd-sr, [hidden], [aria-hidden="true"]')) {
            const d = getComputedStyle(c).display;
            if (d === 'inline' || d === 'contents' || d.startsWith('inline-')) walk(c);
          }
        }
      };
      walk(el);
      return ws;
    };
    // a run of capitals TYPED into a longer text ("YOUR AGREEMENT × EVERY VERSION · Top 5 customers by revenue") is capitals however the CSS sets it
    const CAPS = /(?<![\p{L}\p{N}_])[A-Z]{2,}[A-Z0-9'’.\-]*(?:[ ·×+&/,]+(?:[A-Z]{2,}[A-Z0-9'’.\-]*|\d+))+(?![\p{L}\p{N}_])/gu;
    const longCaps = [...document.querySelectorAll('body *')]
      .filter(vis)
      .map((e) => ({ e, t: own(e) }))
      .filter(({ t }) => t.length > 22)
      .filter(({ e, t }) => {
        const f = font(e);
        const letters = t.replace(/[^A-Za-z]/g, '');
        const typedRun = [...t.matchAll(CAPS)].some((m) => m[0].replace(/['’.\-,\s]+$/, '').length > 22);
        return (f.tt === 'uppercase' || f.ls > 0.02 || (letters.length >= 3 && t === t.toUpperCase()) || typedRun) && !e.closest('.fd-ac__eyebrow, td, th, tbody, pre, code, .fd-priv__pre');
      })
      .map(({ t }) => t);
    // the figures a thrown-out note quotes ("expected $2,252.07, got $2,260.06"): Geist tabular figures, not a monospaced face with a gap round the comma and the point
    const noteFigures = [...document.querySelectorAll('.fd-trace__ghost-note span span')]
      .filter(vis)
      .map((e) => ({ text: e.innerText.trim(), mono: /mono/i.test(getComputedStyle(e).fontFamily), nums: getComputedStyle(e).fontVariantNumeric, ...(() => { const c = charRects(e); const i = c.findIndex((x) => x.c === ','); return i > 0 ? { commaAdvance: c[i].r - c[i].l, digitAdvance: c[1].r - c[1].l } : {}; })() }));
    // the reading measure: the body text the rails, the stage's mini card, the privacy note and the trace's note hold to --fd-measure runs to 75 characters a line at most
    const measure = [...document.querySelectorAll('.fd-agree__empty-p, .fd-agree__foot, .fd-priv__foot, .fd-priv__note, .fd-ac__assumption-text, .fd-stage__q-body, .fd-trace__ghost-note > span, .fd-tf__limit-list > li, .fd-tf__files > li, .fd-rl__list > li')]
      .filter(vis)
      .map((e) => {
        const ws = flowWords(e);
        const rows = [];
        for (const w of ws) {
          const last = rows[rows.length - 1];
          if (last && Math.abs(w.c - last.c) < w.h * 0.6) last.ws.push(w.w);
          else rows.push({ c: w.c, ws: [w.w] });
        }
        return { cls: e.className, longest: Math.max(0, ...rows.map((r) => r.ws.join(' ').length)), text: ws.map((x) => x.w).join(' ').slice(0, 50) };
      })
      .filter((x) => x.longest > 75);
    const lone = [...document.querySelectorAll('body *')]
      .filter((e) => vis(e) && getComputedStyle(e).display !== 'inline' && !e.closest('pre, code, td, th, .fd-trace__head'))
      .map((e) => {
        const ws = flowWords(e);
        const rows = [];
        for (const w of ws) {
          const last = rows[rows.length - 1];
          if (last && Math.abs(w.c - last.c) < w.h * 0.6) last.ws.push(w.w);
          else rows.push({ c: w.c, ws: [w.w] });
        }
        return { text: ws.map((x) => x.w).join(' ').slice(0, 60), words: ws.length, lines: rows.length, last: rows.length ? rows[rows.length - 1].ws.join(' ') : '', lastWords: rows.length ? rows[rows.length - 1].ws.length : 0 };
      })
      .filter((x) => x.lines >= 2 && x.words >= 5 && x.lastWords === 1)
      .map((x) => `${x.text} → ${x.last}`);
    return { lead, amounts, ladder, places, lines, eyebrows, longCaps, noteFigures, measure, lone, sideways: document.documentElement.scrollWidth > window.innerWidth };
  };
  /** The figures: Geist tabular, no gap round the comma and the point, and the amounts level digit by digit. */
  const figuresOk = (t) =>
    !!t.lead && !t.lead.mono && /tabular-nums/.test(t.lead.nums) && t.lead.commaAdvance < 0.4 * t.lead.digitAdvance && Math.abs(t.lead.gapAfterComma) < 1 && !t.amounts.mono && t.amounts.nums.every((n) => /tabular-nums/.test(n));
  /** The answer card as the viewer meets it (run in the page): filled controls, the verdict line and where it sits, the notes. */
  const CARD_FACTS = () => {
    const card = document.querySelector('.fd-ac');
    if (!card) return null;
    const rgb = (e) => getComputedStyle(e).backgroundColor;
    const filled = [...card.querySelectorAll('button, a')].filter((e) => rgb(e) === 'rgb(61, 59, 243)' || rgb(e) === 'rgb(43, 41, 201)').map((e) => e.innerText.trim());
    const v = card.querySelector('.fd-ac__verdict');
    const vs = v && getComputedStyle(v);
    const acts = [...card.querySelectorAll('.fd-ac__actions > button, .fd-ac__actions > a')];
    const lock = card.querySelector('.fd-ac__lock');
    const text = (sel) => card.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    return {
      filled,
      verdict: v?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      verdictStyle: vs && { size: vs.fontSize, lh: vs.lineHeight, color: vs.color, mono: /mono/i.test(vs.fontFamily), icons: v.querySelectorAll('svg').length },
      afterFigure: v ? v.previousElementSibling?.className ?? null : null,
      standaloneNotChecked: [...card.querySelectorAll('p')].filter((e) => /^Not checked:/.test(e.innerText)).length,
      caveat: !!card.querySelector('.fd-ac__caveat'),
      firstAction: card.querySelector('.fd-ac__actions')?.firstElementChild?.innerText.trim() ?? null,
      actionHeights: acts.map((e) => Math.round(e.getBoundingClientRect().height)),
      lockText: lock?.innerText.trim() ?? null,
      lockBg: lock ? rgb(lock) : null,
      handoffTitle: card.querySelector('.fd-btn--primary')?.getAttribute('title') ?? null,
      handoffStatus: card.querySelector('.fd-run__handoff-msg')?.getAttribute('role') ?? null,
      version: text('.fd-ac__version'),
      fig: text('.fd-ac__fig'),
      lockNote: text('.fd-ac__lock-note'),
      lockInfo: text('.fd-ac__lock-info'),
      confirmNote: text('.fd-ac__assumed-note'),
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  };
  /** The verdict line the card should say for a stress test result {caught, total, missed}, the seal's own words (the numbers come from the engine). */
  const verdictFor = (r, tail) => `Passed every check, ${r.missed > 0 ? 'though' : 'and'} the stress test caught ${r.caught} of ${r.total} deliberate breaks. ${tail}`;
  const NEXT = 'if the number matters, hand the calculation to your data team.';
  const MAIN_NOT_CHECKED = 'Not checked: whether orders.csv is the complete export';
  /** Every accessible heading of the page and the live regions, from the browser's own accessibility tree. */
  const axHeadings = async () => {
    const cdp = await p.context().newCDPSession(p);
    try {
      await cdp.send('Accessibility.enable');
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const live = (n) => n.properties?.some((x) => x.name === 'live' && x.value.value !== 'off');
      return {
        headings: nodes.filter((n) => n.role?.value === 'heading' && !n.ignored).map((n) => ({ name: n.name?.value ?? '', desc: n.description?.value ?? '' })),
        live: nodes.filter((n) => !n.ignored && live(n)).map((n) => n.name?.value ?? ''),
      };
    } finally {
      await cdp.detach();
    }
  };
  /** A file of the viewer's own, with the three kinds of text that look like numbers or dates (model/columnNotes.ts). */
  const OWN_CSV = 'Order,Customer,Region,Net Amt (USD),Tax %,Shipped\n1001,Ada Lovelace,north,"1,234.50",19%,31/01/2024\n1002,Grace Hopper,south,"980.00",7%,15/02/2024\n1003,Linus Torvalds,east,"45.25",19%,03/03/2024\n1004,Ada Lovelace,north,"2,310.10",19%,21/03/2024\n';
  const OWN_CAVEAT = /^In this demo, only some questions about the sample file orders\.csv have recorded answers\. Your own file loads and previews here; asking about it needs the version on your computer\.$/;
  const RUN_COMMANDS = ['git clone https://github.com/scasella/undefined.git && cd undefined', 'npm install', 'npm run dev'];
  /** How many words sit on the last line of a paragraph (a one-word last line is a widow). Run in the page. */
  const LAST_LINE_WORDS = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const tops = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const m of n.data.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        tops.push(Math.round(r.getBoundingClientRect().top));
      }
    }
    const last = tops[tops.length - 1];
    return { lines: new Set(tops).size, lastLine: tops.filter((t) => t === last).length };
  };

  /** What the landing's evidence tile says the recorded run's stress test caught (read there, compared with the real run's own report below). */
  let landRecorded = null;
  // ── 3g. the landing's illustrative card: the same verdict line with its own labelled numbers; no hand-off, so no next step and the lock keeps its fill ──
  {
    // ── the landing's answer card while the illustration plays: a compact skeleton (five bars and a caption), its body out of layout and out of the
    // accessibility tree, then released at its natural height; "Run again" goes back to the skeleton in the same render (never a frame of the tall card) ──
    const HELD_FACTS = () => {
      const c = document.querySelector('.fd-stage .fd-ac');
      const body = c?.querySelector('.fd-ac__body');
      if (!c || !body) return null;
      return {
        h: Math.round(c.getBoundingClientRect().height),
        cls: c.className,
        label: c.getAttribute('aria-label'),
        busy: c.getAttribute('aria-busy'),
        bodyDisplay: getComputedStyle(body).display,
        bodyInDom: !!body.querySelector('.fd-ac__lead-name'),
        bars: c.querySelectorAll('.fd-ac__veil-bar').length,
        caption: c.querySelector('.fd-ac__veil-caption')?.innerText.trim() ?? null,
        veilPos: getComputedStyle(c.querySelector('.fd-ac__veil')).position,
        stageH: Math.round(document.querySelector('.fd-stage').getBoundingClientRect().height),
      };
    };
    const answerInTree = async () => {
      const names = (await axHeadings()).headings.map((x) => x.name);
      return names.includes('What the AI assumed') || names.includes('Checked against');
    };
    // restart the playback, so the clock is known (the card is released 6.9 s after it), and read the card while the illustration plays
    await p.locator('.fd-stage__replay').click();
    await p.waitForTimeout(700);
    const held = await p.evaluate(HELD_FACTS);
    const heldTree = await answerInTree();
    check(
      !!held && held.h >= 260 && held.h <= 400 && /fd-ac--held/.test(held.cls) && held.label === 'Answer held until every check passes' && held.busy === 'true' && held.bodyDisplay === 'none' && held.bodyInDom && held.bars === 5 &&
        held.caption === 'Held until every check passes.' && held.veilPos === 'relative' && !heldTree,
      "landing: while the illustration plays the answer card is a compact skeleton (five bars and its caption, 260 to 400 px, not the answer's height), its body is in the DOM but out of layout and out of the accessibility tree",
      { held, heldTree },
    );
    // The release makes the section under the card move down once (about 870 px at 1440, 1,450 at 390). A viewer whose window starts below the card's
    // top is reading something under it and must not see it move; a viewer who can see where the card begins watches it fill. Each case is its own page
    // (the release happens once per load) and runs at the same time as the others: the line under the card is sampled every frame through the release.
    const RELEASE_PROBE = ([target, off]) => {
      const pick = () => (target === 'rail' ? document.querySelector('.fd-agree-rail') : document.querySelector('.fd-stage').nextElementSibling);
      window.scrollTo({ top: pick().getBoundingClientRect().top + scrollY - off, behavior: 'instant' });
      window.__s = [];
      const tick = () => {
        const c = document.querySelector('.fd-stage .fd-ac').getBoundingClientRect();
        window.__s.push({ y: pick().getBoundingClientRect().top, ct: c.top, ch: c.height });
        window.__raf = requestAnimationFrame(tick);
      };
      tick();
    };
    const releaseCase = async ({ w, h, target, off }) => {
      const ctx = await b.browser.newContext({ viewport: { width: w, height: h } });
      try {
        const pg = await ctx.newPage();
        await pg.goto(srv.url + '#/');
        await pg.waitForSelector('.fd-stage .fd-ac');
        await pg.evaluate(RELEASE_PROBE, [target, off]);
        await pg.waitForFunction(() => (window.__s.at(-1)?.ch ?? 0) > 900, null, { timeout: 20000 }); // the release
        await pg.waitForTimeout(700); // the reveal's rise settles
        const s = await pg.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__s; });
        const y0 = s[1].y;
        return { w, target, off, anchor: Math.round(y0), maxMove: Math.round(Math.max(...s.map((f) => Math.abs(f.y - y0)))), cardTop: Math.round(s[1].ct), cardTopEnd: Math.round(s.at(-1).ct), cardH: Math.round(s.at(-1).ch), frames: s.length };
      } finally {
        await ctx.close();
      }
    };
    const kept = [
      { w: 1440, h: 900, target: 'ev', off: 20 }, // the case the first version handled: the card wholly above the window
      { w: 1440, h: 900, target: 'ev', off: 60 }, // the card's bottom edge 36 px in view: the first version let all of the section leave
      { w: 1440, h: 900, target: 'ev', off: 300 }, // the section 300 px down the window, the card's top 25 px above it
      { w: 1180, h: 900, target: 'ev', off: 60 }, // the breakpoint
      { w: 1180, h: 900, target: 'ev', off: 300 },
      { w: 390, h: 844, target: 'ev', off: 60 },
      { w: 390, h: 844, target: 'rail', off: 100 }, // a phone, reading the agreement under the card, with the card's bottom edge in view
      { w: 768, h: 900, target: 'rail', off: 200 },
    ];
    const watched = { w: 1440, h: 900, target: 'ev', off: 600 }; // the card's top 275 px down the window: the viewer sees it begin
    const sweep = await Promise.all([...kept, watched].map(releaseCase));
    const keptRes = sweep.slice(0, kept.length);
    const watchedRes = sweep[kept.length];
    check(
      keptRes.every((r) => r.cardTop < 0 && r.maxMove <= 2 && r.cardH > 900 && r.frames > 20),
      "landing: a viewer whose window starts below the card's top (the evidence 20, 60 and 300 px down the window at 1440, 1180 and 390, and the agreement under the card on a phone and a tablet) sees nothing under the card move when it is released (0 to 2 px through every frame of the release)",
      keptRes,
    );
    check(
      watchedRes.cardTop > 0 && Math.abs(watchedRes.cardTopEnd - watchedRes.cardTop) <= 2 && watchedRes.cardH > 900,
      "landing: a viewer who can see where the card begins (its top 275 px down the window) sees it fill from there: its top does not move",
      watchedRes,
    );
    // the card is released on the main page by now
    await p.waitForFunction(() => (document.querySelector('.fd-stage .fd-ac')?.getBoundingClientRect().height ?? 0) > 900, null, { timeout: 20000 });
    await p.waitForTimeout(800); // the reveal's rows settle
    const released = await p.evaluate(HELD_FACTS);
    const releasedTree = await answerInTree();
    check(
      !!released && released.h > 900 && /fd-ac--shown/.test(released.cls) && released.label === 'Answer: Top 5 customers by revenue' && released.busy === 'false' && released.bodyDisplay === 'block' && releasedTree,
      "landing: the card is released at its natural height (over 900 px, named by its answer, its body in the accessibility tree)",
      { released, releasedTree },
    );
    // "Run again" from the released card: the card is tall at the click (checked), and not one frame at or after the click is tall (a skeleton in the same render)
    await p.evaluate(() => {
      window.__frames = [];
      const btn = document.querySelector('.fd-stage__replay');
      btn.addEventListener('click', () => { window.__clickAt = performance.now(); }, { capture: true, once: true });
      const tick = () => { window.__frames.push({ t: performance.now(), h: document.querySelector('.fd-stage .fd-ac')?.getBoundingClientRect().height ?? 0 }); window.__raf = requestAnimationFrame(tick); };
      tick();
    });
    await p.waitForTimeout(150);
    await p.locator('.fd-stage__replay').click();
    await p.waitForTimeout(700);
    const rerun = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return { before: window.__frames.filter((f) => f.t < window.__clickAt).map((f) => Math.round(f.h)), after: window.__frames.filter((f) => f.t >= window.__clickAt).map((f) => Math.round(f.h)) }; });
    check(
      rerun.before.length > 3 && Math.min(...rerun.before) > 900 && rerun.after.length > 5 && Math.max(...rerun.after) <= 400,
      "landing: 'Run again' from the released card (over 900 px tall at the click) goes straight back to the compact skeleton: not one frame at or after the click is the full-height card",
      { before: [...new Set(rerun.before)], after: [...new Set(rerun.after)] },
    );
    // the stop scenario holds the card until the viewer decides: still the skeleton long after the pass scenario would have released it
    await p.evaluate(() => document.querySelector('.fd-stage')?.scrollIntoView({ block: 'start' }));
    await p.getByRole('button', { name: 'Watch it stop and ask' }).click();
    await p.waitForTimeout(7600);
    const stopHeld = await p.evaluate(HELD_FACTS);
    check(
      !!stopHeld && stopHeld.h >= 260 && stopHeld.h <= 400 && /fd-ac--held/.test(stopHeld.cls) && stopHeld.bodyDisplay === 'none' && stopHeld.caption === 'Waiting on you. No new answer is shown until you decide.' && stopHeld.stageH < 1400,
      "landing: 'Watch it stop and ask' keeps the card a compact skeleton ('Waiting on you…') long after the other scenario would have released it, and the stage is not the answer's height tall",
      stopHeld,
    );
    await p.getByRole('button', { name: 'Watch it pass' }).click();
    await p.evaluate(() => document.querySelector('.fd-ac')?.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(8000); // the illustration's playback settles (the pass scenario reveals the card)
    const land = await p.evaluate(CARD_FACTS);
    check(
      !!land && land.verdict === 'Passed every check, though the stress test caught 11 of 12 deliberate breaks. Not checked: whether orders.csv is the complete export.' && land.verdictStyle.size === '16px' && land.verdictStyle.lh === '24px' && !land.verdictStyle.mono && land.verdictStyle.icons === 0 &&
        land.afterFigure?.includes('fd-ac__lead-bar') && land.standaloneNotChecked === 0 && !land.caveat && !/data team/.test(land.verdict),
      "landing: the illustration's card says the same verdict line (its own labelled numbers: caught 11 of 12), in body text under the figure, with no hand-off and so no next step",
      land,
    );
    check(!!land && land.filled.length === 1 && /Lock this answer/.test(land.filled[0]) && !land.version && /Version 4$/.test(land.fig) && /^Confirming only marks a line on this page; nothing is saved, sent or checked\.$/.test(land.confirmNote ?? ''),
      "landing: the illustration's card keeps its one filled control (the lock), adds no version note, and says what Confirm does", land);
    // ── landing labels: "live" is not the example's word, and "Illustrative" is said once per section that holds illustrative figures ──
    const leaves = (sel, re) => p.evaluate(([s, r]) => [...document.querySelectorAll(`${s} *`)].filter((e) => !e.children.length && new RegExp(r, 'i').test(e.textContent ?? '')).map((e) => e.textContent.trim()), [sel, re.source]);
    const stageHead = await p.evaluate(() => document.getElementById('stage-h')?.textContent?.trim());
    const stageSays = await leaves('.fd-stage', /illustrat/);
    const traceSays = await leaves('.fd-trace', /illustrat|slowed|real run/);
    check(
      stageHead === 'Example: top customers by revenue' && stageSays.length === 1 && stageSays[0] === 'Illustrative playback of the example below, slowed down' && traceSays.length === 0,
      "landing: the stage's heading calls it an example (not a live one) and the stage says it is an illustration once, in its caption: the trace's header, footer and timer no longer repeat it",
      { stageHead, stageSays, traceSays },
    );
    await p.locator('.fd-ev-link--block').first().click();
    await p.waitForSelector('.fd-ev-stress', { timeout: 5000 });
    const evSays = await leaves('.fd-ev', /illustrat/);
    landRecorded = await p.evaluate(() => {
      const r = document.querySelector('.fd-ev-rec');
      const tile = r?.closest('.fd-ev-tile');
      const link = r?.querySelector('a');
      return r && tile ? { text: r.innerText.replace(/\s+/g, ' ').trim(), big: tile.querySelector('.fd-ev-big')?.innerText.trim(), href: link?.getAttribute('href'), linkText: link?.innerText.trim(), linkH: Math.round(link?.getBoundingClientRect().height ?? 0), tiles: document.querySelectorAll('.fd-ev-tile').length, tileIndex: [...document.querySelectorAll('.fd-ev-tile')].indexOf(tile), badges: document.querySelectorAll('.fd-ev-badge').length, dashed: getComputedStyle(r).borderTopStyle } : null;
    });
    const evPlace = await p.evaluate(() => {
      const label = document.querySelector('.fd-ev-label');
      const grid = document.querySelector('.fd-ev-grid');
      const strip = document.querySelector('.fd-ev-stress');
      return { badges: document.querySelectorAll('.fd-ev-badge').length, before: !!label && !!grid && !!(label.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING), stripHead: strip?.querySelector('.fd-ev-stress__h')?.innerText.replace(/\s+/g, ' ').trim(), sub: [...document.querySelectorAll('.fd-ev-sub')].map((e) => e.innerText.trim()), link: document.querySelector('.fd-ev-link--block')?.innerText.trim(), body: document.querySelector('.fd-ev')?.innerText ?? '' };
    });
    check(
      evSays.length === 2 && evSays[0] === 'Illustrative · these four figures are not from a recorded run' && evSays[1] === evPlace.stripHead && evPlace.badges === 1 && evPlace.before &&
        evPlace.stripHead === 'In this illustration, the stress test made 12 deliberate breaks in the calculation. Your checks caught 11.' && evPlace.sub[2] === 'deliberate breaks caught by the stress test' && evPlace.link === 'Hide the 12 deliberate breaks' && !/small (breaks|ways)|on purpose|We broke/.test(evPlace.body),
      "landing: the evidence section has ONE 'Illustrative' label, above its four tiles; the stress-test strip it opens says 'illustration' in its own heading (a sentence, not a second badge: the strip can sit a screen below the label); the stress test is called the stress test and its twelve are 'deliberate breaks'",
      { evSays, evPlace },
    );
    check(
      !!landRecorded && landRecorded.big === '11 of 12' && landRecorded.tileIndex === 2 && landRecorded.badges === 1 && landRecorded.dashed === 'solid' && landRecorded.href === '#/zen' && landRecorded.linkText === 'Run it yourself' && landRecorded.linkH >= 44 &&
        landRecorded.text === 'Recorded run: the stress test caught 8 of 12 deliberate breaks. orders.csv, the same question, Version 4. Its first draft was accepted. The "Watch it pass" playback above throws one out, to show what a rejection looks like. Run it yourself',
      "landing: the stress-test tile (11 of 12, under the section's one 'Illustrative' label) carries the recorded run beside it, marked 'Recorded run': the stress test caught 8 of 12 deliberate breaks on orders.csv, the same question, Version 4, its first draft accepted; a solid divider, no second badge, and a 44 px 'Run it yourself' link to #/zen",
      landRecorded,
    );
    // ── typeset (critique step 5), the landing: the hero line and the figure labels are sentence-case lines, the figures are Geist, the labels that stay are short ──
    {
      const t = await p.evaluate(TYPESET_FACTS);
      const tags = await p.evaluate(() => [...document.querySelectorAll('.fd-ld-col__tag')].map((e) => ({ text: e.innerText.trim(), cls: e.className, mono: /mono/i.test(getComputedStyle(e).fontFamily), tt: getComputedStyle(e).textTransform })));
      const hero = t.lines.find((l) => l.text.startsWith('Answers from your spreadsheet exports'));
      const wanted = ['Answers from your spreadsheet exports · checked before you see them', 'Fig. 2 · Same file, three meanings', 'Fig. 3 · One agreement, every version', 'When the rules run out', 'A question only you can answer · Needs you', 'Made-up · table 47 of 100', 'Your agreement × every version · Top 5 customers by revenue'];
      check(
        wanted.every((w) => t.lines.some((l) => l.text.replace(/^\? /, '') === w && !l.mono && l.tt === 'none' && l.ls === 0 && l.size === '14px')) && hero?.text === wanted[0] && !!hero && hero.text !== hero.text.toUpperCase(),
        "typeset, landing: the hero's 67-character line, 'Fig. 2 · Same file, three meanings', 'Fig. 3 · One agreement, every version', 'When the rules run out', the ask card's label, the made-up table's label and the Fig. 3 board's heading (it was capitals typed into a mono title) are sentence-case Geist lines (14 px, no tracking, not capitals)",
        t.lines,
      );
      check(
        tags.length === 3 && tags.every((g) => !g.mono && g.tt === 'none') && tags.map((g) => g.text).join(' | ') === "The AI's first assumption | + One house rule | + Two house rules",
        "typeset, landing: the three ladder column tags are one family, all sentence-case Geist lines (the longest is over the limit, so none is capitals)",
        tags,
      );
      check(
        t.eyebrows.length >= 6 && t.eyebrows.every((e) => e.text.length <= 22 && e.mono && e.tt === 'uppercase') && t.longCaps.length === 0,
        "typeset, landing: what stays mono capitals is 22 characters or fewer (You asked, YOUR AGREEMENT, THE USUAL ORDER, HERE, MADE-UP, HONEST LIMITS); no text over 22 characters is set in capitals or tracked outside the seal",
        { eyebrows: t.eyebrows.map((e) => e.text), longCaps: t.longCaps },
      );
      check(
        figuresOk(t) && t.amounts.n === 4 && t.amounts.level && !!t.ladder && t.ladder.n === 5 && t.ladder.level && t.ladder.litN === 5 && t.ladder.litLevel && !t.ladder.mono && t.places === null,
        "typeset, landing: the illustration's lead and its four amounts, and the ladder's amounts (the first column and the lit one with its bold leader), are Geist tabular figures, level digit by digit (the landing's list keeps its places caption for screen readers only)",
        { lead: t.lead, amounts: t.amounts, ladder: t.ladder },
      );
      const big = await p.evaluate(() => [...document.querySelectorAll('.fd-ev-big')].map((e) => ({ text: e.innerText.trim(), mono: /mono/i.test(getComputedStyle(e).fontFamily), nums: getComputedStyle(e).fontVariantNumeric })));
      check(big.length === 4 && big.every((b) => !b.mono && /tabular-nums/.test(b.nums)) && big.map((b) => b.text).join(' | ') === '6 of 6 | 100 | 11 of 12 | 1', "typeset, landing: the four evidence figures (6 of 6, 100, 11 of 12, 1) are Geist tabular figures, not wide mono words", big);
      check(t.lone.length === 0, 'typeset, landing: no block of text ends on a single word', t.lone);
      check(
        t.noteFigures.length === 2 && t.noteFigures.map((f) => f.text).join(' | ') === '$2,252.07 | $2,260.06' && t.noteFigures.every((f) => !f.mono && /tabular-nums/.test(f.nums) && f.commaAdvance < 0.4 * f.digitAdvance),
        "typeset, landing: the two amounts in the thrown-out note ($2,252.07, $2,260.06) are Geist tabular figures, a comma a third of a digit wide (not '$2 , 252 . 07' in a monospaced face)",
        t.noteFigures,
      );
      check(t.measure.length === 0, 'typeset, landing: the body text of the stage card, the trace note and the cards below holds to the reading measure (75 characters a line at most)', t.measure);
    }
  }

  // ── 3. seeded: the recording of the agreement is bundled, so the page installs it and the answer is Full checks ──
  await openApp(p, srv.url + '#/start');
  check(await bindOrders(), "'#/start' binds the sample orders.csv (as rows)", (await body()).slice(0, 400));

  await chip(Q_TOP).click();
  await p.waitForFunction((q) => [...document.querySelectorAll('[aria-label="Suggested questions"] button')].some((b) => b.textContent.includes(q) && b.getAttribute('aria-pressed') === 'true'), Q_TOP, { timeout: 15000 });
  await p.waitForFunction(() => { const b = document.getElementById('fd-ask-btn'); return !!b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 30000 });
  const chips = await texts('[aria-label="Suggested questions"] button');
  const pre = await fnState();
  const preText = norm(await body());
  check(
    chips.some((c) => c === `${Q_TOP} Full checks`) &&
      preText.includes('Full checks: this demo file comes with 6 examples, 1 locked answer and 2 house rules for this question.') &&
      preText.includes('6 examples · 1 locked answer · 2 house rules') &&
      pre.has && pre.examples === 6 && pre.houseRules === 2 && pre.pins.length === 1 && pre.pins[0].id === 'seeded-locked-top5',
    "seeded: the question is tagged 'Full checks' and the agreement (6 examples · 1 locked answer · 2 house rules) is installed in the engine before asking",
    { chips, pre: { examples: pre.examples, houseRules: pre.houseRules, pins: pre.pins }, text: preText.slice(0, 500) },
  );

  // the question with a recorded answer comes first, the two that need your computer after it carry that very phrase as their tag, and one line says why
  // (it does not begin by repeating the tag): how many questions have a recording, counted, and that the others need the version on your computer
  const legend = await texts('.fd-ask__legend');
  check(
    chips.length === 3 && chips[0].startsWith(`${Q_TOP} `) && !chips[0].includes(NEEDS_TAG) && chips.slice(1).every((c) => c === `${Q_STATUS} ${NEEDS_TAG}` || c === `${Q_COUNTRY} ${NEEDS_TAG}`) &&
      legend.length === 1 && legend[0].startsWith('This demo has recorded answers for one question; the others need the version on your computer.') && !legend[0].startsWith(NEEDS_TAG) && !/needs live/i.test(`${chips.join(' ')} ${legend[0]}`),
    "seeded: the question that has a recorded answer comes first, the two that need your computer are tagged 'needs your computer' alone (no 'Basic checks' claim, no 'live'), and one line says why without repeating the tag",
    { chips, legend },
  );
  // one wording for one question: the chip, the 'Asking:' line and the trace header read the same words (the chip was 'Top 5 customers by revenue', the line 'Who are our top customers by revenue?')
  const wording = await p.evaluate(() => ({
    chip: [...document.querySelectorAll('[aria-label="Suggested questions"] button[aria-pressed="true"]')].map((b) => b.childNodes[0]?.textContent?.trim() ?? ''),
    asking: document.querySelector('.fd-ask__picked-q')?.innerText.trim(),
    trace: document.querySelector('.fd-trace__hl-a')?.innerText.replace(/\s+/g, ' ').trim(),
  }));
  check(wording.chip.length === 1 && wording.chip[0] === Q_TOP && wording.asking === Q_TOP && !!wording.trace && wording.trace.includes(`· ${Q_TOP} ·`), "full view: the chip, the 'Asking:' line and the trace header say the question in the same words", wording);

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
  check(shown && lead === `${LEAD[0]} | ${money(LEAD[1])}` && !consoleErrors.length, "the top-customers question → Ask: Chef Ravioli Starbright $2,252.07 first", { shown, lead, errors: consoleErrors });
  // the seal arrives with the answer, after the stress test: its count is the engine's own mutation report (killed + killedByBound of total)
  const report = await state(() => {
    const m = window.__undefined.state.value.program.functions.topCustomersByRevenue?.artifact?.evidence?.mutation;
    return m ? { total: m.total, caught: m.killed + m.killedByBound, missed: m.survived } : null;
  });
  const sealWords = report ? `Passed every check · stress test caught ${report.caught} of ${report.total}` : null;
  // the landing's "Recorded run" line is not a number typed twice: it is what this real replay of the recording reports
  check(
    !!report && !!landRecorded && landRecorded.text.startsWith(`Recorded run: the stress test caught ${report.caught} of ${report.total} deliberate ${report.total === 1 ? 'break' : 'breaks'}.`),
    "the landing's 'Recorded run' line says what this real replay of the recording reports: the engine's own stress-test count (caught N of M), read from Artifact.evidence.mutation",
    { report, landRecorded },
  );
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
  check(lockText.length === 1 && lockText[0] === 'Locked' && !/Lock this answer/.test(card) && lockHelp[0] === "This demo can't write a later version; on your computer every later version has to give this same list." && post.pins.length === 1, "seeded: the answer is already locked ('Locked', no 'Lock this answer' offered, one locked answer in the spec)", { lockText, lockHelp, pins: post.pins });

  // 3g. the answer card, seeded, Full view: one verdict line under the figure, one filled control, the lock and the version explained, Confirm honest
  {
    const f = await p.evaluate(CARD_FACTS);
    const rev = await state(() => {
      const s = window.__undefined.state.value;
      const v = s.program.functions.topCustomersByRevenue?.artifact?.revision;
      return { version: v, before: s.revisions.filter((r) => r.id < v).map((r) => r.kind) };
    });
    check(
      !!report && !!f && f.verdict === verdictFor(report, `${MAIN_NOT_CHECKED}, so ${NEXT}`) && f.verdictStyle.size === '16px' && f.verdictStyle.lh === '24px' && !f.verdictStyle.mono && f.verdictStyle.icons === 0 && f.verdictStyle.color === 'rgb(11, 13, 18)' &&
        f.afterFigure?.includes('fd-ac__lead-num') && f.standaloneNotChecked === 0 && !f.caveat,
      "seeded: directly under the figure, in 16px body text (ink, not mono, no icon), one verdict line: the seal's own words with the engine's stress-test count, the one thing most worth knowing was not checked, the hand-off as the next step; the old standalone 'Not checked:' line is gone",
      { f, report },
    );
    check(
      !!f && f.filled.length === 1 && f.filled[0] === 'Hand this to your data team (download)' && f.firstAction === 'Hand this to your data team (download)' && f.lockText === 'Locked' && f.lockBg === 'rgb(255, 255, 255)' && f.actionHeights.every((h) => h >= 44) &&
        /^Downloads a zip: topCustomersByRevenue\.ts, topCustomersByRevenue\.test\.ts/.test(f.handoffTitle ?? '') && f.handoffStatus === 'status' && !f.sideways,
      "seeded: the hand-off is the card's one filled control and the first of its action row (keeping its title and its status line); 'Locked' is a quiet secondary control (white, a ring), every control at least 44 px tall",
      f,
    );
    const kindsOk = rev.before.length === rev.version - 1 && rev.before.every((k) => ['init', 'dataset', 'spec-edit'].includes(k)) && rev.before.includes('spec-edit');
    check(
      kindsOk && f?.version === `Versions 1 to ${rev.version - 1} were the starting point, the file${rev.before.filter((k) => k === 'dataset').length > 1 ? 's' : ''} and the demo's agreement; this is the first answer.` && f.fig.endsWith(`Version ${rev.version}`) &&
        f.lockNote === 'This lock comes with the demo file.' && f.lockInfo === "This lock comes with the demo file. This demo can't write a later version; on your computer every later version has to give this same list.",
      "seeded: the pre-set lock says where it came from, and 'Version 4' is explained from the engine's own saved steps (the starting point, the file, the demo's agreement came first) in the card",
      { f, rev },
    );
    check(f?.confirmNote === 'Confirming only marks a line on this page; nothing is saved, sent or checked.', "seeded: 'What the AI assumed' says once what Confirm does", f?.confirmNote);
    // what Confirm really does: marks the line on this page; the engine, the program and the network are untouched
    const before = await state(() => ({ head: window.__undefined.state.value.headRevision, revs: window.__undefined.state.value.revisions.length, repl: window.__undefined.state.value.repl.length }));
    const reqs = [];
    const onReq = (r) => reqs.push(r.url());
    p.on('request', onReq);
    await p.locator('.fd-ac__confirm').first().click();
    await p.waitForTimeout(600);
    p.off('request', onReq);
    const afterC = await state(() => ({ head: window.__undefined.state.value.headRevision, revs: window.__undefined.state.value.revisions.length, repl: window.__undefined.state.value.repl.length, confirmed: document.querySelector('.fd-ac__confirmed')?.innerText.trim() }));
    check(afterC.confirmed === 'Confirmed by you' && afterC.head === before.head && afterC.revs === before.revs && afterC.repl === before.repl && reqs.length === 0, "seeded: Confirm marks the line 'Confirmed by you' on the page and nothing else: no new saved step in the engine, nothing in the transcript, no request leaves the page", { before, afterC, reqs });
    // the full view's live sentence names the answer, once
    const said = await p.evaluate(() => [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
    check(said.filter((t) => t.includes(LEAD[0])).length === 1 && said.some((t) => t === `${sealWords}. Showing the answer: ${LEAD[0]}, ${money(LEAD[1])}.`), "seeded: the Full view's live sentence says the verdict and the answer once ('… Showing the answer: Chef Ravioli Starbright, $2,252.07.'), and no other live region repeats the name", said);
    // the hand-off still works from its new place, and says so in its status line
    const dl = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await p.getByRole('button', { name: 'Hand this to your data team (download)' }).click();
    const file = await dl;
    const msg = await waitFor(() => /^Downloaded .+\.zip: topCustomersByRevenue\.ts, its checks, provenance\.json and a README\.$/.test(document.querySelector('.fd-run__handoff-msg')?.innerText ?? ''), null, 30000);
    check(!!file && /\.zip$/.test(file.suggestedFilename()) && msg, "seeded: the hand-off in the card's action row downloads the zip and says so in its status line", { name: file?.suggestedFilename(), msg });
    // ── 3h. typeset (critique step 5): the figures, the places label, the labels, the long lines and the last lines on the Full view's answered page ──
    {
      const t = await p.evaluate(TYPESET_FACTS);
      check(
        figuresOk(t) && t.lead.text === money(LEAD[1]) && t.amounts.n === 4 && t.amounts.level && !t.sideways,
        "typeset, full view: the lead amount is set in Geist with tabular figures (no monospaced face, a comma a third of a digit wide, no gap after it: not '$2 , 252 . 07'), and the four amounts under it are level digit by digit",
        t,
      );
      check(
        !!t.places && t.places.text === 'Places 2 to 5' && t.places.label === t.places.text && t.places.hidden === 'true' && t.places.first === '02' && t.places.last === '05' && t.places.beforeList && !t.places.mono && t.places.tt === 'none' && t.places.ls === 0 && t.places.size === '14px',
        "typeset, full view: the ranked list starts under one visible plain label, 'Places 2 to 5' (worked out from its own rows, '02' to '05'), sentence case in Geist, and the list's accessible name is the same words",
        t.places,
      );
      const wanted = ['Start here · bring a file, ask in plain words', 'What the AI will see'];
      check(
        wanted.every((w) => t.lines.some((l) => l.text === w && !l.mono && l.tt === 'none' && l.ls === 0 && l.size === '14px')) &&
          t.eyebrows.length >= 1 && t.eyebrows.every((e) => e.text.length <= 22 && e.mono && e.tt === 'uppercase') && t.eyebrows.some((e) => e.text.toUpperCase() === 'YOUR AGREEMENT') && t.longCaps.length === 0,
        "typeset, full view: the short noun labels (YOUR AGREEMENT) stay mono capitals, 22 characters or fewer; the longer ones ('Start here · bring a file, ask in plain words', 'What the AI will see') are sentence-case Geist lines with no tracking; no text over 22 characters is set in capitals or tracked outside the seal",
        { lines: t.lines, eyebrows: t.eyebrows, longCaps: t.longCaps },
      );
      check(t.lone.length === 0, 'typeset, full view: no block of text ends on a single word', t.lone);
      check(t.measure.length === 0, 'typeset, full view: the rails\' footers, the privacy note and the assumptions hold to the reading measure (75 characters a line at most)', t.measure);
    }
  }

  // the sixth check, the stress test, finishes on its own; the lane reports what the engine counted
  const stressed = await waitFor(() => { const m = window.__undefined.state.value.mutation; return !!m && m.fn === 'topCustomersByRevenue' && m.phase === 'done' && m.total > 0; }, null, 60000);
  const mut = (await fnState()).mutation;
  check(stressed && (await waitText(new RegExp(`Stress test: ${mut?.total} deliberate breaks`), 15000)), 'seeded: the stress test finishes and the sixth check is labelled with what the engine counted (deliberate breaks)', mut);
  // one wording for the stress test: the lane, the ledger line and the seal say "deliberate breaks" / "stress test", never "small ways on purpose" or "N-way"
  const stressSaid = await p.evaluate(() => ({
    lane: [...document.querySelectorAll('.fd-lane__label > span:last-child')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).find((t) => /stress test/i.test(t)),
    ledger: [...document.querySelectorAll('.fd-ac__checked li > span')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).find((t) => /stress test/i.test(t)),
    foot: document.querySelector('.fd-trace__foot-text')?.innerText.replace(/\s+/g, ' ').trim(),
    body: document.body.innerText,
  }));
  const ledgerNums = /^stress test \(caught (\d+) of (\d+) deliberate breaks\)$/.exec(stressSaid.ledger ?? '');
  check(
    stressSaid.lane === `Stress test: ${mut?.total} deliberate breaks` && !!ledgerNums && Number(ledgerNums[2]) === mut?.total && (stressSaid.foot ?? '').includes(`stress test (caught ${ledgerNums[1]} of ${ledgerNums[2]}) ·`) && !/small (breaks|ways)|on purpose|\d+-way|we broke it/i.test(stressSaid.body),
    "full view: the stress test is called the stress test and what it does is 'deliberate breaks' in the lane label, the 'Checked against' line and everywhere else on the page",
    { lane: stressSaid.lane, ledger: stressSaid.ledger, foot: stressSaid.foot },
  );

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
  {
    const mine = await p.evaluate(CARD_FACTS);
    check(!!mine && mine.lockText === 'Locked' && mine.lockNote === null && !/demo file/.test(mine.lockInfo ?? '') && /^Locked, and kept with this answer\. This demo can't write a later version/.test(mine.lockInfo ?? ''), "seeded: a lock the viewer made says nothing about the demo file (the note about where the lock came from is only for the one that came with it) and keeps the whole help sentence", mine);
  }
  await ask(null);
  const cachedAfterLock = await waitText(/Already checked in this session\./, 30000);
  check(cachedAfterLock, 'seeded: ask again after locking shows the cached line', (await body()).slice(0, 600));

  await unrecorded('seeded');
  check(consoleErrors.length === 0, "seeded: '#/start' logs no console errors (besides the replay /generate/health 404)", consoleErrors);

  // ── 3a. the Full view says what the demo cannot do with a file of your own before one is dropped, and keeps the samples in sight after ──
  try {
    await p.getByRole('button', { name: 'Change' }).click(); // the sample is bound on arrival: its picker is folded behind the chip
    await waitFor(() => document.querySelector('.fd-bring__caveat')?.getBoundingClientRect().height > 0, null, 10000);
    const pre = await p.evaluate(() => {
      const c = document.querySelector('.fd-bring__caveat');
      const zone = document.querySelector('.fd-bring__zone');
      return { text: c?.innerText.replace(/\s+/g, ' ').trim(), visible: !!c && c.getBoundingClientRect().height > 0, afterZone: !!zone && !!c && !!(zone.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING), notes: document.querySelectorAll('.fd-bring__note').length };
    });
    check(OWN_CAVEAT.test(pre.text ?? '') && pre.visible && pre.afterZone && pre.notes === 0, "full view: opening the picker (sample bound) shows the one demo caveat under the drop zone, before anything is dropped, and no own-file note", pre);
    await p.locator('input[type=file]').setInputFiles({ name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from(OWN_CSV) });
    await waitFor(() => document.querySelector('.fd-bring__bound-text')?.innerText.startsWith('mine.csv'), null, 20000);
    const kept = await p.evaluate(() => {
      const samples = [...document.querySelectorAll('.fd-bring__sample')];
      const picker = document.querySelector('.fd-bring__picker');
      const ch = document.querySelector('.fd-bring__change');
      return {
        picker: picker ? getComputedStyle(picker).display : null,
        samples: samples.map((b) => b.querySelector('.fd-bring__sample-name')?.innerText.trim()),
        visible: samples.every((b) => b.getBoundingClientRect().height > 0),
        note: document.querySelector('.fd-bring__note:not(.fd-bring__note--paste)')?.innerText.replace(/\s+/g, ' ').trim(),
        caveat: document.querySelector('.fd-bring__caveat')?.innerText.replace(/\s+/g, ' ').trim(),
        change: `${ch?.innerText.trim()}/${ch?.getAttribute('aria-expanded')}`,
      };
    });
    check(kept.picker === 'flex' && kept.samples.join() === 'orders.csv,sales-q3.csv' && kept.visible && kept.note === 'Your file stays in this browser. To see the checks run, try orders.csv.' && OWN_CAVEAT.test(kept.caveat ?? '') && kept.change === 'Change/true', "full view: your own file bound in the demo keeps the picker open (the sample files stay in sight) with the trimmed note, the caveat stays, and the chip's button reads 'Change'", kept);
    await p.getByRole('radio', { name: /orders\.csv/ }).click();
    await waitFor(() => document.querySelector('.fd-bring__bound-text')?.innerText.startsWith('orders.csv') && getComputedStyle(document.querySelector('.fd-bring__picker')).display === 'none', null, 20000);
    check(await waitFor(() => document.activeElement?.className.includes('fd-bring__change'), null, 5000), "full view: picking a sample folds the picker again and focus lands on 'Change' (the Full view is as it was)", await p.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
    // your own file again: the Ask card's sentence is not a dead end either: it names orders.csv and the question it has a recording for, and the button switches to it
    await p.getByRole('button', { name: 'Change' }).click();
    await p.locator('input[type=file]').setInputFiles({ name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from(OWN_CSV) });
    await waitFor(() => document.querySelector('.fd-bring__bound-text')?.innerText.startsWith('mine.csv') && !!document.querySelector('.fd-ask__level button'), null, 30000);
    const own = await p.evaluate(() => {
      const level = document.querySelector('.fd-ask__level');
      return { text: level?.innerText.replace(/\s+/g, ' ').trim(), button: level?.querySelector('button')?.innerText.trim(), tags: [...document.querySelectorAll('.fd-ask__live')].map((e) => e.innerText.trim()), legend: document.querySelector('.fd-ask__legend')?.innerText.replace(/\s+/g, ' ').trim() ?? '' };
    });
    check(
      own.button === 'switch to orders.csv' && own.text === `In this demo, answers are recorded, so questions about your own file need the version on your computer. ${'“'}${Q_TOP}${'”'} has a recorded answer on one sample file: switch to orders.csv.` && !/Try a sample file/.test(own.text) &&
        own.tags.length >= 1 && own.tags.every((t) => t === NEEDS_TAG) && /^This demo has no recorded answers for these questions; they need the version on your computer\./.test(own.legend),
      "full view (own file): the Ask card's sentence names orders.csv and the question it has a recorded answer for, with a real 'switch to orders.csv' button, and the chips say 'needs your computer'",
      own,
    );
    await p.locator('.fd-ask__level button').click();
    await waitFor(() => document.querySelector('.fd-bring__bound-text')?.innerText.startsWith('orders.csv') && document.activeElement?.id === 'fd-ask-btn', null, 20000);
    const sw = await p.evaluate(() => ({ asking: document.querySelector('.fd-ask__picked-q')?.innerText.trim(), level: document.querySelector('.fd-ask__level')?.innerText.replace(/\s+/g, ' ').trim(), active: document.activeElement?.id, off: document.getElementById('fd-ask-btn')?.getAttribute('aria-disabled') }));
    check(sw.asking === Q_TOP && /^Full checks: this demo file comes with 6 examples/.test(sw.level ?? '') && sw.active === 'fd-ask-btn' && sw.off !== 'true', "full view (own file): 'switch to orders.csv' binds the sample, selects the question the sentence named (Full checks) and puts focus on Ask", sw);
    // pressing Ask on a file of your own: the no-recording card offers the way out ONCE, as the button inside its sentence (it also had a
    // second "Switch to orders.csv" button under it, and the answer's veil said the whole sentence a third time)
    await p.getByRole('button', { name: 'Change' }).click();
    await p.locator('input[type=file]').setInputFiles({ name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from(OWN_CSV) });
    await waitFor(() => document.querySelector('.fd-bring__bound-text')?.innerText.startsWith('mine.csv') && document.getElementById('fd-ask-btn')?.getAttribute('aria-disabled') !== 'true', null, 30000);
    await p.locator('#fd-ask-btn').click();
    const noRec = await waitText(/No recorded answer for this one\./, 30000);
    const dead = await p.evaluate(() => {
      const card = document.querySelector('.fd-rs--no');
      return {
        buttons: [...(card?.querySelectorAll('button, [role=button]') ?? [])].map((b) => b.innerText.trim()),
        links: [...(card?.querySelectorAll('a') ?? [])].map((a) => a.innerText.trim()),
        said: (document.body.innerText.match(/switch to orders\.csv/gi) ?? []).length,
        veil: document.querySelector('.fd-ac__veil-caption')?.innerText.trim(),
        sentence: card?.querySelector('p')?.innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    check(
      noRec && dead.buttons.length === 1 && dead.buttons[0] === 'switch to orders.csv' && dead.said === 1 && dead.links.join() === 'How to run it on your computer' &&
        dead.veil === 'Nothing was checked, so no answer is shown.' && /has a recorded answer on one sample file: switch to orders\.csv\.$/.test(dead.sentence ?? ''),
      "full view (own file) → Ask: the no-recording card offers the way out once (one button, inside the sentence, no second 'Switch to orders.csv' button, the veil does not say the sentence again) and links to how to run it on your computer",
      dead,
    );
    // the same card with the rails stacked (768 wide): the agreement rail's empty state and its footer, and the privacy rail, hold to the reading measure
    {
      const was = p.viewportSize();
      await p.setViewportSize({ width: 768, height: 900 });
      await p.waitForTimeout(500);
      const t = await p.evaluate(TYPESET_FACTS);
      check(t.measure.length === 0 && t.lone.length === 0 && !t.sideways, "typeset, full view (own file, 768 wide): the empty agreement's words, its footer and the privacy rail hold to the reading measure (75 characters a line at most), and no block of text ends on a single word", { measure: t.measure, lone: t.lone, sideways: t.sideways });
      await p.setViewportSize(was ?? { width: 1440, height: 900 });
      await p.waitForTimeout(300);
    }
    await p.locator('.fd-rs--no button').click();
    await waitFor(() => document.querySelector('.fd-bring__bound-text')?.innerText.startsWith('orders.csv') && document.activeElement?.id === 'fd-ask-btn', null, 20000);
  } catch (e) {
    check(false, "full view: the own-file path ran without throwing", String(e));
  }

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
    // ── the own-file path: the demo says what it cannot do BEFORE a file of your own is dropped, and keeps the samples in sight after ──
    const pane1 = await p.evaluate(() => {
      const zone = document.querySelector('.zd__zone');
      const c = document.querySelector('.zd__caveat');
      return { text: c?.innerText.replace(/\s+/g, ' ').trim(), visible: !!c && c.getBoundingClientRect().height > 0, afterZone: !!zone && !!c && !!(zone.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING), picker: !!document.getElementById('zd-picker'), noteText: document.querySelector('.zd__note')?.innerText ?? null, btn: document.getElementById('zen-continue').className };
    });
    check(OWN_CAVEAT.test(pane1.text ?? '') && pane1.visible && pane1.afterZone && pane1.picker && pane1.noteText === null && /fd-btn--primary/.test(pane1.btn), "step by step 1: with nothing bound the picker shows the one demo caveat under the drop zone, before anything is dropped (the same words as the Full view), and no own-file note yet", pane1);
    await p.getByRole('button', { name: 'Paste data' }).click();
    await p.locator('#zen-paste').fill(OWN_CSV);
    await p.getByRole('button', { name: 'Use this data' }).click();
    check(await waitFor(() => !!document.querySelector('.zd__chip') && document.activeElement?.id === 'zen-continue', null, 20000), 'step by step 1: an own CSV pasted into pane 1 binds, and focus goes to the forward button', await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
    const own = await p.evaluate(() => {
      const el = (x) => document.querySelector(x);
      const samples = [...document.querySelectorAll('.zd__sample')];
      const note = el('.zd__own');
      const smp = el('.zd__samples');
      const btn = el('#zen-continue');
      const ch = el('.zd__change');
      const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        picker: !!el('#zd-picker'),
        samples: samples.map((b) => b.innerText.trim()),
        visible: samples.every((b) => b.getBoundingClientRect().height > 0),
        note: note?.innerText.replace(/\s+/g, ' ').trim(),
        live: note?.getAttribute('role'),
        directlyAboveSamples: !!note && note.nextElementSibling === smp,
        beforeStatusAndProblem: !!note && before(note, el('.zd__status')),
        caveat: el('.zd__caveat')?.innerText.replace(/\s+/g, ' ').trim(),
        change: `${ch?.innerText.trim()}/${ch?.getAttribute('aria-expanded')}`,
        label: btn.innerText.trim(),
        secondary: btn.classList.contains('fd-btn--secondary'),
        primary: btn.classList.contains('fd-btn--primary'),
        disabled: btn.getAttribute('aria-disabled'),
        said: [...document.querySelectorAll('.zd .fd-sr[role=status]')].map((e) => e.textContent).join(),
      };
    });
    check(own.picker && own.samples.join() === 'orders.csv,sales-q3.csv' && own.visible && OWN_CAVEAT.test(own.caveat ?? '') && own.change === 'Change/true', "step by step 1: your own file bound in the demo keeps the picker open: the sample files stay in sight and 'Change' reads 'Change'", own);
    check(own.note === 'Read in this browser. To see the checks run, try orders.csv.' && own.live === 'status' && own.directlyAboveSamples && own.beforeStatusAndProblem, "step by step 1: the own-file note (the pasted rows' wording: 'Read in this browser') is a status region directly above the samples (not after the status and problem lines), names orders.csv and does not repeat the caveat", own);
    check(own.label === "See what's in your file" && own.secondary && !own.primary && own.disabled === null && /is loaded\.$/.test(own.said), "step by step 1: the forward button reads \"See what's in your file\" (secondary, still enabled), and a screen reader hears that the file is loaded", own);
    await cont.click();
    check(await h1Is('Ask a question') && (await hashNow()) === '#/zen/2', "step by step: 'See what's in your file' opens pane 2 at '#/zen/2'", { h1: await p.evaluate(() => document.querySelector('h1')?.innerText), hash: await hashNow() });
    await waitFor(() => !!document.querySelector('.fd-rl'), null, 30000);
    await waitFor(() => document.activeElement?.id === 'zen-title', null, 5000); // the new pane has spoken its heading; now the checks below may move focus
    const q2 = await p.evaluate(() => {
      const el = (x) => document.querySelector(x);
      const note = el('.zp__colnote');
      const before = (a, b) => !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        count: document.querySelectorAll('.zp__colnote').length,
        said: (document.body.innerText.match(/Read as text, so questions about/g) ?? []).length,
        text: note?.innerText.replace(/\s+/g, ' ').trim(),
        beforeChips: before(note, el('.zp__chips')),
        // an own file's pane 2 shows the dead-end sentence (#zen-why), which says what the legend would: no legend beside it
        legend: !!el('.zp__legend'),
        beforeWhy: before(note, el('#zen-why')),
        beforeNav: before(note, el('.zen__nav')),
        navBeforeTable: before(el('.zen__nav'), el('.zp__data')),
        underTable: !!el('.zt__note'),
      };
    });
    check(q2.count === 1 && q2.said === 1 && /^Read as text, so questions about totals or dates can't use them as they are: Net Amt \(USD\), Tax %, Shipped\./.test(q2.text ?? '') && q2.beforeChips && !q2.legend && q2.beforeWhy && q2.beforeNav && q2.navBeforeTable && !q2.underTable, "step by step 2: the note about columns read as text is said once, above the suggestions, the dead-end sentence (no legend beside it) and the buttons (before the nav in the page), and the table under the nav does not repeat it", q2);
    const dead = await p.evaluate(() => {
      const why = document.getElementById('zen-why');
      const d = document.querySelector('.fd-rl__d');
      const c = document.getElementById('zen-continue');
      return { why: why.innerText.replace(/\s+/g, ' ').trim(), role: why.getAttribute('role'), stepsInWhy: !!why.querySelector('.fd-rl'), hand: document.querySelector('.fd-rl__hand')?.innerText, open: d?.open, summary: document.querySelector('.fd-rl__sum')?.innerText.trim(), by: c.getAttribute('aria-describedby'), off: c.getAttribute('aria-disabled'), plainLink: !!why.querySelector('a'), cmdsShown: !!document.querySelector('.fd-rl__cmds')?.getBoundingClientRect().height };
    });
    dead.widow = await p.evaluate(LAST_LINE_WORDS, '.fd-rl__hand');
    check(/^In this demo, answers are recorded, so questions about your own file need the version on your computer\./.test(dead.why) && dead.role === 'status' && !dead.stepsInWhy && !dead.plainLink && dead.hand === 'If this is not your world, send this page to someone on your data team.' && dead.open === true && dead.summary === 'How to run it on your computer' && dead.by === 'zen-why' && dead.off === 'true' && dead.cmdsShown && dead.widow?.lastLine >= 2, "step by step 2: the dead end says why in its status region, then one plain sentence for someone who does not run commands (no one-word last line), then the steps OPEN under 'How to run it on your computer' (the three commands are on screen without a click); Continue stays off and described by the reason", dead);
    await p.locator('.fd-rl__sum').focus();
    await p.keyboard.press('Enter');
    check(await waitFor(() => document.querySelector('.fd-rl__d')?.open === false, null, 3000), "step by step 2: the disclosure folds from the keyboard (Enter on the real <summary>)", await p.evaluate(() => document.querySelector('.fd-rl__d')?.open));
    // a fold the viewer made survives the message being redrawn: typing a question and pressing Enter selects it, and the dead end unmounts its steps
    // while the answer on file is looked up (state kept in the component would come back open, the default)
    await p.locator('#zen-question').fill('how many customers are there');
    await p.keyboard.press('Enter');
    await waitFor(() => document.querySelector('.zp__picked')?.innerText.includes('how many customers are there'), null, 15000);
    await p.waitForTimeout(600);
    check(await p.evaluate(() => document.querySelector('.fd-rl__d')?.open === false && !!document.querySelector('.fd-rl__sum')), "step by step 2: a disclosure the viewer folded stays folded after they type a question and press Enter", await p.evaluate(() => ({ open: document.querySelector('.fd-rl__d')?.open, picked: document.querySelector('.zp__picked')?.innerText })));
    await p.locator('.fd-rl__sum').focus();
    await p.keyboard.press('Enter');
    check(await waitFor(() => document.querySelector('.fd-rl__d')?.open === true, null, 3000), "step by step 2: the disclosure opens again from the keyboard", await p.evaluate(() => document.querySelector('.fd-rl__d')?.open));
    await p.locator('#zen-question').fill('how many orders were refunded');
    await p.keyboard.press('Enter');
    await waitFor(() => document.querySelector('.zp__picked')?.innerText.includes('how many orders were refunded'), null, 15000);
    await p.waitForTimeout(600);
    check(await p.evaluate(() => document.querySelector('.fd-rl__d')?.open === true), "step by step 2: a disclosure the viewer left open stays open after they type a question and press Enter", await p.evaluate(() => document.querySelector('.fd-rl__d')?.open));
    for (let i = 0; i < 4 && (await p.locator('.zp__remove').count()) > 0; i++) {
      await p.locator('.zp__remove').first().click(); // the two questions typed above go again: the walk below starts from the suggestions
      await p.waitForTimeout(250);
    }
    const stepsNow = () => p.evaluate(() => {
      const cmds = document.querySelector('.fd-rl__cmds');
      const link = document.querySelector('.fd-rl__readme');
      return {
        needs: [...document.querySelectorAll('.fd-rl__list li')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
        cmds: cmds?.textContent.split('\n'),
        mono: cmds && getComputedStyle(cmds).fontFamily.includes('Geist Mono'),
        wraps: cmds && getComputedStyle(cmds).whiteSpace,
        cmdsScrolls: cmds ? cmds.scrollWidth > cmds.clientWidth : null,
        opens: document.querySelector('.fd-rl__opens')?.innerText.replace(/\s+/g, ' ').trim(),
        link: link && { href: link.getAttribute('href'), target: link.target, rel: link.rel, text: link.firstChild?.textContent },
        pageScrolls: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const at1440 = await stepsNow();
    check(at1440.needs.join(' | ') === 'Node ^20.19 or >=22.12 | Codex CLI 0.157 or later (npm i -g @openai/codex), signed in with codex login | No API keys, and no other account' && at1440.cmds.join('|') === RUN_COMMANDS.join('|') && at1440.mono && at1440.opens === 'It opens at http://localhost:5173/#/zen' && at1440.link?.href === 'https://github.com/scasella/undefined#run-it-on-your-computer' && at1440.link?.target === '_blank' && /noopener/.test(at1440.link?.rel) && at1440.link?.text === 'Full steps in the README' && !at1440.pageScrolls, "step by step 2: the steps list what you need, the three commands exactly (set in the mono face), where it opens and the README link, with no horizontal scroll at 1440", at1440);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(300);
    const at390 = await stepsNow();
    check(!at390.pageScrolls && at390.cmdsScrolls === false && at390.wraps === 'pre-wrap' && at390.cmds.join('|') === RUN_COMMANDS.join('|'), "step by step 2: at 390 px the commands wrap (pre-wrap, no scroll region needed), the page does not scroll sideways, and the commands still read exactly as the README's", at390);
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.getByRole('button', { name: 'Back' }).click();
    check(await h1Is('Bring your data', 10000) && (await waitFor(() => !!document.querySelector('.zd__sample') && !!document.getElementById('zd-picker'), null, 5000)), "step by step: Back to pane 1 with your own file still bound shows the picker open, with the samples in sight", await hashNow());
    await waitFor(() => document.activeElement?.id === 'zen-title', null, 5000); // the new pane has spoken its heading; the next step may move focus
    await p.getByRole('button', { name: 'orders.csv', exact: true }).focus();
    await p.keyboard.press('Enter');
    check(await bindOrders(), 'step by step 1: a sample binds orders.csv (as rows)', (await body()).slice(0, 300));
    check(await waitFor(() => document.activeElement?.id === 'zen-continue', null, 10000), 'step by step 1: choosing a sample leaves focus on Continue, not <body>', await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
    const samplePath = await p.evaluate(() => {
      const btn = document.getElementById('zen-continue');
      return { label: btn.innerText.trim(), primary: btn.classList.contains('fd-btn--primary'), secondary: btn.classList.contains('fd-btn--secondary'), picker: !!document.getElementById('zd-picker'), caveat: !!document.querySelector('.zd__caveat'), own: !!document.querySelector('.zd__own'), chip: document.querySelector('.zd__chip-text')?.innerText };
    });
    check(samplePath.label === 'Continue' && samplePath.primary && !samplePath.secondary && !samplePath.picker && !samplePath.caveat && !samplePath.own && /^orders\.csv/.test(samplePath.chip), "step by step 1: the sample path is unchanged: with a sample bound Continue is primary, the picker is folded behind the chip, and nothing new is on the pane", samplePath);
    await p.getByRole('button', { name: 'Change' }).click();
    const openSample = await p.evaluate(() => ({ caveat: document.querySelector('.zd__caveat')?.innerText.replace(/\s+/g, ' ').trim(), own: document.querySelector('.zd__own')?.innerText ?? null, change: document.querySelector('.zd__change').innerText.trim() }));
    check(OWN_CAVEAT.test(openSample.caveat ?? '') && openSample.own === '' && openSample.change === 'Close', "step by step 1: with a sample bound, opening the picker shows only the caveat (no own-file note) and the chip's button reads 'Close'", openSample);
    await p.getByRole('button', { name: 'Close' }).click();
    check(await waitFor(() => !document.getElementById('zd-picker'), null, 3000), "step by step 1: 'Close' folds the picker again (a sample is bound)", await p.evaluate(() => !!document.getElementById('zd-picker')));
    // a refusal holds the picker open in the demo (the Full view's rule), and "Change" then moves in instead of closing; a good pick clears it again
    await p.getByRole('button', { name: 'Change' }).click();
    await p.locator('input[type=file]').setInputFiles({ name: 'fake.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK') });
    await waitFor(() => !!document.querySelector('.zd__problem'), null, 10000);
    const refusedDemo = await p.evaluate(() => ({ problem: document.querySelector('.zd__problem')?.innerText, change: document.querySelector('.zd__change').innerText.trim(), expanded: document.querySelector('.zd__change').getAttribute('aria-expanded'), picker: !!document.getElementById('zd-picker') }));
    await p.locator('.zd__change').click();
    const movedIn = await p.evaluate(() => ({ picker: !!document.getElementById('zd-picker'), inside: !!document.getElementById('zd-picker')?.contains(document.activeElement) }));
    check(/fake\.xlsx/.test(refusedDemo.problem ?? '') && refusedDemo.change === 'Change' && refusedDemo.expanded === 'true' && refusedDemo.picker && movedIn.picker && movedIn.inside, "step by step 1 (demo): a refusal holds the picker open: the chip's button reads 'Change' (aria-expanded true) and pressing it moves focus into the picker instead of closing it", { refusedDemo, movedIn });
    await p.getByRole('button', { name: 'orders.csv', exact: true }).click();
    check(await waitFor(() => !document.getElementById('zd-picker') && !document.querySelector('.zd__problem'), null, 10000), "step by step 1 (demo): picking a sample clears the refusal and folds the picker again", await p.evaluate(() => ({ picker: !!document.getElementById('zd-picker'), problem: document.querySelector('.zd__problem')?.innerText })));
    await waitFor(() => document.activeElement?.id === 'zen-continue', null, 5000);
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
    check(c0.length === 3 && c0[0].startsWith(`${Q_TOP} `) && c0.slice(1).every((c) => c === `${Q_STATUS} ${NEEDS_TAG}` || c === `${Q_COUNTRY} ${NEEDS_TAG}`), "step by step 2: the question with a recorded answer comes first, the ones that need your computer after it are tagged 'needs your computer' alone (no 'Basic checks' claim)", c0);
    const zenLegend = await p.evaluate(() => document.querySelector('.zp__legend')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
    check(zenLegend.startsWith('This demo has recorded answers for one question; the others need the version on your computer.') && !/needs live/i.test(zenLegend), "step by step 2: the legend says why (how many questions have a recording, the rest need the version on your computer) and does not begin by repeating the tag", zenLegend);
    // one wording for one question: the selected chip and the 'Asking:' line are the same words (pane 3 says them again below)
    const zenWord = await p.evaluate(() => ({ chip: document.querySelector('.zp__chip.is-on .zp__q')?.innerText.trim(), asking: document.querySelector('.zp__picked strong')?.innerText.trim() }));
    check(zenWord.chip === Q_TOP && zenWord.asking === Q_TOP, "step by step 2: the selected chip and the 'Asking:' line say the question in the same words", zenWord);
    // typing a suggestion's own words selects it: no second chip
    await p.locator('#zen-question').fill('top 5 customers by revenue?');
    await p.getByRole('button', { name: 'Use this question' }).click();
    await p.waitForTimeout(400);
    const dup = await p.evaluate(() => ({ chips: document.querySelectorAll('.zp__chip').length, on: [...document.querySelectorAll('.zp__chip.is-on')].map((b) => b.innerText.replace(/\s+/g, ' ')), box: document.getElementById('zen-question').value }));
    check(dup.chips === 3 && dup.on.length === 1 && dup.on[0].startsWith(Q_TOP) && dup.box === '', "step by step 2: typing the chip's old words ('top 5 customers by revenue?', an alias) still selects that chip and adds no second one", dup);
    // a typed question the demo cannot answer: 'needs your computer' and no level claim; Continue stays off with the reason and a try-it button
    await p.locator('#zen-question').fill('What is the weather in Paris?');
    await p.getByRole('button', { name: 'Use this question' }).click();
    await waitFor(() => document.querySelectorAll('.zp__chip').length === 4, null, 10000);
    const wx = await p.evaluate(() => {
      const chip = [...document.querySelectorAll('.zp__chip')].find((b) => /weather/.test(b.innerText));
      const c = document.getElementById('zen-continue');
      return { chip: chip?.innerText.replace(/\s+/g, ' '), disabled: c.getAttribute('aria-disabled'), why: document.getElementById('zen-why')?.innerText.replace(/\s+/g, ' '), tryIt: !!document.querySelector('#zen-why button'), steps: document.querySelector('.fd-rl__sum')?.innerText.trim(), link: document.querySelector('.fd-rl__readme')?.href };
    });
    check(wx.chip === `What is the weather in Paris? ${NEEDS_TAG}` && !/checks/i.test(wx.chip) && wx.disabled === 'true' && /^In this demo, answers are recorded/.test(wx.why) && wx.tryIt && wx.steps === 'How to run it on your computer' && /#run-it-on-your-computer$/.test(wx.link ?? ''), "step by step 2: a typed question the demo cannot answer reads 'needs your computer' alone (no level), Continue is off, and the reason has a try-it button, and the way to run it on your computer follows it inline (the steps' disclosure, ending in the README link)", wx);
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
    check(five.lockNote === 'This lock comes with the demo file.', "step by step 5: the answer that came with the demo's locked answer says so", five.lockNote);
    {
      const t = await p.evaluate(TYPESET_FACTS);
      check(figuresOk(t) && t.amounts.n === 4 && t.amounts.level && !!t.places && t.places.text === 'Places 2 to 5' && t.places.label === 'Places 2 to 5' && t.places.hidden === 'true' && t.places.beforeList && !t.places.mono && t.longCaps.length === 0 && t.lone.length === 0 && t.measure.length === 0 && !t.sideways,
        "typeset, step by step 5: the answer's lead and amounts are Geist tabular figures, the ranked list says 'Places 2 to 5' above it (and as its name), no long text is capitals, and no block of text ends on one word", { lead: t.lead, amounts: t.amounts, places: t.places, longCaps: t.longCaps, lone: t.lone });
    }
    {
      const z = await p.evaluate(CARD_FACTS);
      check(
        !!rep && !!z && z.verdict === verdictFor({ ...rep, missed: rep.total - rep.caught }, `${MAIN_NOT_CHECKED}, so ${NEXT}`) && z.filled.length === 1 && z.filled[0] === 'Hand this to your data team (download)' && z.firstAction === 'Hand this to your data team (download)' && z.lockBg === 'rgb(255, 255, 255)' &&
          z.afterFigure?.includes('fd-ac__lead-num') && z.standaloneNotChecked === 0 && /^Versions 1 to \d+ were the starting point, the files? and the demo's agreement; this is the first answer\.$/.test(z.version ?? '') && z.fig.endsWith(`Version ${Number(/to (\d+)/.exec(z.version ?? '')?.[1]) + 1}`) && !z.sideways,
        "step by step 5: the same card: one verdict line under the figure, the hand-off as its one filled control (first in the row), the lock quiet, the version explained",
        { z, rep },
      );
      const ax = await axHeadings();
      const named = await p.evaluate(() => `${document.querySelector('.fd-ac__lead-name')?.innerText}, ${document.querySelector('.fd-ac__lead-num')?.innerText}`);
      const h1ax = ax.headings.find((h) => h.name === 'Your answer');
      check(!!h1ax && h1ax.desc === named && named === `${LEAD[0]}, ${money(LEAD[1])}` && !ax.live.some((t) => t.includes(LEAD[0])) && (await p.evaluate(() => document.getElementById('zen-answer-lead')?.hidden === true && document.activeElement?.id === 'zen-title')),
        "step by step 5: the focused heading is named 'Your answer' and described by the answer's lead ('Chef Ravioli Starbright, $2,252.07') in the browser's accessibility tree; the sentence is hidden (not read again when browsing) and no live region repeats it", { h1ax, named, live: ax.live });
    }
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
    // "Confirmed by you" is the viewer's mark on this run's answer: it has to survive the walk Back and Forward (the pane that held it is torn down)
    const confirmState = () => p.evaluate(() => ({ buttons: document.querySelectorAll('.fd-ac__confirm').length, confirmed: [...document.querySelectorAll('.fd-ac__confirmed')].map((e) => e.innerText.trim()) }));
    const confirmBefore = await confirmState();
    await p.locator('.fd-ac__confirm').first().click();
    const confirmMade = await confirmState();
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
    const confirmKept = await confirmState();
    check(
      confirmBefore.buttons >= 1 && confirmBefore.confirmed.length === 0 && confirmMade.confirmed.join() === 'Confirmed by you' && confirmMade.buttons === confirmBefore.buttons - 1 &&
        confirmKept.confirmed.join() === 'Confirmed by you' && confirmKept.buttons === confirmBefore.buttons - 1,
      "step by step 5: 'Confirmed by you' is still there after the browser's Back to pane 3 and Forward to pane 5 (kept for the life of the run, not by the pane)",
      { confirmBefore, confirmMade, confirmKept },
    );
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

  // ── 3b2. the dead end of your own file is not dead: the sentence names orders.csv and the question it has a recording for, and its button switches to it ──
  consoleErrors.length = 0;
  try {
    await openApp(p, srv.url + '#/zen');
    const h1Is = (t, timeout = 60000) => waitFor((x) => document.querySelector('h1')?.innerText === x, t, timeout);
    const hashNow = () => p.evaluate(() => location.hash);
    await waitFor(() => !!document.getElementById('zen-continue'), null, 15000);
    await p.getByRole('button', { name: 'Paste data' }).click();
    await p.locator('#zen-paste').fill(OWN_CSV);
    await p.getByRole('button', { name: 'Use this data' }).click();
    await waitFor(() => !!document.querySelector('.zd__chip') && document.activeElement?.id === 'zen-continue', null, 20000);
    await p.locator('#zen-continue').click();
    check(await h1Is('Ask a question') && (await hashNow()) === '#/zen/2', "step by step (own file): 'See what's in your file' opens pane 2", await hashNow());
    await waitFor(() => !!document.querySelector('#zen-why button'), null, 30000);
    const deadEnd = () => p.evaluate(() => {
      const why = document.getElementById('zen-why');
      const b = why?.querySelector('button');
      return { text: why?.innerText.replace(/\s+/g, ' ').trim(), button: b?.innerText.trim(), tag: [...document.querySelectorAll('.zp__live')].map((e) => e.innerText.trim()), legend: document.querySelector('.zp__legend')?.innerText.replace(/\s+/g, ' ').trim() ?? '', said: (document.querySelector('.zp')?.innerText.match(/your computer/gi) ?? []).length };
    });
    const d2 = await deadEnd();
    check(
      d2.button === 'switch to orders.csv' && d2.text === `In this demo, answers are recorded, so questions about your own file need the version on your computer. ${'“'}${Q_TOP}${'”'} has a recorded answer on one sample file: switch to orders.csv.` && !/Try a sample file/.test(d2.text) &&
        d2.tag.length === 0 && d2.legend === '' && d2.said === 2,
      "step by step 2 (own file): the dead end names orders.csv and the question it has a recorded answer for, with a real 'switch to orders.csv' button (the old 'Try a sample file for now.' is gone); no chip is tagged 'needs your computer' when none can be answered, and the legend that says the same is not drawn: 'your computer' is said twice on the pane, by the sentence and the how-to heading",
      d2,
    );
    // pane 3 is reachable by its address and says the same sentence with the same button
    await p.evaluate(() => (location.hash = '#/zen/3'));
    await h1Is('What your answer must pass', 15000);
    await waitFor(() => !!document.querySelector('#zen-why button'), null, 10000);
    const d3 = await deadEnd();
    check(d3.button === 'switch to orders.csv' && d3.text === d2.text, "step by step 3 (own file): the checks pane says the same sentence, with the same button", { d2, d3 });
    // the button: binds orders.csv, selects the question the sentence names (which has a recording), and returns focus to the forward button
    await p.locator('#zen-why button').click();
    const switched = await waitFor(() => document.activeElement?.id === 'zen-continue' && !document.querySelector('#zen-why button'), null, 20000).catch(() => false);
    await waitFor(() => window.__undefined.state.value.datasets.some((d) => d.name === 'rows') && document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 20000);
    const after3 = await p.evaluate(() => ({
      active: document.activeElement?.id,
      label: document.getElementById('zen-continue')?.innerText.trim(),
      lede: document.querySelector('.zp__lede')?.innerText.trim(),
      why: document.getElementById('zen-why')?.innerText.trim() ?? '',
      sixth: [...document.querySelectorAll('.zp__check')].map((r) => ({ label: r.querySelector('.zp__label')?.innerText.trim(), note: r.querySelector('.zp__note')?.innerText.trim() })).pop(),
    }));
    check(
      after3.active === 'zen-continue' && after3.label === 'Run the checks' && after3.lede === `Before you see an answer to ${'“'}${Q_TOP}${'”'}, it has to pass these.` && after3.why === '',
      "step by step 3 (own file): 'switch to orders.csv' binds orders.csv, selects the question the sentence named (pane 3 now says it in its own words), clears the dead end and puts focus on the forward button",
      { switched, after3 },
    );
    check(
      after3.sixth?.label === 'Stress test: deliberate breaks' && after3.sixth?.note === 'It makes deliberate breaks in the calculation; your checks should notice.',
      "step by step 3: the sixth check is the stress test and says what it does in 'deliberate breaks' (the trace's own label, no 'small breaks on purpose')",
      after3.sixth,
    );
    check(consoleErrors.length === 0, "step by step (own file): switching to the recorded sample logs no console errors", consoleErrors);
  } catch (e) {
    check(false, 'step by step own-file dead end', e.message.split('\n')[0]);
  }

  // ── 3b3. a question the viewer typed is saved before the demo's first answer: the card claims nothing about a save the demo did not make ──
  // (the saves are the engine's: 1 starting point, 2 the file, 3 the demo's agreement, 4 the typed question's own, 5 the first answer; the card said
  // "Versions 1 to 4 were … the demo's agreement" until the note read each save's function)
  consoleErrors.length = 0;
  try {
    await openApp(p, srv.url + '#/zen');
    await waitFor(() => !!document.getElementById('zen-continue'), null, 15000);
    await p.getByRole('button', { name: 'orders.csv', exact: true }).click();
    await waitFor(() => document.getElementById('zen-continue')?.getAttribute('aria-disabled') !== 'true', null, 15000);
    await p.locator('#zen-continue').click();
    await waitFor(() => document.querySelector('h1')?.innerText === 'Ask a question', null, 15000);
    await p.locator('#zen-question').fill('How many orders were refunded?');
    await p.getByRole('button', { name: 'Use this question' }).click();
    await waitFor(() => document.querySelector('.zp__picked strong')?.innerText === 'How many orders were refunded?', null, 20000);
    await p.evaluate(() => (location.hash = '#/start'));
    await waitFor(() => document.getElementById('fd-ask-btn')?.getAttribute('aria-disabled') !== 'true', null, 20000);
    await askBtn.click();
    const typedDead = await waitText(/No recorded answer for this one\./, 40000);
    await idle();
    await ask(Q_TOP);
    await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), LEAD[0], 60000);
    const typedRun = await p.evaluate(() => ({
      saves: window.__undefined.state.value.revisions.map((r) => `${r.id}:${r.kind}${r.fn ? `(${r.fn})` : ''}`),
      version: document.querySelector('.fd-ac__version')?.innerText ?? null,
      fig: document.querySelector('.fd-ac__fig')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    }));
    check(
      typedDead && typedRun.saves.join(' ') === '1:init 2:dataset 3:spec-edit(topCustomersByRevenue) 4:spec-edit(howManyOrdersWereRefunded) 5:commit(topCustomersByRevenue)' && typedRun.version === null && /Version 5$/.test(typedRun.fig),
      "full view: a question typed on step by step is saved at ask time (save 4); the recorded question's answer (Version 5) then says nothing about where the saves before it came from, because save 4 is not the demo's agreement",
      typedRun,
    );
    check(consoleErrors.length === 0, "full view (typed question first): no console errors", consoleErrors);
  } catch (e) {
    check(false, 'typed question first, then the recorded question', e.message.split('\n')[0]);
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

  // ── 3g. the landing's limits card in the demo lists the steps, and the two columns come out level (the closing card sits under the zip card) ──
  try {
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(srv.url + '#/');
    await p.waitForSelector('#own-file .fd-rl__cmds', { timeout: 15000 });
    const landing = () =>
      p.evaluate(() => {
        const box = (sel) => {
          const e = document.querySelector(sel);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
        };
        const cmds = document.querySelector('#own-file .fd-rl__cmds');
        return {
          zip: box('.fd-tf__zipcard'),
          lim: box('.fd-tf__limits'),
          close: box('.fd-tf__close'),
          needs: [...document.querySelectorAll('#own-file .fd-rl__list li')].length,
          cmds: cmds?.textContent.split('\n'),
          cmdsScroll: cmds ? cmds.scrollWidth > cmds.clientWidth : null,
          readme: !!document.querySelector('#own-file .fd-tf__run'),
          pageScrolls: document.documentElement.scrollWidth > innerWidth,
        };
      });
    const wide = await landing();
    const widow = await p.evaluate(LAST_LINE_WORDS, '#own-file .fd-rl__hand');
    check(
      !!wide.zip && !!wide.lim && !!wide.close && wide.close.t >= wide.zip.b && wide.close.l === wide.zip.l && wide.lim.l >= wide.zip.r && Math.abs(wide.close.b - wide.lim.b) <= 2 && wide.needs === 3 && wide.cmds.join('|') === RUN_COMMANDS.join('|') && wide.readme && !wide.pageScrolls && widow?.lastLine >= 2,
      "landing, demo, 1440: the limits card lists the steps (three needs, the three commands, the README link), the closing card sits under the zip card with the two columns level (bottoms within 2 px, the card heights stretch to it), and the one plain sentence has no one-word last line",
      { wide, widow },
    );
    // level at every two-up width (it was 48 px short at 1180, 96 at 1024, 143 at 900: the limits card ended above the closing card), not only at 1440
    for (const w of [1180, 1024, 900, 810]) {
      await p.setViewportSize({ width: w, height: 900 });
      await p.waitForTimeout(200);
      const mid = await landing();
      check(!!mid.zip && mid.close.t >= mid.zip.b && mid.lim.l >= mid.zip.r && Math.abs(mid.close.b - mid.lim.b) <= 2 && !mid.pageScrolls, `landing, demo, ${w}: still two columns, the closing card under the zip card and the two columns level (bottoms within 2 px)`, mid);
    }
    await p.setViewportSize({ width: 768, height: 900 });
    await p.waitForTimeout(200);
    const tab = await landing();
    check(tab.zip.b <= tab.lim.t && tab.lim.b <= tab.close.t && !tab.pageScrolls, 'landing, demo, 768: one column in reading order (zip, limits with the steps, closing), the page does not scroll sideways', tab);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(200);
    const narrow = await landing();
    check(narrow.zip.b <= narrow.lim.t && narrow.lim.b <= narrow.close.t && narrow.cmdsScroll === false && !narrow.pageScrolls, 'landing, demo, 390: one column in reading order (zip, limits with the steps, closing); the commands wrap and the page does not scroll sideways', narrow);
    // reduced motion: nothing to wait for, so the pass scenario's card is released at once at its natural height (no animation running); the stop scenario's is the compact skeleton
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.reload();
    await p.waitForSelector('.fd-stage .fd-ac', { timeout: 15000 });
    const rm = () => p.evaluate(() => ({ h: Math.round(document.querySelector('.fd-stage .fd-ac').getBoundingClientRect().height), cls: document.querySelector('.fd-stage .fd-ac').className, anim: document.getAnimations().length }));
    const rmPass = await rm();
    await p.getByRole('button', { name: 'Watch it stop and ask' }).click();
    await p.waitForTimeout(300);
    const rmStop = await rm();
    await p.getByRole('button', { name: 'Watch it pass' }).click();
    await p.waitForTimeout(300);
    const rmBack = await rm();
    check(
      rmPass.h > 900 && /fd-ac--shown/.test(rmPass.cls) && rmPass.anim === 0 && rmStop.h >= 260 && rmStop.h <= 400 && /fd-ac--held/.test(rmStop.cls) && rmStop.anim === 0 && rmBack.h > 900 && /fd-ac--shown/.test(rmBack.cls),
      "landing, reduced motion: the pass scenario's card is released at once at its natural height with no animation running, 'Watch it stop and ask' is the compact skeleton, and back to pass is released again",
      { rmPass, rmStop, rmBack },
    );
  } catch (e) {
    check(false, 'landing in the demo: the limits card and the layout ran without throwing', String(e));
  } finally {
    await p.emulateMedia({ reducedMotion: null });
    await p.setViewportSize({ width: 1440, height: 900 });
  }

  // ── 3f. a copy that runs on your computer (the generation service's health check answers "up", stubbed on a second browser context; nothing is asked of
  // it): none of the own-file path's words or elements is drawn, and the picker folds, the forward button reads "Continue" and the landing's
  // limits card has no steps, exactly as before ──
  consoleErrors.length = 0;
  let lctx = null;
  let lp = null;
  try {
    // its own browser context: the first page holds this origin's IndexedDB open, and openApp clears it (a second page of one context would block that)
    lctx = await b.browser.newContext({ viewport: { width: 1440, height: 900 } });
    lp = await lctx.newPage();
    lp.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    lp.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await lp.route('**/generate/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, codexVersion: '0.157.0', model: 'gpt-6-luna', effort: 'low' }) }));
    await openApp(lp, srv.url + '#/zen');
    const liveMode = await lp.evaluate(() => window.__undefined.state.value.mode);
    await lp.waitForSelector('#zen-continue', { timeout: 15000 });
    const fresh = await lp.evaluate(() => ({ caveat: document.querySelectorAll('.zd__caveat').length, own: document.querySelectorAll('.zd__own').length, picker: !!document.getElementById('zd-picker') }));
    check(liveMode === 'live' && fresh.caveat === 0 && fresh.own === 0 && fresh.picker, 'live look, step by step 1: a copy that runs on your computer draws no caveat and no note region under the drop zone', { liveMode, fresh });
    await lp.getByRole('button', { name: 'Paste data' }).click();
    await lp.locator('#zen-paste').fill(OWN_CSV);
    await lp.getByRole('button', { name: 'Use this data' }).click();
    await lp.waitForFunction(() => !!document.querySelector('.zd__chip') && document.activeElement?.id === 'zen-continue', null, { timeout: 20000 });
    const liveOwn = await lp.evaluate(() => {
      const btn = document.getElementById('zen-continue');
      return { picker: !!document.getElementById('zd-picker'), label: btn.innerText.trim(), primary: btn.classList.contains('fd-btn--primary'), secondary: btn.classList.contains('fd-btn--secondary'), change: document.querySelector('.zd__change').innerText.trim(), expanded: document.querySelector('.zd__change').getAttribute('aria-expanded'), note: !!document.querySelector('.zd__note, .zd__own, .zd__caveat'), said: [...document.querySelectorAll('.zd .fd-sr[role=status]')].map((e) => e.textContent).join(), body: /In this demo/.test(document.body.innerText) };
    });
    check(!liveOwn.picker && liveOwn.label === 'Continue' && liveOwn.primary && !liveOwn.secondary && liveOwn.change === 'Change' && liveOwn.expanded === 'false' && !liveOwn.note && /is ready\.$/.test(liveOwn.said) && !liveOwn.body, "live look, step by step 1: your own file folds the picker behind its chip, the button reads 'Continue' (primary) and the file 'is ready', with no demo words anywhere", liveOwn);
    await lp.locator('#zen-continue').click();
    await lp.waitForSelector('.zp__chip', { timeout: 15000 });
    await lp.waitForTimeout(800);
    const liveQ = await lp.evaluate(() => ({ note: document.querySelectorAll('.zp__colnote').length, steps: document.querySelectorAll('.fd-rl').length, demo: /In this demo/.test(document.body.innerText), why: document.getElementById('zen-why')?.innerText ?? null, noteBeforeChips: !!(document.querySelector('.zp__colnote')?.compareDocumentPosition(document.querySelector('.zp__chips')) & Node.DOCUMENT_POSITION_FOLLOWING) }));
    check(liveQ.note === 1 && liveQ.noteBeforeChips && liveQ.steps === 0 && !liveQ.demo, "live look, step by step 2: the column note is above the suggestions here too, and there are no run-it-on-your-computer steps (this copy is that)", liveQ);
    await lp.goto(srv.url + '#/start');
    await lp.waitForSelector('.fd-bring', { timeout: 15000 });
    const liveFull = await lp.evaluate(() => ({ caveat: document.querySelectorAll('.fd-bring__caveat').length }));
    await lp.goto(srv.url + '#/');
    await lp.waitForSelector('#own-file', { timeout: 15000 });
    const liveLanding = await lp.evaluate(() => ({ steps: document.querySelectorAll('.fd-tf__steps, .fd-rl').length, readme: !!document.querySelector('.fd-tf__run'), second: [...document.querySelectorAll('a.fd-btn--secondary')].map((a) => a.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /own file/.test(t)) }));
    check(liveFull.caveat === 0 && liveLanding.steps === 0 && liveLanding.readme && liveLanding.second.length > 0 && liveLanding.second.every((t) => t === 'Use your own file'), "live look: the Full view draws no caveat, and the landing's limits card has no steps (its README link stays) and the own-file buttons read 'Use your own file'", { liveFull, liveLanding });
    // a refusal in live mode does not hold Step by step's picker: "Close" shuts it, as it always did (the demo's rule is the demo's)
    await lp.goto(srv.url + '#/zen/1');
    await lp.waitForSelector('.zd__chip, .zd__sample', { timeout: 15000 });
    if (!(await lp.locator('.zd__chip').count())) {
      await lp.getByRole('button', { name: 'orders.csv', exact: true }).click();
      await lp.waitForSelector('.zd__chip', { timeout: 30000 });
    }
    await lp.locator('.zd__change').click();
    await lp.waitForSelector('#zd-picker', { timeout: 5000 });
    await lp.locator('input[type=file]').setInputFiles({ name: 'fake.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK') });
    await lp.waitForSelector('.zd__problem', { timeout: 10000 });
    const shape = () => lp.evaluate(() => ({ change: document.querySelector('.zd__change').innerText.trim(), expanded: document.querySelector('.zd__change').getAttribute('aria-expanded'), picker: !!document.getElementById('zd-picker'), problem: !!document.querySelector('.zd__problem') }));
    const refusedLive = await shape();
    await lp.locator('.zd__change').click();
    await lp.waitForTimeout(300);
    const closedLive = await shape();
    check(refusedLive.change === 'Close' && refusedLive.expanded === 'true' && refusedLive.picker && closedLive.change === 'Change' && closedLive.expanded === 'false' && !closedLive.picker && closedLive.problem, "live look, step by step 1: after a refusal the chip's button still reads 'Close' (aria-expanded true) and pressing it folds the picker, with the refusal staying under the chip: a refusal does not hold the picker here", { refusedLive, closedLive });
    check(consoleErrors.length === 0, "live look: no console errors", consoleErrors);
  } catch (e) {
    check(false, 'live look (a copy that runs on your computer, health stubbed up)', e.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e));
  } finally {
    await lctx?.close();
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
    await chip(Q_TOP).click();
    await waitFor((q) => [...document.querySelectorAll('[aria-label="Suggested questions"] button')].some((b) => b.textContent.includes(q) && b.getAttribute('aria-pressed') === 'true'), Q_TOP, 15000);
    await p.waitForFunction(() => { const b = document.getElementById('fd-ask-btn'); return !!b && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 30000 });
    const chips0 = await texts('[aria-label="Suggested questions"] button');
    const text0 = norm(await body());
    const pre0 = await fnState();
    check(
      chips0.some((c) => c === `${Q_TOP} Basic checks`) && text0.includes('Basic checks only: no examples, locked answers or house rules for this question yet.') && text0.includes('0 examples · 0 locked answers · 0 house rules') && !pre0.has,
      "seed off: the question is tagged 'Basic checks' and no agreement is installed (the seeded one has no recording to play)",
      { chips0, pre0: pre0.has, text: text0.slice(0, 500) },
    );

    await ask(null);
    const shown0 = await waitFor((n) => document.querySelector('.fd-ac__lead-name')?.innerText.includes(n), 'Puddlesworth Inc', 60000);
    const lead0 = (await texts('.fd-ac__lead-name, .fd-ac__lead-num')).join(' | ');
    const eyebrow0 = await texts('.fd-ac__eyebrow');
    check(shown0 && lead0 === 'Puddlesworth Inc | $2,599.13' && eyebrow0.length === 1 && eyebrow0[0] === 'PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET' && !consoleErrors.length, "seed off: 'Who are our top customers by revenue?' → Ask: Puddlesworth Inc $2,599.13, 'PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET'", { shown0, lead0, eyebrow0, errors: consoleErrors });
    const post0 = await fnState();
    check(
      post0.gen?.phase === 'committed' && post0.gen.statuses.length === 1 && post0.gen.statuses[0] === 'accepted' && post0.live && post0.examples === 0 && post0.houseRules === 0 && post0.pins.length === 0 && post0.rows?.length === 5 && post0.rows[0][0] === 'Puddlesworth Inc' && money(post0.rows[0][1]) === '$2,599.13' &&
        post0.gen.gates.filter((x) => x.status === 'pass').map((x) => x.gate).join() === 'compile,invariants' && post0.gen.gates.filter((x) => x.status === 'skipped').map((x) => x.gate).join() === 'tests,properties',
      "seed off: the engine agrees — the spec-less recorded draft was accepted: only the 2 basic checks ran (compile, invariants; tests and properties skipped, no examples, house rules or locked answer); the output table starts Puddlesworth Inc (2599.131, shown as $2,599.13)",
      post0,
    );
    const card0 = norm((await texts('.fd-ac')).join(' '));
    check(cardShows(card0, post0.rows ?? []), "seed off: the answer card lists the engine's five customers and amounts in order", { rows: post0.rows, card: card0.slice(0, 500) });
    {
      const b0 = await p.evaluate(CARD_FACTS);
      const first0 = await p.evaluate(() => document.querySelector('.fd-ac__not-checked li')?.innerText.replace(/\s+/g, ' ').trim().replace(/\s*\([^()]*\)\s*$/, '') ?? '');
      const kinds0 = await state(() => {
        const s = window.__undefined.state.value;
        const v = s.program.functions.topCustomersByRevenue?.artifact?.revision;
        return { version: v, before: s.revisions.filter((r) => r.id < v).map((r) => r.kind) };
      });
      check(
        !!b0 && b0.verdict === `Only the 2 basic checks ran, so nothing has tested the number yet. Not checked: ${first0}, so ${NEXT}` && first0.length > 0 && !b0.verdict.includes('(') && b0.verdictStyle.size === '16px' && b0.afterFigure?.includes('fd-ac__lead-num') && b0.standaloneNotChecked === 0 &&
          b0.filled.length === 1 && b0.filled[0] === 'Hand this to your data team (download)' && b0.lockBg === 'rgb(255, 255, 255)' && !kinds0.before.includes('spec-edit') && b0.version === 'Versions 1 and 2 were the starting point and the file; this is the first answer.' && kinds0.before.join() === 'init,dataset' && b0.fig.endsWith(`Version ${kinds0.version}`) && b0.lockNote === null,
        "seed off: basic checks only: the verdict says only the 2 basic checks ran and nothing has tested the number yet, with the same one filled control; no agreement came with it, so no lock note, and a first answer is never an unexplained 'Version 3' (the starting point and the file came first)",
        { b0, kinds0 },
      );
    }

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

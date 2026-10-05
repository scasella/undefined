// node scripts/byo-sessions.mjs [N=3] [set ...]   — live smoke of the bring-your-own-data suggestion chips (docs/BYO-DATA-MEASUREMENTS.md).
// node scripts/byo-sessions.mjs chips              — only drop + Load each CSV and print the chips the real UI offers (no model call).
// BYO_APPEND=1 node scripts/byo-sessions.mjs rescore — re-run check() over the stored results after a checker fix (no server).
//
// Question: when a reader drops a realistic CSV and clicks one of the suggested calls (src/data/suggest.ts), does the
// live model write the function (or decline it: NEEDS_SPEC / CANNOT_BE_PURE), do the gates accept it, and is the
// answer right? Three synthetic but realistic CSVs, generated here from a seeded PRNG (so the expected answers are
// computed in node from the very same rows):
//   sales     order_date, region, status, amount       → countByStatus, totalAmountByStatus, averageAmount
//   students  name, class, score                       → countByClass, totalScoreByClass, top5NamesByScore
//   log       timestamp, level, message                → countByLevel, timestampRange
// (suggest.ts offers at most three chips per dataset, in the order countBy, totalBy, top5, average, Range, so no single
// CSV shows all five templates; together these cover each template at least once.)
//
// A "set" is `<csv>:<template>` (template = countBy | totalBy | top5 | average | range); default: every chip each CSV
// shows. Each set is N fresh sessions, each driven through the real UI exactly as a reader would:
//   fresh image (lib/drive.mjs openApp) → dispatch dragenter/dragover/drop with the CSV File on window (the page-wide
//   DropOverlay) → the data drawer opens pre-filled → wait for the preview, click "Load as <name>" → the chips render →
//   click the chip of the template (it pre-types the call) → press Enter in #repl-input → wait until idle.
// The send-samples setting is left at the product default and recorded.
//
// Per session: chips offered, every attempt (status, source, declined reason, failing gate + headline, the model's
// notes = its assumptions), final phase, whether the function committed, the result (pinnable.expected JSON, else the
// printed value), `correct` = the result normalised and compared with a direct computation in node (see check()), and
// the wall-clock time from Enter to idle. "written" = at least one candidate that is not a decline.
//
// Same driver as scripts/decide-sessions.mjs / compose-sessions.mjs (dev server with the live Codex service at its
// defaults: gpt-6-luna, effort low; real Worker watchdog; real attempt budget). ONE browser, serial: the generation
// service is a serial queue. Writes .tmp/byo-sessions-out.json after every session; BYO_APPEND=1 resumes (sets already
// at N are skipped); BYO_OUT names another output file (e.g. for an after-fix re-run); BYO_PORT (default 5198) picks
// the port. Needs `codex` logged in; aborts if the app is not in live mode. Dev tooling only, never bundled.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { startServer, launch, openApp } from './lib/drive.mjs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site, wherever this is run from

// ───────────── data ─────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pickOf = (r, xs) => xs[Math.floor(r() * xs.length)];
const iso = (ms) => new Date(ms).toISOString();

function salesRows() {
  const r = rng(11);
  const rows = [];
  const t0 = Date.UTC(2026, 0, 3);
  for (let i = 0; i < 48; i++) {
    const status = r() < 0.6 ? 'paid' : r() < 0.6 ? 'pending' : 'refunded';
    rows.push({ order_date: iso(t0 + Math.floor(r() * 240) * 86400000).slice(0, 10), region: pickOf(r, ['North', 'South', 'East', 'West']), status, amount: Math.round((15 + r() * 480) * 100) / 100 });
  }
  return rows;
}
function studentsRows() {
  const r = rng(23);
  const names = ['Ava Chen', 'Liam Patel', 'Noah Kim', 'Emma Rossi', 'Mia Novak', 'Lucas Silva', 'Zoe Martin', 'Ethan Brown', 'Ivy Okafor', 'Owen Diaz', 'Leah Cohen', 'Sam Ito', 'Nora Berg', 'Eli Haddad', 'Ruby Walsh', 'Finn Moreau', 'Jade Singh', 'Omar Aziz', 'Tara Quinn', 'Hugo Lind', 'Iris Park', 'Theo Vargas', 'Maya Lopez', 'Ben Adler'];
  const scores = new Set();
  return names.map((name) => {
    let s;
    do s = 42 + Math.floor(r() * 58);
    while (scores.has(s)); // tie-free, so "top 5" has one answer
    scores.add(s);
    return { name, class: pickOf(r, ['7A', '7B', '8A']), score: s };
  });
}
function logRows() {
  const r = rng(5);
  const msgs = { INFO: ['request served', 'cache warmed', 'user signed in', 'job finished'], WARN: ['slow query', 'retrying upstream', 'disk 80% full'], ERROR: ['upstream timeout', 'payment declined by provider'], DEBUG: ['cache miss', 'config reloaded'] };
  const rows = [];
  let t = Date.UTC(2026, 8, 14, 7, 58, 11);
  for (let i = 0; i < 60; i++) {
    t += Math.floor(5000 + r() * 400000);
    const x = r();
    const level = x < 0.55 ? 'INFO' : x < 0.75 ? 'DEBUG' : x < 0.92 ? 'WARN' : 'ERROR';
    rows.push({ timestamp: iso(t).replace(/\.\d{3}Z$/, 'Z'), level, message: pickOf(r, msgs[level]) });
  }
  // a log is not always in time order: swap two lines so "first row = earliest" is wrong
  [rows[3], rows[40]] = [rows[40], rows[3]];
  return rows;
}
const csvCell = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) => [Object.keys(rows[0]).join(','), ...rows.map((x) => Object.values(x).map(csvCell).join(','))].join('\n') + '\n';

const CSVS = {
  sales: { file: 'sales.csv', rows: salesRows(), cat: 'status', num: 'amount', who: null, date: null },
  students: { file: 'students.csv', rows: studentsRows(), cat: 'class', num: 'score', who: 'name', date: null },
  log: { file: 'log.csv', rows: logRows(), cat: 'level', num: null, who: null, date: 'timestamp' },
};
const TEMPLATES = { countBy: /^countBy/, totalBy: /^total\w+By/, top5: /^top5/, average: /^average/, range: /Range$/ };

// ───────────── expected answers (node) and the check ─────────────
function expected(csv, template) {
  const d = CSVS[csv];
  const group = (f) => d.rows.reduce((m, x) => ((m[x[d.cat]] = (m[x[d.cat]] ?? 0) + f(x)), m), {});
  if (template === 'countBy') return group(() => 1);
  if (template === 'totalBy') return group((x) => x[d.num]);
  if (template === 'average') return d.rows.reduce((a, x) => a + x[d.num], 0) / d.rows.length;
  if (template === 'top5') return [...d.rows].sort((a, b) => b[d.num] - a[d.num]).slice(0, 5).map((x) => x[d.who]);
  if (template === 'range') {
    const ts = d.rows.map((x) => x[d.date]).sort();
    return [ts[0], ts[ts.length - 1]];
  }
  return null;
}

const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 1e-9);
/** Any keyed result → {key: number}: an object map, [{k, n}], [[k, n]]. Null when it has no such reading. */
function asMap(v, prefer) {
  if (v && typeof v === 'object' && v.$t === 'Map' && Array.isArray(v.v)) return asMap(v.v, prefer); // the page's encoding of a returned Map
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const nums = Object.entries(v).filter(([, x]) => typeof x === 'number');
    if (nums.length === Object.keys(v).length && nums.length) return Object.fromEntries(nums);
    // {paid: {count: 3}} or {byStatus: {...}}
    const inner = Object.values(v).find((x) => x && typeof x === 'object');
    if (Object.keys(v).length === 1 && inner) return asMap(inner, prefer);
    const nested = Object.entries(v).every(([, x]) => x && typeof x === 'object' && !Array.isArray(x));
    if (nested) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, numberIn(x, prefer)]));
    return null;
  }
  if (Array.isArray(v)) {
    const m = {};
    for (const e of v) {
      if (Array.isArray(e) && e.length === 2) m[String(e[0])] = e[1];
      else if (e && typeof e === 'object') {
        const k = Object.values(e).find((x) => typeof x === 'string');
        if (k === undefined) return null;
        m[k] = numberIn(e, prefer);
      } else return null;
    }
    return m;
  }
  return null;
}
function numberIn(o, prefer) {
  const ent = Object.entries(o).filter(([, x]) => typeof x === 'number');
  return (ent.find(([k]) => prefer.test(k)) ?? ent[0])?.[1];
}
function check(template, want, got) {
  if (got === undefined) return { correct: false, why: 'no result' };
  if (template === 'countBy' || template === 'totalBy') {
    const m = asMap(got, template === 'countBy' ? /count|n$|rows|total/i : /total|sum|amount|score/i);
    if (!m) return { correct: false, why: 'unrecognised shape' };
    const keys = Object.keys(want);
    const ok = keys.length === Object.keys(m).length && keys.every((k) => near(m[k], want[k]));
    return { correct: ok, why: ok ? '' : `got ${JSON.stringify(m)}` };
  }
  if (template === 'average') {
    const n = typeof got === 'number' ? got : got && typeof got === 'object' ? numberIn(got, /average|mean|avg/i) : undefined;
    return { correct: near(n, want), why: near(n, want) ? '' : `got ${n}, want ${want}` };
  }
  if (template === 'top5') {
    const names = Array.isArray(got) ? got.map((e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? Object.values(e).find((x) => typeof x === 'string') : null)) : null;
    const ok = !!names && JSON.stringify(names) === JSON.stringify(want);
    return { correct: ok, why: ok ? '' : `got ${JSON.stringify(names)}` };
  }
  if (template === 'range') {
    const strs = Array.isArray(got) ? got : got && typeof got === 'object' ? Object.values(got) : [];
    const ms = strs.map((x) => (typeof x === 'string' || typeof x === 'number' ? Date.parse(x) : NaN));
    const ok = ms.length === 2 && ms[0] === Date.parse(want[0]) && ms[1] === Date.parse(want[1]);
    return { correct: ok, why: ok ? '' : `got ${JSON.stringify(got)}` };
  }
  return { correct: false, why: 'unknown template' };
}

// ───────────── driving the page ─────────────
async function dropFile(page, file, text) {
  await page.evaluate(
    ({ file, text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], file, { type: 'text/csv' }));
      for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { file, text },
  );
  try {
    await page.waitForSelector('dialog.drawer[open]', { timeout: 5000 });
    return 'drop';
  } catch {
    await page.locator('input.data-start-input').first().setInputFiles({ name: file, mimeType: 'text/csv', buffer: Buffer.from(text) });
    await page.waitForSelector('dialog.drawer[open]', { timeout: 5000 });
    return 'file-input';
  }
}

async function loadCsv(page, csv) {
  const d = CSVS[csv];
  const via = await dropFile(page, d.file, toCsv(d.rows));
  const load = page.locator('dialog.drawer[open] .form-actions .btn-primary');
  await page.waitForFunction(() => {
    const b = document.querySelector('dialog.drawer[open] .form-actions .btn-primary');
    return b && !b.disabled && /^Load as/.test(b.textContent ?? '');
  }, null, { timeout: 15000 });
  await load.click();
  await page.waitForSelector('.suggest-chip', { timeout: 15000 });
  const chips = await page.locator('.suggest-chip').allTextContents();
  return { via, chips: chips.map((c) => c.trim()) };
}

const OUTCOME = () => {
  const s = window.__undefined.state.value;
  const g = s.generation;
  const outs = s.repl.filter((x) => x.kind === 'output' || x.kind === 'error');
  const last = outs[outs.length - 1] ?? null;
  const rec = g ? s.program.functions[g.fn] : null;
  return {
    samples: s.send.samples,
    fn: g?.fn ?? null,
    phase: g?.phase ?? null,
    error: g?.error?.message ?? null,
    maxAttempts: g?.maxAttempts ?? null,
    committed: !!rec?.artifact && rec.artifact.specHash === rec.specHash,
    attempts: (g?.attempts ?? []).map((a) => {
      const c = a.candidate;
      const gates = c?.gates ?? a.gates ?? [];
      const fail = gates.find((x) => x.status === 'fail');
      return { status: a.status, source: c?.source ?? null, declined: c?.declined ? { reason: c.declined.reason, message: c.declined.message } : null, gate: fail?.gate ?? null, headline: fail?.headline ?? c?.headline ?? null, notes: c?.notes ?? null, body: c?.body ?? a.shown ?? '' };
    }),
    last: last && (last.kind === 'output' ? { kind: 'output', value: last.value, note: last.note ?? null, table: !!last.table, expected: last.pinnable ? last.pinnable.expected : undefined } : { kind: 'error', name: last.name, message: last.message }),
  };
};

async function session(page, url, csv, template) {
  await openApp(page, url);
  const mode = await page.evaluate(() => window.__undefined.state.value.mode);
  if (mode !== 'live') throw new Error(`app is in ${mode} mode: is codex installed and logged in?`);
  const { via, chips } = await loadCsv(page, csv);
  const chip = chips.find((c) => TEMPLATES[template].test(c.replace(/\(.*$/, ''))); // match the name, not "name(arg)"
  if (!chip) return { via, chips, outcome: 'no-chip' };
  await page.locator('.suggest-chip', { hasText: chip }).first().click();
  const typed = await page.evaluate(() => window.__undefined.state.value.replInput);
  await page.locator('#repl-input').focus();
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !window.__undefined.state.value.busy, null, { timeout: 900000, polling: 250 });
  const ms = Date.now() - t0;
  const o = await page.evaluate(OUTCOME);
  let got;
  if (o.last?.kind === 'output') {
    got = o.last.expected;
    if (got === undefined) {
      try {
        got = JSON.parse(o.last.value);
      } catch {
        got = o.last.value;
      }
    }
  }
  const written = o.attempts.some((a) => !a.declined && a.body.trim() !== '');
  const declined = o.attempts.filter((a) => a.declined).map((a) => a.declined.reason);
  const verdict = o.committed && o.last?.kind === 'output' ? check(template, expected(csv, template), got) : { correct: false, why: 'not committed' };
  return { via, chips, chip, typed, ms, written, declined, accepted: o.committed, ...verdict, result: got, ...o };
}

// ───────────── main ─────────────
const args = process.argv.slice(2);
const CHIPS = args[0] === 'chips';
const N = CHIPS ? 1 : Number(args[0] ?? 3);
const DEFAULT_SETS = ['sales:countBy', 'sales:totalBy', 'sales:average', 'students:countBy', 'students:totalBy', 'students:top5', 'log:countBy', 'log:range'];
const sets = !CHIPS && args.slice(1).length ? args.slice(1) : DEFAULT_SETS;
const OUT = process.env.BYO_OUT ?? '.tmp/byo-sessions-out.json';
mkdirSync('.tmp', { recursive: true });
const out = existsSync(OUT) && process.env.BYO_APPEND ? JSON.parse(readFileSync(OUT, 'utf8')) : { started: new Date().toISOString(), sets: {} };
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1));
out.expected = Object.fromEntries(DEFAULT_SETS.map((s) => [s, expected(...s.split(':'))]));

if (args[0] === 'rescore') {
  // node scripts/byo-sessions.mjs rescore — re-run check() over the stored results (after a checker fix); no server, no model call
  for (const [set, runs] of Object.entries(out.sets)) {
    const [csv, template] = set.split(':');
    for (const r of runs) {
      if (!r.accepted || r.last?.kind !== 'output') continue;
      const v = check(template, expected(csv, template), r.result);
      if (v.correct !== r.correct) console.log(set, `#${r.i}`, r.correct, '→', v.correct, v.why);
      Object.assign(r, v, { rescored: new Date().toISOString() });
    }
  }
  save();
  process.exit(0);
}
const srv = await startServer({ mode: 'dev', port: Number(process.env.BYO_PORT ?? 5198) });
const health = await fetch(`${srv.url}generate/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
out.health = health;
console.log('service', JSON.stringify(health));
const b = await launch();
try {
  if (CHIPS) {
    for (const csv of Object.keys(CSVS)) {
      await openApp(b.page, srv.url);
      const r = await loadCsv(b.page, csv);
      console.log(csv.padEnd(9), r.via.padEnd(10), r.chips.join('  '));
    }
  } else {
    for (const set of sets) {
      const [csv, template] = set.split(':');
      const runs = (out.sets[set] = out.sets[set] ?? []);
      for (let i = runs.length; i < N; i++) {
        let run;
        try {
          run = { i, at: new Date().toISOString(), ...(await session(b.page, srv.url, csv, template)) };
        } catch (e) {
          run = { i, at: new Date().toISOString(), outcome: 'harness-error', error: String(e).split('\n')[0] };
        }
        runs.push(run);
        save();
        const a = run.attempts ?? [];
        console.log(
          set.padEnd(18),
          `#${i}`,
          run.outcome ?? `${run.written ? 'written' : 'declined'} ${run.accepted ? 'accepted' : 'rejected'} ${run.correct ? 'CORRECT' : 'wrong'}`,
          `${a.length}/${run.maxAttempts ?? '-'} [${a.map((x) => x.declined?.reason ?? x.gate ?? x.status).join(',')}]`,
          `${Math.round((run.ms ?? 0) / 1000)}s`,
          `| ${run.chip ?? ''} | ${(run.why ?? run.error ?? '').slice(0, 120)}`,
        );
      }
    }
  }
} finally {
  out.finished = new Date().toISOString();
  if (!CHIPS) save();
  await b.close();
  srv.stop();
}

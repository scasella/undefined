// node scripts/decide-sessions.mjs [N=8] [set ...]   — live measurement of the Decide flow (docs/DECIDE-MEASUREMENTS.md).
//
// Question 1: of first-candidate rejections, what share are SPEC GAPS (the failing check's first diagnostic carries the
// `silentOn` marker, i.e. the card says "the spec was silent") vs CANDIDATE FAULTS (no marker) vs ACCEPTED FIRST TRY.
// Question 2: for each spec-gap session, take the Decide path with one ruling and record whether the flow reaches a
// commit within the retry budget (re-certified in place = 0 new candidates, or re-grown and committed within
// spec.maxAttempts), how many candidates it took and how long.
//
// Same harness shape as scripts/sessions.mjs (dev server with the live Codex service, real Worker watchdog, the real
// budget, fresh image per session via lib/drive.mjs openApp), so the split is comparable with docs/EXAMPLES.md. Runs
// ONE browser serially: the generation service is a serial queue, so parallel browsers only add queue wait to the times.
//
// A "set" is `<example>:<ruling>`, ruling one of
//   match   — the alternative that agrees with the failing check (what the shipped tests expect; median NaN)
//   differ  — a disagreeing alternative: for a number return `throws` (else the first enabled disagreeing one), for a
//             string return the candidate's own answer (slugify "don-t-stop")
//   none    — classify only, no ruling
//   <id>    — a GapAlternative id from engine.gapQuestion (e.g. `zero`)
// Each set is N fresh sessions; a ruling needs its own fresh grow, so the match and differ sets are separate sessions.
// Default: median:match median:differ slugify:match slugify:differ fibonacci:none.
//
// The ruling is taken through the page: the "spec was silent … · Decide" line under the accepted verdict is clicked,
// the alternative's radio is picked and Decide is pressed (the same DOM path scripts/replay-check.mjs drives). Where the
// grow exhausted its budget there is no accepted verdict, so the harness calls engine.decide with the same GapRef the
// rejection card builds (src/ui/decide.ts gapRefFor) — the exact call Decide.tsx makes; `via` records which.
//
// Writes .tmp/decide-sessions-out.json after every session and prints one line per session. Needs `codex` logged in;
// aborts if the app is not in live mode. Dev tooling only, never bundled; no telemetry.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { startServer, launch, openApp, runCall, engineCall } from './lib/drive.mjs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site, wherever this is run from

const N = Number(process.argv[2] ?? 8);
const sets = process.argv.slice(3).length ? process.argv.slice(3) : ['median:match', 'median:differ', 'slugify:match', 'slugify:differ', 'fibonacci:none'];
const CALLS = { median: 'median([3, 1, 4, 2])', slugify: 'slugify("Hello, World! Crème Brûlée")', fibonacci: 'fibonacci(90)' };
const OUT = '.tmp/decide-sessions-out.json';
mkdirSync('.tmp', { recursive: true });
const out = existsSync(OUT) && process.env.DECIDE_APPEND ? JSON.parse(readFileSync(OUT, 'utf8')) : { started: new Date().toISOString(), sets: {} };
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1));

/** First attempt of the current grow: gate, diagnostics' markers, body. Runs in the page (vite dev serves /src). */
const FIRST = async () => {
  const s = window.__undefined.state.value;
  const g = s.generation;
  if (!g) return null;
  const a = g.attempts[0];
  if (!a) return { status: 'none', phase: g.phase, error: g.error?.message ?? null };
  const gates = a.candidate?.gates ?? a.gates;
  const fail = gates.find((x) => x.status === 'fail');
  const diags = fail ? fail.diagnostics : [];
  let ref = null;
  let q = null;
  if (fail) {
    const m = await import('/src/ui/decide.ts');
    ref = m.gapRefFor(g, a, s.program);
    q = ref ? window.__undefined.gapQuestion(ref) : null;
  }
  return {
    status: a.status,
    declined: !!a.candidate?.declined,
    phase: g.phase,
    attempts: g.attempts.length,
    maxAttempts: g.maxAttempts,
    gate: fail?.gate ?? null,
    headline: fail?.headline ?? a.candidate?.headline ?? null,
    firstMarked: !!diags[0]?.silentOn,
    marked: diags.filter((d) => d.silentOn).length,
    diagnostics: diags.length,
    silentOn: diags[0]?.silentOn ?? null,
    check: diags[0]?.name ?? null,
    body: a.candidate?.body ?? a.shown,
    notes: a.candidate?.notes ?? null,
    later: g.attempts.slice(1).map((x) => ({ status: x.status, gate: (x.candidate?.gates ?? x.gates).find((y) => y.status === 'fail')?.gate ?? null, headline: x.candidate?.headline ?? null })),
    question: q && { call: q.call, kind: q.kind, check: q.check.name, expected: q.expectedShown, actual: q.actualShown, onlyAgreeing: q.onlyAgreeing ?? null, alternatives: q.alternatives.map((x) => ({ id: x.id, label: x.label, source: x.source, agrees: x.agrees, disabled: x.disabled ?? null, throws: !!(x.outcome && 'throws' in x.outcome) })) },
  };
};

function pickAlternative(q, ruling) {
  const enabled = q.alternatives.filter((x) => !x.disabled);
  if (ruling === 'match') return enabled.find((x) => x.agrees) ?? null;
  if (ruling === 'differ') {
    const dis = enabled.filter((x) => !x.agrees);
    return dis.find((x) => x.throws) ?? dis.find((x) => x.source === 'candidate') ?? dis[0] ?? null;
  }
  return enabled.find((x) => x.id === ruling) ?? null;
}

/** State after the ruling: revisions added, the grow it started (if any), whether a committed artifact is live. */
const AFTER = ({ fn, genBefore, revsBefore }) => {
  const s = window.__undefined.state.value;
  const rec = s.program.functions[fn];
  const g = s.generation;
  const regrow = g && g.id !== genBefore && g.kind !== 'recheck' ? g : null;
  const art = rec?.artifact;
  return {
    revisions: s.revisions.slice(revsBefore).map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
    decisions: (rec?.spec.decisions ?? []).map((d) => ({ call: d.call, waives: d.waives, test: d.test })),
    live: !!art && art.specHash === rec.specHash && art.testsHash === rec.testsHash,
    recheck: g && g.id !== genBefore && g.kind === 'recheck' ? { reason: g.recheck?.reason ?? null } : null,
    regrow: regrow && {
      call: regrow.call,
      phase: regrow.phase,
      maxAttempts: regrow.maxAttempts,
      error: regrow.error?.message ?? null,
      attempts: regrow.attempts.map((a) => {
        const gates = a.candidate?.gates ?? a.gates;
        const fail = gates.find((x) => x.status === 'fail');
        return { status: a.status, gate: fail?.gate ?? null, headline: fail?.headline ?? a.candidate?.headline ?? null, body: a.candidate?.body ?? a.shown, notes: a.candidate?.notes ?? null, prompt: a.candidate?.prompt ?? null };
      }),
    },
    notice: s.notice ?? null,
    repl: s.repl.filter((x) => x.kind !== 'input').slice(-3).map((x) => x.value ?? x.message ?? x.text ?? null),
  };
};

async function waitIdle(page, timeoutMs) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !window.__undefined.state.value.busy, null, { timeout: timeoutMs, polling: 200 });
}

async function rule(page, id, first, alt) {
  const before = await page.evaluate(() => ({ genBefore: window.__undefined.state.value.generation?.id ?? null, revsBefore: window.__undefined.state.value.revisions.length }));
  const t0 = Date.now();
  let via = 'engine';
  if (first.phase === 'committed' && (await page.locator('.silent-decide').count())) {
    via = 'page';
    await page.locator('.silent-decide').first().click();
    await page.waitForSelector('details.decide[open]', { timeout: 10000 });
    await page.locator(`details.decide[open] input[type=radio][value="${alt.id}"]`).check();
    await page.locator('details.decide[open] .decide-confirm').click();
  } else {
    await page.evaluate(async ({ altId }) => {
      const s = window.__undefined.state.value;
      const g = s.generation;
      const m = await import('/src/ui/decide.ts');
      const ref = m.gapRefFor(g, g.attempts[0], s.program);
      void window.__undefined.decide(ref, { alternative: altId }, { reason: 'measurement run' });
    }, { altId: alt.id });
  }
  await waitIdle(page, 900000);
  const after = await page.evaluate(AFTER, { fn: id, ...before });
  const ms = Date.now() - t0;
  let outcome;
  if (after.regrow) outcome = after.regrow.phase === 'committed' && after.live ? 'regrown-committed' : after.regrow.error ? 'regrow-error' : 'exhausted';
  else if (after.live && after.decisions.length > 0 && after.revisions.some((r) => r.kind === 'decision')) outcome = 'recertified';
  else outcome = 'error';
  return { via, ruling: { id: alt.id, label: alt.label, source: alt.source, agrees: alt.agrees }, outcome, candidates: after.regrow ? after.regrow.attempts.length : 0, ms, after };
}

const srv = await startServer({ mode: 'dev', port: 5199 });
const health = await fetch(`${srv.url}generate/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
out.health = health;
console.log('service', JSON.stringify(health));
const b = await launch();
try {
  for (const set of sets) {
    const [id, ruling] = set.split(':');
    const runs = (out.sets[set] = out.sets[set] ?? []);
    for (let i = runs.length; i < N; i++) {
      const t0 = Date.now();
      await openApp(b.page, srv.url);
      const mode = await b.page.evaluate(() => window.__undefined.state.value.mode);
      if (mode !== 'live') throw new Error(`app is in ${mode} mode: is codex installed and logged in?`);
      if (id !== 'median') await engineCall(b.page, 'loadExample', id);
      await runCall(b.page, CALLS[id], { timeoutMs: 400000 });
      const growMs = Date.now() - t0;
      const first = await b.page.evaluate(FIRST);
      const cls = !first || first.status === 'none' ? 'error' : first.declined ? 'declined' : first.status === 'accepted' ? 'accepted' : first.firstMarked ? 'gap' : 'fault';
      const run = { i, at: new Date().toISOString(), growMs, class: cls, first };
      if (cls === 'gap' && ruling !== 'none') {
        const alt = first.question && pickAlternative(first.question, ruling);
        if (!alt) run.decide = { outcome: 'no-alternative', question: first.question };
        else {
          try {
            run.decide = await rule(b.page, id, first, alt);
          } catch (e) {
            run.decide = { outcome: 'harness-error', error: String(e).split('\n')[0] };
          }
        }
      }
      runs.push(run);
      save();
      const d = run.decide;
      console.log(
        set.padEnd(16),
        `#${i}`,
        cls.padEnd(8),
        `${first?.gate ?? '-'} ${first?.phase ?? '-'} ${first?.attempts ?? 0}/${first?.maxAttempts ?? '-'}`,
        `grow ${Math.round(growMs / 1000)}s`,
        d ? `| decide ${d.ruling?.label ?? ''} via ${d.via ?? '-'} → ${d.outcome} (${d.candidates ?? 0} cand, ${Math.round((d.ms ?? 0) / 1000)}s)` : '',
        `| ${(first?.headline ?? '').slice(0, 90)}`,
      );
    }
  }
} finally {
  out.finished = new Date().toISOString();
  save();
  await b.close();
  srv.stop();
}

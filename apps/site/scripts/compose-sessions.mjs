// node scripts/compose-sessions.mjs [N=8] [set ...]   — live measurement of Phase 3 composition (docs/COMPOSE-MEASUREMENTS.md).
//
// A "set" is `<dep>><target>`: commit <dep> first from its SHIPPED recording (loadRecording + its call: the recorded
// candidates replay, the gates run live, no model call), then run <target> LIVE with <dep> certified in the program, so
// the target's prompt carries the OTHER FUNCTIONS section. <target> is either a shipped example id (median, slugify,
// fibonacci, orders: its spec is loaded with loadExample and its pre-typed call is run; compare with docs/EXAMPLES.md)
// or a spec-less scenario key from SCENARIOS below (slugifyAll, uniqueSlugs, medianOfMedians, spread).
// Default sets: slugify>median median>slugify median>fibonacci slugify>orders slugify>slugifyAll slugify>uniqueSlugs
//               median>medianOfMedians median>spread
//
// Per session: every attempt's source (must be 'live' for the target, or the session is flagged), status, rejecting gate
// and headline, whether its prompt carries OTHER FUNCTIONS naming the dependency, whether its body names the dependency
// (regex), and for a commit the recorded Artifact.deps. Same driver as scripts/sessions.mjs / decide-sessions.mjs (dev
// server with the live Codex service, real Worker watchdog, real attempt budget, a fresh image per session). ONE browser,
// serial: the generation service is a serial queue. Writes .tmp/compose-sessions-out.json after every session; with
// COMPOSE_APPEND=1 it resumes. Needs `codex` logged in; aborts if the app is not in live mode. Dev tooling only.
//
// `node scripts/compose-sessions.mjs stale` instead drives ONE dependency-staleness cycle: slugify committed from its
// recording, slugifyAll grown live until it commits calling slugify, then "Break it" on slugify (its spec changes) and a
// call to slugifyAll; records functionStatus (the Repo's text) for both functions at each step.
// `node scripts/compose-sessions.mjs decide` drives ONE ruling cycle: median committed from its recording, medianOfMedians
// grown live until it calls median, then a Decide ruling that disagrees with median's tests (median([]) throws), so
// median is regrown live; records the same status per step. COMPOSE_PORT (default 5199) picks the dev server port, so a
// run can go beside scripts/sessions.mjs.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, launch, openApp, runCall, engineCall, gapRefInPage } from './lib/drive.mjs';
process.chdir(new URL('../', import.meta.url).pathname); // paths below are relative to apps/site, wherever this is run from

const EXAMPLE_CALLS = { median: 'median([3, 1, 4, 2])', slugify: 'slugify("Hello, World! Crème Brûlée")', fibonacci: 'fibonacci(90)', orders: 'topCustomersByRevenue(rows)' };
const EXAMPLE_FN = { median: 'median', slugify: 'slugify', fibonacci: 'fibonacci', orders: 'topCustomersByRevenue' };
const SCENARIOS = {
  slugifyAll: 'slugifyAll(["Hello, World!", "Crème Brûlée", "Don\'t Stop"])',
  uniqueSlugs: 'uniqueSlugs(["Hello World", "Hello, World!", "Crème Brûlée"])',
  medianOfMedians: 'medianOfMedians([[3, 1, 2], [9, 7, 8], [5, 4, 6, 10]])',
  spread: 'spread([3, 1, 4, 1, 5, 9, 2, 6])',
};
const args = process.argv.slice(2);
const STALE = args[0] === 'stale';
const DECIDE = args[0] === 'decide';
const N = STALE || DECIDE ? 1 : Number(args[0] ?? 8);
const sets = !STALE && !DECIDE && args.slice(1).length ? args.slice(1) : ['slugify>median', 'median>slugify', 'median>fibonacci', 'slugify>orders', 'slugify>slugifyAll', 'slugify>uniqueSlugs', 'median>medianOfMedians', 'median>spread'];
const OUT = process.env.COMPOSE_OUT ?? (STALE ? '.tmp/compose-stale-out.json' : DECIDE ? '.tmp/compose-decide-out.json' : '.tmp/compose-sessions-out.json');
mkdirSync('.tmp', { recursive: true });
const out = existsSync(OUT) && process.env.COMPOSE_APPEND ? JSON.parse(readFileSync(OUT, 'utf8')) : { started: new Date().toISOString(), sets: {} };
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1));

/** The current grow, per attempt, with what composition adds. Runs in the page. */
const GROW = ({ fn, dep }) => {
  const s = window.__undefined.state.value;
  const g = s.generation;
  const rec = s.program.functions[fn];
  // "names" = calls or passes the dependency and does not declare its own (a local `median` variable is not a call)
  const calls = (b) => new RegExp(`\\b${dep}\\s*\\(|[(,]\\s*${dep}\\s*[),]`).test(b) && !new RegExp(`(function|const|let|var)\\s+${dep}\\b`).test(b);
  const attempts = (g?.attempts ?? []).map((a) => {
    const c = a.candidate;
    const gates = c?.gates ?? a.gates ?? [];
    const fail = gates.find((x) => x.status === 'fail');
    const body = c?.body ?? a.shown ?? '';
    return {
      status: a.status,
      source: c?.source ?? null,
      declined: c?.declined ? { reason: c.declined.reason, message: c.declined.message } : null,
      gate: fail?.gate ?? null,
      headline: fail?.headline ?? c?.headline ?? null,
      promptHasOthers: !!c?.prompt && c.prompt.includes('OTHER FUNCTIONS') && c.prompt.includes(`function ${dep}(`),
      bodyNamesDep: calls(body),
      body,
      notes: c?.notes ?? null,
    };
  });
  return {
    fn: g?.fn ?? null,
    phase: g?.phase ?? null,
    error: g?.error?.message ?? null,
    maxAttempts: g?.maxAttempts ?? null,
    attempts,
    committed: !!rec?.artifact && rec.artifact.specHash === rec.specHash,
    deps: rec?.artifact?.deps ? Object.keys(rec.artifact.deps) : [],
    depArtifact: !!s.program.functions[dep]?.artifact,
    prompt: g?.attempts?.[0]?.candidate?.prompt ?? null,
    repl: s.repl.filter((x) => x.kind !== 'input').slice(-2).map((x) => String(x.value ?? x.message ?? x.text ?? '').slice(0, 200)),
  };
};

/**
 * Each named function's status, as the original REPL's Repo tab said it (certified rN / invalid: spec changed / out of
 * date: x changed in rN / waiting for x / no code yet; the rule is the engine's compose/graph.ts dependencyStatus, loaded
 * from the dev server by its file path), plus the current generation's kind.
 */
const GRAPH = `/@fs${fileURLToPath(new URL('../../../packages/engine/src/compose/graph.ts', import.meta.url))}`;
const STATUS = async ({ names, graph }) => {
  const { dependencyStatus } = await import(graph);
  const and = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const s = window.__undefined.state.value;
  const fns = {};
  for (const n of names) {
    const rec = s.program.functions[n];
    if (!rec) { fns[n] = 'absent'; continue; }
    const a = rec.artifact;
    let kind;
    let text;
    if (!a) [kind, text] = ['none', 'no code yet — written on the first call'];
    else if (a.specHash !== rec.specHash || a.testsHash !== rec.testsHash) {
      const what = a.specHash !== rec.specHash && a.testsHash !== rec.testsHash ? 'spec and tests' : a.specHash !== rec.specHash ? 'spec' : 'tests';
      [kind, text] = ['stale', `invalid: ${what} changed — regenerates on next call`];
    } else {
      const st = dependencyStatus(s.program, n);
      if (st.kind === 'changed') {
        const changed = st.calls.filter((c) => c.state === 'changed');
        [kind, text] = ['changed', `out of date: ${and(changed.map((c) => c.name))} changed in ${and([...new Set(changed.map((c) => `r${c.nowRevision ?? c.certifiedRevision}`))])}`];
      } else if (st.kind === 'waiting') [kind, text] = ['waiting', `waiting for ${and(st.waitingFor)}`];
      else [kind, text] = ['certified', `certified r${a.revision}`];
    }
    fns[n] = { kind, text, uses: Object.keys(a?.deps ?? {}).sort(), revision: a?.revision ?? null, body: a?.body ?? null };
  }
  const g = s.generation;
  return {
    head: s.headRevision,
    fns,
    generation: g && { fn: g.fn, kind: g.kind ?? 'grow', call: g.call ?? null, phase: g.phase, recheck: g.recheck ?? null, attempts: g.attempts.map((a) => ({ status: a.status, source: a.candidate?.source ?? null, gate: (a.candidate?.gates ?? a.gates ?? []).find((x) => x.status === 'fail')?.gate ?? null, headline: a.candidate?.headline ?? null, body: a.candidate?.body ?? null })) },
    revisions: s.revisions.slice(-6).map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
    repl: s.repl.filter((x) => x.kind !== 'input').slice(-3).map((x) => String(x.value ?? x.message ?? x.text ?? '').slice(0, 240)),
    notice: s.notice ?? null,
  };
};

async function precommit(page, dep) {
  // loadRecording's `url` accepts only full https:// links, so the shipped file is fetched in the page and passed as text
  // (an earlier version passed the path, the load failed with a notice, and the dependency was grown live spec-less).
  await page.evaluate(async (u) => {
    const text = await fetch(u).then((r) => r.text());
    await window.__undefined.loadRecording({ text, source: u });
  }, `/recordings/${dep}.json`);
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !window.__undefined.state.value.busy, null, { timeout: 60000, polling: 100 });
  const r = await runCall(page, EXAMPLE_CALLS[dep], { timeoutMs: 120000 });
  const ok = await page.evaluate((fn) => {
    const s = window.__undefined.state.value;
    const r = s.program.functions[fn];
    const g = s.generation;
    return {
      committed: !!r?.artifact && r.artifact.specHash === r.specHash && r.artifact.testsHash === r.testsHash,
      specd: (r?.spec.doc ?? '') !== '' && r?.spec.origin !== 'call',
      sources: (g?.attempts ?? []).map((a) => a.candidate?.source ?? null),
      notice: s.notice?.tone === 'error' ? s.notice.text : null,
    };
  }, EXAMPLE_FN[dep]);
  if (!ok.committed || !ok.specd || ok.sources.some((x) => x !== 'replay')) {
    throw new Error(`precommit of ${dep} from its recording failed: ${JSON.stringify(ok)} ${JSON.stringify(r.generation?.attempts?.map((a) => a.status))}`);
  }
}

const srv = await startServer({ mode: 'dev', port: Number(process.env.COMPOSE_PORT ?? 5199) });
const health = await fetch(`${srv.url}generate/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
out.health = health;
console.log('service', JSON.stringify(health));
const b = await launch();
try {
  if (DECIDE) {
    // One ruling cycle through a dependency: median committed from its recording (first candidate rejected on the
    // empty list, a spec gap), medianOfMedians grown live until it calls median, the page reloaded (so median's regrow
    // is live), then a Decide ruling on median's gap that DISAGREES with the tests (median([]) throws), so median is
    // regrown; then medianOfMedians is called again. Records the Repo text for both at each step.
    const steps = (out.steps = []);
    const names = ['median', 'medianOfMedians'];
    let ref = null;
    let alt = null;
    for (let tries = 1; ; tries++) {
      await openApp(b.page, srv.url);
      await precommit(b.page, 'median');
      ({ ref, alt } = await b.page.evaluate((ref) => {
        const q = ref && window.__undefined.gapQuestion(ref);
        const alt = q?.alternatives.find((x) => !x.disabled && !x.agrees && x.outcome && 'throws' in x.outcome) ?? null;
        return { ref, alt: alt && { id: alt.id, label: alt.label } };
      }, await b.page.evaluate(gapRefInPage, 0)));
      if (!ref || !alt) throw new Error('median recording gave no decidable gap');
      await runCall(b.page, SCENARIOS.medianOfMedians, { timeoutMs: 400000 });
      const g = await b.page.evaluate(GROW, { fn: 'medianOfMedians', dep: 'median' });
      steps.push({ step: `grow medianOfMedians (try ${tries})`, grow: g, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
      save();
      console.log('grow medianOfMedians', g.phase, 'deps', g.deps.join(','));
      if (g.committed && g.deps.includes('median')) break;
      if (tries >= 6) throw new Error('medianOfMedians never committed calling median');
    }
    let t = Date.now();
    await openApp(b.page, srv.url, { fresh: false });
    steps.push({ step: 'reload the page (image kept, loaded recording dropped)', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    t = Date.now();
    await b.page.evaluate(({ ref, altId }) => void window.__undefined.decide(ref, { alternative: altId }, { reason: 'measurement run' }), { ref, altId: alt.id });
    await b.page.waitForTimeout(400);
    await b.page.waitForFunction(() => !window.__undefined.state.value.busy, null, { timeout: 900000, polling: 200 });
    steps.push({ step: `decide on median's gap: ${alt.label}`, ms: Date.now() - t, grow: await b.page.evaluate(GROW, { fn: 'median', dep: 'median' }), status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    save();
    console.log('after decide', JSON.stringify(steps.at(-1).status.fns));
    t = Date.now();
    await runCall(b.page, SCENARIOS.medianOfMedians, { timeoutMs: 600000 });
    steps.push({ step: 'call medianOfMedians after the ruling', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    t = Date.now();
    await runCall(b.page, 'medianOfMedians([[], [1, 2]])', { timeoutMs: 600000 });
    steps.push({ step: 'call medianOfMedians([[], [1, 2]])', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    save();
    console.log('final', JSON.stringify(steps.at(-1).status.fns), JSON.stringify(steps.at(-1).status.repl));
  } else if (STALE) {
    const steps = (out.steps = []);
    const t0 = Date.now();
    await openApp(b.page, srv.url);
    if ((await b.page.evaluate(() => window.__undefined.state.value.mode)) !== 'live') throw new Error('app not in live mode');
    await precommit(b.page, 'slugify');
    const names = ['slugify', 'slugifyAll'];
    let tries = 0;
    for (;;) {
      tries++;
      await runCall(b.page, SCENARIOS.slugifyAll, { timeoutMs: 400000 });
      const g = await b.page.evaluate(GROW, { fn: 'slugifyAll', dep: 'slugify' });
      steps.push({ step: `grow slugifyAll (try ${tries})`, grow: g, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
      save();
      console.log('grow slugifyAll', g.phase, 'deps', g.deps.join(','), g.attempts.map((a) => a.gate ?? a.status).join(','));
      if (g.committed && g.deps.includes('slugify')) break;
      if (tries >= 6) throw new Error('slugifyAll never committed calling slugify');
      // reimplemented or failed: start over with a fresh image
      await openApp(b.page, srv.url);
      await precommit(b.page, 'slugify');
    }
    // Reload the page (the image persists): the loaded recording is per page load, so slugify's regrow after the break
    // goes to the live model instead of replaying the recording's own break-it session; and the reload recompiles the
    // composed artifact from the stored image (compose-design §D's biggest risk).
    let t = Date.now();
    await openApp(b.page, srv.url, { fresh: false });
    steps.push({ step: 'reload the page (image kept, loaded recording dropped)', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    save();
    console.log('after reload', JSON.stringify(steps.at(-1).status.fns));
    t = Date.now();
    await engineCall(b.page, 'breakIt', 'slugify');
    steps.push({ step: 'break it: slugify (spec edited)', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    save();
    console.log('after break', JSON.stringify(steps.at(-1).status.fns));
    t = Date.now();
    await runCall(b.page, SCENARIOS.slugifyAll, { timeoutMs: 600000 });
    steps.push({ step: 'call slugifyAll after the break', ms: Date.now() - t, grow: await b.page.evaluate(GROW, { fn: 'slugify', dep: 'slugify' }), status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    save();
    console.log('after call', JSON.stringify(steps.at(-1).status.fns), JSON.stringify(steps.at(-1).status.generation));
    // if the call left slugifyAll needing a re-check, ask for one explicitly (the Repo's Re-check button)
    const st = steps.at(-1).status.fns.slugifyAll;
    if (st.kind === 'changed') {
      t = Date.now();
      await engineCall(b.page, 'recheck', 'slugifyAll');
      steps.push({ step: 'explicit re-check of slugifyAll', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
      save();
    }
    t = Date.now();
    await runCall(b.page, SCENARIOS.slugifyAll, { timeoutMs: 600000 });
    steps.push({ step: 'call slugifyAll again', ms: Date.now() - t, status: await b.page.evaluate(STATUS, { names, graph: GRAPH }) });
    out.totalMs = Date.now() - t0;
    save();
    console.log('final', JSON.stringify(steps.at(-1).status.fns), JSON.stringify(steps.at(-1).status.repl));
  } else {
    for (const set of sets) {
      const [dep, target] = set.split('>');
      const isExample = target in EXAMPLE_CALLS;
      const fn = isExample ? EXAMPLE_FN[target] : target;
      const call = isExample ? EXAMPLE_CALLS[target] : SCENARIOS[target];
      const depFn = EXAMPLE_FN[dep];
      const runs = (out.sets[set] = out.sets[set] ?? []);
      for (let i = runs.length; i < N; i++) {
        const t0 = Date.now();
        await openApp(b.page, srv.url);
        if ((await b.page.evaluate(() => window.__undefined.state.value.mode)) !== 'live') throw new Error('app not in live mode: is codex installed and logged in?');
        let run;
        try {
          await precommit(b.page, dep);
          if (isExample && target !== 'median') await engineCall(b.page, 'loadExample', target);
          const t1 = Date.now();
          await runCall(b.page, call, { timeoutMs: 600000 });
          const g = await b.page.evaluate(GROW, { fn, dep: depFn });
          const first = g.attempts[0];
          const cls = !first ? 'error' : first.declined ? 'declined' : first.status === 'accepted' ? 'accepted' : first.gate ?? first.status;
          run = { i, at: new Date().toISOString(), growMs: Date.now() - t1, totalMs: Date.now() - t0, first: cls, allLive: g.attempts.every((a) => a.source === 'live' || a.declined), ...g };
          if (i > 0) delete run.prompt; // keep one full prompt per set
        } catch (e) {
          run = { i, at: new Date().toISOString(), harnessError: String(e).split('\n')[0] };
        }
        runs.push(run);
        save();
        console.log(
          set.padEnd(24), `#${i}`, String(run.first ?? 'ERR').padEnd(10),
          `${run.phase ?? '-'} ${run.attempts?.length ?? 0}/${run.maxAttempts ?? '-'}`,
          `deps[${(run.deps ?? []).join(',')}]`, `names-dep ${(run.attempts ?? []).map((a) => (a.bodyNamesDep ? 'y' : 'n')).join('')}`,
          `others-in-prompt ${(run.attempts ?? []).map((a) => (a.promptHasOthers ? 'y' : 'n')).join('')}`,
          run.allLive === false ? 'NOT-ALL-LIVE' : '', `grow ${Math.round((run.growMs ?? 0) / 1000)}s`,
          `| ${(run.attempts?.find((a) => a.headline)?.headline ?? run.harnessError ?? '').slice(0, 90)}`,
        );
      }
    }
  }
} finally {
  out.finished = new Date().toISOString();
  save();
  await b.close();
  srv.stop();
}

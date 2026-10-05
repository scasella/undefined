// node apps/site/scripts/parity-measure.mjs [--write] — the BROWSER side of the Node/CLI parity check
// (docs/EVIDENCE.md "Node and CLI parity"). `npm run build:check` first (`npm run measure:parity` does both and writes).
//
// Replays every session of every shipped recording in headless Chrome through `vite preview` of dist-check/ (the
// shipped sources built in development mode so the engine hook window.__undefined exists; no backend, replay mode, the
// real Worker watchdog): session 1 by engine.loadExample + submit, session 2 by engine.breakIt + submit (the spec change
// the example ships). For every attempt it reads the engine's own facts (state.generation attempts and their gate
// results; the committed Artifact and, after the lazy broken-copy check, Artifact.evidence.mutation) and formats them
// in Node with the same functions the site and the parity suites use:
//   - a rejection: the gate rows, the rejecting gate's line ("✕ REJECTED BY <GATE> — <class> · #n", explain.ts
//     rejectionClass) and the headline text (explain.ts plainHeadline);
//   - the accepted attempt: the gate rows, then the "What was checked" sentence (lib/evidence.ts plainEvidence), the
//     evidence line (engine shared/evidence.ts describeEvidence: what the CLI and eject print) and each surviving
//     mutant's line (survivorLine).
// The recordings themselves carry only the model's bodies (prompt/body/notes/durationMs/progress), not gate results, so
// this is the only source of the site's measured values. --write saves them to
// apps/site/src/examples/parity.browser.json, which both parity suites read (src/examples/parity.node.test.ts and
// scripts/cli.parity.ts). Re-run with --write whenever the recordings change.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { startServer, launch, openApp } from './lib/drive.mjs';

const SITE = fileURLToPath(new URL('../', import.meta.url));
process.chdir(SITE);
const WRITE = process.argv.includes('--write');
const OUT = fileURLToPath(new URL('../src/examples/parity.browser.json', import.meta.url));
const EX = ['median', 'slugify', 'fibonacci', 'orders'];

// the site's own formatting (TypeScript sources, loaded through Vite's module runner)
const load = async (id) => (await runnerImport(id, { configFile: false, root: SITE, logLevel: 'error' })).module;
const { plainEvidence } = await load(fileURLToPath(new URL('../src/lib/evidence.ts', import.meta.url)));
const { plainHeadline, plainGateText, rejectionClass } = await load(fileURLToPath(new URL('../src/lib/explain.ts', import.meta.url)));
const { describeEvidence, survivorLine } = await load('@scasella/undefined-engine/shared/evidence');
const GATE_LABEL = { compile: 'Compile', tests: 'Tests', properties: 'Properties', invariants: 'Invariants' };
const flat = (t) => t.replace(/\s+/g, ' ').trim();

const srv = await startServer({ mode: 'preview', port: 5207, outDir: 'dist-check' });
const b = await launch({ width: 1440, height: 900 });
const p = b.page;
const chrome = b.browser.version();

/** In the page: the facts of the current generation and, for its committed artifact, the evidence. */
const FACTS = () => {
  const s = window.__undefined.state.value;
  const g = s.generation;
  const art = g && g.phase === 'committed' ? s.program.functions[g.fn]?.artifact : null;
  return {
    head: s.headRevision,
    busy: s.busy,
    phase: g?.phase ?? null,
    error: g?.error?.message ?? null,
    attempts: (g?.attempts ?? []).map((a) => ({ attempt: a.attempt, status: a.status, gates: a.gates, headline: a.candidate?.headline ?? null })),
    artifact: art && art.revision === g.revision ? { revision: art.revision, evidence: art.evidence, deps: Object.keys(art.deps ?? {}).sort() } : null,
  };
};

/** Submit what is typed; wait for a NEW committed revision and its finished broken-copy check; return the attempts. */
async function submitAndMeasure() {
  const before = await p.evaluate(() => window.__undefined.state.value.headRevision);
  const t0 = Date.now();
  await p.evaluate(() => void window.__undefined.submit());
  await p.waitForFunction((h) => { const s = window.__undefined.state.value; return !s.busy && s.headRevision > h && s.generation?.phase === 'committed'; }, before, { timeout: 180000, polling: 50 });
  const committedMs = Date.now() - t0;
  // the lazy broken-copy check starts after the commit and an idle pause (engine.ts scheduleMutation): wait for its report
  await p.waitForFunction(() => {
    const s = window.__undefined.state.value;
    const g = s.generation;
    const a = g && s.program.functions[g.fn]?.artifact;
    return !!a && a.revision === g.revision && !!a.evidence?.mutation && (!s.mutation || s.mutation.phase === 'done');
  }, null, { timeout: 180000, polling: 100 });
  const f = await p.evaluate(FACTS);
  const gates = (a) => a.gates.map((x) => ({ gate: GATE_LABEL[x.gate], status: x.status }));
  const attempts = f.attempts.map((a) => {
    if (a.status === 'rejected') {
      const fail = a.gates.find((x) => x.status === 'fail');
      const note = fail.note && fail.note !== 'spec error' ? ` · ${plainGateText(fail.note)}` : '';
      const gateLine = `✕ REJECTED BY ${GATE_LABEL[fail.gate]} — ${rejectionClass(fail)} · #${a.attempt}${note}`.toUpperCase();
      return { verdict: 'rejected', gates: gates(a), rejection: { gateLine, headline: flat(plainHeadline(fail.headline ?? a.headline ?? `Rejected by ${fail.gate}`)) } };
    }
    const ev = f.artifact.evidence;
    return {
      verdict: 'accepted',
      gates: gates(a),
      text: flat(plainEvidence(ev, f.artifact.deps)),
      evidenceLine: describeEvidence(ev, f.artifact.deps),
      survivors: (ev.mutation?.survivors ?? []).map(survivorLine),
      committed: `r${f.artifact.revision}`,
    };
  });
  return { attempts, committedMs };
}

const out = {};
try {
  for (const id of EX) {
    await openApp(p, srv.url);
    await p.evaluate((x) => window.__undefined.loadExample(x), id);
    const s1 = await submitAndMeasure();
    console.log(id, 'session 1', JSON.stringify(s1.attempts.map((a) => (a.verdict === 'rejected' ? a.rejection.gateLine : a.text))));
    // session 2: the example's "Break it" spec change, then the call it pre-types
    await p.evaluate((x) => window.__undefined.breakIt(x), id);
    const s2 = await submitAndMeasure();
    console.log(id, 'session 2', JSON.stringify(s2.attempts.map((a) => (a.verdict === 'rejected' ? a.rejection.gateLine : a.text))));
    out[id] = [s1.attempts, s2.attempts];
  }
} finally {
  await b.close();
  srv.stop();
}

const doc = {
  measuredAt: new Date().toISOString(),
  how: 'node apps/site/scripts/parity-measure.mjs --write (dist-check: the site built in development mode for the engine hook, vite preview, replay mode, headless Chrome, real Worker watchdog)',
  head: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
  dirtyTree: execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0,
  chrome,
  recordings: Object.fromEntries(EX.map((id) => [id, JSON.parse(readFileSync(`public/recordings/${id}.json`, 'utf8')).sessions.map((s) => s.specHash)])),
  examples: out,
};
if (WRITE) {
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
} else console.log(JSON.stringify(doc, null, 2));

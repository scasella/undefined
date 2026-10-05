// node scripts/mutation-check.mjs — what a visitor is told: replay each shipped example in headless Chrome (vite preview
// of dist-check/, no backend, replay mode), wait for the lazy mutation check, and print the app's own "What was checked"
// sentence (lib/evidence.ts plainEvidence over Artifact.evidence, with the mutation report). `npm run build:check` first.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { startServer, launch, openApp } from './lib/drive.mjs';

const SITE = fileURLToPath(new URL('../', import.meta.url));
const { plainEvidence } = (await runnerImport(fileURLToPath(new URL('../src/lib/evidence.ts', import.meta.url)), { configFile: false, root: SITE, logLevel: 'error' })).module;
const EX = ['median', 'slugify', 'fibonacci'];
const srv = await startServer({ mode: 'preview', port: 5204, outDir: 'dist-check' });
const b = await launch({ width: 1440, height: 900 });
const p = b.page;
const out = {};
try {
  for (const id of EX) {
    await openApp(p, srv.url);
    const before = await p.evaluate(() => window.__undefined.state.value.headRevision);
    await p.evaluate((x) => window.__undefined.loadExample(x), id);
    await p.evaluate(() => void window.__undefined.submit());
    await p.waitForFunction((h) => { const s = window.__undefined.state.value; return !s.busy && s.headRevision > h && s.generation?.phase === 'committed'; }, before, { timeout: 120000 });
    // the lazy check starts >= 10 s after the submit and 4 s idle; wait for its report on the committed artifact
    const ev = await p
      .waitForFunction(() => {
        const s = window.__undefined.state.value;
        const g = s.generation;
        const a = g && s.program.functions[g.fn]?.artifact;
        return a && a.revision === g.revision && a.evidence?.mutation && (!s.mutation || s.mutation.phase === 'done') ? { evidence: a.evidence, deps: Object.keys(a.deps ?? {}).sort() } : false;
      }, null, { timeout: 120000 })
      .then((h) => h.jsonValue());
    out[id] = `What was checked ${plainEvidence(ev.evidence, ev.deps)}`.replace(/\s+/g, ' ');
    console.log(id.padEnd(10), out[id]);
  }
} finally {
  await b.close();
  srv.stop();
}

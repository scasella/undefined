// node scripts/record.mjs [id ...]   (default: median slugify fibonacci)
// Records REAL live sessions (Codex, your login) for each example and its "Break it" edit, through the real app in
// headless Chrome, and writes public/recordings/<id>.json (format v2: full spec + calls per session).
// Honesty rule: a recording is kept only if the first candidate of the ORIGINAL session was rejected (the typical
// outcome, see README); the number of tries is printed so the curation is never hidden.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, openApp, runCall, engineCall } from './lib/drive.mjs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['median', 'slugify', 'fibonacci'];
const CALLS = { median: 'median([3, 1, 4, 2])', slugify: 'slugify("Hello, World! Crème Brûlée")', fibonacci: 'fibonacci(90)', orders: 'topCustomersByRevenue(rows)' };
// Spec-less examples have no tests, so there is nothing to reject on the first candidate: committed is the requirement.
const SPECLESS = new Set(['orders']);
const MAX_TRIES = 4;
mkdirSync('public/recordings', { recursive: true });
const srv = await startServer({ mode: 'dev', port: 5193 });
const b = await launch();
try {
  for (const id of ids) {
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      await openApp(b.page, srv.url);
      if (id !== 'median') await engineCall(b.page, 'loadExample', id);
      const first = await runCall(b.page, CALLS[id]);
      const firstRejected = first.generation?.attempts[0]?.rejectedBy ?? null;
      await engineCall(b.page, 'breakIt', id);
      const second = await runCall(b.page, CALLS[id]);
      const ok = (firstRejected || SPECLESS.has(id)) && first.generation.phase === 'committed' && second.generation.phase === 'committed';
      console.log(`${id} try ${attempt}: first candidate ${firstRejected ? 'rejected by ' + firstRejected : 'ACCEPTED'}, original ${first.generation.phase}, after break ${second.generation.phase} (${second.generation.attempts.map((a) => a.rejectedBy ?? a.status).join(',')})`);
      if (!ok) continue;
      const rec = await b.page.evaluate(() => window.__undefined.exportRecording());
      rec.id = id;
      rec.title = `${id} — recorded live session`;
      rec.sessions = rec.sessions.filter((s) => s.fn === id);
      writeFileSync(`public/recordings/${id}.json`, JSON.stringify(rec, null, 1) + '\n');
      console.log(`  saved public/recordings/${id}.json (v${rec.version}, ${rec.sessions.length} sessions, tries: ${attempt})`);
      break;
    }
  }
  const names = readdirSync('public/recordings').filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  writeFileSync('public/recordings/index.json', JSON.stringify(names, null, 1) + '\n');
} finally {
  await b.close();
  srv.stop();
}

// node scripts/sessions.mjs [N=8] [id ...]  — SESSION-level rates through the real app (dev server, real Worker
// watchdog, the real 3-attempt budget): for each example, N fresh sessions of its pre-typed call. Writes
// .tmp/sessions-out.json and prints a table. This is the number to quote, not the single-retry sampling of tune.
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch, openApp, runCall, engineCall } from './lib/drive.mjs';
const N = Number(process.argv[2] ?? 8);
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['median', 'slugify', 'fibonacci', 'orders'];
const CALLS = { median: 'median([3, 1, 4, 2])', slugify: 'slugify("Hello, World! Crème Brûlée")', fibonacci: 'fibonacci(90)', orders: 'topCustomersByRevenue(rows)' };
mkdirSync('.tmp', { recursive: true });
const srv = await startServer({ mode: 'dev', port: 5199 });
const out = {};
try {
  // sessions are independent: run a few browsers side by side (the generation service serialises codex calls itself)
  for (const id of ids) {
    const runs = [];
    const workers = Array.from({ length: 3 }, async (_, w) => {
      const b = await launch();
      try {
        for (let i = w; i < N; i += 3) {
          const t0 = Date.now();
          await openApp(b.page, srv.url);
          if (id !== 'median') await engineCall(b.page, 'loadExample', id);
          const r = await runCall(b.page, CALLS[id], { timeoutMs: 240000 });
          const g = r.generation;
          runs.push({ i, ms: Date.now() - t0, phase: g?.phase, attempts: g?.attempts.map((a) => ({ status: a.status, rejectedBy: a.rejectedBy, headline: a.headline })), declined: !!g?.declined });
        }
      } finally { await b.close(); }
    });
    await Promise.all(workers);
    runs.sort((a, b) => a.i - b.i);
    const first = runs.map((r) => r.attempts?.[0]?.rejectedBy ?? (r.attempts?.[0]?.status === 'accepted' ? 'accepted' : r.phase));
    const rejected = runs.filter((r) => r.attempts?.[0]?.status === 'rejected');
    const committed = runs.filter((r) => r.phase === 'committed');
    const rejCommitted = rejected.filter((r) => r.phase === 'committed');
    out[id] = { N, firstAttempt: first.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}), firstRejected: rejected.length, committedWithinBudget: committed.length, rejectedThenCommitted: rejCommitted.length, meanSeconds: Math.round(runs.reduce((s, r) => s + r.ms, 0) / runs.length / 100) / 10, runs };
    console.log(id.padEnd(10), 'first attempt', JSON.stringify(out[id].firstAttempt), '| committed within 3 attempts', committed.length + '/' + N, '| of the', rejected.length, 'rejected first, recovered', rejCommitted.length, '| mean', out[id].meanSeconds + ' s');
    writeFileSync('.tmp/sessions-out.json', JSON.stringify({ at: new Date().toISOString(), out }, null, 1));
  }
} finally { srv.stop(); }

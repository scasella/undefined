// node scripts/hostile.mjs [startIndex] [endIndex]  — types what strangers type, live, with no spec, into a fresh image
// each time. Raw results go to .tmp/hostile-raw.json; docs/HOSTILE.md is written from them by hand.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { startServer, launch, openApp, runCall } from './lib/drive.mjs';
const calls = JSON.parse(readFileSync(new URL('./hostile-calls.json', import.meta.url)));
const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? calls.length);
const out = existsSync('.tmp/hostile-raw.json') ? JSON.parse(readFileSync('.tmp/hostile-raw.json')) : {};
const srv = await startServer({ mode: 'dev', port: 5192 });
const b = await launch();
try {
  for (let i = from; i < to; i++) {
    const c = calls[i];
    const t0 = Date.now();
    await openApp(b.page, srv.url);
    let r;
    try {
      for (const s of c.setup ?? []) await runCall(b.page, s, { timeoutMs: 60000 });
      r = await runCall(b.page, c.call, { timeoutMs: 150000 });
      const follow = [];
      for (const t of c.then ?? []) follow.push(await runCall(b.page, t, { timeoutMs: 150000 }));
      r.follow = follow.map((f) => f.repl.at(-1));
    } catch (e) {
      r = { error: String(e.message).slice(0, 300) };
    }
    r.cat = c.cat; r.call = c.call; r.ms = Date.now() - t0;
    out[i] = r;
    writeFileSync('.tmp/hostile-raw.json', JSON.stringify(out, null, 1));
    const g = r.generation;
    console.log(i, c.call.slice(0, 48).padEnd(48), g ? g.phase + ' ' + g.attempts.map((a) => a.rejectedBy ?? a.status).join(',') : '-', '|', JSON.stringify(r.repl?.at(-1)?.value ?? r.error).slice(0, 60));
  }
} finally {
  await b.close();
  srv.stop();
}

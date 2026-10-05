// node scripts/smoke.mjs  — proves the harness: dev server + Chrome + engine hook + one real live generation.
import { startServer, launch, openApp, runCall } from './lib/drive.mjs';
const srv = await startServer({ mode: 'dev', port: 5191 });
const b = await launch();
try {
  await openApp(b.page, srv.url);
  const r = await runCall(b.page, 'median([3, 1, 4, 2])');
  console.log(JSON.stringify({ head: r.head, phase: r.generation?.phase, attempts: r.generation?.attempts.map((a) => a.status + ':' + (a.rejectedBy ?? '')), out: r.repl.at(-1) }));
} finally {
  await b.close();
  srv.stop();
}

// node scripts/mutation-check.mjs — what a visitor sees: replay each shipped example from the production build (no backend),
// wait for the lazy mutation check, and print the app's own confidence line. `npm run build` first.
import { startServer, launch } from './lib/drive.mjs';
const EX = { median: 'median(', slugify: 'slugify(', fibonacci: 'fibonacci(' };
const srv = await startServer({ mode: 'preview', port: 5204 });
const b = await launch({ width: 1440, height: 900 });
const p = b.page;
const out = {};
try {
  for (const [id, btn] of Object.entries(EX)) {
    await p.goto(srv.url);
    await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('undefined-image'); q.onsuccess = q.onerror = q.onblocked = () => r(); setTimeout(r, 1500); }); });
    await p.goto(srv.url); await p.waitForSelector('#repl-input');
    if (id !== 'median') await p.locator('button.example', { hasText: btn }).click();
    await p.locator('#repl-input').press('Enter');
    await p.waitForFunction(() => /Accepted · saved as r\d+/.test(document.body.innerText), null, { timeout: 120000 });
    // the lazy check starts >= 10 s after Enter and 4 s idle; wait for a finished sentence
    await p.waitForFunction(() => document.querySelector('.panel-gates [data-mutation="done"]') && /broken cop(y|ies)/.test(document.querySelector('.panel-gates')?.innerText ?? ''), null, { timeout: 120000 });
    const text = await p.evaluate(() => document.querySelector('.panel-gates').innerText);
    const i = text.indexOf('What was checked');
    out[id] = text.slice(i, i + 700).replace(/\n+/g, ' ');
    console.log(id.padEnd(10), out[id]);
  }
} finally { await b.close(); srv.stop(); }

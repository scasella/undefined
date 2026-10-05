// Dev tooling (not part of the product, never bundled): drive the real app in your installed Chrome via playwright-core.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = new URL('../../', import.meta.url).pathname;

/**
 * Start `vite` (dev: live service + engine hook) or `vite preview` (a static build, replay mode). `outDir` picks the
 * build preview serves: 'dist' (the shipped one, no engine hook) or 'dist-check' (`npm run build:check`: the same
 * sources built in development mode, so the engine hook is there). Returns {url, stop}.
 */
export async function startServer({ mode = 'dev', port = 5190, outDir = 'dist' } = {}) {
  const args = mode === 'preview' ? ['vite', 'preview', '--configLoader', 'runner', '--outDir', outDir, '--port', String(port), '--strictPort'] : ['vite', '--configLoader', 'runner', '--port', String(port), '--strictPort', '--no-open'];
  const child = spawn('npx', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
    if (i === 99) throw new Error('server did not start:\n' + log);
  }
  return {
    url,
    stop: () => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
}

export async function launch({ width = 1440, height = 900, dsf = 1, mobile = false, video = null } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    isMobile: mobile,
    hasTouch: mobile,
    ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  return { browser, context, page, close: () => browser.close() };
}

/** Where a fresh load clears storage: a same-origin static file, so no app code holds the image database open. */
const BLANK = 'recordings/index.json';

/**
 * Clear this origin's storage (localStorage and every IndexedDB database) from a same-origin page that runs no app code,
 * waiting until each delete has really completed (onsuccess / onerror). A delete that stays blocked past `capMs` throws:
 * it would otherwise leave a stale image behind and the next load would not be fresh.
 */
export async function clearStorage(page, base, { capMs = 20000 } = {}) {
  await page.goto(new URL(BLANK, base).href);
  const left = await page.evaluate(async (cap) => {
    localStorage.clear();
    sessionStorage.clear();
    const names = (await indexedDB.databases?.())?.map((d) => d.name).filter(Boolean) ?? ['undefined-image'];
    const stuck = [];
    await Promise.all(
      names.map(
        (name) =>
          new Promise((res) => {
            const t = setTimeout(() => (stuck.push(name), res()), cap);
            const r = indexedDB.deleteDatabase(name);
            r.onsuccess = r.onerror = () => (clearTimeout(t), res());
            // onblocked: another connection is still open; the delete completes (onsuccess) once it closes
          }),
      ),
    );
    return stuck;
  }, capMs);
  if (left.length) throw new Error(`could not delete IndexedDB ${left.join(', ')} within ${capMs} ms`);
}

/**
 * Open the site (the front door: index.html at `base`, with `base`'s hash if any, e.g. '#/start') and wait until the
 * engine is ready. `fresh` clears storage first (see clearStorage). The engine is on window.__undefined when the page
 * was built in development mode: `vite` (dev) or `npm run build:check` (dist-check, served by startServer({mode:
 * 'preview', outDir: 'dist-check'})). The shipped dist/ has no hook, and this throws on it.
 */
export async function openApp(page, base, { fresh = true, timeoutMs = 30000 } = {}) {
  if (fresh) await clearStorage(page, base);
  await page.goto(base);
  try {
    await page.waitForFunction(() => !!window.__undefined && window.__undefined.state.value.ready, null, { timeout: timeoutMs });
  } catch (e) {
    const hook = await page.evaluate(() => !!window.__undefined).catch(() => false);
    throw new Error(hook ? `the engine did not become ready within ${timeoutMs} ms` : 'no engine hook (window.__undefined): serve `vite` (dev) or the dist-check build (npm run build:check), not dist/', { cause: e });
  }
}

/** Summarise engine state (dev hook) in one JSON-able object. */
export const SUMMARY = () => {
  const s = window.__undefined.state.value;
  const g = s.generation;
  return {
    head: s.headRevision,
    mode: s.mode,
    busy: s.busy,
    generation: g && {
      fn: g.fn,
      phase: g.phase,
      signature: g.signature,
      ungated: g.ungated,
      error: g.error ?? null,
      attempts: g.attempts.map((a) => ({
        status: a.status,
        body: a.candidate?.body ?? a.shown,
        notes: a.candidate?.notes,
        rejectedBy: a.candidate?.rejectedBy ?? null,
        headline: a.candidate?.headline ?? null,
        gates: (a.candidate?.gates ?? a.gates).map((x) => ({ gate: x.gate, status: x.status, summary: x.summary, note: x.note ?? null, headline: x.headline ?? null })),
      })),
    },
    repl: s.repl.filter((x) => x.kind !== 'input').slice(-6).map((x) => ({ kind: x.kind, value: x.value ?? x.message ?? x.text, label: x.label ?? null, name: x.name ?? null })),
    notice: s.notice ?? null,
    functions: Object.fromEntries(Object.entries(s.program.functions).map(([k, v]) => [k, { artifact: !!v.artifact, stale: !!v.artifact && (v.artifact.specHash !== v.specHash || v.artifact.testsHash !== v.testsHash) }])),
  };
};

async function idle(page, timeoutMs) {
  await page.waitForFunction(() => !window.__undefined.state.value.busy, null, { timeout: timeoutMs, polling: 100 });
}

/** Type a REPL line and submit it through the engine; wait until idle. Returns the state summary. */
export async function runCall(page, input, { timeoutMs = 180000 } = {}) {
  await page.evaluate((t) => {
    window.__undefined.setInput(t);
    void window.__undefined.submit();
  }, input);
  await page.waitForTimeout(150);
  await idle(page, timeoutMs);
  return page.evaluate(SUMMARY);
}

/** Call an engine method (dev hook), wait until idle, return summary. */
export async function engineCall(page, method, ...args) {
  await page.evaluate(([m, a]) => window.__undefined[m](...a), [method, args]);
  await idle(page, 60000);
  return page.evaluate(SUMMARY);
}

/** Run something in the page with the engine in scope. */
export const inPage = (page, fn, arg) => page.evaluate(fn, arg);

/**
 * In the page: the GapRef of a rejected attempt whose check said the spec was silent (null otherwise). The same rule
 * the door's session uses: a committed grow points into the artifact's candidate history, anything else carries the
 * diagnostic. Usage: `await page.evaluate(gapRefInPage, 0)` (the first attempt of the current generation).
 */
export function gapRefInPage(attemptIndex) {
  const s = window.__undefined.state.value;
  const gen = s.generation;
  const a = gen?.attempts[attemptIndex];
  if (!gen || !a) return null;
  const gates = a.candidate?.gates ?? a.gates;
  const fail = gates.find((g) => g.status === 'fail');
  const d = fail?.diagnostics[0];
  if (!fail || !d || (d.kind !== 'test' && d.kind !== 'property') || !d.silentOn) return null;
  const art = s.program.functions[gen.fn]?.artifact;
  if (gen.kind !== 'recheck' && gen.phase === 'committed' && gen.revision !== undefined && art && art.revision === gen.revision && a.candidate) {
    const i = art.candidates.findIndex((c) => c.id === a.candidate.id);
    if (i >= 0) return { fn: gen.fn, revision: gen.revision, candidate: i, gate: fail.gate, index: 0 };
  }
  return { fn: gen.fn, diagnostic: d };
}

// Dev tooling (not part of the product, never bundled): drive the real app in your installed Chrome via playwright-core.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = new URL('../../', import.meta.url).pathname;

/** Start `vite` (dev: live service + engine hook) or `vite preview` (static build, replay mode). Returns {url, stop}. */
export async function startServer({ mode = 'dev', port = 5190 } = {}) {
  const args = mode === 'preview' ? ['vite', 'preview', '--port', String(port), '--strictPort'] : ['vite', '--port', String(port), '--strictPort', '--no-open'];
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

/**
 * The workbench page (the original REPL UI: #repl-input, .panel-gates, button.example …) for a server URL. The site root
 * (index.html) is the front door (src/door); every script that drives the REPL by selector goes through this. A URL whose
 * path already names a page is returned unchanged; the query (?opener=, ?fixture=, …) and hash are kept.
 * workbench('http://localhost:5194/', '?opener=orders') → 'http://localhost:5194/workbench.html?opener=orders'
 */
export function workbench(url, query = '') {
  const u = new URL(url);
  if (u.pathname.endsWith('/')) u.pathname += 'workbench.html';
  if (query) u.search = query;
  return u.href;
}

/** Open the workbench (see workbench()) and wait until the engine is ready. In dev the engine is on window.__undefined. */
export async function openApp(page, base, { fresh = true } = {}) {
  const url = workbench(base);
  await page.goto(url);
  if (fresh) {
    await page.evaluate(async () => {
      localStorage.clear();
      await new Promise((res) => {
        const r = indexedDB.deleteDatabase('undefined-image');
        r.onsuccess = r.onerror = r.onblocked = () => res();
        setTimeout(res, 1500);
      });
    });
    await page.goto(url);
  }
  await page.waitForSelector('#repl-input', { timeout: 30000 });
  await page.waitForFunction(() => !window.__undefined || window.__undefined.state.value.ready, null, { timeout: 30000 });
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

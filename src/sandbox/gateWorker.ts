/**
 * Thin Web Worker shell around gateExecutor.ts. One worker per gate run (gateRunner.ts spawns it fresh and
 * terminates it afterwards), so nothing a candidate does can leak into the next run.
 * Every message is plain JSON-ish data (strings from show()), never raw candidate values.
 */
import { executeGates } from './gateExecutor';
import type { FromWorker, ToWorker } from './gateRunner';
import { scrubWorkerGlobals } from './mask';

const ctx = self as unknown as {
  postMessage(m: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

// Capture before scrubbing: the scrub removes IPC/network APIs from the worker scope.
const postMessage = ctx.postMessage.bind(ctx);
const post = (m: FromWorker): void => postMessage(m);
scrubWorkerGlobals(ctx);

ctx.onmessage = (ev) => {
  const msg = ev.data as ToWorker;
  if (msg?.type !== 'run') return;
  try {
    const results = executeGates(msg.input, {
      phase: (phase) => post({ type: 'phase', phase }),
      enter: (label) => post({ type: 'enter', label }),
      leave: () => post({ type: 'leave' }),
      gate: (result) => post({ type: 'gate', result }),
    });
    post({ type: 'done', results });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};

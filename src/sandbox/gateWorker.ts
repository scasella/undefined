/**
 * Thin Web Worker shell around gateExecutor.ts. One worker per gate run (gateRunner.ts spawns it fresh and
 * terminates it afterwards), so nothing a candidate does can leak into the next run.
 * Every message is plain JSON-ish data (strings from show()), never raw candidate values.
 *
 * Message integrity (see gateRunner.ts ToWorker): the run's nonce is kept in this module's closure and stamped on
 * every message. Before any candidate or test code runs, this module
 *   - captures the real postMessage, then replaces `self.postMessage` with a function that throws;
 *   - takes the message event first (capture listener registered before any user code) and stops it there, and locks
 *     `self.onmessage`, so user code cannot observe or answer the run message;
 *   - replaces `self.close` (a closed worker would only stall the run until the watchdog's overall cap).
 */
import { executeGates } from './gateExecutor';
import type { FromWorkerBody, ToWorker } from './gateRunner';
import { lockWorkerMessaging, scrubWorkerGlobals } from './mask';

const ctx = self as unknown as {
  postMessage(m: unknown): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void, opts: { capture: boolean }): void;
};

// Capture before scrubbing: the scrub removes IPC/network APIs from the worker scope.
const postMessage = ctx.postMessage.bind(ctx);
let nonce: string | null = null;
const post = (m: FromWorkerBody): void => {
  if (nonce !== null) postMessage({ ...m, nonce });
};

ctx.addEventListener(
  'message',
  (ev) => {
    ev.stopImmediatePropagation();
    const msg = ev.data as ToWorker;
    // One run per worker: the first message with a nonce wins, anything later is ignored.
    if (nonce !== null || msg?.type !== 'run' || typeof msg.nonce !== 'string' || msg.nonce === '') return;
    nonce = msg.nonce;
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
  },
  { capture: true },
);
lockWorkerMessaging(ctx);
scrubWorkerGlobals(ctx);

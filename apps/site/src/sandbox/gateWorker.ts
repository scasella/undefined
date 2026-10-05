/**
 * Thin Web Worker shell around the engine's gate worker protocol (gateWorkerCore.ts → gateExecutor.ts). One worker
 * per gate run (gateRunner.ts spawns it fresh and terminates it afterwards), so nothing a candidate does can leak into
 * the next run. Every message is plain JSON-ish data (strings from show()), never raw candidate values.
 *
 * Message integrity (see gateRunner.ts ToWorker): the run's nonce is kept in the protocol closure and stamped on
 * every message. Before any candidate or test code runs, this module
 *   - captures the real postMessage, then replaces `self.postMessage` with a function that throws;
 *   - takes the message event first (capture listener registered before any user code) and stops it there, and locks
 *     `self.onmessage`, so user code cannot observe or answer the run message;
 *   - replaces `self.close` (a closed worker would only stall the run until the watchdog's overall cap).
 * The same protocol code runs in Node (packages/engine/src/node/harness.ts) with that host's own capture and lock.
 */
import { installGateWorker } from '@scasella/undefined-engine/sandbox/gateWorkerCore';
import { lockWorkerMessaging, scrubWorkerGlobals } from '@scasella/undefined-engine/sandbox/mask';

const ctx = self as unknown as {
  postMessage(m: unknown): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void, opts: { capture: boolean }): void;
};

// Capture before scrubbing: the scrub removes IPC/network APIs from the worker scope.
const postMessage = ctx.postMessage.bind(ctx);

installGateWorker({
  post: (m) => postMessage(m),
  listen: (receive) =>
    ctx.addEventListener(
      'message',
      (ev) => {
        ev.stopImmediatePropagation();
        receive(ev.data);
      },
      { capture: true },
    ),
});
lockWorkerMessaging(ctx);
scrubWorkerGlobals(ctx);

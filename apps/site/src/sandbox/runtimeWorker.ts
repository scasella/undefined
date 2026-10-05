/**
 * Runtime worker: a thin shell around replCore. Captures postMessage, locks the worker's messaging and scrubs
 * network/storage APIs from the worker scope (mask.ts), then answers RuntimeRequests from runtime.ts.
 *
 * Message integrity: the first message must be `{type:'init', nonce}` (runtime.ts sends it right after spawning).
 * The nonce stays in this module's closure and is stamped on every message posted back; runtime.ts drops anything
 * without it. Committed functions and REPL lines run in this worker, but `self.postMessage` is replaced before any of
 * them run and message events are taken (and stopped) by a capture listener registered first, so they cannot answer
 * a request, forge a reply, or read the nonce.
 */
import { lockWorkerMessaging, scrubWorkerGlobals } from '@scasella/undefined-engine/sandbox/mask';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from './replCore';

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void, opts: { capture: boolean }): void;
};

const rawPost = ctx.postMessage.bind(ctx);
let nonce: string | null = null;
const dispatch = createDispatcher((m: RuntimeMessage) => {
  if (nonce !== null) rawPost({ ...m, nonce });
});

ctx.addEventListener(
  'message',
  (ev) => {
    ev.stopImmediatePropagation();
    const data = ev.data as { type?: unknown; nonce?: unknown } | null;
    if (nonce === null) {
      if (data?.type === 'init' && typeof data.nonce === 'string' && data.nonce !== '') nonce = data.nonce;
      return;
    }
    dispatch(ev.data as RuntimeRequest);
  },
  { capture: true },
);
lockWorkerMessaging(ctx);
scrubWorkerGlobals(ctx);

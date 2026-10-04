/**
 * Runtime worker: a thin shell around replCore. Captures postMessage, scrubs network/storage APIs from the worker
 * scope (mask.ts), then answers RuntimeRequests from runtime.ts.
 */
import { scrubWorkerGlobals } from './mask';
import { createDispatcher, type RuntimeMessage, type RuntimeRequest } from './replCore';

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
};

const post = ctx.postMessage.bind(ctx);
scrubWorkerGlobals(ctx);

const dispatch = createDispatcher((m: RuntimeMessage) => post(m));
ctx.addEventListener('message', (ev) => dispatch(ev.data as RuntimeRequest));

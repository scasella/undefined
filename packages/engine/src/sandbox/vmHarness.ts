/**
 * Entry of the Node host's in-realm harness, bundled into one IIFE string (node/harnessSource.ts) and evaluated in a
 * `node:vm` realm inside a `worker_thread` (node/worker.mjs). NOT a security boundary: see node/host.ts.
 *
 * It runs the same protocol code as the browser's gate worker (gateWorkerCore.ts → gateExecutor.ts, fast-check, the
 * mask), all in this one realm, as they share the worker realm in the browser.
 *
 * Inbound data crosses as a STRING: the worker hands over the run message as `JSON.stringify(encodeValue(message))`
 * and it is decoded here, in-realm, so no outer-realm object (whose `.constructor.constructor` is the outer
 * `Function`) is ever reachable from candidate or test code. Outbound messages go in-realm → outer, the safe direction.
 */
import { postToHost } from './vmPrelude'; // must stay the first import: installs the realm's host stand-ins
import { installGateWorker } from './gateWorkerCore';
import { decodeValue } from '../shared/serialize';
import type { Json } from '../types';

let receive: ((data: unknown) => void) | null = null;

installGateWorker({
  post: (m) => postToHost(m),
  listen: (r) => {
    receive = r;
  },
});

/** Called by the worker for each message from the runner (a string, see the module comment). */
export function deliver(text: unknown): void {
  if (typeof text !== 'string' || receive === null) return;
  let data: unknown;
  try {
    data = decodeValue(JSON.parse(text) as Json);
  } catch {
    return;
  }
  receive(data);
}

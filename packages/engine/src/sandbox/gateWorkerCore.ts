/**
 * The gate worker's protocol code, shared by both hosts (one implementation, so both speak exactly the same protocol):
 *   - the browser shell, apps/site/src/sandbox/gateWorker.ts (a module Web Worker started through the blob wrapper);
 *   - the Node harness, packages/engine/src/node/harness.ts (a `node:vm` realm inside a `worker_thread`).
 *
 * Message integrity (gateRunner.ts ToWorker): the run's nonce is kept in this closure and stamped on every message;
 * the runner ignores any message without it. One run per worker: the first well-formed run message wins and anything
 * later is ignored. The host supplies `post` (captured BEFORE any user code can run) and `listen` (registered before
 * any user code can run); locking the host's own messaging globals is the host's job, done right after this call.
 */
import { executeGates } from './gateExecutor';
import type { FromWorker, FromWorkerBody, ToWorker } from './gateRunner';

export interface GateWorkerScope {
  /** Sends one message to the runner (already nonce-stamped). Must not throw into the caller. */
  post(message: FromWorker): void;
  /** Registers the one receiver of runner messages. */
  listen(receive: (data: unknown) => void): void;
}

export function installGateWorker(scope: GateWorkerScope): void {
  let nonce: string | null = null;
  const post = (m: FromWorkerBody): void => {
    if (nonce !== null) scope.post({ ...m, nonce });
  };
  scope.listen((data) => {
    const msg = data as ToWorker;
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
  });
}

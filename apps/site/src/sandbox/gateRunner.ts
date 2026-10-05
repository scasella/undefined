/**
 * The site's gate runner: the engine's runner (packages/engine/src/sandbox/gateRunner.ts: Watchdog, timeouts, crash
 * results, the nonce protocol) with the browser's default worker plugged in. The default is the only Vite/DOM-bound
 * part: a module worker started through a blob: wrapper so it inherits the page's CSP (spawn.ts). Everything else is
 * re-exported unchanged, so `runExecutionGates(input, onGate)` behaves exactly as before the workspace split.
 */
import {
  runExecutionGates as runWith,
  type ExecGateInput,
  type GateRunOptions as EngineGateRunOptions,
  type GateWorkerPort,
} from '@scasella/undefined-engine/sandbox/gateRunner';
import type { GateResult } from '@scasella/undefined-engine/types';
import { spawnModuleWorker } from './spawn';
import { gateWorkerUrl } from './workerUrls';

export * from '@scasella/undefined-engine/sandbox/gateRunner';

/** As the engine's options, but `createWorker` defaults to the browser's blob-wrapped module worker. */
export type GateRunOptions = Partial<Pick<EngineGateRunOptions, 'createWorker'>> & Omit<EngineGateRunOptions, 'createWorker'>;

function defaultGateWorker(): GateWorkerPort {
  const w = spawnModuleWorker(gateWorkerUrl);
  return {
    postMessage: (m) => w.postMessage(m),
    terminate: () => w.terminate(),
    onMessage: (cb) => {
      w.onmessage = (ev: MessageEvent) => cb(ev.data);
    },
    onError: (cb) => {
      w.onerror = (ev: ErrorEvent) => {
        ev.preventDefault();
        cb(ev.message || 'the gate worker failed to start');
      };
      w.onmessageerror = () => cb('a gate worker message could not be decoded');
    },
  };
}

export function runExecutionGates(input: ExecGateInput, onGate?: (r: GateResult) => void, opts: GateRunOptions = {}): Promise<GateResult[]> {
  return runWith(input, onGate, { ...opts, createWorker: opts.createWorker ?? defaultGateWorker });
}

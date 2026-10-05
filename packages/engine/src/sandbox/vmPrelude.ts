/**
 * First module of the Node host's in-realm harness (vmHarness.ts). NOT a security boundary: see node/host.ts.
 *
 * The harness bundle is evaluated inside a fresh `node:vm` realm as `(function (__undefinedHost) { … })`, and the Node
 * worker calls it once with two outer-realm functions: `now()` (the worker's `performance.now`) and `post(message)`
 * (the worker's `parentPort.postMessage`, wrapped so it never throws back into the realm). They are captured here, in
 * this closure, and never stored on the realm's global object, so candidate and test code cannot reach them (an
 * outer-realm function would hand them the outer `Function`, i.e. `process`).
 *
 * The realm gets in-realm stand-ins for the host globals the gate code reads at module load (gateExecutor.ts
 * `performance`, testApi.ts `structuredClone`, fast-check's timer functions) or may call (`console`). This module must run before any other harness
 * module: those modules capture the globals when they load, and mask.ts snapshots `globalThis.structuredClone` for its
 * integrity check, so the stand-ins are installed once here and never removed.
 */
import { structuredClonePolyfill } from './clone';

declare const __undefinedHost: { now(): number; post(message: unknown): void };

const host = __undefinedHost;
const hostNow = host.now;
const hostPost = host.post;

const realm = globalThis as unknown as Record<string, unknown>;
const define = (name: string, value: unknown): void => {
  Object.defineProperty(realm, name, { value, writable: true, enumerable: false, configurable: true });
};
const noop = (): void => {};

define('performance', { now: (): number => +hostNow() });
define('structuredClone', structuredClonePolyfill);
// fast-check captures the timer functions when it loads (it uses them only for async properties and time limits, which
// the gates never set). The realm has no event loop of its own to give it, so they exist and refuse.
const noTimers = (): never => {
  throw new Error('timers are not available to the gates');
};
for (const name of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) define(name, noTimers);
// Candidate and test output goes nowhere: the CLI's terminal is not theirs to write to.
define('console', { log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop });

/** Sends one in-realm message out to the runner. Returns nothing from the outer realm. */
export function postToHost(message: unknown): void {
  hostPost(message);
}

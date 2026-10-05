// The Node host's gate worker: the entry of one `worker_thread` per gate run (host.ts starts it, the runner's
// watchdog terminates it). Plain JavaScript with only `node:` imports, so it loads on every supported Node without a
// build step or a TypeScript loader.
//
// NOT A SECURE SANDBOX. It evaluates the harness (gate code + fast-check + the candidate and the user's tests) in a
// fresh `node:vm` realm that has no Node APIs on its global object. `node:vm` is not a security mechanism (Node's
// documentation says so) and a worker thread shares the process with the CLI: this catches accidents (impurity,
// runaway loops, runaway memory), it does not contain a deliberate escape. See host.ts and docs/SECURITY.md.
import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

const harness = workerData && typeof workerData.harness === 'string' ? workerData.harness : '';
const port = parentPort;
if (!port) throw new Error('worker.mjs must run as a worker_thread');

// Outer-realm functions handed to the harness once; the prelude keeps them in a closure (sandbox/vmPrelude.ts).
// post never throws back into the realm: an outer-realm Error object would reach the outer Function.
const host = {
  now: () => performance.now(),
  post: (message) => {
    try {
      port.postMessage(message);
    } catch {
      /* not cloneable: dropped; the runner's watchdog decides what an incomplete run means */
    }
  },
};

// A context with an ordinary global object where Node offers one (DONT_CONTEXTIFY, Node >= 22.8): no interceptor
// that could consult an outer-realm sandbox object. Otherwise a null-prototype sandbox object, so no outer
// `Object.prototype` (and so no outer `Function`) is reachable through the global's prototype chain.
const options = { name: 'undefined gate realm', codeGeneration: { strings: true, wasm: false } };
const context =
  vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined
    ? vm.createContext(vm.constants.DONT_CONTEXTIFY, options)
    : vm.createContext(Object.create(null), options);

// No importModuleDynamically: every import() in the realm (harness, candidate, tests) is refused.
const script = new vm.Script(`(function (__undefinedHost) {\n${harness}\nreturn __undefinedHarness;\n})`, {
  filename: 'undefined-gate-harness.js',
});
const factory = script.runInContext(context);
const api = factory(host);

port.on('message', (text) => api.deliver(text));

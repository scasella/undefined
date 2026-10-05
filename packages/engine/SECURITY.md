# Security note: the engine's Node host is not a secure sandbox

`@scasella/undefined-engine` certifies code; it never generates any. Its Node host (`src/node/host.ts`, used by the
CLI and the GitHub Action) **executes untrusted code** — the function being certified and the tests that come with it —
**in a Node `worker_thread` with a watchdog**, inside a `node:vm` realm that has no Node APIs on its global object.
That is **not a secure sandbox**: `node:vm` is not a security mechanism, and a worker thread shares the process, its
memory, its environment-reachable files and its privileges with the program that started it.

What it does contain (each case is a test in `src/node/host.test.ts`, and the CLI-level probes are listed in
[docs/SECURITY.md](../../docs/SECURITY.md#the-node-host-packagesengine-used-by-the-cli-and-the-action)):

- runaway loops, `Atomics.wait`, a hang in test code: the watchdog terminates the worker (per-call budget, 15 s overall cap);
- runaway memory: the 256 MB heap cap stops the worker; reported as Invariants `bounded`;
- deep recursion: `RangeError` inside the realm (1 MB stack, close to a browser worker's);
- reaching for `process`, `require`, `globalThis`, `Function`, intrinsics: purity violations (the mask), and the realm
  behind the mask has no `process`, `require`, `Buffer`, `fetch` or host hook; `import()` and WebAssembly are refused;
- forged output: the realm's `console` is a no-op and the worker's stdout/stderr are discarded; the runner only accepts
  messages carrying its per-run nonce, and the function that posts them is not reachable from user code;
- thrown values that throw when inspected (hostile `Proxy`): reported as the call throwing, never as a worker error.

What it does not contain: a V8, Node or `vm` escape, or any path not listed above, runs with the privileges of the
process that called the engine (your shell for the CLI; the CI job and its token for the Action). Limits are per run,
not per machine. Run it only on code you would run anyway, or inside a disposable VM or container.

No telemetry, no analytics, no network access: the engine and the CLI make no network calls at all; the Action calls
only the GitHub API for its one comment.

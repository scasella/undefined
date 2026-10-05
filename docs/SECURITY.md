# Security model

Generated code, and the test code in a spec, run in Web Workers and never on the page's main thread. This is a set of
guard rails with a real policy behind them, **not a security boundary**: treat a recording from a stranger like a script
from a stranger, and only load recordings from people you trust (the app asks before it loads one).

For what the page sends anywhere, see [What leaves your browser](../README.md#what-leaves-your-browser). For how
strangers' programs behaved in practice, see [HOSTILE.md](HOSTILE.md).

**What is enforced**

- **No network for worker code except the one door we cannot close, and that door is shut by policy.** `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `caches`, `Worker` and similar are removed from the worker
  scope, and the candidate sees trapping stand-ins for the clock, `Math.random`, timers and the global object. Dynamic
  `import()` is syntax and cannot be removed, so a Content-Security-Policy closes it: both workers start from a `blob:`
  wrapper (GitHub Pages cannot send headers, and a page's `<meta>` CSP is *not* inherited by a worker loaded from a normal
  URL, but *is* inherited by a blob worker; checked in Chrome 154), and the policy's `script-src` allows only this site.
  `import()` of an `http(s):`, `data:` or `blob:` URL is refused, including when the code is built from a string through
  `(() => 0).constructor`. `npm run check:csp` fails the build if the shipped policy is weakened.
- **Verdicts cannot be forged from inside the worker.** Every worker message carries a per-run secret nonce that user
  code cannot read, and `postMessage` is locked after the worker takes its private copy.
- **Test code is also restricted:** `import()` is rejected at transpile time, and the network and global names are trapped.
- **CPU is bounded** by a watchdog (per-call budget, a 15 s overall cap, then the worker is terminated).
- **Datasets are read-only** in the REPL, and replayed on frozen copies in the gates.
- **Generated functions reach each other only by name, through what their certification recorded.** In the gates the
  callees are evaluated under the same mask in the same worker; in the REPL a dependent holds late-bound stubs that look
  the callee up when it is called. This adds no new capability: it is the same worker and the same mask.

**What is not guaranteed**

- The `(() => 0).constructor` escape still reaches the worker's real global object. What it finds there has the network and
  messaging APIs removed, but this is the reason this is not a boundary.
- `connect-src` allows `https:` (the page fetches a recording URL you give it), and the workers inherit that. Outbound
  `https` from a worker is therefore stopped only by the removal of `fetch` and friends, not by the policy.
- A spec's author decides its verdict: a stranger's tests can make any candidate "pass" by asserting nothing. What is
  guaranteed is that the verdict matches the tests you are shown.
- Memory exhaustion is bounded only by what the browser does to the tab. A hostile spec can spend up to the CPU cap on each run.
- Verified in Chrome only. **There is no end-to-end automated attack test:** the CSP behaviour was verified empirically and
  by unit tests (nonce protocol, test-code restrictions, the policy text), but a harness that loads a crafted malicious
  recording and asserts zero outbound requests was not built.

## The Node host (packages/engine; used by the CLI and the Action)

**This is not a secure sandbox.** The engine's Node host (`packages/engine/src/node/host.ts`) runs the function being
certified, and the tests that come with it, **as untrusted code in a Node `worker_thread` with a watchdog**, inside a
`node:vm` realm whose global object has no Node APIs. `node:vm` is not a security mechanism (Node's documentation says
so), and a worker thread shares the operating-system process, its memory and its privileges with the program that
started it. It is built to catch accidents (impurity, runaway loops, runaway memory), not to resist code written to
escape. Run it only on code you would run anyway, or inside a disposable VM or container (in CI, the isolation boundary
is the runner VM, not this host).

How it is built: one fresh `worker_thread` per gate run (empty environment, no argv/execArgv, output discarded,
`resourceLimits`: 256 MB old-generation heap, 32 MB young generation, 1 MB stack); inside it a `node:vm` context
(`DONT_CONTEXTIFY` where Node has it, otherwise a null-prototype sandbox; string code generation allowed because the mask
uses `Function`, WebAssembly code generation refused; no `importModuleDynamically`). The gate code, fast-check, the mask
and the candidate all live in that one realm, as they share the worker in the browser. The run message enters the realm
as one encoded string and is decoded there, so no outer-realm object is reachable from user code; the two host functions
the realm needs (the clock and the message port) are held in a closure and never put on its global object. The gate
runner, the watchdog, the nonce protocol and the result builders are the browser's, unchanged.

**Measured by `packages/engine/src/node/host.test.ts`** (Node 25.8.1 on macOS; each test is named CONTAINED or NOT CONTAINED):

| attempt | what happens |
|---|---|
| infinite loop / `Atomics.wait` in a call | contained: the worker is terminated at the per-call budget, Invariants `bounded` |
| a loop outside any call (in test code) | contained: terminated at the overall cap (15 s by default), Invariants `bounded` |
| heap blow-up | contained: the worker stops at its heap limit (`ERR_WORKER_OUT_OF_MEMORY`), reported as Invariants `bounded` ("used more than the 256 MB heap limit"), the process and the next run are unaffected |
| deep recursion | contained: `RangeError` inside the realm, a test failure |
| `process.exit()`, `require('fs')` by name | contained by the mask: a purity violation, nothing runs |
| the real global object, reached past the mask (`(() => 0).constructor('return this')()`) | contained: it has no `process`, `require`, `Buffer`, `fetch`, `setImmediate`, `postMessage` or host hook, and `globalThis.constructor.constructor` is the realm's own `Function` |
| an argument's `.constructor.constructor` | contained: arguments are decoded inside the realm |
| `import('node:fs')`, from a script or from `Function` code | contained: refused with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` |
| WebAssembly | contained: code generation disallowed |
| `Error.prepareStackTrace` → `CallSite.getFunction()` on the worker's frames | contained on this Node: the worker and Node's internals are strict-mode code, so no outer function is exposed |
| a wrong function that throws a `Proxy` whose traps throw (or any thrown value that throws when read) | contained since the Phase 4 review: reported as that call throwing (`threw a value that cannot be inspected`), a rejection. Before, describing the value threw inside the gate and the run ended as a gate worker error, i.e. *could not run* (exit 3), which the Action does not fail on, so a wrong function could dodge its rejection (regression tests in `host.test.ts`) |
| unhandled promise rejections, a throwing `.then` | contained: no crash, the verdict is the code's (`host.test.ts`) |

**Probed end to end through the built CLI** (Phase 4 review, `node packages/cli/dist/cli.js certify … --json` on a
throwaway project whose `HOME` held a canary `~/.ssh/id_rsa`; the body was a wrong `inc` plus the attack; nothing was
written outside the project and stdout was always exactly one JSON document):

| attack in the candidate | outcome |
|---|---|
| `globalThis['pro'+'cess'].exit(0)` / `.kill(pid)` / `.stdout.write(…)`, `globalThis['req'+'uire']('fs')` to read `~/.ssh` | rejected by Invariants: the mask reports the read of `globalThis` (and the realm has no `process`/`require` behind it) |
| `new Function("return import('node:child_process')")()`, `Function('return process')()` | rejected: reading `Function` is a purity violation; from test code, `import()` is refused and `process` is `undefined` |
| `Error.prepareStackTrace` then `getFunction()` / `getThis()` on the frames | rejected (it writes to `Error`); from test code it finds no outer function |
| infinite loop, 1e6-element arrays forever, `s += s` forever, unbounded recursion | `bounded` at the 1000 ms budget / `bounded` at the 256 MB heap cap / `RangeError` / `RangeError`; all rejections, exit 1 |
| `console.log('{"exitCode":0}')` to forge the CLI's output | the realm's `console` is a no-op and the worker's stdout/stderr are piped and discarded: `--json` stays one document |
| post a result to the runner without the nonce (`__undefinedHost`, `postMessage`, any global with a `post`) | nothing reachable: the post function lives in a closure; from test code the scan of globals is itself a test sandbox error |
| patch `Object.is`, `JSON.stringify`, `Array.prototype.some` to fool the checks | rejected by Invariants (`candidate modified … (pure)`) |
| return a throwing `Proxy`, a looping getter, a `Symbol`, a function | rejected by Tests (`returned [Unshowable]`, `{ v: [Getter] }`, …) |
| throw a `Proxy` whose traps throw / throw `{ get message() { for (;;) {} } }` | rejected by Tests (`threw … cannot be inspected`) / `bounded` at the budget (the thrown value's `message` is read inside the call's time window); before the fix the first ended as *could not run* (exit 3) |
| test code (`globalThis.process`, `Function('return process')`, indirect `eval`, `({}).constructor.constructor`, stack-frame `getFunction`/`getThis`, `import()`, WebAssembly) | `process` is `undefined` everywhere in the realm; `import()` and WebAssembly are refused. A test that throws a trap-throwing `Proxy` itself still ends as a gate worker error (*could not run*): the test author decides the verdict anyway |
| an `Atomics.wait` in test code | `bounded` at the 15 s overall cap (a rejection) |

The mask and the realm are the browser's; none of this makes the host a security boundary. A deliberate attacker with a
V8/Node/`vm` escape, or any path not listed here, runs with the process's privileges (in the Action: the job's token).

**Not measured yet:** only Node 25.8.1 was tested. On Node before 22.8 (no `DONT_CONTEXTIFY`) the realm is built from a
null-prototype sandbox object instead; that path has not been run. `host.test.ts` must pass on the Node 20 and 22 CI
matrix before the CLI or Action is published.

**Not contained, by design or because it cannot be:** the code runs inside the certifying process. A bug in V8 or Node,
a native-level escape, or a `vm` escape not listed above would run with the CLI's (or the CI job's) privileges. CPU and
memory are bounded per run, not per machine: a spec can spend up to the overall cap and the heap limit on every run.
The stack size and the heap limit differ from a browser tab's, so a very deep recursion or a large allocation can be a
different verdict in Node than in the site (none of the shipped examples comes near either; the parity tests,
`apps/site/src/examples/parity.node.test.ts` and `apps/site/scripts/cli.parity.ts`, check the shipped recordings).

**The GitHub Action (`packages/action`)** runs a PR's code on this host, so the boundary that matters is the runner VM.
Its README says so and gives the rules: run it on `pull_request` (a fork gets a read-only token and no secrets), never
on `pull_request_target` with the PR's head checked out (fork code next to a write token and secrets), and use the
two-workflow split (`mode: certify` on `pull_request`, `mode: comment` on `workflow_run`, which checks out and runs no PR
code and treats the result file as untrusted data) to comment on fork PRs. The Action's only network access is the
GitHub API calls for its one comment. It recognises its comment by the marker **and** a bot author, so a PR author who
posts a comment starting with the marker can neither pre-empt the report nor get the Action to overwrite a comment that
shows under the author's name (fixed in the Phase 4 review; regression test in `packages/action/test/main.test.ts`).
Two residual risks are by design and stated in the Action's README: a function the engine cannot run (exit 3: e.g. a
generic signature) does not fail the check unless `fail-on` includes `could-not-run`, and in `certify-and-comment` mode a
deliberate escape from the host would run next to the job's `pull-requests: write` token.

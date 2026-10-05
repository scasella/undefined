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

# Launch kit: the evidence appendix

For the essay. Everything here was measured or captured in this repository; nothing is estimated. Where a number is a
sample, it says how large. Re-run commands are at the end of each section.

**Setup of every live measurement below:** model `gpt-6-luna` (the only model; no other was tried), reasoning effort `low`,
Codex CLI 0.159.2 (`codex exec`, read-only sandbox, empty temp directory, `--ignore-user-config`), macOS, Node v25.8.1,
Chrome 154 headless via playwright-core, measured 2026-10-04. One model, one day: treat every rate as that.

## 1. Rejection and recovery rates

### 1a. Whole sessions through the real app (the number to quote)

8 fresh sessions per example, each the example's pre-typed call, real Web Worker gates and watchdog, the real budget of
3 candidates. `node apps/site/scripts/sessions.mjs 8`.

| example | sessions | first candidate rejected (by) | first candidate accepted | committed within 3 candidates | mean session time |
|---|---|---|---|---|---|
| `median` | 8 | 8 (8 properties) | 0 | 8/8 | 37.3 s |
| `slugify` | 8 | 6 (6 tests) | 2 | 7/8 | 42.6 s |
| `fibonacci` | 8 | 6 (6 invariants) | 2 | 7/8 | 42.7 s |
| `orders` | 8 | 0 (n/a) | 8 | 8/8 | 22.2 s |

- 2 of the 32 sessions ended without a commit, both an exhausted budget rather than a crash: `slugify` session 6 was
  rejected by tests, then compile, then tests; `fibonacci` session 0 by the bounded check, then tests, then tests.
  (`orders` has no tests, so its first candidate is accepted by construction; that row measures only that the data path
  works, 8/8.)
- A rejection on the first candidate is common for these three specs and **not guaranteed**: 2 of 8 `slugify` sessions and
  2 of 8 `fibonacci` sessions passed first time. The shipped recordings are real sessions, kept only if the first candidate
  was rejected (`npm run record` prints the tries it needed: median 1, slugify 1, fibonacci 2).
- The same event showed up while recording: in both recording runs the first fibonacci session exhausted its budget and was
  discarded (that is why the recording needed 2 tries).

### 1b. Earlier, narrower sampling (kept for the record)

`apps/site/scripts/tune.tune.ts`, 8 samples per example, one candidate and **one** retry with the diagnostic: median 8/8 rejected →
8/8 passed; slugify 8/8 → 7/8; fibonacci 8/8 → 8/8. The session-level numbers above are lower because a session can
have a different first candidate each time and has to recover within the real budget. Before any tuning, **18 of 18**
first attempts at tightly specified versions of these examples passed every gate: the model does not need help from the
toolchain on a well-specified function, and the examples are built around specs that are honestly incomplete.

### 1c. The decline rule (stubs versus honesty)

`apps/site/scripts/calibrate.tune.ts`: ~47 spec-less calls, 3 samples each, written vs. declined.

| group | expected | result |
|---|---|---|
| names that describe a result (incl. `topCustomersByRevenue(rows)`, `monthlyTotals(rows)`, `dedupeByEmail(rows)`) | write | 78 of 78 written |
| meaningless names (`clean`, `process`, `handle`, `transform`, `data`, `run`, `doIt`) | decline | 21 of 21 declined |
| impure names (`now`, `uuid`, `shuffle`, `fetchUser`, `readFile`, …) | decline | 41 of 45 declined (the four writes: `getCookie`, `printReport` read as pure parsing/formatting) |

The first draft of the rule declined `topCustomersByRevenue(rows)` ("which discount rules count?"); the calibration is why
it no longer does. See `docs/HOSTILE.md` for the 54 stranger-style calls: 20 impure/ambiguous calls were committed as stubs
before the rule, 2 after.

## 2. How strong are the shipped tests? (mutation kill rates)

Twelve deliberately broken copies of each committed function (operator swaps, flipped comparisons, boundary ±1,
constants, negated conditions, returns replaced), run against the function's real tests and properties. Four buckets, never
merged: killed, stopped by the time limit, survived (may be equivalent), did not compile.

| function (body) | where measured | result |
|---|---|---|
| `median` (shipped good body 1) | Node, real gates (`apps/site/src/core/engine.evidence.test.ts`) | 11 of 12 killed; the survivor is `0 → -1` on the empty-list guard, which changes nothing observable (an equivalent mutant: the empty list still yields NaN) |
| `median` (good body 2) | same | 11 of 12 killed, same survivor |
| `median` (the body in the shipped recording) | browser, production build in replay mode, real watchdog, measured 2026-10-04 after the final re-record (`node apps/site/scripts/mutation-check.mjs`) | 12 of 12 killed |
| `slugify` (regex chain; also the shipped recording's body) | Node and browser | 1 of 1 (the body has a single mutation site) |
| `slugify` (loop version) | Node | 12 of 12 killed |
| `fibonacci` (fast doubling) | Node | 12 of 12 killed |
| `fibonacci` (the body in the shipped recording) | same | 11 of 12 caught: 9 by a test or rule, 2 more by the time limit; 1 survived (it may behave exactly like the original) |
| `topCustomersByRevenue` | n/a | skipped: no tests, nothing could kill a mutant |
| any function with no tests at all | all five bodies tested | 0 killed (and the app says so) |

The browser rows are what a visitor of the static site sees; they are re-measured whenever the recordings change (an earlier
recording's fibonacci body read 8 of 12 caught + 2 survived, so these numbers belong to *these* bodies, not to the example).

A weak median spec (one single-value test, no properties) kills 8 of 12 and lets 4 through, which is the point of the
number: it separates a test suite that checks something from one that merely exists.

## 3. Real session transcripts (verbatim, with the diagnostics the model received)

Generated from the shipped recordings by `node apps/site/scripts/transcripts.mjs`: every prompt exactly as sent, every body exactly
as returned. The second prompt of each ends with the toolchain's diagnostics for the rejected candidate.

- `docs/transcripts/median.md`, `docs/transcripts/slugify.md`, `docs/transcripts/fibonacci.md`
- `docs/transcripts/orders.md` (the spec-less data call: what the model is told about the type and sample rows, and nothing else)

The three diagnostics blocks, as the model received them:

**median** (first candidate threw on `[]`; the model's note was: 'Sorts a copy and returns the middle value or the mean of the two middle values; assumes the list is non-empty.')

```
What the checks reported:
passed: compile, tests
PROPERTIES FAILED
  - property "agrees with a sort-based reference"
    counterexample (shrunk by fast-check in 0 steps, seed 356460707): median([])
    expected: NaN
    error:    Error: median requires a non-empty list

Fix exactly what the diagnostics show. Keep what worked. Do not repeat an approach that was already rejected.
```

**slugify** (first candidate: 'Uses Unicode decomposition for accents, expands common special letters and ampersands, and joins remaining letter and digit runs with single hyphens.')

```
What the checks reported:
passed: compile
TESTS FAILED — 1 of 10
  - test "apostrophes"
    call:     slugify("Don't Stop")
    expected: "dont-stop"
    actual:   "don-t-stop"

Fix exactly what the diagnostics show. Keep what worked. Do not repeat an approach that was already rejected.
```

**fibonacci** (first candidate: 'Uses an iterative exact BigInt calculation and rejects inputs outside the documented integer range.')

```
What the checks reported:
passed: compile
INVARIANTS FAILED
  - bounded: fibonacci(1000000) did not return within 1500 ms
    call:     fibonacci(1000000)
    budget:   1500 ms, elapsed: 1518 ms
    during:   tests
    detail:   worker terminated by the watchdog
    meaning:  the call was too slow; use an asymptotically faster algorithm

Fix exactly what the diagnostics show. Keep what worked. Do not repeat an approach that was already rejected.
```

## 4. The honest limits (say these in the essay)

- **One model, one day.** Rates are for `gpt-6-luna` at effort `low`. Another model, another effort, or another week may
  differ. Nothing here claims otherwise.
- **The rejections are built, then measured.** A strong model passes a well-specified function first time (18/18). The three
  rejecting examples use honestly incomplete specs (median, slugify: the spec is silent and the tests choose) or a stated
  limit the model does not time (fibonacci). The app labels which is which. The shipped recordings were kept only when
  the first candidate was rejected.
- **The spec-less path is gated only by Compile and Invariants.** With no tests, a wrong answer sails through (see
  `docs/HOSTILE.md`: 2 of the 54 stranger calls are ❌ for that reason, and results vary run to run: `isPalindrome` of the
  classic phrase was `true`, `false`, `true`). The UI says so under every spec-less result; pinning a result is the remedy.
- **The sandbox is not a security boundary.** Candidates run in a Web Worker with the clock, `Math.random`, network and
  timers shadowed and network APIs removed; a determined program can still reach the worker's global scope through
  `Function`-constructor tricks. The model is not adversarial; the checks catch accidental impurity.
- **Mutation testing finds weak tests, not wrong ones.** Survivors may be equivalent mutants; "12 of 12 killed" says the
  tests notice changes, not that the spec is right.
- **Replay is a recording, not a run.** The static site replays recorded candidates; only the gates run live in the visitor's
  browser. It is labelled as such on screen.
- **Not tested:** Safari/Firefox (Chrome only); Node versions other than 20.20, 22.23, 25.8 and 26.8; any model other than
  `gpt-6-luna`; concurrent users (it is a local single-user tool).
- **Data privacy:** in live mode a dataset's inferred type and up to 3 sample rows go to Codex (the user can turn the sample
  rows off and send the type only); nothing else about the data does, and in replay mode nothing leaves the browser.

### 4a. The engine as a product: what may and may not be said

The gates also ship without the site: `packages/engine`, the CLI (`npx @scasella/undefined certify <file>`, not
published yet; [PACKAGES.md](PACKAGES.md)) and a GitHub Action that comments on PRs ([ENGINE.md](ENGINE.md)). They
certify code from any source (Claude Code, Codex, Cursor, a human) and contain no generation path. The claim that ties
them to the site is the **parity table** in [EVIDENCE.md](EVIDENCE.md#node-and-cli-parity): all 11 recorded candidates
get the same verdict, gate statuses, evidence line and mutation buckets from the built CLI in Node as from the site in
Chrome (`npm run check:parity`, in CI), with exactly two stated differences (the killed / stopped-by-time-limit split
may differ; the site's "rejected, spec was silent" is the engine's `gaps`, exit 2).

**Never claim:**

- **that it is a sandbox.** The Node runner executes untrusted code in a `worker_thread` with a watchdog inside a
  `node:vm` realm; that catches accidents, not escapes ([SECURITY.md](SECURITY.md#the-node-host-packagesengine-used-by-the-cli-and-the-action)).
  In the Action the isolation boundary is the runner VM, and an escape would see the job's token.
- **that certification is proof.** "Accepted" means the function passed the checks it came with: evidence, not a
  proof of correctness. A spec that asserts nothing certifies anything.
- **that a mutation kill rate grades the code.** It measures the tests: how many deliberate changes they notice.
  Survivors may be equivalent mutants.
- that parity holds beyond the shipped recordings, on other machines' timing, or on Node 20/22 before CI has run it
  there (measured on one Mac, Chrome and Node 25.8.1, 2026-10-05).
- download counts, users or a published package: nothing is published.

## 5. Suggested outline for the essay

Moved to [ESSAY-OUTLINE.md](ESSAY-OUTLINE.md): the section structure, the evidence each section should cite (with the
numbers above), and what each section must not claim.

## 6. Assets and how to regenerate everything here

| asset | command |
|---|---|
| session rates (1a) | `node apps/site/scripts/sessions.mjs 8` |
| single-retry sampling (1b) | `TUNE_N=8 TUNE_EX=median,slugify,fibonacci npx vitest run -c apps/site/scripts/vitest.tune.config.ts apps/site/scripts/tune.tune.ts` |
| decline calibration (1c) | `CAL_N=3 npx vitest run -c apps/site/scripts/vitest.tune.config.ts apps/site/scripts/calibrate.tune.ts` |
| hostile calls | `node apps/site/scripts/hostile.mjs` |
| recordings | `npm run record` |
| transcripts | `node apps/site/scripts/transcripts.mjs` |
| replay check on the production build | `npm run build && npm run check:replay` |
| screenshots in both schemes and sizes | `node apps/site/scripts/shots.mjs` |
| `docs/opening.gif`, `docs/demo.mp4` | `node apps/site/scripts/capture.mjs` |
| `docs/opening-<id>.gif` (the opening for `?opener=<id>`) | `node apps/site/scripts/capture.mjs --opener=<id>` |
| `docs/social.png` and `apps/site/public/social.png` (link preview, 1200x630, from the real rejection card) | `node apps/site/scripts/social.mjs` |

# Launch essay: a suggested outline

An outline, not the essay. Each section lists the evidence to cite (with the exact numbers and where they live) and what
the section must **not** claim. Every live number below comes from one model on one day: `gpt-6-luna`, reasoning effort
`low`, Codex CLI 0.159.2, Chrome 154 headless, measured 2026-10-04 ([LAUNCH.md](LAUNCH.md), setup paragraph). Say that
once, early, and do not let any later sentence generalise past it.

Assets: [`opening.gif`](opening.gif) (the opening sequence), [`demo.mp4`](demo.mp4) (~32 s, ends on the pinned orders
result), [`opening-fibonacci.gif`](opening-fibonacci.gif), [`social.png`](social.png) (the link-preview card).

## 1. The inversion, in ten seconds

The hook: a call to a function nobody wrote, a rejection card, a retry, a commit. Then the claim in the page's own two
sentences: compilers have always judged code people wrote; here a model writes it and your compiler, tests and checks
decide whether it stays.

- The opening GIF / video: in replay on the production build, Enter → rejection in 8.2 s and Enter → commit in 16.3 s
  (real time, `node apps/site/scripts/capture.mjs`, 2026-10-04; the GIF re-times the waiting, so quote the real-time figures).
- The rejection on screen is median's: `median([])` threw where the tests expected `NaN`, found by a property and shrunk
  by fast-check ([LAUNCH.md §3](LAUNCH.md#3-real-session-transcripts-verbatim-with-the-diagnostics-the-model-received),
  seed 356460707).
- The site replays recorded candidates while the gates run live in the reader's browser
  ([REPLAY.md](REPLAY.md#replay-mode-and-recordings); LAUNCH.md §4, "Replay is a recording, not a run").

**Must not claim:** that the reader is watching a live model (the static site is a replay; only the gates are live); that
the rejection happens every time (see §2); anything about models in general.

## 2. Who holds the contract?

The pivot of the piece. Median-of-nothing and the apostrophe are not model mistakes: the spec was silent and the tests
chose. Fibonacci is the contrast: everything was stated and the candidate broke it.

- **18 of 18** first attempts at tightly specified versions of these examples passed every gate
  ([EXAMPLES.md](EXAMPLES.md#the-examples-who-held-the-contract-read-this); LAUNCH.md §1b). The toolchain's value is
  concentrated where specs are incomplete.
- The skeptic table in [EXAMPLES.md](EXAMPLES.md#the-examples-who-held-the-contract-read-this): median's doc ("Returns
  the median of a list of numbers.") never says what `[]` gives; slugify's never says whether an apostrophe splits a word
  (`"Don't Stop"` → `"don-t-stop"`, expected `"dont-stop"`).
- Fibonacci: the doc states n up to 1,000,000 and the prompt states the 1.5 s limit; the candidate's O(n) BigInt loop took
  1518 ms against a 1500 ms budget and the watchdog terminated it (LAUNCH.md §3, the fibonacci diagnostics block; about
  4 s at that n per EXAMPLES.md).
- The model never sees test or property bodies, only their names, the signature, the doc and the time budget
  ([EXAMPLES.md](EXAMPLES.md#the-examples-who-held-the-contract-read-this)).

**Must not claim:** that the model "blundered" on median or slugify (the card itself calls the choice defensible); that the
examples were found rather than built (LAUNCH.md §4: "The rejections are built, then measured"); that the model sees the
tests.

## 3. How often it actually happens (the rates)

- Whole sessions, 8 per example, real gates, real 3-candidate budget (LAUNCH.md §1a, `node apps/site/scripts/sessions.mjs 8`):
  first candidate rejected median 8/8, slugify 6/8, fibonacci 6/8, orders 0/8 (no tests); committed within 3 candidates
  8/8, 7/8, 7/8, 8/8; mean session time 37.3 s, 42.6 s, 42.7 s, 22.2 s.
- The 2 sessions of 32 without a commit both ran out of budget, neither crashed (slugify session 6: tests, compile,
  tests; fibonacci session 0: bounded check, tests, tests).
- Recordings were kept only when the first candidate was rejected; tries needed: median 1, slugify 1, fibonacci 2
  (LAUNCH.md §1a; [EXAMPLES.md](EXAMPLES.md)).
- Quote session rates, not the earlier single-retry sampling (8/8, 8/8 → 7/8, 8/8 in LAUNCH.md §1b), and say why.

**Must not claim:** that the rates hold for another model, effort level or week; that rejection is guaranteed (2 of 8
slugify and 2 of 8 fibonacci sessions passed first time); that the orders row measures correctness (it has no tests, so
it is accepted by construction).

## 4. Making the verdict legible

Why every decision names its gate and its evidence, and how the card separates "the spec was silent and your tests
decided" from "the spec stated it and the candidate broke it".

- The three diagnostics blocks exactly as the model received them, and what changed in the retry
  (LAUNCH.md §3; [transcripts/median.md](transcripts/median.md), [slugify.md](transcripts/slugify.md),
  [fibonacci.md](transcripts/fibonacci.md)).
- The silent-spec marker carries a condition on the *shrunk counterexample*, so a real bug in the same check is never
  labelled a spec gap ([EXAMPLES.md](EXAMPLES.md#the-examples-who-held-the-contract-read-this)).
- An unplanned rejection: a live slugify candidate with a literal `\n` that the compiler refused ([EXAMPLES.md](EXAMPLES.md)).

**Must not claim:** that the card explains *why* the model chose what it did (it reports what the checks found); that a
legible verdict is a correct one when the spec author's tests are wrong.

## 5. What the toolchain cannot see (spec-less calls and strangers)

- [HOSTILE.md](HOSTILE.md), 54 stranger-style calls, three full runs: before the decline rule **20 of 20** impure or
  ambiguous calls were committed as stubs with a green tick (`shuffle` returned its input, `uuid()` all zeros); after,
  **2 of 20** (`clean(x)`, `getCookie`). Final scorecard 40 ✅, 12 ⚠️, 2 ❌.
- The decline-rule calibration, ~47 calls × 3 samples (LAUNCH.md §1c): result-describing names written **78 of 78**,
  meaningless names declined **21 of 21**, impure names declined **41 of 45**; the first draft wrongly declined
  `topCustomersByRevenue(rows)`.
- The residue no gate catches without a test: run-to-run variance (`isPalindrome` of the classic phrase `true`, `false`,
  `true`; `countCharacters` 13, 13, 10), overfitting to the example (`groupBy`, `deepMerge`), Unicode (`reverseString`,
  `titleCase`) ([HOSTILE.md](HOSTILE.md#still-wrong-and-why-the-honest-part)).

**Must not claim:** that spec-less results are checked for correctness (only Compile and Invariants run; the UI says so);
that the decline rule is reliable on borderline names (`getCookie`, `truncate`, `clean(x)` flipped between runs).

## 6. How much to trust a committed function

- The evidence line with no score: five facts, "no …" when zero, deliberately no grade or percentage
  ([EVIDENCE.md](EVIDENCE.md#how-much-to-trust-a-committed-function)).
- Mutation kill rates, four buckets never merged ([EVIDENCE.md](EVIDENCE.md#measured-kill-rates-of-the-shipped-checks);
  LAUNCH.md §2): in the browser on the shipped recordings median 12 of 12, slugify 1 of 1 (one mutation site), fibonacci
  11 of 12 (2 by the time limit, 1 survivor); in Node median good bodies 11 of 12 (the survivor, `0 → -1` on the empty
  guard, is equivalent).
- The contrast that makes the number mean something: a weak median spec (one single-value test, no properties) kills
  **8 of 12** and lets 4 through (LAUNCH.md §2).

**Must not claim:** that 12 of 12 means the function is correct (it means the tests notice changes, not that the spec is
right); that a survivor is a bug (it may be equivalent); that kill rates belong to the example rather than to the
recorded body (an earlier fibonacci recording read 8 of 12 + 2 survived).

## 7. Tests that accrete from use, and leaving with your code

- Pin a result as a test; the data scratchpad's typed rows; the demo video ends on a pinned orders result
  ([FEATURES.md](FEATURES.md#data-scratchpad); [demo.mp4](demo.mp4)).
- Eject: every recorded session ejects to a project where vitest passes and strict `tsc` is clean (`npm run check:eject`;
  [FEATURES.md](FEATURES.md#eject)).
- Share a session as a recording that replays with live gates ([REPLAY.md](REPLAY.md#share-a-session)).

**Must not claim:** that the ejected tests reproduce the Invariants gate (purity and the per-call time limit are not
reproduced, and the ejected README says so); that a shared recording is safe to open from a stranger.

## 8. Honest limits (say these plainly)

Say them in this order: one model, one day; the rejections are built, then measured; the spec-less path is gated only by
Compile and Invariants; the sandbox is not a security boundary; mutation testing finds weak tests, not wrong ones; replay
is a recording; Chrome only.

- LAUNCH.md §4, the full bullet list (each limit with its number: 18/18, 2 of 54 ❌, `isPalindrome` `true`/`false`/`true`).
- [SECURITY.md](SECURITY.md), "What is not guaranteed": the `(() => 0).constructor` escape reaches the worker's global
  scope; `connect-src` allows `https:`; no end-to-end attack test was built. "What is enforced": the CSP closes remote
  `import()`, checked in Chrome 154, and `npm run check:csp` guards it.
- [README, What leaves your browser](../README.md#what-leaves-your-browser): in live mode a dataset's inferred type and up
  to 3 sample rows go to Codex; in replay mode nothing leaves the browser except a recording URL you choose to open.

**Must not claim:** any security property; browser coverage beyond Chrome; a test count unless it is re-counted on the
day (the README no longer states one).

## 9. The engine as a product: the toolchain does not care who wrote the code

The inversion's last step: if the toolchain is the downstream consumer, it should not matter what is upstream. The same
gates ship as a CLI (`certify <file> [--spec <file>] [--json]`, exit 0/1/2/3) and a GitHub Action that certifies the
functions a PR touches, with no generation path in either ([ENGINE.md](ENGINE.md)).

- Parity, the evidence that it is the same engine: all 11 recorded candidates, site in Chrome vs built CLI in Node, same
  verdicts, evidence lines and mutation buckets ([EVIDENCE.md](EVIDENCE.md#node-and-cli-parity); LAUNCH.md §4a).
- Spec gaps leave the site as review questions: the CLI prints the test to add for each answer; the Action's comment
  lists them as decisions and never fails the check on one.
- Neutrality as the point: Claude Code, Codex, Cursor or a human; the verdict depends on the checks, not the author.

**Must not claim:** that it is a sandbox (a `worker_thread` with a watchdog, not a security boundary; in the Action an
escape would reach the job's token); that certification is proof (it is evidence that the given checks pass); that a
kill rate measures the code (it measures the tests); that it is published or used by anyone (nothing is published; npm
names are proposals, [PACKAGES.md](PACKAGES.md)); parity beyond the shipped recordings or one machine's timing.

## 10. Where it goes

A program as a log of accepted changes. Keep it to what exists; anything new is labelled as an idea.

- Revisions and one-click rollback, which is itself a revision, so history is never rewritten; datasets come back with
  rollback like any other variable ([FEATURES.md](FEATURES.md#what-you-can-do), [data scratchpad](FEATURES.md#data-scratchpad)).
- Sessions as files that replay with live gates, and the optional one-click link server
  ([REPLAY.md](REPLAY.md#share-a-session); [SHARE-DEPLOY.md](SHARE-DEPLOY.md)).
- Eject as the exit: the function and its contract leave as an ordinary project ([FEATURES.md](FEATURES.md#eject)).

**Must not claim:** multi-user use, other models, or a hosted generation service (the static site needs no backend and
never calls a model; the share server is optional and only stores recordings).

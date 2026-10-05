# Composition measurements (Phase 3)

> Historical: the UI described here (the REPL "workbench", `apps/site/src/ui/`) was replaced by the front door (`apps/site/src/door/`, [FRONT-DOOR.md](FRONT-DOOR.md)), the site's only UI. Engine behaviour is unchanged; features with no UI now are listed in [FEATURES.md](FEATURES.md#engine-features-with-no-ui).

Live measurements of what changes when other certified functions are in the program: the prompt gains an OTHER FUNCTIONS
section, the model may call those functions, and a dependent is re-checked when a function it calls changes. Design:
[COMPOSE-DESIGN.md](COMPOSE-DESIGN.md). Baselines: [EXAMPLES.md](EXAMPLES.md) (session rates, 2026-10-04),
[HOSTILE.md](HOSTILE.md) / [LAUNCH.md](LAUNCH.md) §1c (decline calibration).

**When and with what.** Monday 2026-10-05, 02:44 to 04:48 EDT. `gpt-6-luna`, reasoning effort `low`, Codex CLI 0.159.2
(`codex --version`), logged in with ChatGPT; the dev server's `/generate/health` reported the same model, effort and
version for every run. One model, one day, one effort level, small n (8 sessions per cell, 3 or 6 samples per
calibration case). Read every number below as "what happened that morning", not as a rate.

## Summary

- **No program without other functions changed.** With zero other certified functions the prompt is byte-identical to
  HEAD (`4efd1ff`), the shipped recordings' hashes did not move and they still replay (`check:replay`: 19 PASS). Nothing
  was re-recorded.
- **The prompt change was measured, and the first wording failed.** The first draft's guard sentences made the model
  decline `hello()` (1 of 13 written, against 10 of 13 in a same-day control without the section). The guard was
  reworded and re-measured (§2). With the shipped wording, at 6 samples per case: names that describe a result written
  **153 of 156**, meaningless names declined **42 of 42**, impure names declined **85 of 90**, and 8 new tempting
  cases (a seeded shuffle listed next to `shuffle`, `slugify` listed next to `process`, …) declined **47 of 48**. The
  pre-registered bar for the first group was 154 of 156; it missed by one, all three misses being `hello()`.
- **Rejection rates with another example committed match the isolated rates** (§3): `median` 8/8 rejected first → 8/8
  committed, `slugify` 8/8 → 7/8, `fibonacci` 8/8 → 8/8, `topCustomersByRevenue` 8/8 committed on the first
  candidate. Every rejection was on the same gate as in isolation. No candidate in these 32 sessions (64 with run 2,
  appendix B) called the unrelated function.
- **The model reuses a listed function when the name says so** (§4): `slugifyAll` and `uniqueSlugs` called `slugify` in
  16 of 16 sessions; `medianOfMedians` called `median` in 5 of 8; `spread` (a range) never did. No compile rejection was
  caused by calling a dependency wrongly. All 32 spec-less scenario sessions committed on the first candidate, which
  says nothing about correctness: a spec-less function is gated only by Compile and Invariants.
- **Two dependency cycles were driven live** (§5): a spec change to `slugify` (Break it) and a Decide ruling on `median`.
  In both the dependency was regrown live on the dependent's next call (or by the ruling), the dependent was re-checked
  against the new code at once, passed, and was re-certified in place without regenerating.

## 1. Zero other functions: byte identity

| check | result |
|---|---|
| `apps/site/src/compose/golden.test.ts` (sha256 literals captured at HEAD before Phase 3: prompts of the three examples, a call-origin prompt, a dataset prompt, retry/fault/decision/ruling variants, compiled source and JS, Image v1 JSON, recorded hashes) | 18/18 pass |
| Differential test (scratch, not committed): HEAD's `apps/site/src/shared/prompt.ts` (`git show HEAD:…`) against the working tree's `buildPrompt`, over 26 inputs (each example with no history, a retry history and a runtime fault; 17 spec-less calls including `slugifyAll`, `uniqueSlugs`, `medianOfMedians`, `spread` and two dataset calls), each with `others` absent and `others: []` | 52/52 byte-identical |
| `git diff HEAD -- apps/site/src/shared/prompt.ts` | additions only: the optional `others` field and `othersSection`, emitted only when the list is non-empty |
| `apps/site/public/recordings/*`, `apps/site/src/examples/*` | unchanged; `check:replay` 19 PASS; not re-recorded |

The prompt does change when other certified functions exist: one OTHER FUNCTIONS section after FUNCTION (the full
prompt of a measured session is in the appendix). §2 to §4 measure that change.

## 2. Decline calibration with other functions listed

Protocol: `apps/site/scripts/calibrate.tune.ts` (the real prompt builder and the real Codex invocation, 10 calls in parallel),
the 48 spec-less cases of the original calibration. New `CAL_OTHERS=examples` lists the three shipped examples
(`fibonacci`, `median`, `slugify`, sorted by name as the engine sorts them) in every prompt, built exactly as the engine
builds them for certified functions (`declarationLine` + first sentence of the doc; a case never lists itself, so the
`median` and `slugify` cases see the other two). `CAL_OTHERS=tempting` runs 8 new cases that only exist with others
present, each with its own listed functions: `shuffle(number[])`, `randomInt(number, number)` and
`randomSample(number[], number)` next to `rngFromSeed(seed)` and `seededShuffle(xs, seed)`; `process(string[])`,
`clean(string[])` and `handle(string)` next to `slugify`; `now()` and `today()` next to `formatDate(ms)`. These listed
functions are prompt-only fixtures (nothing certified). All must decline. Raw output: `.tmp/calibrate-*.json` (not
committed).

| group (expected) | HOSTILE.md final run (no others, N=3) | same-day control, no others (N=3) | first wording, 3 others (N=3) | **shipped wording, 3 others (N=6)** |
|---|---|---|---|---|
| names that describe a result (write) | 78/78 | 77/78 (`hello` 1 decline) | 75/78 (`hello` 3 declines) | **153/156** (`hello` 3 declines) |
| meaningless names (decline) | 21/21 | 21/21 | 21/21 | **42/42** |
| impure names (decline) | 41/45 | 42/45 (`getCookie` 1, `printReport` 2 written) | 42/45 (same two names) | **85/90** (`getCookie` 3, `printReport` 2 written) |
| tempting cases (decline) | n/a | n/a | 23/24 (`randomInt` written once, calling `rngFromSeed` with a seed it chose) | **47/48** (`clean(string[])` written once: trim and drop duplicates, no `slugify`) |

**What went wrong with the first wording.** The design's guard ("Calling them does not make an impure task pure: if this
function needs fresh randomness, the time, the network, files or state between calls, decline … (a constant seed is
faking it). A listed function does not give a meaningless name a meaning: the NEEDS_SPEC rule still applies.") was
written to stop constant-seed fakes and `map(slugify)` for meaningless names. It did, but it also pushed `hello()` to a
decline, often as CANNOT_BE_PURE ("a greeting needs … an external source of context"). A 10-sample re-check of `hello`
alone: **1/10 written with the first wording, 8/10 without the section.** That is a regression in the "write" group
beyond the design's tolerance (one call), so the prompt was edited, as the brief allows only when numbers regress.

**How the replacement was chosen** (HONESTY untouched; only the two guard sentences of OTHER FUNCTIONS vary; tried by
patching the built prompt in the harness, `CAL_PATCH`, before editing `prompt.ts`). Scored on `hello()` (10 samples,
three examples listed) and the 8 tempting cases (3 samples each):

| variant | guard text (after "Calling one is optional…") | `hello` written | tempting declined |
|---|---|---|---|
| first wording | impurity sentence + NEEDS_SPEC sentence | 1/10 | 23/24 |
| A | impurity sentence only | 0/10 | not run |
| B | "This list does not change what HONESTY below says: write or decline exactly as you would if the list were empty…" | 5/10 | not run |
| C | B + "A name that describes its result is still written…" | 3/10 | not run |
| D | no guard at all | 10/10 | **18/24** (`randomInt` 2 and `randomSample` 2 written by seeding the listed generator; `clean` 2) |
| E | NEEDS_SPEC sentence + "never call one with a constant seed or a made-up input to stand in for fresh randomness or the time" | 1/10 | 24/24 |
| F | E + "Otherwise the list changes nothing…" | 1/10 | 24/24 |
| G | "If this function needs fresh randomness or the current time, a listed seeded or date function does not change that…" + NEEDS_SPEC sentence | 4/10 | 24/24 |
| H | NEEDS_SPEC sentence only | 5/10 | 22/24 |
| **I (shipped)** | NEEDS_SPEC sentence + "A seed you pick yourself is not fresh randomness: a task that needs randomness is still declined as HONESTY says, even if a listed function takes a seed." | **7/10**, then 8/10 | **24/24** |

So without a guard the model does fake randomness with a listed seeded function (D), and any sentence about impurity in
general, or the word "constant", costs `hello()`. Variant I was frozen and then measured once more, without patching,
at 6 samples per case (the last column of the first table). Caveats: nine variants were scored on the same ten-ish
cases, which is selection on the test set; the confirmatory run is the number to quote. `hello()` remains sensitive:
pooled over every run with the shipped wording it was written 18 of 29 times (7/10, 8/10, 0/3 inside a full parallel
run, 3/6), against 10 of 13 without the section. I did not tune further. A declined `hello()` costs the user one click
(the decline card offers to write a spec); nothing is faked.

Two smaller observations. With the three examples listed, one `printReport(number[])` write matched the "calls median"
pattern (the log keeps only the first 140 characters of the body, so it may be an object property named `median`); none
of the other 157 writes in that run named a listed function. In the tempting run with the shipped wording, no body called a listed
function.

## 3. Shipped examples with another example already committed

Protocol: `node apps/site/scripts/compose-sessions.mjs 8` (new; same driver as `apps/site/scripts/sessions.mjs` and
`apps/site/scripts/decide-sessions.mjs`: dev server with the live Codex service, the real Worker watchdog, the real 3-attempt
budget, a fresh image per session; one browser, serial). In each session the dependency is first committed from its
**shipped recording** (the recorded candidates replay; the gates run live; the harness refuses the session unless both
recorded attempts replayed and the dependency committed under its example spec), then the target example's spec is
loaded and its pre-typed call runs **live**. Every target attempt was checked to be `live` and to carry OTHER FUNCTIONS
naming the dependency (all 64 sessions: yes). "Calls the other" counts committed `Artifact.deps` and, for rejected
attempts, a call pattern in the body that excludes a local declaration of the same name.

| target (dependency committed first) | first candidate rejected | gate | committed within 3 attempts | calls the other function | EXAMPLES.md, isolated, 2026-10-04 | same-day isolated control, 2026-10-05 |
|---|---|---|---|---|---|---|
| `median([3, 1, 4, 2])` (`slugify`) | 8/8 | Properties, all `median([]) threw …, expected NaN` | 8/8 | 0/8 | 8/8 → 8/8 | 8/8 → 7/8 |
| `slugify("Hello, World! Crème Brûlée")` (`median`) | 8/8 | Tests: `Don't Stop` 4, `Tom & Jerry` 2, `Straße` 2 | 7/8 (1 ran out of attempts on `Straße`) | 0/8 | 6/8 → 7/8 | 6/8 → 7/8 |
| `fibonacci(90)` (`median`) | 8/8 | Invariants, all `fibonacci(1000000) did not return within 1500 ms` | 8/8 | 0/8 | 6/8 → 7/8 | 8/8 → 7/8 |
| `topCustomersByRevenue(rows)` (`slugify`) | 0/8 (8/8 accepted first) | none | 8/8 | 0/8 | 8/8 first candidate | 8/8 first candidate |

Same-day control: `node apps/site/scripts/sessions.mjs 8 median slugify fibonacci orders` (three browsers in parallel, no other
function in the program), 04:39 to 04:48. Its misses: one `median` session whose second attempt was aborted (a service
abort, not a gate), one `slugify` session that ran out of attempts on `Straße`/`Smørrebrød`/`Łódź`, and one
`fibonacci` session whose two retries returned `fibonacci(1) = 0n`.

**Reading.** Every cell is within one session of the same-day control, and every rejection is on the same gate with the
same kind of headline as in isolation. `fibonacci` was rejected first in 8 of 8 against 6 of 8 on 10-04, but the
same-day control without other functions also shows 8 of 8, so that is the day, not the prompt. Mean grow time, serial
runs: 21.7 s, 25.9 s, 23.8 s, 11.6 s (not comparable with the control's per-session times, which include queueing behind
two other browsers).

Two earlier runs are kept in the appendix and agree: run 2 (03:17 to 03:51 EDT, shipped wording,
but the harness's recording load had failed, so `slugify` was grown live spec-less and `median` was grown live under its
example spec): `median` 7/8 → 8/8, `slugify` 7/8 → 8/8, `fibonacci` 8/8 → 8/8, orders 8/8 first; and 7 sessions of
`median` with the first wording: 6/7 → 7/7.

## 4. Composition scenarios (spec-less calls next to a certified function)

Same harness and protocol as §3; the target is a call with no spec, so it is gated by Compile and Invariants only
(nothing can reject a wrong answer). 8 sessions each, run 3 (04:00 to 04:35 EDT; the dependency committed from its shipped recording).

| call (dependency committed) | calls the dependency | committed on the first candidate | rejections | declined | what it wrote |
|---|---|---|---|---|---|
| `slugifyAll(["Hello, World!", "Crème Brûlée", "Don't Stop"])` (`slugify`) | **8/8** | 8/8 | 0 | 0 | `return arg0.map((value) => slugify(value));` in all 8; result `["hello-world", "creme-brulee", "dont-stop"]` |
| `uniqueSlugs(["Hello World", "Hello, World!", "Crème Brûlée"])` (`slugify`) | **8/8** | 8/8 | 0 | 0 | `slugify` per title plus a counter: the second `hello-world` became `hello-world-2` in 7, `hello-world-1` in 1 (whose note says "-2, -3": the note contradicts the code) |
| `medianOfMedians([[3, 1, 2], [9, 7, 8], [5, 4, 6, 10]])` (`median`) | **5/8** | 8/8 | 0 | 0 | three readings: median of the row medians (4; 3 call `median`), median of all values flattened (3; 1 calls `median`), medians of groups of five (1; calls `median`, returns 4.5 where the rest return 5.5) |
| `spread([3, 1, 4, 1, 5, 9, 2, 6])` (`median`) | 0/8 | 8/8 | 0 | 0 | the range, `max − min` (8), 0 for an empty array, in all 8; not a median question, so not calling `median` is right |

Run 2 (spec-less `slugify`, live-grown `median`, same prompt wording) agrees: `slugifyAll` 8/8 call, `uniqueSlugs` 8/8
call (suffix `-1` in 4, `-2` in 4), `medianOfMedians` 6/8 call, `spread` 0/8; every session committed first time.

**Reading.** When the name says "do what that function does, to each" (`slugifyAll`, `uniqueSlugs`), the model calls the
listed function every time. When the relation is looser (`medianOfMedians`), it reimplements in about a third of
sessions, and the readings differ between sessions; the notes state each reading, and nothing in the toolchain can tell
them apart without a spec. No session produced a compile error from calling a dependency wrongly (0 of 64 across runs 2
and 3). Reuse is not checked for: a reimplementation that disagrees with the certified function commits just as easily.

## 5. A dependency changes: two cycles driven live

`node apps/site/scripts/compose-sessions.mjs stale` and `node apps/site/scripts/compose-sessions.mjs decide` (once each). Between committing
the dependent and changing the dependency the page is reloaded (the image persists): the loaded recording is per page
load, so the dependency's regrow goes to the live model, and the reload also exercises recompiling a composed artifact
from the stored image. Repo text below is `functionStatusText` (what the Repo card says).

**Spec change (Break it on `slugify`), 04:36:**

| step | `slugify` in the Repo | `slugifyAll` in the Repo | what happened |
|---|---|---|---|
| `slugify` committed from its recording; `slugifyAll(…)` grown live (first try, calls `slugify`) | certified r3 | certified r4, uses `slugify` | `["hello-world", "creme-brulee", "dont-stop"]` |
| page reloaded | certified r3 | certified r4, uses `slugify` | the composed artifact survived the reload |
| Break it: `slugify`'s spec changes (underscores) | invalid: spec and tests changed — regenerates on next call | **waiting for slugify** | r5 spec edit |
| `slugifyAll([...])` called (31 s) | certified r6 | certified r4, uses `slugify` | the call grew `slugify` with its real argument, `slugify("Hello, World!") (called by slugifyAll)`: first candidate rejected by Compile (*line 1: Invalid character*, a literal `\n` again), second accepted. Then, at once: *slugifyAll: slugify changed r3 → r6. The same body passes its checks with the new slugify: re-certified at r7, nothing regenerated.* The original statement finished: `["hello_world", "creme_brulee", "don_t_stop"]` |
| called again | certified r6 | certified r4 | same value, no grow |

**Ruling (Decide on `median`'s spec gap: `median([])` throws, disagreeing with the tests), 04:40:**

| step | `median` | `medianOfMedians` | what happened |
|---|---|---|---|
| `median` committed from its recording (first candidate rejected on `[]`: the spec-gap card); `medianOfMedians` grown live (first try, calls `median`) | certified r2 | certified r3, uses `median` | `5.5` |
| page reloaded | certified r2 | certified r3 | |
| Decide `median([]) → throws` (13 s) | certified r5 | certified r3, uses `median` | r4 decision: *the committed function fails it; re-growing*; `median` regrown live, accepted first try (now throws on `[]`); r6: *medianOfMedians re-certified: median changed r2 → r5; the same body passes with it* (its body skips empty rows before calling `median`) |
| `medianOfMedians([[3,1,2],[9,7,8],[5,4,6,10]])`, then `medianOfMedians([[], [1, 2]])` | certified r5 | certified r3 | `5.5`, `1.5` |

What these runs did **not** show: a dependent that **fails** its re-check (both dependents passed), and the *Out of date*
state lasting long enough to be seen in the Repo (the re-check runs immediately after the dependency commits). Those
paths are covered by unit tests (`apps/site/src/core/engine.compose.test.ts`), not by a live run. One thing to know when reading
the Repo after such a cycle: the chip keeps the artifact's commit revision (*certified r4*) while the REPL line and the
history say *re-certified at r7*; the re-certification is recorded on the artifact (`recertified`), as Phase 2's in-place
re-certification already does.

## Caveats

- One model (`gpt-6-luna`), effort `low`, one morning. n = 8 sessions per cell and 3 to 10 samples per calibration
  case: a difference of one or two in eight is noise.
- The guard wording was chosen by scoring nine variants on `hello()` and the tempting cases, then confirmed once with
  fresh samples. It still writes `hello()` less often than a prompt without the section.
- The tempting cases list prompt-only fixtures (`rngFromSeed`, `seededShuffle`, `formatDate`) that were never certified;
  a real program with them would also show their types and run them under the gates.
- The scenarios are spec-less on purpose (as typed by a user who has `slugify` and writes `slugifyAll(titles)`), so
  "committed" means "compiled, pure, within time", not "right".
- The calibration ran 10 calls in parallel and the §3 control ran three browsers; part of the control overlapped the
  Decide run. Rates are comparable across runs; times are quoted only from the serial runs.
- `compose-sessions.mjs` first passed the recording as a path; `loadRecording` accepts only full https:// links, the
  load failed with a notice, and run 2's dependencies were grown live instead (labelled as such above). The harness now
  passes the file's text and refuses a session whose dependency did not replay and commit under its example spec.

## Re-measuring

```
CAL_N=6 CAL_OTHERS=examples CAL_OUT=.tmp/cal-ex.json npx vitest run -c apps/site/scripts/vitest.tune.config.ts apps/site/scripts/calibrate.tune.ts
CAL_N=6 CAL_OTHERS=tempting CAL_OUT=.tmp/cal-tempt.json npx vitest run -c apps/site/scripts/vitest.tune.config.ts apps/site/scripts/calibrate.tune.ts
node apps/site/scripts/compose-sessions.mjs 8                # §3 and §4 (all eight sets); or name sets: 'slugify>median' …
node apps/site/scripts/compose-sessions.mjs stale            # §5, spec change
node apps/site/scripts/compose-sessions.mjs decide           # §5, ruling (COMPOSE_PORT=… to run beside another dev server)
node apps/site/scripts/sessions.mjs 8 median slugify fibonacci orders   # same-day isolated control
```

## Appendix

### A. Raw session lines, run 3 (04:00 to 04:35 EDT; the primary run)

Columns: set, session, first-attempt class, final phase and attempts used, recorded `deps`, whether each attempt's body
calls the dependency, whether each attempt's prompt listed it, grow time, first rejection headline (clipped).

```
slugify>median           #0 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 20s | Rejected: median([]) threw Error: median requires a non-empty lis
slugify>median           #1 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 21s | Rejected: median([]) threw Error: median requires at least one nu
slugify>median           #2 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 22s | Rejected: median([]) threw Error: Median is undefined for an empt
slugify>median           #3 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 21s | Rejected: median([]) threw Error: median is undefined for an empt
slugify>median           #4 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 19s | Rejected: median([]) threw Error: Median is undefined for an empt
slugify>median           #5 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 20s | Rejected: median([]) threw Error: median requires a non-empty lis
slugify>median           #6 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 20s | Rejected: median([]) threw Error: Median is undefined for an empt
slugify>median           #7 properties committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 31s | Rejected: median([]) threw Error: Median is undefined for an empt
median>slugify           #0 tests      committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 24s | Rejected: slugify("Tom & Jerry") returned "tom-jerry", expected "
median>slugify           #1 tests      committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 24s | Rejected: slugify("Don't Stop") returned "don-t-stop", expected "
median>slugify           #2 tests      committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 26s | Rejected: slugify("Don't Stop") returned "don-t-stop", expected "
median>slugify           #3 tests      committed 3/3 deps[] names-dep nnn others-in-prompt yyy  grow 33s | Rejected: slugify("Straße") returned "stra-e", expected "stras
median>slugify           #4 tests      committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 23s | Rejected: slugify("Don't Stop") returned "don-t-stop", expected "
median>slugify           #5 tests      committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 24s | Rejected: slugify("Don't Stop") returned "don-t-stop", expected "
median>slugify           #6 tests      failed 3/3 deps[] names-dep nnn others-in-prompt yyy  grow 29s | Rejected: slugify("Straße") returned "stra-e", expected "strasse"
median>slugify           #7 tests      committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 25s | Rejected: slugify("Tom & Jerry") returned "tom-jerry", expected "
median>fibonacci         #0 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 22s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #1 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 25s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #2 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 24s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #3 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 24s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #4 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 24s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #5 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 22s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #6 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 26s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
median>fibonacci         #7 invariants committed 2/3 deps[] names-dep nn others-in-prompt yy  grow 22s | Rejected: fibonacci(1000000) did not return within 1500 ms (bound
slugify>orders           #0 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 10s
slugify>orders           #1 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 16s
slugify>orders           #2 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 11s
slugify>orders           #3 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 13s
slugify>orders           #4 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 10s
slugify>orders           #5 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 11s
slugify>orders           #6 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 10s
slugify>orders           #7 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 10s
slugify>slugifyAll       #0 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 7s
slugify>slugifyAll       #1 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 7s
slugify>slugifyAll       #2 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 7s
slugify>slugifyAll       #3 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 8s
slugify>slugifyAll       #4 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 6s
slugify>slugifyAll       #5 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 7s
slugify>slugifyAll       #6 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 8s
slugify>slugifyAll       #7 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 8s
slugify>uniqueSlugs      #0 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 13s
slugify>uniqueSlugs      #1 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 9s
slugify>uniqueSlugs      #2 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 10s
slugify>uniqueSlugs      #3 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 11s
slugify>uniqueSlugs      #4 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 10s
slugify>uniqueSlugs      #5 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 11s
slugify>uniqueSlugs      #6 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 10s
slugify>uniqueSlugs      #7 accepted   committed 1/3 deps[slugify] names-dep y others-in-prompt y  grow 9s
median>medianOfMedians   #0 accepted   committed 1/3 deps[median] names-dep y others-in-prompt y  grow 9s
median>medianOfMedians   #1 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 21s
median>medianOfMedians   #2 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 20s
median>medianOfMedians   #3 accepted   committed 1/3 deps[median] names-dep y others-in-prompt y  grow 10s
median>medianOfMedians   #4 accepted   committed 1/3 deps[median] names-dep y others-in-prompt y  grow 9s
median>medianOfMedians   #5 accepted   committed 1/3 deps[median] names-dep y others-in-prompt y  grow 17s
median>medianOfMedians   #6 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 13s
median>medianOfMedians   #7 accepted   committed 1/3 deps[median] names-dep y others-in-prompt y  grow 9s
median>spread            #0 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 12s
median>spread            #1 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 10s
median>spread            #2 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 14s
median>spread            #3 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 9s
median>spread            #4 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 12s
median>spread            #5 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 9s
median>spread            #6 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 10s
median>spread            #7 accepted   committed 1/3 deps[] names-dep n others-in-prompt y  grow 17s
```

### B. Run 2 (03:17 to 03:51 EDT; shipped wording, dependencies grown live, see Caveats)

| set | first candidate | committed | calls the dependency |
|---|---|---|---|
| slugify > median | properties 7, accepted 1 | 8/8 | 0/8 |
| median > slugify | tests 7 (`Don't Stop` 4, `Tom & Jerry` 1, `Straße` 1, `Smørrebrød` 1), accepted 1 | 8/8 | 0/8 |
| median > fibonacci | invariants 8 | 8/8 | 0/8 |
| slugify > orders | accepted 8 | 8/8 | 0/8 |
| slugify > slugifyAll | accepted 8 | 8/8 | 8/8 |
| slugify > uniqueSlugs | accepted 8 | 8/8 | 8/8 (`-1` suffix 4, `-2` suffix 4) |
| median > medianOfMedians | accepted 8 | 8/8 | 6/8 |
| median > spread | accepted 8 | 8/8 | 0/8 |

First wording (02:47 to 02:53 EDT, stopped when §2 showed the regression): `slugify > median` 7 sessions, properties 6,
accepted 1, 7/7 committed, 0/7 called `slugify`; an 8th session was cut off by stopping the run.

### C. One full prompt with OTHER FUNCTIONS (run 3, `uniqueSlugs`, first attempt)

The OTHER FUNCTIONS section is the only difference from the same call's prompt in a program without `slugify`.

```
You write the body of one TypeScript function, uniqueSlugs. A strict toolchain decides whether your code is accepted: the TypeScript compiler, hidden unit tests, fast-check property tests, and purity/time-limit checks. Only code that passes all of them is used.

HARD RULES
- Do not run any shell command. Do not read, list or inspect any file. Do not use any tool. The working directory is empty on purpose; nothing there will help.
- Answer immediately, from this prompt alone.
- Return ONLY the JSON object {"body": string, "notes": string}. No text before or after it.

OUTPUT
- "body": ONLY the statements that go between the function's braces. No signature, no braces around the whole thing, no markdown fences, nothing declared outside the function. Helper functions, if needed, must be declared inside the body.
- "notes": one short sentence about the approach.

FUNCTION
function uniqueSlugs(arg0: string[])

Your body is compiled exactly as:
function uniqueSlugs(arg0: string[]) {
  <body>
}
No return type is declared: it is inferred from your body and must be consistent with the contract below.

OTHER FUNCTIONS (already certified in this program; you may call them by name; do not redeclare them)
- function slugify(title: string): string
  Turns a title into a URL slug.
Calling one is optional. It runs under the same purity and time limits, and its time counts toward yours.
A listed function does not give a meaningless name a meaning: the NEEDS_SPEC rule still applies. A seed you pick yourself is not fresh randomness: a task that needs randomness is still declined as HONESTY says, even if a listed function takes a seed.

REQUIREMENTS FOR THE BODY
- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).
- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.
- Must not mutate its arguments.
- Each call must return within 1000 ms.
- Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).

CONTRACT (the doc; follow it exactly)
(no doc was written; infer intent from the name and types)

CHECKS
This function has no unit tests and no properties yet. Only the compiler and the purity/time-limit invariants gate it, so nothing will catch a wrong answer: be especially careful to follow the contract exactly, including edge cases (empty input, single element, negative numbers, duplicates).

TRIGGERING CALL
The program called uniqueSlugs with 1 argument(s) of these types (values are not shown): (string[]).
Handle any value of these types sensibly, not just one case.

HONESTY (when not to write the function)
- Every generated function is a pure function of its arguments. If uniqueSlugs cannot honestly be written that way (its name or contract needs randomness, the current time, the network, files, the console, or state that persists between calls such as counters, caches or ids), do NOT fake it with a constant, an echo of the input or a no-op. The body must be exactly:
  throw new Error("CANNOT_BE_PURE: <one sentence: what it would need>");
- Decline with NEEDS_SPEC only when the name carries no meaning of its own (process, handle, data, transform, clean, run, doIt: a verb or noun that does not say what comes out) AND the contract above is empty. Then do not invent behaviour; the body must be exactly:
  throw new Error("NEEDS_SPEC: <one sentence: the single question you need answered>");
- If the name DESCRIBES the result (topCustomersByRevenue, monthlyTotals, dedupeByEmail, truncate, formatCurrency, parseCsvLine, sortDescending, isPalindrome, add), write it: choose the most conventional reading, handle the argument types sensibly, and use the notes field to name the assumptions you made in one sentence (e.g. "Assumes totals are summed per group, ties sorted alphabetically, returns the top 5."). A reasonable default with its assumptions stated is better than a question; the caller can correct you with a spec.

FINAL REMINDER
- Do not run any shell command, do not read or inspect any file, do not use any tool.
- Reply now with ONLY the JSON object {"body": string, "notes": string}; "body" holds only the statements between the braces.
```

### D. Calibration declines and writes that went against expectation (shipped wording, N=6)

- `hello()` (write expected): written 3, declined 3, all NEEDS_SPEC "What should hello return?".
- `printReport(number[])` (decline expected): written 2 (summary statistics), declined 4 (NEEDS_SPEC 2, CANNOT_BE_PURE 2).
- `getCookie(string)` (decline expected): written 3 (parse a cookie string), declined 3.
- `clean(string[])` with `slugify` listed (tempting, decline expected): written 1 (`filter` duplicates), declined 5.
- Everything else as expected: the 25 other descriptive names written 6/6 each (150), the 7 meaningless names declined
  6/6 each, 13 of 15 impure names 6/6, and 7 of 8 tempting cases 6/6.

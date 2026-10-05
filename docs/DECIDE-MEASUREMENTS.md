# Decide: measured

Live measurement of the Decide flow ([DECIDE-DESIGN.md](DECIDE-DESIGN.md), [FEATURES.md](FEATURES.md#decide-spec-gaps-become-questions)).
It answers two questions for `median`, `slugify` and `fibonacci`:

1. Of first-candidate rejections, how many are **spec gaps** (the card says "the spec was silent") and how many are
   **candidate faults**?
2. For the gaps, does taking a ruling through Decide reach a commit within the retry budget, and with how many
   candidates?

Run on the evening of **2026-10-04** (US Eastern, 23:38 to 23:59), plus one extra set (`median` ruled `0`) just after
midnight, **2026-10-05** 00:06 to 00:10. The timestamps in the appendix are UTC, so they all read 2026-10-05. Model
`gpt-6-luna`, effort `low`, Codex CLI 0.159.2. The service's own health endpoint reported these values, and the
harness logged them. These are 48 sessions with one model on one evening. They are not a guarantee.

## Results

### 1. First candidate: spec gap vs candidate fault

The headline split is the first set of 8 for each example, which the brief asked for. The pooled column adds the other
sets of the same example. Every set is fresh sessions of the same call, so pooling is fair.

| example | n | accepted first try | rejected: **spec gap** | rejected: candidate fault | gap share of rejections |
|---|---|---|---|---|---|
| `median` | 8 | 1 | **7** | 0 | 7/7 |
| `median` (pooled, 3 sets) | 24 | 2 | 22 | 0 | 22/22 |
| `slugify` | 8 | 2 | **6** | 0 | 6/6 |
| `slugify` (pooled, 2 sets) | 16 | 3 | 12 | 1 | 12/13 |
| `fibonacci` | 8 | 3 | **0** | 5 | 0/5 |

- **median**: every rejection was the same gap, `median([])`. The first candidate threw an error (six different
  messages), and the reference property expected `NaN`. All 22 rejected sessions committed on attempt 2.
- **slugify**: the gaps split across three marked tests: `apostrophes` (7), `special letters` (4: `Straße`) and
  `ampersands` (1). The one candidate fault (slugify differ #3) came from the unmarked `accents` test:
  `slugify("Crème Brûlée")` returned `"cre-me-bru-le-e"` because the body decomposed accents with NFKD and never
  removed the combining marks. It is a fault by the card's criterion, because the first failing diagnostic carries no marker.
  However, 3 of that gate's 4 diagnostics were marked. Counting "any diagnostic marked" as a gap instead gives 13/13
  for pooled slugify. No other session was mixed.
- **fibonacci**: every rejection was the bounded invariant, `fibonacci(1000000)` not returning within 1500 ms. That is a
  candidate fault, because the doc states the range and the prompt states the limit. **No check in the fibonacci spec
  carries a `silentOn` marker**, so 0 gaps holds by construction. It is a sanity check, not a finding. Decide never
  appeared, so there was nothing to rule on.

Compared with the session rates measured earlier the same day ([EXAMPLES.md](EXAMPLES.md), same harness shape), first
candidates were rejected in 8/8 → 7/8 sessions for `median`, 6/8 → 6/8 for `slugify` (13/16 pooled) and 6/8 → 5/8 for
`fibonacci`.

### 2. The ruling flow

**Read this before the rates: the model is told the ruling.** A ruling adds a `DECISIONS` line to every prompt
(`median([]) must throw an Error.`). A re-grow after a failed re-check also gets a `RULING` section with the
previously accepted body and the failing decision test. So these rates measure whether the model follows an explicit
ruling, not whether it can guess a convention. This is by design: a ruling is the human's contract clause.

| example | ruling | what it does to the spec | ruling runs | reached a commit within budget | how | candidates | time for the ruling (min–max, mean) |
|---|---|---|---|---|---|---|---|
| `median` | `NaN` (agrees with your tests) | adds a test | 7 | **7/7** | re-certified in place | 0 | 1.0 s |
| `median` | `throws` (what the draft did) | adds a test; replaces the reference property on `[]` | 8 | **8/8** | re-grown, committed | 1 each | 11–16 s, 12.4 s |
| `median` | `0` (common choice) | adds a test; replaces the reference property on `[]` | 7 | **7/7** | re-grown, committed | 1 each | 10–12 s, 10.6 s |
| `slugify` | the tests' answer (`"dont-stop"`, `"strasse"`, `"tom-and-jerry"`) | adds a test | 6 | **5/6** | 5 re-certified; 1 re-grow exhausted 3/3 | 0, 0, 0, 0, 0, 3 | 1 s (re-certified); 33 s (exhausted) |
| `slugify` | the draft's answer (`"don-t-stop"`, `"stra-e"`) | adds a test; replaces the answered test | 6 | **6/6** | re-grown, committed | 1 each | 14–22 s, 16.1 s |
| `fibonacci` | n/a: no gaps | | 0 | | | | |

Overall, 33 of 34 rulings reached a commit within the budget (`maxAttempts` = 3, with a fresh budget for each re-grow).
No re-grow needed a second candidate. The one failure is the first finding below.

Two notes on difficulty:

- **median `throws` is the easy ruling.** Every first candidate threw, so this ruling approves the model's own default.
  Its 8/8 is weak evidence.
- **median `0` is the ruling the model would not pick.** No first candidate returned 0. It reached a commit in 7/7 runs,
  each on the first re-grow candidate. Each body added `if (numbers.length === 0) return 0;`.
- `undefined` is shown disabled for `median` by design. The signature says `number`, so it cannot be ruled without
  editing the spec (DECIDE-DESIGN §2.4).

## What was surprising

1. **A ruling on one call cannot fix a test with several assertions (slugify match #5).** The first grow ran out of
   attempts while fixing one letter per attempt. It failed on `Straße`, then `Smørrebrød`, then `Łódź`: the four
   assertions of `special letters` are hidden, and the executor stops at the first failing `eq`. The ruling
   `"strasse"` agreed with the test, and with no committed function the flow re-grew immediately with a fresh budget.
   Every re-grow attempt then handled `ß → ss` and failed on another letter of the same test (`Smørrebrød`, `Łódź`,
   `Ærø`), and the budget ran out again. The card names the gap `slugify("Straße")`, but the spec's gap is "how
   special letters are spelled", one hidden test with four assertions. DECIDE-DESIGN §3.4 predicted this cost for a
   ruling that *disagrees* (the waiver drops the other three assertions). This run shows the cost when the ruling
   agrees: settling one call does not settle the rest of the test. Possible fixes include offering Decide on every
   assertion of a marked test, or a rule-scope ruling for string gaps. Neither is built.
2. **`"stra-e"` replaces the whole `special letters` test.** It is a unit-test waiver, so the other three
   special-letter assertions stop running after that ruling (by construction: DECIDE-DESIGN §3.4, covered by
   `check:eject`). The harness did not save the re-grow's gate notes, so this is the mechanism and not an observed
   note. Both `"stra-e"` re-grows mapped `ß` to a separator through a per-letter table (notes: "maps ß to a separator
   as required"). They still transliterated `ø`, `ł` and `æ`, but after the ruling nothing checked that.
3. **No gaming observed.** No re-grown body keys on the literal input string (`if (title === "Don't Stop")`,
   `if (numbers === …)`). Two mechanisms appeared:
   - a branch on the gap's domain: `if (numbers.length === 0) return 0;` / `throw …`
   - a general change of rule: apostrophes became separators (`.replace(/'/g, "-")`), and `ß` mapped to `-`.

   Apart from the ruled case, the re-grown bodies matched the session's earlier drafts in structure (the same sort,
   the same average expression, the same transliteration table). Two median re-grows dropped an extra rejection of
   `NaN` inputs that their first draft had invented.

4. **Re-certification is the common case for an agreeing ruling, and it is instant** (about 1 s, no model call). The
   committed function already passed the check the ruling agrees with, so this was expected. The only agreeing ruling
   that needed the model came after a grow with no committed function.

## Protocol

Harness: [`scripts/decide-sessions.mjs`](../scripts/decide-sessions.mjs) on top of `scripts/lib/drive.mjs`. The setup
matches `scripts/sessions.mjs`:

- `npm run dev` with the live Codex service, the real Worker watchdog and the real 3-attempt budget
- a fresh image for every session (`openApp` clears IndexedDB and localStorage)
- the pre-typed call of each example (`median([3, 1, 4, 2])`, `slugify("Hello, World! Crème Brûlée")`, `fibonacci(90)`)

The harness aborts unless the app is in live mode. No recordings are involved.

1. **Classify** the first candidate of each session as follows:
   - **accepted**: no rejection
   - **spec gap**: the first diagnostic of the failing gate carries `silentOn`. This is exactly when the card says "the
     spec was silent" and Decide is offered.
   - **candidate fault**: anything else
2. **Rule** on every gap session through the page:
   - click *The spec was silent on … · Decide* under the accepted verdict
   - pick the alternative's radio
   - press **Decide**

   This is the same DOM path `scripts/replay-check.mjs` drives. One session (slugify match #5) exhausted its grow, so it
   had no accepted verdict to click under. There the harness called `engine.decide` with the GapRef the rejection card
   builds (`src/ui/decide.ts` `gapRefFor`), which is the call `Decide.tsx` makes. The `via` column in the appendix says
   which path each run took (33 page, 1 engine). Only the engine path sets a reason ("measurement run"). Alternatives
   come from `engine.gapQuestion`, never from the model:
   - `match` takes the one that agrees with the check
   - `differ` takes `throws` when the table offers it, else the draft's own answer
   - `zero` takes `0`
3. **Sets, not snapshots.** Each ruling needs its own fresh grow, so every set is 8 new sessions: `median:match`,
   `median:differ`, `slugify:match`, `slugify:differ`, `fibonacci:none`, then `median:zero`. A grow is never reused
   through export and import, because `importImage` appends an `import` revision and the stored GapRef would no longer
   line up.
4. **One browser, serial.** The generation service runs Codex calls one at a time, so parallel browsers would only
   add queue wait to the times. The *grow* time covers opening the app and the whole grow. The *ruling* time runs from
   pressing Decide until the engine is idle (re-check plus any re-grow).
5. **Outcome classes** for a ruling:
   - `recertified`: a `decision` revision was added, the artifact is live under the new hashes, and no model call was
     made
   - `regrown-committed`: a grow against the decision committed and is live
   - `exhausted`: the re-grow used its whole budget without a commit

   "Reached a commit within budget" means recertified or regrown-committed.

Two pilot sessions (one `median:match`, one `median:differ`, the same outcomes as their sets) were used to debug the
harness and are excluded. Raw output is written to `.tmp/decide-sessions-out.json`. It is ephemeral, which is why every
session line is reproduced below. Re-run with `node scripts/decide-sessions.mjs 8` (default sets) or name sets, for
example `node scripts/decide-sessions.mjs 8 median:zero`.

## Caveats

- **n = 8 per set**, one model (`gpt-6-luna`), effort `low`, one evening. Rates at this n move by one session at a time.
- **"Spec gap" means the spec author marked it**, not ground truth. The split follows from where the shipped specs put
  `silentOn` markers. fibonacci has none, so its 0 is built into the spec.
- **The ruling is in the prompt**, so the reach-commit rate measures compliance with an explicit ruling.
- Only table and observed alternatives were measured. *Type your own* and rule-scope rulings were not.
- The slugify ruling counts are small: 6 per ruling type, spread over three different gaps.
- Shipped specs, recordings and hashes were not touched. The measurement only adds decisions inside throwaway sessions.

## Appendix: every session

Format: `set | # | end of session (UTC) | class | failing gate | check | marked/diagnostics | grow phase attempts/max | grow time | ruling → outcome | first rejection`.

```
median:match | #0 | 2026-10-05T03:38:29Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 25s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires at least one number, expected NaN
median:match | #1 | 2026-10-05T03:38:52Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 23s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires at least one number, expected NaN
median:match | #2 | 2026-10-05T03:39:15Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 22s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires at least one number, expected NaN
median:match | #3 | 2026-10-05T03:39:35Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 19s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires at least one number, expected NaN
median:match | #4 | 2026-10-05T03:39:47Z | accepted | - | - | 0/0 | committed 1/3 | 11s | - |
median:match | #5 | 2026-10-05T03:40:07Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 20s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires at least one number, expected NaN
median:match | #6 | 2026-10-05T03:40:28Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 21s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires at least one number, expected NaN
median:match | #7 | 2026-10-05T03:40:50Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 21s | ruling NaN (tests) via page -> recertified, 0 cand, 1s | median([]) threw Error: median requires a non-empty list, expected NaN
median:differ | #0 | 2026-10-05T03:41:12Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 21s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 12s | median([]) threw Error: Median is undefined for an empty list., expected NaN
median:differ | #1 | 2026-10-05T03:41:45Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 21s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 11s | median([]) threw Error: median requires a non-empty list, expected NaN
median:differ | #2 | 2026-10-05T03:42:22Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 26s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 11s | median([]) threw Error: median requires at least one number, expected NaN
median:differ | #3 | 2026-10-05T03:42:56Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 23s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 12s | median([]) threw Error: median requires at least one number, expected NaN
median:differ | #4 | 2026-10-05T03:43:30Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 22s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 13s | median([]) threw Error: median requires a non-empty list of non-NaN numbers, expected NaN
median:differ | #5 | 2026-10-05T03:44:05Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 23s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 11s | median([]) threw Error: Input must contain finite numbers and be non-empty, expected NaN
median:differ | #6 | 2026-10-05T03:44:42Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 26s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 13s | median([]) threw Error: median is undefined for an empty list, expected NaN
median:differ | #7 | 2026-10-05T03:45:22Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 27s | ruling throws (candidate) via page -> regrown-committed, 1 cand, 16s | median([]) threw Error: median requires at least one number, expected NaN
slugify:match | #0 | 2026-10-05T03:45:51Z | accepted | - | - | 0/0 | committed 1/3 | 13s | - |
slugify:match | #1 | 2026-10-05T03:46:20Z | gap | tests | ampersands | 2/2 | committed 2/3 | 29s | ruling "tom-and-jerry" (tests) via page -> recertified, 0 cand, 1s | slugify("Tom & Jerry") returned "tom-jerry", expected "tom-and-jerry"
slugify:match | #2 | 2026-10-05T03:47:11Z | gap | tests | special letters | 2/2 | committed 3/3 | 50s | ruling "strasse" (tests) via page -> recertified, 0 cand, 1s | slugify("Straße") returned "stra-e", expected "strasse"
slugify:match | #3 | 2026-10-05T03:47:43Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 31s | ruling "dont-stop" (tests) via page -> recertified, 0 cand, 1s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:match | #4 | 2026-10-05T03:48:11Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 27s | ruling "dont-stop" (tests) via page -> recertified, 0 cand, 1s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:match | #5 | 2026-10-05T03:48:45Z | gap | tests | special letters | 2/2 | failed 3/3 | 33s | ruling "strasse" (tests) via engine -> exhausted, 3 cand, 33s | slugify("Straße") returned "stra-e", expected "strasse"
slugify:match | #6 | 2026-10-05T03:49:44Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 26s | ruling "dont-stop" (tests) via page -> recertified, 0 cand, 1s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:match | #7 | 2026-10-05T03:50:05Z | accepted | - | - | 0/0 | committed 1/3 | 20s | - |
slugify:differ | #0 | 2026-10-05T03:50:40Z | gap | tests | special letters | 2/2 | committed 3/3 | 34s | ruling "stra-e" (candidate) via page -> regrown-committed, 1 cand, 22s | slugify("Straße") returned "stra-e", expected "strasse"
slugify:differ | #1 | 2026-10-05T03:51:36Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 34s | ruling "don-t-stop" (candidate) via page -> regrown-committed, 1 cand, 16s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:differ | #2 | 2026-10-05T03:52:37Z | gap | tests | special letters | 1/1 | committed 3/3 | 46s | ruling "stra-e" (candidate) via page -> regrown-committed, 1 cand, 16s | slugify("Straße") returned "stra-e", expected "strasse"
slugify:differ | #3 | 2026-10-05T03:53:18Z | fault | tests | accents | 3/4 | committed 2/3 | 26s | - | slugify("Crème Brûlée") returned "cre-me-bru-le-e", expected "creme-brulee"
slugify:differ | #4 | 2026-10-05T03:53:49Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 31s | ruling "don-t-stop" (candidate) via page -> regrown-committed, 1 cand, 14s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:differ | #5 | 2026-10-05T03:54:47Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 43s | ruling "don-t-stop" (candidate) via page -> regrown-committed, 1 cand, 15s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:differ | #6 | 2026-10-05T03:55:39Z | gap | tests | apostrophes | 1/1 | committed 2/3 | 37s | ruling "don-t-stop" (candidate) via page -> regrown-committed, 1 cand, 15s | slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"
slugify:differ | #7 | 2026-10-05T03:56:10Z | accepted | - | - | 0/0 | committed 1/3 | 17s | - |
fibonacci:none | #0 | 2026-10-05T03:56:34Z | fault | invariants | - | 0/1 | committed 2/3 | 24s | - | fibonacci(1000000) did not return within 1500 ms (bounded)
fibonacci:none | #1 | 2026-10-05T03:56:59Z | fault | invariants | - | 0/1 | committed 2/3 | 25s | - | fibonacci(1000000) did not return within 1500 ms (bounded)
fibonacci:none | #2 | 2026-10-05T03:57:17Z | accepted | - | - | 0/0 | committed 1/3 | 18s | - |
fibonacci:none | #3 | 2026-10-05T03:57:38Z | accepted | - | - | 0/0 | committed 1/3 | 21s | - |
fibonacci:none | #4 | 2026-10-05T03:58:01Z | fault | invariants | - | 0/1 | committed 2/3 | 24s | - | fibonacci(1000000) did not return within 1500 ms (bounded)
fibonacci:none | #5 | 2026-10-05T03:58:26Z | fault | invariants | - | 0/1 | committed 2/3 | 24s | - | fibonacci(1000000) did not return within 1500 ms (bounded)
fibonacci:none | #6 | 2026-10-05T03:58:39Z | accepted | - | - | 0/0 | committed 1/3 | 13s | - |
fibonacci:none | #7 | 2026-10-05T03:59:14Z | fault | invariants | - | 0/1 | committed 2/3 | 35s | - | fibonacci(1000000) did not return within 1500 ms (bounded)
median:zero | #0 | 2026-10-05T04:06:46Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 21s | ruling 0 (common) via page -> regrown-committed, 1 cand, 10s | median([]) threw Error: median is undefined for an empty list, expected NaN
median:zero | #1 | 2026-10-05T04:07:31Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 34s | ruling 0 (common) via page -> regrown-committed, 1 cand, 11s | median([]) threw Error: median requires at least one number, expected NaN
median:zero | #2 | 2026-10-05T04:07:51Z | accepted | - | - | 0/0 | committed 1/3 | 9s | - |
median:zero | #3 | 2026-10-05T04:08:11Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 20s | ruling 0 (common) via page -> regrown-committed, 1 cand, 10s | median([]) threw Error: median requires at least one number, expected NaN
median:zero | #4 | 2026-10-05T04:08:45Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 23s | ruling 0 (common) via page -> regrown-committed, 1 cand, 11s | median([]) threw Error: median requires at least one number, expected NaN
median:zero | #5 | 2026-10-05T04:09:22Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 27s | ruling 0 (common) via page -> regrown-committed, 1 cand, 10s | median([]) threw Error: Median is undefined for an empty list., expected NaN
median:zero | #6 | 2026-10-05T04:09:51Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 19s | ruling 0 (common) via page -> regrown-committed, 1 cand, 12s | median([]) threw Error: median requires at least one number, expected NaN
median:zero | #7 | 2026-10-05T04:10:22Z | gap | properties | agrees with a sort-based reference | 1/1 | committed 2/3 | 20s | ruling 0 (common) via page -> regrown-committed, 1 cand, 10s | median([]) threw Error: median requires at least one number, expected NaN
```

Re-grown bodies, abridged. For each ruling type, the change from the committed body:

- median `0`: `if (numbers.length === 0) { return 0; }` in place of the `throw`
- median `throws`: the empty-list `throw` restored; the rest is the committed body
- slugify `"don-t-stop"`: apostrophes mapped to `-` (`.replace(/'/g, "-")`) before the separator collapse
- slugify `"stra-e"`: a per-letter table with `"ß": "-"`; `ø`/`æ`/`ł`/… still transliterated

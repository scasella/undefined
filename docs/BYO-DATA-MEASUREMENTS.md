# Bring-your-own-data measurements

> Historical: the UI described here (the REPL "workbench", `apps/site/src/ui/`) was replaced by the front door (`apps/site/src/door/`, [FRONT-DOOR.md](FRONT-DOOR.md)), the site's only UI. Engine behaviour is unchanged; features with no UI now are listed in [FEATURES.md](FEATURES.md#engine-features-with-no-ui).

The question: a reader drops a realistic CSV and clicks one of the suggested calls (`apps/site/src/data/suggest.ts`).
Does the live model write the function, or decline it with NEEDS_SPEC / CANNOT_BE_PURE? Do the gates accept it, and is
the answer right? Feature description: [FEATURES.md § Data](FEATURES.md#data). Harness:
`apps/site/scripts/byo-sessions.mjs`.

**When and with what.** Monday 2026-10-05, 09:50 to 09:55 EDT (13:50 to 13:55 UTC). `gpt-6-luna`, reasoning effort `low`,
Codex CLI 0.159.2 (`codex --version`), logged in with ChatGPT. The dev server's `/generate/health` reported
`{"ok":true,"codexVersion":"0.159.2","model":"gpt-6-luna","effort":"low"}` for every run. This is one model on one
morning at one effort level, with 3 sessions per cell. Read the numbers as "what happened that morning", not as rates.

## Summary

- **24 of 24 sessions were written, committed and correct**, each on its first candidate (1 of 3 attempts used). No
  declines, no gate rejections, no retries.
- Every session took 7 to 15 s from Enter to idle (median 8.7 s). The brief estimated 30 to 60 s.
- **`suggest.ts` was not changed.** No template was declined or wrong in 2 or more of 3 sessions for any CSV, so the
  name-generation fix was not triggered. No after-fix run was made.
- The first run hit two harness bugs, both fixed in the script. Neither involved the model or the product (see
  [Harness fixes](#harness-fixes)).

## Protocol

Each session drives the real UI the way a reader would. It starts from a fresh image (`lib/drive.mjs` `openApp`), then
dispatches `dragenter`/`dragover`/`drop` with the CSV `File` on `window` (the page-wide drop overlay; all 24 sessions
went in by drop, none needed the file-input fallback). The data drawer opens pre-filled. The harness waits for the
preview and clicks **Load as `<name>`**, waits for the suggestion chips, and clicks the chip for the template, which
pre-types the call. It then presses Enter in `#repl-input` and waits until the app is idle. The dev server uses the live
Codex service at its defaults, the real Worker watchdog and the real attempt budget (3). Sessions run serially in one
browser.

**Send samples.** Left at the product default, which is **on**: the prompt carries the variable name, the row count, the
`type Row = {…}` declaration and 3 sample rows (first, middle, last). The harness recorded `send.samples = true` in all 24
sessions.

**Correctness.** The script builds each CSV from a seeded PRNG and computes the expected answer in node from the same
rows. It then compares that answer with the committed function's result: the pinnable `expected` value, or else the
printed value. The comparison is shape-tolerant. Maps can be an object, `[k, n]` pairs, `[{k, n}]` or a returned `Map`.
Numbers must agree to within 0.011. Names in top 5 must match in order. For range, both ends must parse to the same
instant. "Written" means at least one candidate was not a decline.

## The three CSVs

| CSV | columns | rows | traps |
|---|---|---|---|
| `sales.csv` (`sales`) | `order_date, region, status, amount` | 48 | amounts with cents; 3 statuses |
| `students.csv` (`students`) | `name, class, score` | 24 | scores tie-free, so "top 5" has one answer |
| `log.csv` (`log`) | `timestamp, level, message` | 60 | rows 3 and 40 are swapped, so the first row is not the earliest |

The chips offered (`node apps/site/scripts/byo-sessions.mjs chips`, no model call) were the same in every session:

| CSV | chips |
|---|---|
| sales | `countByStatus(sales)` `totalAmountByStatus(sales)` `averageAmount(sales)` |
| students | `countByClass(students)` `totalScoreByClass(students)` `top5NamesByScore(students)` |
| log | `countByLevel(log)` `timestampRange(log)` |

`suggest.ts` offers at most three chips per dataset. Between them the three CSVs cover all five templates, and the
harness ran every chip, giving 8 sets × 3 sessions = 24.

## Results

### Per template

| template | sets | written | committed | correct | time (median, min to max) | declines | rejections |
|---|---|---|---|---|---|---|---|
| countBy | sales, students, log | 9/9 | 9/9 | 9/9 | 9.0 s (7.7 to 14.3) | none | none |
| totalBy | sales, students | 6/6 | 6/6 | 6/6 | 8.5 s (7.7 to 9.0) | none | none |
| top5 | students | 3/3 | 3/3 | 3/3 | 7.5 s (7.2 to 8.0) | none | none |
| average | sales | 3/3 | 3/3 | 3/3 | 7.9 s (7.7 to 9.5) | none | none |
| range | log | 3/3 | 3/3 | 3/3 | 12.2 s (11.0 to 14.5) | none | none |

### Per set

| set | call | written | committed | correct | attempts | median time |
|---|---|---|---|---|---|---|
| sales:countBy | `countByStatus(sales)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 9.2 s |
| sales:totalBy | `totalAmountByStatus(sales)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 8.7 s |
| sales:average | `averageAmount(sales)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 7.9 s |
| students:countBy | `countByClass(students)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 12.0 s |
| students:totalBy | `totalScoreByClass(students)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 8.5 s |
| students:top5 | `top5NamesByScore(students)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 7.5 s |
| log:countBy | `countByLevel(log)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 9.0 s |
| log:range | `timestampRange(log)` | 3/3 | 3/3 | 3/3 | 1,1,1 | 12.2 s |

### Assumptions the model stated (its `notes`)

- **The shape of the result varied.** In one `totalAmountByStatus` session the model returned a `Map` ("statuses retain
  their first-seen insertion order"). The other 17 grouping sessions returned plain objects. Neither shape has a spec
  behind it, and both are correct.
- **`timestampRange` produced two readings, and both gave the right instants.** Session 0 compared the raw strings
  ("ISO timestamps sort chronologically") and returned them unchanged (`…07:59:51Z`). Sessions 1 and 2 parsed each value
  with `Date.parse`, skipped unparseable ones and returned `toISOString()` (`…07:59:51.000Z`). All three scanned every row
  instead of taking the first and last, so the swapped rows did not trip any of them. All three return `{start, end}`, or
  `null` for an empty input.
- **Empty input.** `averageAmount` returns 0 for an empty array (3/3). `countBy` and `totalBy` return `{}`.
- **Ties in `top5NamesByScore`.** The model keeps input order for tied scores (3/3). The data has no ties, so this was not
  tested.

## Harness fixes

These are bugs in the harness, not in the product or the model. Both are fixed in `apps/site/scripts/byo-sessions.mjs`.

1. **The range chip was never found.** The template regex `/Range$/` was tested against the chip text
   `timestampRange(log)`, so the first run recorded log:range as `no-chip` 3 times, with no model call made. The harness
   now matches the name without its argument list. The 3 `no-chip` rows are kept under `harnessFix` in the output file,
   and log:range was re-run (sessions at 13:54 UTC).
2. **The checker did not read a returned `Map`.** The page encodes a returned `Map` as `{"$t":"Map","v":[[k,n],…]}`, which
   the checker scored as `unrecognised shape`. Its values were exactly right. `asMap` now reads that encoding, and the new
   `rescore` mode (`BYO_APPEND=1 node scripts/byo-sessions.mjs rescore`) re-checked the stored results with no server and no
   model call. That changed exactly one row, sales:totalBy #1, from wrong to correct. Before the fix, the first run read
   20/21 correct plus 3 no-chip.

Raw output: `apps/site/.tmp/byo-sessions-out.json` (a copy from before the fix is in `byo-sessions-out.run1.json`). Neither
file is committed.

## Caveats

- **Small n.** There were 3 sessions per cell. 3/3 shows the path works. It does not establish a rate.
- **Synthetic CSVs.** The three files are small (24 to 60 rows) and clean: no empty cells, no mixed types, no locale
  number formats. The column names match their roles, which is the case `suggest.ts` handles best. Messier real files
  were not tested.
- **One model, one effort level.** `gpt-6-luna` at effort `low`, on one morning. Other models or efforts were not
  measured.
- **Send samples was on.** With samples off the model sees only the type. That setting was not measured.
- **Correctness was checked only where a node answer exists.** These are spec-less functions, so only Compile and
  Invariants gate them. "Correct" here is the harness's check, not a gate's.

## Appendix: raw per-session lines

Time is the session start in UTC (EDT is UTC−4). Attempts are given as used/budget, then each attempt's outcome. The
result is the committed function's return value. Notes are the model's own note on its first candidate.

| set | # | start | typed | attempts | written | committed | correct | time | result | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| sales:countBy | 0 | 13:50:26Z | countByStatus(sales) | 1/3 accepted | y | y | y | 9.2 s | {"paid":34,"refunded":8,"pending":6} | Counts rows per status and returns an object keyed by status, with an empty object for empty input. |
| sales:countBy | 1 | 13:50:37Z | countByStatus(sales) | 1/3 accepted | y | y | y | 9.2 s | {"paid":34,"refunded":8,"pending":6} | Counts rows per status and returns an object mapping each status to its count. |
| sales:countBy | 2 | 13:50:47Z | countByStatus(sales) | 1/3 accepted | y | y | y | 7.7 s | {"paid":34,"refunded":8,"pending":6} | Counts rows per status and returns a plain object keyed by status. |
| sales:totalBy | 0 | 13:50:55Z | totalAmountByStatus(sales) | 1/3 accepted | y | y | y | 8.7 s | {"paid":8501.56,"refunded":1254.8600000000001,"pending":1634.7800000000002} | Sums amounts by status and returns an object keyed by status, with an empty object for empty input. |
| sales:totalBy | 1 | 13:51:04Z | totalAmountByStatus(sales) | 1/3 accepted | y | y | y (rescored) | 8.0 s | {"$t":"Map","v":[["paid",8501.56],["refunded",1254.8600000000001],["pending",1634.7800000000002]]} | Sums amounts by status and returns a map; statuses retain their first-seen insertion order. |
| sales:totalBy | 2 | 13:51:13Z | totalAmountByStatus(sales) | 1/3 accepted | y | y | y | 8.7 s | {"paid":8501.56,"refunded":1254.8600000000001,"pending":1634.7800000000002} | Sums amounts by status and returns an object keyed by status, with an empty object for empty input. |
| sales:average | 0 | 13:51:22Z | averageAmount(sales) | 1/3 accepted | y | y | y | 7.9 s | 237.31666666666663 | Returns the arithmetic mean of all row amounts; an empty array returns 0. |
| sales:average | 1 | 13:51:31Z | averageAmount(sales) | 1/3 accepted | y | y | y | 9.5 s | 237.31666666666663 | Returns the arithmetic mean of all row amounts; an empty array returns 0. |
| sales:average | 2 | 13:51:41Z | averageAmount(sales) | 1/3 accepted | y | y | y | 7.7 s | 237.31666666666663 | Returns the arithmetic mean of all row amounts, using 0 for an empty array. |
| students:countBy | 0 | 13:51:49Z | countByClass(students) | 1/3 accepted | y | y | y | 12.0 s | {"7B":6,"8A":10,"7A":8} | Counts rows per class and returns a class-to-count object; an empty input returns an empty object. |
| students:countBy | 1 | 13:52:02Z | countByClass(students) | 1/3 accepted | y | y | y | 14.3 s | {"7B":6,"8A":10,"7A":8} | Counts rows per class and returns a class-to-count object; assumes class names are the grouping keys. |
| students:countBy | 2 | 13:52:16Z | countByClass(students) | 1/3 accepted | y | y | y | 8.5 s | {"7B":6,"8A":10,"7A":8} | Counts rows per class and returns a class-to-count object; empty input returns an empty object. |
| students:totalBy | 0 | 13:52:26Z | totalScoreByClass(students) | 1/3 accepted | y | y | y | 8.5 s | {"7B":378,"8A":672,"7A":585} | Assumes the result is an object mapping each class to the sum of its students' scores. |
| students:totalBy | 1 | 13:52:35Z | totalScoreByClass(students) | 1/3 accepted | y | y | y | 9.0 s | {"7B":378,"8A":672,"7A":585} | Sums scores per class and returns an object keyed by class, preserving first-seen class order. |
| students:totalBy | 2 | 13:52:44Z | totalScoreByClass(students) | 1/3 accepted | y | y | y | 7.7 s | {"7B":378,"8A":672,"7A":585} | Sums scores per class and returns a plain object keyed by class, preserving first-seen class order. |
| students:top5 | 0 | 13:52:53Z | top5NamesByScore(students) | 1/3 accepted | y | y | y | 7.2 s | ["Hugo Lind","Owen Diaz","Ruby Walsh","Noah Kim","Maya Lopez"] | Assumes rows are ranked by descending score, ties retain input order, and the result contains up to five names. |
| students:top5 | 1 | 13:53:00Z | top5NamesByScore(students) | 1/3 accepted | y | y | y | 8.0 s | ["Hugo Lind","Owen Diaz","Ruby Walsh","Noah Kim","Maya Lopez"] | Returns the five highest-scoring names, preserving input order for ties. |
| students:top5 | 2 | 13:53:09Z | top5NamesByScore(students) | 1/3 accepted | y | y | y | 7.5 s | ["Hugo Lind","Owen Diaz","Ruby Walsh","Noah Kim","Maya Lopez"] | Returns names of the five highest-scoring rows, preserving input order for score ties. |
| log:countBy | 0 | 13:53:17Z | countByLevel(log) | 1/3 accepted | y | y | y | 9.0 s | {"DEBUG":12,"INFO":37,"WARN":6,"ERROR":5} | Returns a plain record counting rows per exact level string; an empty input returns an empty record. |
| log:countBy | 1 | 13:53:26Z | countByLevel(log) | 1/3 accepted | y | y | y | 9.7 s | {"DEBUG":12,"INFO":37,"WARN":6,"ERROR":5} | Counts rows by exact level string and returns the per-level totals. |
| log:countBy | 2 | 13:53:37Z | countByLevel(log) | 1/3 accepted | y | y | y | 8.7 s | {"DEBUG":12,"INFO":37,"WARN":6,"ERROR":5} | Counts rows by exact level string and returns an empty object for empty input. |
| log:range | 0 | 13:54:16Z | timestampRange(log) | 1/3 accepted | y | y | y | 11.0 s | {"start":"2026-09-14T07:59:51Z","end":"2026-09-14T11:16:41Z"} | Assumes timestampRange returns the lexicographically earliest and latest timestamp strings, or null for an empty array; ISO timestamps sort chronologically. |
| log:range | 1 | 13:54:28Z | timestampRange(log) | 1/3 accepted | y | y | y | 14.5 s | {"start":"2026-09-14T07:59:51.000Z","end":"2026-09-14T11:16:41.000Z"} | Assumes the range is the earliest and latest valid timestamps, returned as ISO strings, or null when none are valid. |
| log:range | 2 | 13:54:43Z | timestampRange(log) | 1/3 accepted | y | y | y | 12.2 s | {"start":"2026-09-14T07:59:51.000Z","end":"2026-09-14T11:16:41.000Z"} | Returns the earliest and latest parseable timestamps as ISO strings, or null when no timestamp can be parsed. |

Expected answers (node): sales countBy `{"paid":34,"refunded":8,"pending":6}`; sales totalBy `{"paid":8501.56,"refunded":1254.86,"pending":1634.78}`
(to the cent); sales average `237.3167`; students countBy `{"7B":6,"8A":10,"7A":8}`; students totalBy `{"7B":378,"8A":672,"7A":585}`;
students top5 `["Hugo Lind","Owen Diaz","Ruby Walsh","Noah Kim","Maya Lopez"]`; log countBy `{"DEBUG":12,"INFO":37,"WARN":6,"ERROR":5}`;
log range `["2026-09-14T07:59:51Z","2026-09-14T11:16:41Z"]`.

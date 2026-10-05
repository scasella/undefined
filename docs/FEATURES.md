# Features

What the site does, in more detail than the [README](../README.md). For how a call is decided, see
[ARCHITECTURE.md](ARCHITECTURE.md); for what the evidence under an answer means, see [EVIDENCE.md](EVIDENCE.md).

The site has one UI, the **front door** (`index.html`, code in `apps/site/src/door/`). The engine underneath it
(`apps/site/src/core/engine.ts`, the `Engine` interface in `packages/engine/src/types.ts`) can do more than the front
door shows. The original REPL UI (the "workbench") that exposed every engine feature was removed; the features it alone
exposed are listed under [Engine features with no UI](#engine-features-with-no-ui), with how to reach them today.

## The front door

- **Landing (`#/`):** the claim, a slowed-down and labelled illustration of one question being checked, the evidence
  strip, what an agreement is, the definition ladder, "it asks", "it says no", what leaves your browser, and the file you
  can hand your data team. Figures on it are computed from the bundled sample data (`door/model/figures.ts`).
- **First run (`#/start`):** bring a CSV, TSV or JSON export (drop it, choose it, paste it, or pick a sample:
  the fictional `orders.csv`, 332 rows, or `sales-q3.csv`, 48 rows), see its columns, pick a question, and watch the
  real checks run on the real engine. The contract, the vocabulary map (plain words → engine features) and the honesty
  rules are in [FRONT-DOOR.md](FRONT-DOOR.md).

What it lets you do, in the engine's terms:

| On the page | Engine feature |
|---|---|
| Bring a file: drop, **Choose a file**, paste, or a sample | `previewDataset` / `loadDataset` (CSV, TSV, JSON, JSON Lines; 20,000 rows, 1 MB) |
| The suggested questions for the file | Deterministic call suggestions from the column types (`data/suggest.ts`), no model asked; the ask box is read-only |
| Ask · checks run first | `setInput` + `submit`: the grow loop and the four gates, shown as the check trace |
| Drafts thrown out, the answer | Rejected and accepted candidates of the run (`state.generation`) |
| Stress test | The mutation check, run automatically after a commit (`state.mutation`) |
| Does this look right? Lock this answer / Locked | `pinResult` / `removePin` |
| A question only you can answer · Save as a house rule | Decide: `gapQuestion` + `decide(ref, choice, { scope, reason })`, choosing among the listed answers |
| It says no | A decline (`GenerationView.declined`) |
| What the AI will see, the example-rows switch, the exact prompt | `previewDataset().sampleText`, `setSendSamples`, the last candidate's prompt |
| Hand this to your data team (download) | Eject (`eject/eject.ts`): the zip described under [Eject](#eject) |
| *Demo · recorded answers, real checks* / *Live* | Replay mode / live mode |

Old links carrying the removed workbench's parameters (`?opener=<example>`, `?recording=<url>`, `#recording=<url>`)
open the front door and are ignored: the page passes no location to the engine, so no example is swapped in and no
recording is fetched.

## Engine features with no UI

These still exist and are tested, but nothing on the page reaches them. "Engine API" means a method of the `Engine`
returned by `createEngine()` (`apps/site/src/core/engine.ts`); in `npm run dev` it is on `window.__undefined` for
maintainer scripts. The CLI (`packages/cli`) has one command, `certify`, which runs the gates and the mutation check on a
TypeScript file in Node; it does not drive the site's engine.

| Feature | How to reach it now |
|---|---|
| Free-form REPL calls (any function name, several statements on one line, variables) | Engine API: `setInput` + `submit` |
| The `median`, `slugify`, `fibonacci` examples and **Break it** | Engine API: `loadExample`, `breakIt` |
| Spec editing | Engine API: `upsertSpec`, `editSpec`; for files, the CLI's `certify --spec` |
| Revisions and rollback | Engine API: `state.revisions`, `rollback(id)` |
| Structured recovery (restarts after a committed function throws) | Engine API: `invokeRestart` |
| Removing a decision; typing your own expected value | Engine API: `removeDecision`, `previewExpectation` + `decide` |
| Suggested extra checks ("More checks you can add") | `suggest/suggest.ts suggestProperties`; Engine API: `addSuggestedProperty` |
| Re-check of a function whose callee changed; the Uses / Used by lists | Engine API: `recheck(fn)`; status from `compose/graph.ts dependencyStatus` |
| Re-running the mutation check on demand | Engine API: `runMutation(fn)` (the page runs it once after each commit) |
| Export / import the whole program as one JSON image | Engine API: `exportImage`, `previewImage`, `importImage` (the page only uses `exportImage` internally, for the download's dataset rows) |
| Share a session as a recording; open a `?recording=` link | Engine API: `exportRecording`, `previewRecording`, `loadRecording` ([REPLAY.md](REPLAY.md#share-a-session) describes the removed dialog) |
| Removing a loaded dataset | Engine API: `removeDataset` |
| Starting over | Engine API: `resetImage` (the page's session has `reset()`, but no button calls it) |
| The local session log | Engine API: `setSessionLogEnabled`, `exportSessionLog`, `clearSessionLog`; off by default and never turned on by the page |
| Certifying functions in your own repository | CLI `certify` and the GitHub Action ([ENGINE.md](ENGINE.md)) |

The rest of this file describes how these features behave in the engine, whichever way they are reached.

## How the engine treats a call

- **Call anything.** With no spec, a function's signature is inferred from the real arguments and only *Compile* and
  *Invariants* gate it (the front door calls this *Basic checks*).
- **It will say no.** A call that needs the clock, randomness, the network, files or hidden state cannot be a pure
  function, and a name like `clean` or `process` says nothing about what it should do. Rather than commit a stub, the
  model can decline, and the engine says why and what to do. A decline commits nothing. [HOSTILE.md](HOSTILE.md) has the
  54 stranger-style calls behind this.
- **Revisions.** Every accepted change is a numbered revision of the whole program *and its live state* (REPL variables).
  Rollbacks are themselves revisions, so history is never rewritten. The front door shows the head revision as
  *Version N*.
- **Hot reload.** Accepted functions are swapped into the running sandbox worker without a restart and without touching
  the REPL variables.
- **Several statements on one line**, separated by `;`, with destructuring. After a function grows, only the statement
  that called it runs again (`engine.ts rerunText`).
- **Functions that call each other.** A generated function may call another one already certified in the program,
  never in a cycle (a draft that would is rejected by Compile). When a callee gets new code, the caller is out of date
  and `recheck` runs the same code against its own checks with the new callee, no model asked.
- **Persistence.** State persists in IndexedDB; two tabs share one stored program and do not merge edits.

## Decide: spec gaps become questions

A check can declare that it encodes a convention the doc leaves open (`silentOn`). When such a check rejects a draft,
the rejection is a question for you, not a verdict on the model; on `#/start` it is *A question only you can answer*.
`gapQuestion(ref)` gives the smallest failing call, what the draft did and what the checks expect, and the answers to
choose from:

- what your checks expect, and what the draft did (labelled as such);
- a small fixed table keyed by the kind of input and the return type (an empty list for a number: throws, `NaN`, `0`);
- whatever the check itself declared (`alternatives` in the marker options);
- (engine API only) your own TypeScript expression, evaluated as test code first (`previewExpectation`).

The model never proposes an answer. A single number parameter with a negative, non-integer or non-finite input also
offers a rule *for every input like it* (the page's **Save it for**). An optional *Why* is kept with the ruling and never
sent to the model. A replacement never reaches past what the check declared silent, and a ruling is refused when the
checks it answers have changed since that rejection.

Deciding adds a test to the spec, so the committed function is re-checked in place: if it already does what you ruled it
is **re-certified** (nothing written again); otherwise the model writes it again with your ruling in the prompt. In
replay mode a ruling that differs from what the recorded session was checked against cannot be replayed and says so.
The evidence counts decisions, and an ejected zip lists each in `provenance.json` and the README.

## Data

The file is read in your browser, parsed, and its columns typed (numbers, booleans; empty cells become `null`; dates stay
strings). A spreadsheet or other binary file is refused with *export it as CSV*; CSV that parses into one column asks
whether the delimiter is something else; a recording or program image is refused as not data. Rows are bound to a
variable named after the file (`sales.csv` → `sales`, pasted text → `data`; the orders sample is bound as `rows`, see
[FRONT-DOOR.md](FRONT-DOOR.md#recordings)) as a revision, stored once by content hash in IndexedDB. Limits: 20,000 rows
and 1 MB. The parameter is typed from the declared row type, and the gates replay the call on the real rows, frozen, so a
candidate that sorts the rows in place is rejected.

**What is sent to Codex, and when.** Nothing is sent when you paste, preview or load, and nothing at all in replay mode.
When a call that uses a dataset grows a function in live mode, the prompt contains the variable name, the row count, the
`type Row = {…}` declaration and, while the example-rows switch is on (the default; remembered), three rows spread
across the data, with long strings cut and at most 1.5 kB of JSON. A retry prompt also carries what the gates reported
about the rejected draft; while data is loaded, the parts built from real arguments and results are replaced by
*(withheld: derived from your data)* when the switch is off. The page shows the exact prompt after a run.

On the public site (replay mode) your data loads and previews, but a function is only written when a bundled recording
was made against the exact spec; otherwise the page says so and points at the question that has an answer.

**Lock this answer** turns the call and its result into a pinned test on that function (dataset arguments are stored by
reference). Pins are outside both hashes, so locking invalidates nothing; the next regeneration must reproduce the
locked answer, or the Tests gate rejects it.

## Eject

**Hand this to your data team (download)**, under a committed answer on `#/start`, downloads `<name>-eject.zip`:

- **`<name>.ts`**: the function body exactly as the model wrote it, the spec's exported types, and a doc comment.
- **`<name>.test.ts`**: the spec's examples, locked answers and house rules, with a copy of the app's small test API at
  the top, so it runs on vitest, fast-check and typescript alone. Properties use the gate's fixed seed.
- **`provenance.json`**: the spec and tests hashes, seed, model, Codex CLI version, dates, the evidence line, the mutation
  result, pins, datasets and the full candidate history (including the prompts, which can contain sample rows).
- **`README.md`**: how to run the tests. It says the Invariants gate (purity and the per-call time limit) is not
  reproduced outside the app.

A function that calls other generated functions is ejected with them (one `.ts` and `.test.ts` per function, and a
`provenance.json` with the graph). The download is not offered while the function is out of date. `npm run check:eject`
ejects every shipped recording into a fresh project and runs vitest and strict `tsc` on it.

## Local session log (engine API only)

Off by default, and the page never turns it on. When enabled through the engine API it keeps a short log of inputs and
what the gates decided in this browser's storage only (IndexedDB database `undefined-session-log`); it is never sent
anywhere, never holds dataset rows or prompts, and keeps at most 5,000 entries. The policy is in `src/sessionlog/` and
`core/engine.ts`.

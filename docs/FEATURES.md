# Features

Everything you can do in the app, in more detail than the [README](../README.md). For how a call is decided, see
[ARCHITECTURE.md](ARCHITECTURE.md); for what the confidence line under a commit means, see [EVIDENCE.md](EVIDENCE.md).

## What you can do

- **Call anything.** Type `slugify("Hello World")` with no setup: the signature is inferred from your real arguments, only
  *Compile* and *Invariants* gate it, and the UI says so ("no tests yet, add one to make the gate stricter").
- **Four one-click examples** (the first three are specs where a rejection happens naturally, see
  [EXAMPLES.md](EXAMPLES.md); the fourth, `orders`, is the data scratchpad with no spec at all): `median`, `slugify`, `fibonacci`, `topCustomersByRevenue(rows)`.
  Each has a **Break it** button that edits the spec: the artifact's hashes no longer match, it is marked invalid, and the
  next call regenerates it.
- **It will say no.** A call that needs the clock, randomness, the network, files or hidden state cannot be a pure
  function, and a name like `clean` or `process` says nothing about what it should do. Rather than commit a stub with a
  green tick, the model can decline, and the REPL says why and what to do (pass the randomness in as an argument; write a
  one-line spec). A decline commits nothing. [HOSTILE.md](HOSTILE.md) has the 54 stranger-style calls behind this.
- **Revisions.** Every accepted change is a numbered revision of the whole program *and its live state* (REPL variables).
  One click rolls back; rollbacks are themselves revisions, so history is never rewritten.
- **Hot reload.** Accepted functions are swapped into the running sandbox worker without a restart and without touching
  your REPL variables.
- **Several statements on one line**, separated by `;`, with destructuring (`const {a, b} = pair(1); a + b`). The result
  is the last statement's value. After a function grows, only the statement that called it runs again, and the console
  says so (*Re-ran statement 3 of 4 from its start; statements 1–2 were not run again.*); a retry after a fault resumes
  at the statement that faulted, and an error names its statement (*(statement 2 of 3)*). The input stays one line.
- **Functions that call each other.** A generated function may call another one already certified in the program
  (never in a cycle). The Draft says so quietly under the code (*uses slugify*, from what the compiler resolved, not a
  guess). Each Repo card lists **Uses** (with the revision it was certified against) and **Used by**. When a function it
  uses gets new code, or a function further down the chain does, the card says *Out of date: slugify changed in r5* and offers **Re-check**, which runs the same
  code and its own checks with the new callee, no model asked; if that fails, Checks shows the failing check under *A
  function it calls changed after it was committed*, and the next call writes it again. When a function it uses has no
  code (its spec changed), the card says *Waiting for slugify*, and the next call that reaches it grows it first. A draft
  that would call a function in a cycle is rejected by Compile (*would call itself in a cycle*).
- **Structured recovery.** If a committed function throws, the REPL offers restarts: retry with the error fed back to the
  model, roll back, or edit the spec. Never a crash.
- **Export / import** your whole program (revisions, specs, artifacts, provenance) as one JSON file. Importing replaces
  the program, so it asks first (*This replaces your current program (N revisions, M functions). Export it first if
  you want to keep it.*: **Export current first**, **Replace**, **Cancel**). State persists in IndexedDB.
- **Decide** what the spec should say where a check said it was silent (see [Decide](#decide-spec-gaps-become-questions)).
- **Eject** a committed function as a zip that runs without the app (see [Eject](#eject)).
- **Share** a session as a link (see [REPLAY.md](REPLAY.md#share-a-session)).

## Decide: spec gaps become questions

A check can declare that it encodes a convention the doc leaves open (`silentOn`). When such a check rejects a draft,
the rejection is a question for you, not a verdict on the model. Once the grow is over, the rejection card ends with a
collapsed **Decide what the spec should say about `median([])`** (after a commit, the accepted card links back to it:
*The spec was silent on `median([])` (draft #1). Decide*). It shows the smallest failing call, what the draft did and
what your tests expect, then the answers you can choose from:

- what your tests expect, and what the draft did (labelled as such);
- a small fixed table keyed by the kind of input and the return type (an empty list for a number: throws, `NaN`, `0`;
  `undefined` is shown but disabled when the signature says `number`);
- whatever the check itself declared (`alternatives` in the marker options);
- **Type your own expectation**: a TypeScript expression, evaluated as test code in your browser (same trust as the spec
  editor; the sandbox is not a security boundary), with "evaluates to …" before you confirm, or *It should throw an error
  instead*.

The model never proposes an alternative. Before **Decide** the card says, in plain words, the test it adds (*Adds a test:
median([]) returns NaN.*, source under a disclosure), whether it replaces your check where the spec was silent, and what
happens next. An optional *Why* is kept as "decided by you on <date>: <why>" and never sent to the model. A single
number parameter with a negative, non-integer or non-finite input also offers *for every input like it* (a rule).
A replacement never reaches past what the check declared silent: a unit test is replaced in full (the card says so),
a property only where its marker's `when` holds, and a property whose marker has no `when` (silent on every input)
can only be decided with its own answer. A ruling is refused when the checks it answers have changed since that
rejection, or when another check shares the replaced check's name.

Deciding adds the test to the spec, so its tests hash changes, and the committed function is re-checked in place: if it
already does what you ruled it is **re-certified** (nothing written again; the card says what changed and the hash
before and after); otherwise the model writes it again with your ruling in the prompt. In replay mode a ruling that
agrees with the recorded tests replays; any other one ends with *differs from what the recorded session was checked
against … Run live*, the commands to run it live, **How to run live**, **Check for the live service** and **Remove the
decision** (which re-checks and brings the earlier function back). The card warns about this before you confirm.

The Repo tab lists **Decisions** under each spec: the ruling, the date and reason, what it replaces, the generated test,
and **Remove** (asks first; removing re-checks the committed function against the spec without it). Rejected drafts in
the Repo history offer Decide too, after a reload. The evidence line counts them (*5 tests passed, including 1
decision.*), and an ejected zip lists each in `provenance.json` and the README, with its test under "your decisions".

## Try a different opener (?opener=…)

On a first visit the console is pre-typed with the `median` example. `?opener=fibonacci`, `?opener=slugify` or
`?opener=orders` pre-types that example instead, loaded exactly as its example button would load it (for `orders`, the
bundled rows are bound to `rows` first). Case and surrounding spaces are ignored; a missing, empty or unknown value falls
back to `median`. The parameter is read only when there is no stored program yet: once this browser holds a program it is
ignored, and resetting the program seeds `median` again. Share links strip it. [opening-fibonacci.gif](opening-fibonacci.gif) shows the
`fibonacci` opener; `node apps/site/scripts/capture.mjs --opener=<id>` records one for any opener.

## Data scratchpad

**Live mode opens on your data.** When the local service answers (`npm run dev`; a service that is running but cannot
use Codex counts, and its fix is shown on the card), a browser with nothing stored beyond the seed and no `?opener=`
leads with a drop card (*Drop a CSV or JSON file, or paste data*, with **Choose a file…** and **Paste data…**), the
examples under it as *or try an example*, the line *Bring your own data. Call a function on it that doesn't exist; a
model writes it and your checks decide whether it stays.* and an empty console. **Start with examples** (on the card, or
**Session → Start with examples**) switches to the example-first opening and is remembered in this browser; **Session →
Start with your data** switches back. A returning browser (anything loaded, run or committed) opens on the examples
layout with its stored state. The public page (replay mode) always keeps the example-first opening.

Otherwise, click **Use your data…** next to the examples (it opens a file picker), **Paste data…**, or **Session → Data…**, or drop
a file anywhere on the page: CSV, TSV, JSON or JSON Lines (`.csv .tsv .json .jsonl .ndjson .txt`). A dropped `.json` is a
recording or a program image when its `format` says so, and data when it holds rows (an array, or `{ "x": [ … ] }`). Every
way in opens the same data drawer with the file in it; the drawer is the one preview and the one place that says what
leaves your browser. The file is read in your browser, parsed, and its columns typed (numbers, booleans; empty cells become
`null`; dates stay strings). The preview shows the row count, each column's type, the declared `type SalesRow = {…}` and
the first 20 rows. A spreadsheet or other binary file is refused with *export it as CSV*; CSV that parses into one column
asks whether the delimiter is something else. Nothing is stored until **Load**, which binds the rows to a REPL variable
named after the file (`sales.csv` → `sales`, `2024-q3.csv` → `data2024Q3`, pasted text → `data`; editable in the drawer;
never `rows`, which the orders example uses, and never a name already taken) as a revision. Rows are stored once, by
content hash, in IndexedDB and in exported images, and come back with rollback like any other variable. Limits: 20,000
rows and 1 MB.

After **Load**, two or three calls to try appear under the examples, worked out from the column types with no model
asked, each named for what it returns: `countByStatus(sales)`, `totalAmountByRegion(sales)`, `top5CustomersByAmount(sales)`,
`averageAmount(sales)`, `orderDateRange(sales)`. Clicking one types it into the console; Enter runs it. (Live smoke on three CSVs: 24 of 24 chip calls were written, committed and correct on the first candidate; see [BYO-DATA-MEASUREMENTS.md](BYO-DATA-MEASUREMENTS.md).) Or call any
function that does not exist on it, e.g. `topCustomersByRevenue(rows)`. The parameter is typed `Row[]`, the
type declaration is compiled in front of the function, and the gates replay the call on the real rows, frozen, so a
candidate that sorts `rows` in place is rejected.

On the public page (replay mode) your data loads, previews and works with functions that already exist, but nothing was
recorded for a new function on it: the call says *This page replays recorded drafts; none exists for countByStatus on your
data. Writing it needs live mode.* before any attempt, with **How to run live** and **Try the orders example** (the same
flow, recorded).

**What is sent to Codex, and when.** Nothing is sent when you paste, preview or load. When a call that uses a dataset
grows (or regrows) a function in live mode, that prompt contains the variable name, the row count, the `type Row = {…}`
declaration and, while **Send 3 sample rows to Codex along with the type** is on (the default; your choice is
remembered), three rows spread across the data (first, middle, last), with long strings cut and at most 1.5 kB of JSON.
The drawer shows that exact text before you load anything. A *retry* prompt also carries what the gates reported about
the rejected draft. While any dataset is loaded, the parts of that feedback built from real arguments and results (a
pinned result, the call the Invariants gate replayed, a runtime error's call and message) are replaced by *(withheld:
derived from your data)* when the toggle is off; when it is on, retry feedback may quote up to 200 characters of your
data per field. Property counterexamples (generated by fast-check) and your unit tests' own values are sent as they are.
**What the model saw** shows each prompt exactly as sent. In replay mode nothing is sent.

**Pin result as test.** Under a result, **Pin result as test** turns the call and its result into a unit test on that function
(dataset arguments are stored by reference, not copied). Pins are outside both hashes, so pinning invalidates nothing.
The next regeneration must reproduce the pinned result, or the Tests gate rejects it and says that you pinned it.
Remove a pin in **Repo**.

The **orders** example binds a bundled, fictional `orders.csv` (332 rows) to `rows` and pre-types
`topCustomersByRevenue(rows)` with no spec. Only Compile and Invariants judge the result, so it is yours to judge: pin
it. Once the function exists, its **Break it** (in Repo) states what revenue means: refunds excluded, discounts applied,
rounded to cents. A recorded session ships for it (and for its *Break it*), so it replays on the static site too.

## Eject

Every committed function has an **Eject** button: in **Checks** under *What was checked*, and in the **Repo** tab under
its evidence. It downloads `<name>-eject.zip`, a `<name>-eject/` folder with four files:

- **`<name>.ts`**: the function body exactly as the model wrote it, the spec's exported types, and a doc comment from
  the spec's doc.
- **`<name>.test.ts`**: the spec's unit tests, pinned results and properties, with a copy of the app's small test API at
  the top, so it runs on vitest, fast-check and typescript alone. Properties use the gate's fixed seed, so a failure
  reproduces. A spec with no checks gets one `it.todo` placeholder.
- **`provenance.json`**: the spec and tests hashes, seed, model, Codex CLI version, dates, the evidence line, the mutation
  result, pins, datasets and the full candidate history (including the prompts, which can contain sample rows).
- **`README.md`**: how to run the tests. It says that the Invariants gate (purity and the per-call time limit) is not
  reproduced outside the app.

A function that calls other generated functions is ejected with them, and the button says so (*Eject uniqueSlugs and
2 functions it uses*): one `<name>.ts` and `<name>.test.ts` per function, each `.ts` importing the functions it calls, and a `provenance.json` (version 2) with the graph of which
version of each callee every function was certified against.

Eject is disabled while the function is out of date (its spec or checks changed after it was certified, or a function it
calls changed or has no runnable code). `npm run check:eject`
ejects every shipped recording into a fresh project and runs vitest and strict `tsc` on it.

## Local session log

**Session → Session log** is off by default. Turned on, it keeps a short log of what you type and what
the gates decided, in this browser's storage only (IndexedDB database `undefined-session-log`, memory if that is
blocked); it is never sent anywhere. It may contain values you typed in your own calls, never dataset rows or prompts.
Each entry is small: REPL inputs, the kind of outcome (never the value), which gate rejected a candidate, declines,
commits, pins, rollbacks, spec edits, dataset loads (name, row and column counts only) and errors. A gate's headline
(cut to 200 characters), a decline's reason and an error's message are kept only while no dataset is loaded and the
function is not typed over one; otherwise the entry says only *rejected by invariants (pure)*, *declined
(cannot-be-pure)*, *boom threw TypeError*. Error notices are logged by their leading phrase only. The dialog shows the
entry count, **Export log**
(`undefined-session-log.json`) and **Clear**; turning it off stops new entries and keeps the old ones until you clear
them. At most 5,000 entries are kept (oldest dropped first).

# Undefined

**A live program that grows the functions you call but haven't written. The model proposes; your toolchain decides.**

![The opening sequence: an undefined call, a rejected candidate, a retry, a commit](docs/opening.gif)

Compilers used to sit upstream of everything: a human wrote code, the compiler judged it. LLMs invert that pipeline. The
model becomes the *upstream source* of code, and the ordinary toolchain (a strict TypeScript compiler, unit tests,
property tests, purity and runtime-bound checks) becomes the *downstream consumer* that decides what is accepted. Undefined
makes that inversion visible: call a function that doesn't exist, watch a model draft it, and watch real gates (not
string checks) reject the first attempt with a concrete counterexample before the retry is committed as a numbered
revision of your running program. Everything runs in your browser except the model call, which goes through your local
[Codex CLI](https://github.com/openai/codex).

> **You didn't write this. The model wrote it. Your tests hold the contract, and your toolchain enforced it.**

## Run it

**Prerequisites:** Node `^20.19 || >=22.12` (Vite 8's floor; typecheck, 532 tests and the build were run on Node 20.20, 22.23, 25.8 and 26.8; older 20.x releases fail Vite's own engine check), [Codex CLI](https://github.com/openai/codex) 0.157 or later (`npm i -g @openai/codex`), and
`codex login` completed. No API keys, no cloud backend, nothing leaves your machine except the prompt to Codex.

```bash
git clone <this repo> undefined && cd undefined
npm install
npm run dev          # opens on http://localhost:5173 with the generation service running (LIVE mode)
```

**Replay mode (no Codex needed):** `npm run build` produces a static site in `dist/` (deployable to GitHub Pages; assets
use relative paths). With no generation service reachable the app replays recorded `gpt-6-luna` sessions: *"Replaying a
recorded gpt-6-luna session; gates are running live."* The candidates are recorded; **every gate still executes live in
your browser** against them. `npm run preview` serves the build locally. A "Run live" button explains how to switch.

```bash
npm test             # unit + integration tests (Node)
npm run typecheck
```

## What you can do

- **Call anything.** Type `slugify("Hello World")` with no setup: the signature is inferred from your real arguments, only
  *Compile* and *Invariants* gate it, and the UI says so ("no tests yet, add one to make the gate stricter").
- **Three one-click examples** (specs tuned so a rejection happens naturally, see below): `median`, `slugify`, `fibonacci`.
  Each has a **Break it** button that edits the spec: the artifact's hashes no longer match, it is marked invalid, and the
  next call regenerates it.
- **Revisions.** Every accepted change is a numbered revision of the whole program *and its live state* (REPL variables).
  One click rolls back; rollbacks are themselves revisions, so history is never rewritten.
- **Hot reload.** Accepted functions are swapped into the running sandbox worker without a restart and without touching
  your REPL variables.
- **Structured recovery.** If a committed function throws, the REPL offers restarts: retry with the error fed back to the
  model, roll back, or edit the spec. Never a crash.
- **Export / import** your whole program (revisions, specs, artifacts, provenance) as one JSON file. State persists in
  IndexedDB.

## How a call is decided

```
REPL call ──► runtime worker (name lookup is a Proxy scope) ──► name not defined
   │
   └─► grow loop (visible retry budget, default 3 candidates)
         prompt ─► codex exec (read-only, empty temp dir) ─► candidate body
         ┌─────────────────────────── gates (the toolchain decides) ───────────────────────────┐
         │ 1 Compile     strict TypeScript, lib ES2022 only (no DOM, no Node globals)             │
         │ 2 Tests       your unit tests, run in a Web Worker                                      │
         │ 3 Properties fast-check, fixed seed derived from the spec hashes, shrunk counterexample│
         │ 4 Invariants  pure (masked globals, frozen-argument replay, determinism) and            │
         │               bounded (per-call wall-clock budget; the worker is terminated on overrun) │
         └──────────────────────────────────────────────────────────────────────────────────────┘
         fail ─► diagnostic (file/line/message, or counterexample + expected vs actual) goes back to the model
         pass ─► new revision, hot-swapped into the running program, original call completes
```

Every decision shows who made it: which gate, which line or counterexample. A rejected candidate stays visible in the
candidate strip, so you can see the toolchain turning work away. If the budget runs out, the call fails cleanly and the
program is unchanged.

**What the model sees:** the signature, the doc, the *names* of your tests and properties (never their bodies or the
reference implementation), the time budget per call, the *types* of the triggering call's arguments (never the values),
and on retries the previous attempt plus structured diagnostics. Every candidate keeps the exact prompt it was generated
from: open *What the model saw* under the candidate (or in the Repo tab's candidate history) to read it, headed by a plain
summary of what was and was not sent. For replayed sessions that is the prompt stored in the recording (older recordings predate
the budget line, and the summary says only what their prompt contains). The gates know more than the model; that is the
point. When a failing check declares that the doc never covered the case, the rejection card says so: the spec was
silent, your tests decided, and the candidate's choice was defensible.

**Gate semantics worth knowing.** An invariant violation seen in *any* phase is reported by the Invariants gate. The
runaway candidate in `fibonacci` is killed while the Tests gate is running, so Tests and Properties show as "interrupted"
and Invariants shows the rejection with the exact call and the budget. Fast-check's seed is derived from the spec hashes,
so the same candidate always gets the same verdict and the same shrunk counterexample: the *gates* are deterministic; the
*model* is not.

**Provenance, not reproducibility.** Each artifact records its spec hash, tests hash, model id, Codex CLI version, and the
full candidate history including rejected attempts. Nothing here claims the model would produce the same code twice.

## The examples, and how they were tuned (read this)

`gpt-6-luna` is a strong model, and with tight specs it passes first time: in my first sampling, **18 of 18** attempts at
fully-specified versions of these examples passed every gate on the first try. A demo of rejection needs a spec that is
*honestly incomplete*, the way real tickets are, with the tests encoding conventions the doc leaves open. So the shipped
docs are terse, test names are vague, and the property/test bodies are hidden from the model:

| example | what the gates catch | measured on gpt-6-luna (effort `low`, 8 samples each, first attempt → retry) |
|---|---|---|
| `median` | empty list: the model throws, the reference returns `NaN`. The reference-comparison property generates `[]` and fast-check shrinks to it (headline: `median([]) threw Error: …, expected NaN`) | 8/8 rejected by Properties → 8/8 passed on retry |
| `slugify` | convention gaps: `"Don't Stop"` → `dont-stop` (the model says `don-t-stop`), `&` → `and`, `ß`/`ø` | 8/8 rejected by Tests → 7/8 passed on retry |
| `fibonacci` | the obvious O(n) bigint loop takes ~4 s at `n = 1,000,000`; the 1.5 s bounded invariant terminates it; the diagnostic steers the model to fast doubling | 8/8 rejected by Invariants (bounded) → 8/8 passed on retry |

Models also fail in ways nobody tuned: in one live `slugify` run the first candidate came back with a literal `\n` in place
of a newline and the compiler rejected it ("Invalid character"), which is exactly the kind of thing the compile gate is for.

These are rates I measured on one day with one model; they are not a guarantee. A live run can pass first time. The
shipped recordings are real sessions captured from the live app (nothing was edited), made on runs where the first
candidate was rejected, which is the typical outcome above.

Two honest deviations from the idealised story: the `median` rejection is the empty list (shrunk by fast-check), not
`median([1, 2])` returning `1` (this model gets the textbook cases right), and `fibonacci` is rejected for the loop at `n = 1,000,000`, not for naive
recursion at `n = 90` (this model never wrote the naive recursion unprompted, even with the recurrence in the doc).

## Replay mode and recordings

Every live session is recordable: **Download recording** (live mode) saves a JSON file of the model candidates with their
prompts and progress lines. Recordings in `public/recordings/` are matched by function name + spec hash + tests hash, so
replay works for the unmodified examples and for their **Break it** edits. Edit a spec to something that was never
recorded and replay mode says so, and tells you how to run live.

Maintainers can record new sessions against a running `npm run dev` (it exposes a dev-only
`POST /__save-recording?id=<name>` route and `window.__undefined`); the static build contains neither.

## The generation service

A small Vite dev-server middleware (`server/`), absent from the static build: `GET /generate/health`, `POST /generate`
(server-sent events). One `codex exec` per request, serialised, in an empty temp directory:

```
codex exec - --model gpt-6-luna --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config \
  -C <empty tmp dir> --output-schema <{body,notes}> -o <tmp file> --json -c model_reasoning_effort=low
```

The service does nothing else: no compiling, testing, or caching. It kills the whole process group on timeout or client
disconnect, streams Codex's progress to the browser, and returns structured errors the gate panel displays with the fix
(`npm i -g @openai/codex`, `codex login`). It only answers same-host requests. Environment overrides:
`UNDEFINED_MODEL`, `UNDEFINED_EFFORT` (default `low`; your own Codex config may default to something much slower),
`UNDEFINED_TIMEOUT_MS`, `UNDEFINED_CODEX_BIN`.

Codex returns its answer in one piece, so "typed out as it arrives" is a typewriter over the received candidate; the live
progress lines above it (session started, turn started, tokens) are real Codex events.

## Limits and known gaps

- **The sandbox is a Web Worker, not a security boundary.** Candidate code runs with the clock, `Math.random`, network,
  timers and the global object shadowed by trapping proxies, and network/storage APIs are removed from the worker scope. A
  determined program could still reach the worker's global through `Function`-constructor tricks; the model is not
  adversarial and these checks exist to catch accidental impurity and make the decision visible.
- **REPL lines** are one expression or one binding (`x = …`, `const x = …`); no destructuring or multi-statement lines.
  After a function grows, the original line is re-evaluated, so side effects that happened *before* the undefined call run
  twice.
- Generated functions are self-contained: they cannot call other generated functions.
- A self-recursive function with no declared return type cannot compile (TS7023); the engine allows one extra attempt and
  tells the model.
- No multi-tab coordination for IndexedDB. No async tests.
- Browsers with IndexedDB blocked fall back to in-memory state for the session.

## Layout

```
server/            Vite middleware: the codex generation service, dev-only recording save
src/core/          engine (orchestrator), program/revision model, IndexedDB store, generators (live, replay)
src/gates/         strict TypeScript compile gate (lazy-loaded compiler + libs), source wrapper
src/sandbox/       gate executor + worker + watchdog, REPL runtime worker, purity masking
src/shared/        prompt builder, value display/serialisation, hashing, type inference
src/examples/      median, slugify, fibonacci (+ known-good and known-bad candidates used by tests)
src/ui/            Preact UI;  public/recordings/  recorded sessions;  docs/DESIGN.md  module contracts
scripts/           tune.tune.ts: samples the real model against the real gates (see below)
```

`TUNE_N=8 TUNE_EX=median,slugify,fibonacci npx vitest run -c scripts/vitest.tune.config.ts` re-measures the rejection
rates above against your own Codex login (results in `.tmp/tune-out.json`).

## A 60-second demo script

1. **0:00** Open the page. One line of copy: *"This function doesn't exist. Press Enter."* The REPL holds `median([3, 1, 4, 2])`.
   Press **Enter**.
2. **0:03** The REPL prints `ReferenceError: median is not defined`, then *Generating…* with live Codex progress lines and a
   timer. Point at the retry strip: attempt 1 of 3.
3. **0:10** Candidate #1 types into the code pane. The gate panel runs top to bottom: **Compile ✓**, **Tests ✓**, then
   **Properties ✗**. The giant red headline names the gate and the shrunk counterexample: `median([]) threw Error: …,
   expected NaN`. *"The model didn't lose an argument with a person; a property check it never saw said no."*
4. **0:18** Candidate #2 appears, passes all four gates, and the banner turns green: *Accepted, committed as r2*. The REPL
   prints `2.5` labelled **generated · revision 2**. Candidate #1 is still in the strip, in red.
5. **0:25** Press Enter on `median([9, 7, 1])`: `7`, instantly, labelled **cached artifact**, with the one-time line *"You didn't
   write this. The model wrote it. Your compiler and tests decided whether to keep it."*
6. **0:35** Click the **fibonacci** example, press Enter. Watch **Invariants** reject the first candidate for blowing the
   1.5 s bound, with the call and elapsed time on screen; the retry commits a fast-doubling version.
7. **0:50** Open **Repo → median**, press **Break it**. The artifact turns *invalid: spec changed*. Call it again and it
   regenerates.
8. **0:55** Open **Revisions** and click **Roll back to r2**. Then **Image → Export** to download your whole program.

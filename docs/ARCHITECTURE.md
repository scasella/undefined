# Architecture

How a call is decided, what the model sees, the local generation service and the source layout. Module contracts are in
[DESIGN.md](DESIGN.md); the security properties of the sandbox are in [SECURITY.md](SECURITY.md).

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

## The generation service

A small Vite dev-server middleware (`server/`), absent from the static build: `GET /generate/health`, `POST /generate`
(server-sent events). One `codex exec` per request, serialised, in an empty temp directory:

```
codex exec - --model gpt-6-luna --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config \
  -C <empty tmp dir> --output-schema <{body,notes}> -o <tmp file> --json -c model_reasoning_effort=low
```

The service does nothing else: no compiling, testing, or caching. It kills the whole process group on timeout or client
disconnect, streams Codex's progress to the browser, and returns structured errors the **Checks** panel displays with the fix
(`npm i -g @openai/codex`, `codex login`). It only answers same-host requests. Environment overrides:
`UNDEFINED_MODEL`, `UNDEFINED_EFFORT` (default `low`; your own Codex config may default to something much slower),
`UNDEFINED_TIMEOUT_MS`, `UNDEFINED_CODEX_BIN`.

Codex returns its answer in one piece, so "typed out as it arrives" is a typewriter over the received candidate; the live
progress lines above it (session started, turn started, tokens) are real Codex events.

## Layout

```
server/            Vite middleware: the codex generation service, dev-only recording save
src/core/          engine (orchestrator), program/revision model, IndexedDB store, generators (live, replay)
src/gates/         strict TypeScript compile gate (lazy-loaded compiler + libs), source wrapper
src/sandbox/       gate executor + worker + watchdog, REPL runtime worker, purity masking
src/shared/        prompt builder, value display/serialisation, hashing, type inference
src/examples/      median, slugify, fibonacci (+ known-good and known-bad candidates used by tests)
src/share/         loading a shared recording (text, URL, ?recording=);  src/sessionlog/  the opt-in local session log
src/ui/            Preact UI;  public/recordings/  recorded sessions;  docs/DESIGN.md  module contracts
scripts/           tune.tune.ts: samples the real model against the real gates (see below)
```

Also: `src/eject/` builds the [Eject](FEATURES.md#eject) zip; `server/share/` is the optional share-link Worker
([SHARE-DEPLOY.md](SHARE-DEPLOY.md)), not part of the dev server or the static site.

`TUNE_N=8 TUNE_EX=median,slugify,fibonacci npx vitest run -c scripts/vitest.tune.config.ts` re-measures the rejection
rates in [EXAMPLES.md](EXAMPLES.md) against your own Codex login (results in `.tmp/tune-out.json`).

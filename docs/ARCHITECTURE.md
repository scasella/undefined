# Architecture

How a call is decided, what the model sees, the local generation service and the source layout. Module contracts are in
[DESIGN.md](DESIGN.md); the security properties of the sandbox are in [SECURITY.md](SECURITY.md).

## One page, one engine

The static site ships one page, `apps/site/index.html` → `src/door/main.tsx`: the **front door** (landing `#/`, first
run `#/start`), a guided, plain-language surface over the engine. `apps/site/vite.config.ts` builds it into
`apps/site/dist/` with the production Content-Security-Policy `<meta>` (`npm run check:csp` asserts it). Contract,
vocabulary map, honesty rules, layout and recordings: [FRONT-DOOR.md](FRONT-DOOR.md). The page creates the engine
(`src/core/engine.ts`) with no location, so URL parameters the engine understands (`?opener=`, `?recording=`) are
ignored. The original REPL UI (the workbench, `src/ui/`) was removed; the engine features only it exposed are listed in
[FEATURES.md](FEATURES.md#engine-features-with-no-ui). Everything below describes the engine.

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

A line of several statements runs one statement at a time; after a grow only the statement that made the call runs
again (earlier statements never re-run), and the engine says which (`engine.ts rerunText`). A committed function's
status through the functions it calls is derived, never stored (`compose/graph.ts dependencyStatus`: current, changed,
waiting); `Engine.recheck(fn)` re-checks a caller against a changed callee, which functions a draft uses comes from the compile gate's `CompileOutput.deps` (kept on
`AttemptView.uses`, not persisted), and a re-check after a callee changed carries `GenerationView.recheck.callees`. Every
decision records who made it: which gate, which line or counterexample. Rejected candidates stay in the run
(`state.generation`); the front door shows them as drafts thrown out. If the budget runs out, the call fails cleanly and the
program is unchanged.

**What the model sees:** the signature, the doc, the *names* of your tests and properties (never their bodies or the
reference implementation), the time budget per call, the *types* of the triggering call's arguments (never the values),
and on retries the previous attempt plus structured diagnostics. When other functions in the program are already
certified (and calling them would not close a cycle), an OTHER FUNCTIONS section lists their signatures and the first
sentence of their docs, never their code; with none, the prompt is byte-identical to a program without composition
(`apps/site/src/compose/golden.test.ts`). Every candidate keeps the exact prompt it was generated
from (`Candidate.prompt`); on `#/start` the *What the AI will see* rail shows the last one after a run. For replayed sessions that is the prompt stored in the recording (older recordings predate
the budget line). The gates know more than the model; that is the point. When a failing check declares that the doc
never covered the case, the rejection is a question for you (Decide), not a verdict on the model.

**Gate semantics worth knowing.** An invariant violation seen in *any* phase is reported by the Invariants gate. The
runaway candidate in `fibonacci` is killed while the Tests gate is running, so Tests and Properties show as "interrupted"
and Invariants shows the rejection with the exact call and the budget. Fast-check's seed is derived from the spec hashes,
so the same candidate always gets the same verdict and the same shrunk counterexample: the *gates* are deterministic; the
*model* is not.

**Provenance, not reproducibility.** Each artifact records its spec hash, tests hash, model id, Codex CLI version, and the
full candidate history including rejected attempts. Nothing here claims the model would produce the same code twice.

## The generation service

A small Vite dev-server middleware (`apps/site/server/`), absent from the static build: `GET /generate/health`, `POST /generate`
(server-sent events). One `codex exec` per request, serialised, in an empty temp directory:

```
codex exec - --model gpt-6-luna --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config \
  -C <empty tmp dir> --output-schema <{body,notes}> -o <tmp file> --json -c model_reasoning_effort=low
```

The service does nothing else: no compiling, testing, or caching. It kills the whole process group on timeout or client
disconnect, streams Codex's progress to the browser, and returns structured errors that the front door shows with the fix
(`npm i -g @openai/codex`, `codex login`). It only answers same-host requests. Environment overrides:
`UNDEFINED_MODEL`, `UNDEFINED_EFFORT` (default `low`; your own Codex config may default to something much slower),
`UNDEFINED_TIMEOUT_MS`, `UNDEFINED_CODEX_BIN`.

Codex returns its answer in one piece, so "typed out as it arrives" is a typewriter over the received candidate; the live
progress lines above it (session started, turn started, tokens) are real Codex events.

## Layout

An npm workspace (root `package.json`; `npm install`, `npm test`, `npm run typecheck|build|dev|preview|check:*` all run
from the root and delegate). The site imports the engine as `@scasella/undefined-engine/<module>` (the TypeScript
source, no build step); the engine never imports the site, and its `tsconfig.json` (`lib: ES2022`, no DOM or Node
types, host globals listed in `src/env.d.ts`) makes the compiler enforce that it runs in a browser Worker and in Node.
Only `src/node/` (excluded from that config, checked with Node types) may touch Node APIs. The gate worker's protocol
code (`sandbox/gateWorkerCore.ts`) is one implementation run by both hosts: the site's Web Worker shell and the Node
harness (`sandbox/vmHarness.ts`, bundled once with rolldown and evaluated in the `vm` realm).

```
packages/engine/src/
  types.ts           the shared contract
  gates/             strict TypeScript compile gate (lazy compiler; lib .d.ts texts come from the host via setLibSource), source wrapper
  sandbox/           gate executor, Test API, purity masking, the gate runner + watchdog (the host supplies the worker), run nonce
  shared/            value display/serialisation, hashing, evidence line, spec info, type inference, declaration line
  program.ts         pure program/revision operations
  compose/           the dependency graph between generated functions: what a body may call, status, closure
  mutation/ decide/  the mutation check; spec-gap questions and decisions
  suggest/ eject/    property suggestions; the Eject zip and provenance
  spec/validate.ts   the spec / decision / pin validators (shared by the site's image reader and the spec-file reader)
  certify.ts         the pipeline the site orchestrator and certify() share: spec check, gate input, mutation check, verdicts
  certifyModule.ts   certify({ source, spec }): every exported function of a TypeScript file, against a spec or vitest file
  ingest/            per-function splitting of a source file, the undefined-spec file, the vitest + fast-check shim
  node/              Node only (never imported by the site): the gate host (a worker_thread + node:vm realm with the
                     same watchdog; NOT a secure sandbox, docs/SECURITY.md), TypeScript libs from disk, certifyFile()
apps/site/
  index.html         the only page: the front door (src/door/main.tsx)
  vite.config.ts  public/recordings/ (recorded sessions)
  server/            Vite middleware: the codex generation service, dev-only recording save; share/ the optional share Worker
  src/core/          engine (orchestrator), IndexedDB store, generators (live, replay), REPL line splitting
  src/gates/libs.ts  the site's lib source for the compile gate (a lazy Vite glob)
  src/sandbox/       worker spawning (blob: wrapper, CSP), the gate and REPL runtime workers, the site's gate runner (default worker)
  src/shared/        prompt builder, REPL statement splitter
  src/examples/      median, slugify, fibonacci, orders (+ known-good and known-bad candidates used by tests)
  src/share/ src/sessionlog/ src/data/   shared recordings, the opt-in session log (engine API only), data parsing and typing
  src/lib/           pure helpers shared by the front door and tests: data intake refusals and naming (data.ts), plain
                     evidence and gate wording (evidence.ts, explain.ts, also used by scripts/cli.parity.ts)
  src/door/          the front door (landing + first run): components/, model/ (pure, tested view-models), landing/, start/
  scripts/           checks (replay, csp, eject), recording (record.mjs; record-door.mjs for the front door), screenshots, tune.tune.ts (see below)
packages/cli/      undefined-certify: args, the certify command over the engine's certify(), human and --json reports,
                   mutant line mapping, examples/ (pass, rejected, spec gap); dist/ built by scripts/build.mjs
packages/action/   the GitHub Action (action.yml): PR diff → touched exported functions → the engine's certify() on the
                   Node host → one marked PR comment via the REST API; fork-safe certify/comment modes; dist/ is the
                   committed bundle (scripts/build.mjs, checked by check:action-dist)
docs/DESIGN.md       module contracts; docs/ENGINE.md the engine/CLI/Action API; docs/PACKAGES.md npm names
```

`apps/site/server/share/` is the optional share-link Worker ([SHARE-DEPLOY.md](SHARE-DEPLOY.md)), not part of the dev
server or the static site.

`TUNE_N=8 TUNE_EX=median,slugify,fibonacci npx vitest run -c apps/site/scripts/vitest.tune.config.ts` re-measures the rejection
rates in [EXAMPLES.md](EXAMPLES.md) against your own Codex login (results in `.tmp/tune-out.json`).

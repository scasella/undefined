# Phase 4 design: the engine as a product (workspace, Node runner, CLI, Action)

Status: step 1 (restructure) implemented, see §10; the engine API, the Node host and spec ingestion (steps 2–3 and the
ingestion half of 4) implemented, see §11; the CLI (step 4) implemented, see §12; the Action (step 6) implemented, see §13; the parity
fixture and the docs were built in the Phase 4 commit as [EVIDENCE.md](EVIDENCE.md#node-and-cli-parity) describes. Written against HEAD `0d1c13c`. Every claim about current behaviour cites the
file and function it comes from. Where the brief cannot be met as written, §9 says so and proposes the alternative.

Brief (product owner, condensed): restructure into `packages/engine`, `packages/cli`, `packages/action`, `apps/site`
without changing the site's behaviour; `certify <file> [--spec <file>] [--json]` runs all four gates and the mutation
check in Node with a real watchdog (exit 0 pass, 1 rejected, 2 spec gaps, 3 could not run); the Action certifies the
functions a PR touches, keeps one comment up to date and fails only on a rejection; no code generation in the CLI or
the Action; Node must reproduce the browser verdicts for the shipped examples, proven by a parity test.

Hard constraints carried from the project rules: tests / typecheck / build / check:replay / check:csp / check:eject
green after every step; opening sequence untouched; the static site needs no backend and no env vars; prompt bytes,
`specHash`, `testsHash` and the recordings byte-identical (`src/**/golden.test.ts`); shipped example specs unchanged;
MIT; no accounts, telemetry or analytics; the sandbox is never called a security boundary.

---

## 1. Layout

### 1.1 Target tree

```
package.json                 private root: "workspaces": ["packages/*", "apps/*"], scripts delegate (§1.6)
tsconfig.base.json           shared strict options (today's tsconfig.json compilerOptions minus lib/types/jsx)
vitest.config.ts             root: test.projects = apps/site, packages/engine, packages/cli, packages/action
docs/  LICENSE  README.md    stay at the root (README links unchanged; package READMEs link back)
.github/workflows/           ci.yml, pages.yml (paths updated), action-self-test.yml (new, §5.9)

packages/engine/             "private": true in v1 (bundled into cli/action, §1.5); name @scasella/undefined-engine
  src/index.ts               the public surface (§1.3)
  src/types.ts               ← src/types.ts (moved whole: DESIGN.md forbids forking the contract)
  src/gates/                 ← src/gates/{compile,source}.ts (+ tests); compile.ts gains a LibSource seam (§2.6)
  src/sandbox/               ← attribution, gateExecutor, testApi, mask (+ tests); gateRunner.ts without the browser
                               default (§1.2); gateWorkerCore.ts (new: the body of today's gateWorker.ts, §2.2);
                               nonce.ts (newNonce/hasNonce, split out of spawn.ts)
  src/shared/                ← hash, evidence, specInfo, serialize, show, diff, literal, inferType (+ tests);
                               declaration.ts (new: declarationLine, split out of shared/prompt.ts)
  src/program.ts             ← src/core/program.ts (pure; eject and compose need isStale/isLive/recordFor)
  src/compose/               ← graph.ts, sha256.ts (+ graph/sandbox/compile/eject compose tests; compose/golden,
                               prompt.compose, decide/golden and the engine/store/text compose tests stay in the
                               site: they guard prompt bytes or exercise core/engine.ts)
  src/mutation/              ← mutate, run, classify (+ tests)
  src/decide/                ← decisions, gaps (+ tests)
  src/suggest/               ← suggest, apply, fixtures (+ tests); NOT exported to cli/action (§4.8)
  src/eject/                 ← eject, literal, zip (+ tests)
  src/spec/validate.ts       ← vSpec/vDecisions/vPins and helpers lifted out of core/store.ts (store re-imports them)
  src/certify.ts             new: the pipeline the site and the CLI share (§1.3)
  src/node/                  new, Node-only, never imported by the site: host.ts, worker.ts, harness.ts, libs.ts (§2)

packages/cli/                @scasella/undefined (bin: undefined-certify) — §4
  src/main.ts  src/args.ts  src/ingest/{source,specFile,vitest,eject}.ts  src/report/{human,json}.ts
packages/action/             GitHub Action — §5
  action.yml  src/main.ts  src/diff.ts  src/github.ts  src/comment.ts  dist/index.js (committed)

apps/site/                   the current app, behaviour unchanged
  index.html  vite.config.ts  public/  server/  scripts/  src/{main.tsx,styles.css}
  src/core/                  engine.ts (orchestrator), generator.ts, store.ts, opener.ts (+ tests)
  src/sandbox/               runtime.ts, runtimeWorker.ts, replCore.ts, spawn.ts, workerUrls.ts, gateWorker.ts (shell),
                             gateRunner.ts (thin: injects the blob-worker default), protocol.test.ts, runtime tests
  src/shared/                prompt.ts, replSplit.ts (+ tests, incl. prompt golden)
  src/examples/  src/data/  src/share/  src/sessionlog/  src/ui/
```

All moves are `git mv`. The one non-move in step 1 is splitting four files whose current text mixes both sides; each
split leaves the old path re-exporting the moved symbols so no import site and no test changes in that commit:

| file today | goes to engine | stays in site | why |
|---|---|---|---|
| `src/shared/prompt.ts` | `declarationLine` → `engine/shared/declaration.ts` | everything else | `compose/graph.ts` imports `declarationLine` from the prompt builder; generation must not ride into the engine |
| `src/gates/compile.ts` | everything except `splitReplLine` | `splitReplLine` → `site/src/core/split.ts` (uses engine `loadTs`) | the REPL splitter imports `shared/replSplit.ts` |
| `src/sandbox/spawn.ts` | `newNonce`, `hasNonce` → `engine/sandbox/nonce.ts` | `absoluteUrl`, `wrapperSource`, `spawnModuleWorker` **unchanged** | the runner needs the nonce; the blob wrapper is the browser's CSP path |
| `src/sandbox/gateRunner.ts` | all of it, with `createWorker` required | `site/src/sandbox/gateRunner.ts`: `defaultGateWorker()` (today's text) + `runExecutionGates(i, g, o) = engine(i, g, { createWorker: defaultGateWorker, ...o })` and type re-exports | it statically imports `./spawn` and `./workerUrls` (`?worker&url`, Vite-only) |
| `src/core/store.ts` | `vSpec`, `vDecisions`, `vPins`, `readDecisions` and the `obj/str/num…` helpers → `engine/spec/validate.ts` | IndexedDB, image, everything else | the CLI's spec-file validator must be this one, not a fork |
| `src/core/engine.ts` | `classifyMutant`, `infraFailure`, `evidenceOf`, the body of `mutationReport`, the compile + spec-check + `ExecGateInput` assembly at the top of `runGates` → `engine/certify.ts` | the rest (UI pacing, queue, history, store, REPL, generation) re-exports the moved names | §1.3 |

`src/sandbox/spawn.ts`, `src/sandbox/workerUrls.ts`, `server/csp.ts` and the blob-wrapper spawn path keep their exact
text: only their directory changes (`apps/site/...`). The gate worker shell `apps/site/src/sandbox/gateWorker.ts` keeps
its capture → listen-in-capture-phase → `lockWorkerMessaging` → `scrubWorkerGlobals` order verbatim and calls the
moved `executeGates`.

### 1.2 The browser runner stays the browser runner

`runExecutionGates` (`src/sandbox/gateRunner.ts`) already takes `GateRunOptions.createWorker?: () => GateWorkerPort`
and `nonce?`; the default is the only Vite/DOM-bound part (`defaultGateWorker` → `spawnModuleWorker(gateWorkerUrl)`).
The engine copy makes `createWorker` required. The site's `gateRunner.ts` supplies today's default, so the site's
`EngineDeps.execGates` (`core/engine.ts defaultDeps`) is bit-for-bit the same function as now. `Watchdog`,
`timeoutResults`, `crashResults`, `selectPhases`, `evidenceFrom`, `DEFAULT_OVERALL_CAP_MS = 15_000` and
`WATCHDOG_INTERVAL_MS = 25` move unchanged and are shared by both hosts: one watchdog implementation.

### 1.3 The engine API (`packages/engine/src/certify.ts`) and how the site uses it

The site's 4.3k-line orchestrator interleaves UI pacing (`setAttempt`, `sleep(pacing.gateDwellMs …)`, per-gate
deferreds) with the actual decisions. The decisions move; the pacing stays. Exported:

```ts
export interface GateHost {                       // what differs between browser and Node
  execGates(input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]>;
  compile?(spec: FunctionSpec, body: string, ctx?: CompileContext): Promise<CompileOutput>; // default compileCandidate
  transpile?(src: string): { js: string; error?: string };                               // default transpileUserCode
  now(): number;                                  // Date.now for MutationReport.at
}

/** Gate 1 + the spec check + the ExecGateInput (today: the top half of engine.ts runGates). */
export async function prepareGates(spec, body, hashes, opts: { callArgs?; pinned?; callable?; program?; host }):
  Promise<{ compiled: CompileOutput } & (
    | { stop: GateResult[]; specError?: { gate: 'tests' | 'properties'; message: string } }   // compile fail / spec error
    | { input: ExecGateInput })>;

export function classifyMutant(results: readonly GateResult[]): 'killed' | 'killed-by-bound' | 'survived'; // moved
export function evidenceOf(gates, mutation?, spec?): Evidence;                                         // moved

/** Today's engine.ts mutationReport minus Aborted/progress plumbing, which become options. */
export async function mutationCheck(a: { spec; js; specHash; testsHash; pinned; deps?; evidence?: Evidence;
  host: GateHost; signal?: AbortSignal; progress?(done: number, total: number): void;
  timeBoxMs?: number /* 6000 */; callBudgetCapMs?: number /* 1000 */ }): Promise<{ report: MutationReport; baseline?: Evidence }>;

/** The whole pipeline, for the CLI/Action and the parity test. No pacing, no UI, no generation. */
export async function certify(spec: FunctionSpec, body: string, opts: { host: GateHost; mutation?: boolean;
  program?: Program; onGate?(r: GateResult): void }): Promise<Certification>;

export interface Certification {
  verdict: 'accepted' | 'rejected' | 'spec-error';
  gates: GateResult[];                // 4 results, GATE_ORDER
  headline?: string;                  // the rejecting gate's headline, verbatim
  specHash: Hash; testsHash: Hash; seed: number;
  compile: CompileOutput;
  evidence?: Evidence;                // accepted only; includes mutation unless disabled
  evidenceLine?: string;              // shared/evidence.ts describeEvidence(evidence, calls)
  gaps: GapQuestion[];                // decide/gaps.ts gapQuestion for each diagnostic of the rejecting gate
}
```

`certify` = `hashesFor` → `prepareGates` → `host.execGates` → (accepted) `mutationCheck` → `evidenceOf` →
`describeEvidence` → gaps. The site's `runGates` becomes: `prepareGates(...)`, then its existing deferred/pacing loop
over `deps.execGates(prepared.input, deliver)`; `mutationReport` becomes a call to `mutationCheck` with
`signal: ctrl.signal` and its progress callback; the `Aborted` translation stays in the site. Nothing is computed twice
and the order of operations is the same, so `core/engine.*.test.ts` stay green unchanged — that is the "no behaviour
change" proof for this extraction. `certify` itself is new code but only composes the shared functions.

### 1.4 How the site consumes the engine (dev, test, build — no prebuild)

- `packages/engine/package.json`: `"exports": { ".": "./src/index.ts", "./*": "./src/*.ts" }`, `"type": "module"`.
  npm workspaces symlink `node_modules/@scasella/undefined-engine` → `packages/engine`. Vite and vitest transform
  linked TypeScript sources directly (a linked package is not pre-bundled); TypeScript with
  `moduleResolution: "bundler"` resolves `exports` to the `.ts` files. No build step in dev or test.
- `apps/site/vite.config.ts`: `server.fs.allow: [searchForWorkspaceRoot(process.cwd())]` (the engine and the hoisted
  `node_modules/typescript/lib` are outside `apps/site`); `optimizeDeps.include` keeps `typescript`, `fast-check`.
- Imports in the site change from `'../gates/compile'` to `'@scasella/undefined-engine/gates/compile'` (subpath per
  module keeps the diff mechanical and the code-split chunks identical; the barrel is for the CLI).
- The production bundle must not change behaviour; chunk names/hashes may change. `check:csp` already scans
  `dist/assets/*.js` and the meta policy, not file names.

### 1.5 Build for publish (zero new build dependencies)

Vite 8 is already a devDependency and runs on Rolldown; no esbuild/tsup/ncc is needed. Two lib-mode configs:

| output | config | format | externals |
|---|---|---|---|
| `packages/cli/dist/cli.js` (+ `worker.js`) | `packages/cli/vite.config.ts`, `build.ssr`, target `node20` | ESM | `typescript` (a real dependency: 9 MB, and the lib `.d.ts` must come from the same install, §2.6) |
| `packages/cli/dist/harness.js` | second config, single entry `engine/src/node/harness.ts` | IIFE string, everything inlined incl. `fast-check` | none (runs inside a `vm` context that cannot import, §2.3) |
| `packages/action/dist/index.js` | `packages/action/vite.config.ts` | ESM, `typescript` **inlined** too | none: Actions run without `npm install`, so `dist/` is committed (§5.8) |

The engine is bundled into both; it is `private` in v1, so there is one published npm package. Publishing the engine
as a library later is a `dist` + `.d.ts` build (`tsc -p packages/engine --emitDeclarationOnly`) and is out of scope.

### 1.6 TypeScript, vitest, scripts, CI, Pages

- **tsconfig.** `tsconfig.base.json` (strict, ES2022, bundler resolution, isolatedModules…). Per package:
  `packages/engine/tsconfig.json` with `"lib": ["ES2022"]`, `"types": []` plus `src/env.d.ts` declaring exactly the
  host globals the engine may touch (`performance.now`, `structuredClone`, `crypto.getRandomValues`,
  `crypto.subtle.digest`, `TextEncoder`, `setInterval/clearInterval`, `console`) — the compiler then *enforces* that
  the engine is environment-neutral; `engine/src/node/**` and `*.test.ts` are a second project with `types: ["node"]`.
  `apps/site/tsconfig.json` = today's options (DOM, `vite/client`, `node`, preact JSX). `packages/{cli,action}`:
  `types: ["node"]`. No project references (they require `composite` + declaration emit for no gain here).
  Root `npm run typecheck` = `tsc -p packages/engine && tsc -p packages/engine/tsconfig.node.json && tsc -p packages/cli
  && tsc -p packages/action && tsc -p apps/site`.
- **vitest.** Root `vitest.config.ts` with `test.projects: ['apps/site', 'packages/*']` (vitest 4); `apps/site` keeps
  its `test` block in `vite.config.ts` (environment node, `--configLoader runner`); engine/cli/action get a minimal
  `vitest.config.ts` each. `npm test` at the root runs all of them. The golden tests move with their modules and keep
  asserting the same bytes.
- **Root scripts** delegate: `build` = `npm run build -w apps/site`, `check:replay|csp|eject` = `-w apps/site`,
  new `build:cli`, `build:action`, `check:parity` (§6), `check:action-dist` (rebuild and `git diff --exit-code
  packages/action/dist`). `scripts/` moves to `apps/site/scripts/` (all of them read `dist/`, `public/recordings` or
  `/src/...` relative to the site root, so `npm run -w apps/site` keeps every relative path working; the vitest
  configs inside it keep their relative `include`). `.gitignore`: `dist` already matches nested dirs; add
  `!packages/action/dist`.
- **CI** (`.github/workflows/ci.yml`): same jobs; steps call the root scripts, which delegate. Add `npm run
  build:cli && npm run check:parity` to the test job and `check:action-dist`. The replay job is unchanged apart from
  the delegated scripts.
- **Pages** (`pages.yml`): `upload-pages-artifact` `path: apps/site/dist`; `npm run build` from the root (delegated);
  `VITE_SHARE_ENDPOINT` stays optional and empty by default, so the static site still builds with no env vars.

---

## 2. Host abstraction

### 2.1 How a gate run works today

`runExecutionGates` (main thread) creates a fresh worker per run (`spawnModuleWorker` → `blob:` module
`import "<gateWorker url>"`, so the worker inherits the page CSP), posts `{type:'run', input, nonce}`, and runs
`Watchdog` every 25 ms against `performance.now()`. The worker (`gateWorker.ts`) captures `postMessage`, takes the run
message in a capture-phase listener and stops it, locks `postMessage/close/onmessage/onmessageerror`
(`lockWorkerMessaging`), removes network/IPC APIs (`scrubWorkerGlobals`), then `executeGates(input, hooks)` posts
`phase`/`enter`/`leave`/`gate`/`done`/`error`, each stamped with the nonce. The main side ignores un-nonced messages,
times the *outermost* in-flight call against `budgetMs` and the run against `overallCapMs`, and on overrun calls
`worker.terminate()` and builds the result with `timeoutResults` (attribution: Invariants reports `bounded`, the
interrupted phase is `skipped: interrupted`). A worker `error` event becomes `crashResults` (a gate failure, never a
pass). Candidate code is evaluated by `mask.ts evalMasked` with the trapped names shadowed as `new Function`
parameters.

### 2.2 The seam: `GateWorkerPort` already exists

```ts
interface GateWorkerPort { postMessage(m: ToWorker): void; terminate(): void;
  onMessage(cb: (data: unknown) => void): void; onError(cb: (message: string) => void): void }
```

Nothing new is needed on the main-thread side: the Node host is a `createWorker` that returns this port over
`node:worker_threads`. Same `ToWorker`/`FromWorker` protocol, same nonce (`crypto.getRandomValues` is global in Node
≥ 20), same `Watchdog`, same `timeoutResults`/`crashResults`, same `setInterval` cadence — so watchdog semantics are
identical by construction, not by re-implementation. On the worker side today's `gateWorker.ts` body becomes
`installGateWorker(scope: { post(m): void; listen(cb): void })` in `engine/sandbox/gateWorkerCore.ts`; the browser
shell passes `self` adapters and runs `lockWorkerMessaging(self)` + `scrubWorkerGlobals(self)` exactly as today.

### 2.3 The Node host (`engine/src/node/host.ts`, `worker.ts`, `harness.ts`)

```
CLI main thread                            worker_thread (worker.js)                     vm context (harness.js)
runExecutionGates(input, onGate,     ──►  new Worker(worker.js, { env: {}, argv: [],  ──► fresh realm: no process, require,
  { createWorker: nodeGateWorker })        execArgv: [], stdout/stderr piped,             Buffer, fetch, WebSocket, import();
Watchdog every 25 ms                       resourceLimits: { maxOldGenerationSizeMb:      harness = installGateWorker +
worker.terminate() on overrun              256, maxYoungGenerationSizeMb: 32,             executeGates + fast-check + mask
                                           stackSizeMb: 1 } })                            (one IIFE string, §1.5)
                                           ctx = vm.createContext(Object.create(null),
                                             { codeGeneration: { strings: true, wasm: false },
                                               microtaskMode: 'afterEvaluate' })
                                           vm.Script(harness) — no importModuleDynamically
```

- **Why a `vm` context inside the worker, not the worker's own global.** In a Node worker, `import('node:fs')` and
  `process.getBuiltinModule('fs')` (Node ≥ 22.3) work; CSP does not exist; the `(() => 0).constructor('return this')()`
  escape that SECURITY.md already documents would reach `process`. A `vm.Script` compiled without
  `importModuleDynamically` makes every `import()` throw `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` — the Node
  equivalent of the CSP closing `import()` — and the context's global object simply has no Node APIs, so the
  `.constructor` escape lands on an empty realm. `--experimental-permission`/`--permission` was rejected: it is
  process-wide (the CLI itself must read files), and `module.register`/`registerHooks` do not cover
  `getBuiltinModule`.
- **Same-realm semantics as the browser.** Harness, fast-check, mask, test code and candidate all live in the one
  context realm, exactly as they share the worker realm in the browser, so `mask.ts`'s intrinsic snapshot,
  `instanceof`, frozen arguments and `deepEqual` behave the same.
- **What the realm must be given.** `gateExecutor.ts:139-141` and `testApi.ts:19` capture `performance` and
  `structuredClone` at module load; `hash`/`nonce` are main-thread only. Passing the worker's own functions into the
  context would hand user code an outer-realm `Function` (`fn.constructor.constructor('return process')()`), the
  classic `vm` escape. So: `structuredClone` is an **in-realm implementation** bundled into the harness (arrays incl.
  holes, plain objects, primitives incl. `-0`/`NaN`/bigint, `Map`, `Set`, `Date`, `RegExp`, typed arrays, `Error`,
  cycles; functions/symbols throw `DataCloneError` like the native one, which `cloneOrSelf` already catches);
  `performance.now` and `post` are passed as two outer functions that the harness captures into its closure and then
  **deletes from the context global before any user code loads** (the same capture-then-lock move as
  `lockWorkerMessaging`). The browser keeps the native `structuredClone`: the polyfill is selected only in
  `harness.ts`.
- **Inbound data crosses as a string, never as objects.** The run message carries objects (`callArgs`,
  `pinned[].args/expected`, `deps`, `waived`); handed in as structured-cloned outer-realm objects they would reopen
  the escape (`callArgs[0].constructor.constructor('return process')()`). The worker therefore serialises the whole
  `ToWorker` message to one string with `shared/serialize.ts encodeValue` + `JSON.stringify` (already lossless for
  NaN, -0, bigint, Map, Set, Date) and the harness decodes it in-realm before anything runs. Outbound messages go
  in-realm → outer, the safe direction (they are cloned by `parentPort.postMessage`).
- **Watchdog.** Unchanged and real: main thread timestamps `enter`/`leave` (`parentPort` messages), and on overrun
  `worker.terminate()` stops even a tight synchronous loop (V8 `TerminateExecution`). Per-call budget = `spec.budgetMs`
  (mutants: `min(budgetMs, 1000)`), overall cap 15 s (mutants: `max(2·budget, time box left)`), exactly as
  `engine.ts mutationReport` sets them today.
- **Memory.** `resourceLimits` turns heap exhaustion into a worker `error` with code `ERR_WORKER_OUT_OF_MEMORY`.
  Decision: the Node port's `onError` recognises that code and reports an Invariants `bounded` failure (built with
  `attribution.ts invariantFailure` + `applyAttribution`, message "used more than the 256 MB heap limit", phase =
  the watchdog's current phase), i.e. a rejection of the candidate (exit 1) and, for a mutant, `killed-by-bound`. Every
  other worker error stays `crashResults` → "gate worker error" → infrastructure (`engine.ts infraFailure`) → exit 3.
  The browser has no such limit
  (SECURITY.md: "bounded only by what the browser does to the tab"); this is a Node-only strengthening and a
  documented parity difference.
- **Stack.** Worker threads default to `stackSizeMb: 4`; a Chrome worker's stack is smaller. A deep recursion can
  therefore throw `RangeError` (Tests fail) on one host and run on (Invariants `bounded`) on the other. Pin
  `stackSizeMb: 1` as the closest match and state it as approximate. None of the shipped recorded bodies recurse
  (fibonacci attempt 0 is the iterative BigInt loop, attempt 1 fast doubling — checked).
- **Output.** `stdout`/`stderr: true`: candidate `console.*` cannot write to the CLI's terminal (console inside the
  context is a no-op in-realm object).
- **Honest limits (go verbatim into the CLI README, the Action README and SECURITY.md):** the Node runner executes
  untrusted code in a `worker_thread` with a watchdog, inside a `vm` context with no Node APIs. **`node:vm` is not a
  security mechanism** (Node's own docs say so) and a worker thread shares the process; this is not a secure sandbox.
  What it does: catches accidental impurity, stops runaways, bounds memory. What it does not: resist a deliberate
  escape. Run it only on code you would run anyway, or inside a disposable VM/container.

### 2.4 Determinism across hosts

The fast-check seed is `gateSeed(specHash, testsHash)` (`shared/hash.ts`), pure arithmetic over hashes computed with
`crypto.subtle` — same in both. fast-check is the same version (one workspace install, bundled into the harness).
Verdicts can still differ where V8 or ICU differ: Unicode property escapes / `normalize` tables across V8 versions
(relevant to slugify), `localeCompare`/`Intl` with different ICU data, `Math` transcendental functions (V8's port is
deterministic across platforms, but a candidate depending on the last ulp could differ across V8 versions). The CLI
prints `node <version>, V8 <v8 version>, ICU <icu version>` in `--json` provenance so a divergence is traceable.

### 2.5 Timing differences

Everything is deterministic except what the watchdog measures: wall-clock from the main thread's receipt of `enter`
to now, polled every 25 ms. Consequences: (a) a candidate whose honest runtime is near `budgetMs` can flip between
pass and `bounded`; (b) a mutant near 1000 ms can flip between `killed` (it failed a check) and `killed-by-bound`, or
between `survived` and `killed-by-bound`; (c) the 6 s mutation time box can stop the run early on a slow machine
(`MutationReport.skipped = 'time box reached after k of n mutants'`). Measured margin on the recorded bodies:
fibonacci's accepted body computes `fibonacci(1000000)` in ~20 ms in Node 25 (budget 1500 ms); the rejected one is the
O(n²)-bit loop, orders of magnitude over the budget. Worker start-up (~30–60 ms in Node, similar in Chrome) is
outside any budget: the watchdog's per-call clock starts at `enter`.

### 2.6 TypeScript in Node: same compiler, same libs, same diagnostics

`compile.ts` today loads libs through `import.meta.glob('/node_modules/typescript/lib/lib.{es,decorators}*.d.ts',
{ query: '?raw' })` — Vite-only, and Vite-root-relative (it would break in `apps/site` anyway once npm hoists
`typescript` to the root `node_modules`). Introduce:

```ts
export type LibSource = (file: string /* e.g. 'lib.es2022.d.ts' */) => Promise<string>;
export function setLibSource(s: LibSource): void;   // called once by each host before the first compile
```

- site: `apps/site/src/gates/libs.vite.ts` with the same glob written relative to the hoisted install
  (`'../../../../node_modules/typescript/lib/lib.{es,decorators}*.d.ts'`), registered in `main.tsx` and in the site's
  vitest setup file; `check:replay` and the compile tests prove it resolves.
- Node: `engine/src/node/libs.ts` reads `dirname(createRequire(import.meta.url).resolve('typescript/lib/lib.es2022.d.ts'))`.
- The virtual `LIB_DIR = '/node_modules/typescript/lib'`, `/candidate.ts`, `/others.d.ts`, `lib: ['lib.es2022.d.ts']`,
  `types: []` stay as they are: the compiler sees the same virtual file system in both hosts, so diagnostics, line
  mapping (`bodyStartLine`) and emitted JS are byte-identical. `DOM` is absent in both by design (DESIGN.md gate 1).
- Pin `typescript` to one exact version across the workspace (`5.9.3`, not `^5.9.3`) and make the CLI depend on the same
  exact version: TS diagnostic wording is part of the rejection headline.

---

## 3. Spec ingestion (CLI)

### 3.1 What the engine certifies, and what a source file must look like

The gates certify a **function body** compiled inside a generated wrapper (`gates/source.ts buildSource`:
`typeDecls` + `function name(params): returns {\n<body>\n}`), with lib ES2022, no imports, no ambient types. So
`certify` reads the TS file with the TypeScript parser and, per exported function, extracts:

- `export function name(p: T, …): R { … }` and `export const name = (p: T, …): R => { … }` / `function (…) {…}`.
  Expression-bodied arrows become `return <expr>;` (body text then differs from the file; diagnostics map back).
- `params` = each parameter's name and the **verbatim** type text (`node.type.getText()`), `returns` = return type
  text or `null`. A parameter without a type annotation, a rest/optional/default/destructured parameter, type
  parameters (`<T>`), overloads, `this` parameters or `async`/generator functions → exit 3 with the reason
  (`FunctionSpec` cannot express them; extending it changes the hashed shape and is a separate decision).
- `doc` = the function's JSDoc text (summary + tags rendered as text); `''` when none.
- `typeDecls` = `type`/`interface` declarations in the same file that the signature or body reference (transitively),
  in file order. Anything else the body references at module scope (imports, consts, classes, enums, non-exported
  helpers) → exit 3: "`slugify` uses `STOP_WORDS` from module scope; the gates certify self-contained functions".
  Exported functions in the same file that it calls are certified first and linked as callees through
  `ExecGateInput.deps` (the composition path, `compose/graph.ts closureOf`), in `topoOrder`; a cycle → exit 3.
  Type-only imports from relative files are resolved by reading that file's `type`/`interface` declarations.
- `body` = the exact text between the braces with the leading newline and the trailing newline before `}` removed and
  **no re-indentation** — the inverse of how the parity test writes a recorded body into a file (§6), so
  `buildSource(spec, body)` reproduces the site's compile source byte for byte. Diagnostic lines are reported both
  body-relative (as the site does) and file-relative (`file:line`), using the function's start line.
- `budgetMs` default 1000 (`gates/source.ts DEFAULT_BUDGET_MS`), `maxAttempts` 1 (unused: nothing is generated),
  `origin: 'user'`.

### 3.2 (a) The canonical spec file: `undefined-spec` v1

The site's own spec format is `FunctionSpec` as stored in images and in recordings v2 (`RecordedSession.spec`),
validated by `core/store.ts vSpec`. The eject `provenance.json` is **not** round-trippable as it stands: it carries
`params/returns/doc/typeDecls/budgetMs` and the decision summaries but not `tests`/`properties`/`pins`/decision tests
(`eject/eject.ts provenance`); those live in the ejected test file. So the canonical format is FunctionSpec JSON:

```json
{
  "format": "undefined-spec",
  "version": 1,
  "functions": {
    "median": {
      "doc": "Returns the median of a list of numbers. …",
      "tests": "test('odd length', () => { eq(median([3, 1, 2]), 2); });\n…",
      "properties": "matchesReference('agrees with a sort-based reference', [fc.array(fc.integer())], …);",
      "budgetMs": 1000,
      "params": [{ "name": "numbers", "type": "number[]" }],
      "returns": "number",
      "typeDecls": "…", "pins": [ … ], "decisions": [ … ],
      "calls": [ [[3, 1, 4, 2]] ]
    }
  },
  "datasets": { "<sha256>": [ { "customer": "a", "total": 3 } ] }
}
```

- `calls` (optional, encoded with `shared/serialize.ts`): argument lists handed to the gates as the triggering call
  (`ExecGateInput.callArgs`, first entry), so a spec-less function still gets the Invariants replay the site gives it
  (the site always has the triggering call; without one the gate reports `skipped: never called`, `NEVER_CALLED_NOTE`).
  Not hashed, like the site. `datasets` mirrors recording v2 (`hash → rows`): pins and calls may refer to a dataset by
  hash; a missing hash is exit 3 (the site skips such a pin with a notice; a CI tool must not silently weaken a spec).

- Key = function name. `params`/`returns`/`typeDecls` are optional; when present they must equal what was extracted
  from the source (else exit 3, naming both), because they feed `specHash` and thus the seed. `doc`: the spec file wins
  over JSDoc when both exist (and the CLI says so once). `tests`, `properties`: the site's Test API (`test`, `eq`,
  `throws`, `property`, `matchesReference`, `fc`, with `silentOn`/`reasonable`/`when` markers) — the exact text the site
  hashes. `pins`, `decisions`: the stored shapes, validated by the lifted `vSpec`/`vPins`/`vDecisions`.
- Errors are path-addressed (the existing `bad(path, what)` style): `spec.json: functions.median.budgetMs: expected a
  number`. Unknown top-level keys are an error (typos must not silently weaken a spec).
- Also accepted as `--spec`: a recording (`format: 'undefined-recording'`, validated by `core/generator.ts
  validateRecording`): the last session per function name is the spec; and an **eject folder** (best effort): the
  spec fields from `provenance.json` plus the bodies of `__uDescribe('unit tests', …)` / `__uDescribe('properties', …)`
  / `'your decisions'` extracted from `<name>.test.ts` with the TS parser. Decisions come back as plain tests (the
  folder does not hold `Decision` objects), so the recomputed `testsHash` may differ; the CLI compares with
  `provenance.specHash/testsHash` and says "hashes differ from the ejected artifact: a different seed" when they do.
- Optional later step (not in Phase 4 scope): eject also writes `<name>.undefined.json`. That changes the eject zip and
  `check:eject`; it is a site behaviour change and needs its own decision.

### 3.3 (b) vitest + fast-check test files

Discovery for `src/foo.ts` (first match wins, `--spec` overrides everything): `src/foo.undefined.json`, then
`src/foo.test.ts`, `src/foo.spec.ts`, `src/__tests__/foo.test.ts`, `src/__tests__/foo.spec.ts`. A source file with
several exported functions shares one test file; each `describe`/`it` is attributed to the function(s) it calls
(static: identifiers bound to the imported function names inside the block); a test that calls two exported functions
counts for both (each certification runs it with the other linked as certified callee).

Ingestion = a TS-AST rewrite into Test API source, then the normal gates. Rules:

| vitest / fast-check | becomes | notes |
|---|---|---|
| `import … from 'vitest'`, `'fast-check'`, `'@fast-check/vitest'` | removed; `fc` is the gate's `fc` | |
| `import { median } from './median'` (`as m` → `const m = median;`) | removed; candidate is in scope by name | any other import → exit 3 |
| `describe(name, fn)` | `fn()` runs at registration; names prefix `"name > "` | `describe.each`, `.concurrent`, `.only` → exit 3 |
| `it`/`test(name, fn)` with no `fc.assert` in the body | `test(prefix + name, fn)` (Tests gate) | async fn / returning a promise → exit 3 |
| `it`/`test` whose body calls `fc.assert(fc.property(...arbs, pred), params?)` | `property(prefix + name, [arbs], pred, { numRuns })` (Properties gate); n-th assert in one test → `name #n` | `fc.asyncProperty`, `fc.check`, `params.seed/path/examples` → exit 3 (the gate owns the seed) |
| `test.prop([arbs])(name, pred)` (`@fast-check/vitest`) | `property(name, [arbs], pred)` | |
| `it.skip`, `it.todo` | not run; listed under "skipped by the test file" | counted nowhere in the evidence |
| `beforeEach`, `afterEach`, `beforeAll`, `vi.*`, snapshots, `expect.extend` | exit 3 | |

`expect(x)` shim (in-realm, throws the Test API's `AssertionFailure` with `actual`/`expected`, so diagnostics and
headlines look like the site's): `toBe` (`Object.is`), `toEqual` and `toStrictEqual` (`eq`/`deepEqual`; note: gate
equality is stricter than vitest's `toEqual` about `undefined` properties — documented), `toThrow(match?)`
(`throws`), `toBeCloseTo(n, digits = 2)`, `toBeNaN`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeTruthy`,
`toBeFalsy`, `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`, `toHaveLength`, `toContain`, `toContainEqual`,
`toMatch`, each with `.not`. **Unsupported matchers are found statically** (every `expect(...).<chain>` in the AST is
checked against this list before anything runs) → exit 3 listing file:line of each. As a backstop the `expect`
object is a `Proxy` whose unknown properties throw `UnsupportedMatcher`; the CLI scans failing diagnostics for that
tag and turns the run into exit 3, never a rejection of the code. After rewriting, the generated source is scanned
once more: any surviving `fc.assert`/`fc.check`/`fc.sample` (e.g. in a helper the rewrite could not attribute) is exit
3, because it would run under fast-check's random seed instead of the gate's.

Spec-gap markers in vitest files: a JSDoc tag on the `it`, `/** @silentOn what the median of nothing is
@reasonable Throwing on an empty list is also defensible. */`, becomes the third-argument marker of the generated
`test`/`property` call. vitest itself ignores comments, so the file keeps working unchanged. Without markers, vitest
files never produce exit 2.

The generated Test API source is the `tests`/`properties` that get hashed, so the seed is stable for a given test
file; `--json` includes the generated source so a reviewer can see exactly what ran.

---

## 4. CLI

### 4.1 Surface

```
npx @scasella/undefined certify <file.ts> [--spec <file>] [--json] [--function <name>]… [--budget-ms <n>]
                                          [--no-mutation] [--time-box-ms <n>] [--seed <n>] [--overall-cap-ms <n>]
                                          [--heap-mb <n>] [--quiet]
```

- `--function` (repeatable): certify only these exports (their in-file callees are still certified first).
- `--budget-ms`: override `budgetMs` for functions whose spec does not set it (a spec value always wins; changing it
  changes `specHash`, and the output says so).
- `--seed`: replaces the derived seed (printed as `seed 123 (overridden; the site would use 456)`); for reproducing a
  counterexample, never needed for normal use.
- `--no-mutation`, `--time-box-ms` (default 6000), `--overall-cap-ms` (default 15000), `--heap-mb` (default 256).
- No `--workers`: functions run one after another (mutants already run serially in the site; parallel runs would
  distort the watchdog's wall clock). No network, no config file lookup outside the given paths, no telemetry.

### 4.2 Human output

```
median  src/stats.ts:12  (spec: src/stats.undefined.json, seed -1534081289)
  Compile     ✓ compiled
  Tests       ✓ 4/4 tests passed
  Properties  ✓ 3/3 properties held (300 runs: …)
  Invariants  ✓ pure ✓ bounded ✓ (26 sampled calls replayed on frozen arguments)
  ACCEPTED
  Compiled. 4 tests passed. 3 rules held for 100 random inputs each. 26 calls re-run to look for side effects. Your checks caught 11 of 12 deliberately broken copies.
  survived: src/stats.ts:17 (compiled line 5)  0 → -1   (may be equivalent)
```

The evidence line is `describeEvidence` verbatim (the same sentence the site shows). A rejection prints the gate's
`headline` verbatim, then each diagnostic (compile: `file:line: message` + snippet; test/property: call, expected,
actual, shrunk counterexample, seed; invariant: call, budget, elapsed, phase). A gap prints the question (§4.4).

**Mutant lines.** `MutantInfo.line` is a line of the *compiled JS* body (`mutation/mutate.ts`), not of the TS. The CLI
maps it with a side-channel source map: `ts.transpileModule(buildSource(spec, body).source, { sourceMap: true, target
ES2022 })` (single-file emit, same output as the program emit for these options; verified per run by comparing the
emitted text with `CompileOutput.js` minus the map comment — on mismatch it prints only `compiled line N`). The
mapping never touches `CompileOutput.js`, so mutants, hashes and the site are unaffected.

### 4.3 Exit codes (whole run)

| code | when |
|---|---|
| 0 | every certified function is accepted (including "no tests": accepted with `Compile ✓`, Tests/Properties skipped and the evidence line saying "no tests"; `--json` sets `"unchecked": true`) |
| 1 | at least one function is **rejected** and the rejection is not entirely a spec gap |
| 2 | no rejection of kind 1, and at least one function is rejected **only** by spec gaps: the rejecting gate is Tests or Properties and **every** diagnostic of that gate yields a non-null `decide/gaps.ts gapQuestion` (an applying `silentOn` plus exact `args`/`expectedOutcome`/`actualOutcome`). Questions printed |
| 3 | could not run: no exported function found, unsupported signature or module-scope dependency, spec file invalid, unsupported test-file construct or matcher, spec error in the tests (`note: 'spec error'`, which the site also treats as "not the candidate's fault"), gate worker failed to start, TypeScript not found |

Precedence across functions: 1 > 3 > 2 > 0 (a real rejection is the most important fact; an un-runnable function is
reported but must not mask it). Mixed within one function: a gap and a non-gap failure in the same gate → 1, and the
gap questions are still printed. Invariants, Compile and gate-worker failures are never gaps. Because a failing gate
stops later gates (`DESIGN.md` rule 5), "only gaps" means "only gaps in what ran"; the output says when Properties
was not reached.

### 4.4 Spec gaps in CLI output

For each `GapQuestion`: `The spec didn't say <silentOn>.` / the call / `your tests expect <expectedShown>, the code
<actualShown>` / `reasonable` / the alternatives (`GapQuestion.alternatives` labels) / and the exact test to add for
each choice, from `decide/decisions.ts decisionTest(fn, args, ruling)` — Test API syntax for `undefined-spec` users,
and a vitest rendering (`it('decided: median([]) → NaN', () => { expect(median([])).toBeNaN(); })`, built from the
same `RulingSpec`) when the tests came from a vitest file. Nothing is written to disk: the reviewer decides.

### 4.5 `--json`

One JSON document on stdout (human output suppressed): `{ format: 'undefined-certify', version: 1, tool: { name,
version, node, v8, icu, typescript, fastCheck }, exitCode, functions: { <name>: <provenance> } }` where each
`<provenance>` is **`eject/eject.ts provenance(rec, …)`'s object** (format `undefined-eject` v1 fields: `specHash`,
`testsHash`, `gateSeed`, `returnType`, `spec`, `evidenceLine`, `evidence`, `mutation`, `pins`, `decisions`,
`candidates`), built from a synthetic `FunctionRecord` whose artifact has `model: null`, `codexVersion: null`,
`candidates: [the one certified body, with its gates]`, plus CLI-only keys: `verdict`, `headline`, `gaps`, `source:
{ file, line }`, `mutantLines` (the mapped file lines), `generatedTests` (§3.3). With in-file callees, the document
per root is `closureProvenance`'s version-2 shape (`graph` + `functions`). The site does not change; the CLI reuses its
builder, so the two cannot drift. `ejectedAt` becomes the certification time; it is the only nondeterministic field
besides `ms`/`at` timings, which `--json` keeps (honest) and the parity test ignores.

### 4.6 Packaging

`packages/cli/package.json`: `"name": "@scasella/undefined"` (or the chosen name, §7), `"bin": { "undefined-certify":
"dist/cli.js" }` (so `npx @scasella/undefined certify …` works), `"files": ["dist", "README.md", "LICENSE"]`,
`"engines": { "node": "^20.19.0 || >=22.12.0" }` (same as the root), `"dependencies": { "typescript": "5.9.3" }`,
`fast-check` bundled into `harness.js`, `"license": "MIT"`, `"type": "module"`. `prepublishOnly` = build + tests.
**Not published in this phase.**

### 4.7 Determinism

Same file + same spec → same hashes → same seed → same verdicts and counterexamples, except the timing cases of §2.5.
The CLI prints the seed and the versions; it never claims the code is correct, only which checks it passed.

### 4.8 Neutrality

No generator, no prompt builder (`shared/prompt.ts` stays in the site), no Codex. `suggest/` lives in the engine but
is **not exported** to the CLI/Action surface: its suggestions are property-test source text, and offering them from
a CI tool blurs "certify, don't write". A later `--suggest` flag that only prints them could be argued for; not now.

---

## 5. GitHub Action

### 5.1 `action.yml`

```yaml
name: Undefined certify
description: Certify the TypeScript functions a PR touches. Never generates code.
inputs:
  paths:        { default: 'src/**/*.ts', description: 'globs of source files to consider (.test/.spec/.d.ts excluded)' }
  mode:         { default: 'certify-and-comment', description: 'certify-and-comment | certify | comment (fork-safe split, §5.7)' }
  github-token: { default: '${{ github.token }}' }
  budget-ms:    { required: false }
  mutation:     { default: 'true' }
outputs:
  result-path:  { description: 'JSON of all certifications (the CLI --json document per file)' }
runs: { using: node24, main: dist/index.js }
```

`node24`: GitHub deprecated `node20` for actions in 2025–26; `node24` is the current runtime.

### 5.2 Finding the touched functions

1. Base/head from `$GITHUB_EVENT_PATH` (`pull_request.base.sha`, `pull_request.head.sha`). Requires
   `actions/checkout` with `fetch-depth: 0` (or the Action runs `git fetch --no-tags --depth=1 origin <base>`).
2. `git diff --unified=0 --no-color <merge-base>...<head> -- <paths>` (three-dot: only the PR's own changes), parsed
   for new-side hunk ranges per file; deleted files skipped.
3. Each changed file parsed with the TS parser; an exported function is "touched" when a hunk intersects its range
   (JSDoc through closing brace). A change to a `type`/`interface` it uses, or to its spec/test file, touches it too.
4. Each touched function is certified with the engine (in-process, the Node host of §2.3), with the CLI's ingestion
   and discovery rules. Not-touched callees in the same file are certified as callees (needed for linking) but not
   reported.

### 5.3 The comment

One comment, found by the marker `<!-- undefined-certify -->` (GitHub REST via `fetch`: `GET
/repos/{o}/{r}/issues/{n}/comments?per_page=100` paged, then `PATCH /repos/{o}/{r}/issues/comments/{id}` or `POST
/repos/{o}/{r}/issues/{n}/comments`; `Authorization: Bearer ${token}`, `X-GitHub-Api-Version: 2022-11-28`). No
`@actions/core`/octokit: outputs and logs use the documented `$GITHUB_OUTPUT` file and `::error::` workflow commands.

```markdown
<!-- undefined-certify -->
### Undefined: 3 functions certified at a1b2c3d — 1 rejected, 1 spec gap, 1 accepted
Checked by the gates (compile, tests, properties, invariants) and a mutation check. Nothing was generated. The code
ran in a Node worker_thread with a watchdog; that is not a secure sandbox.

| function | verdict | evidence |
|---|---|---|
| `median` `src/stats.ts:12` | ✅ accepted | Compiled. 4 tests passed. … Your checks caught 11 of 12 deliberately broken copies. |
| `slugify` `src/slug.ts:3` | ❌ rejected by Tests | Rejected: slugify("a--b") returned "a--b", expected "a-b" |
| `clamp` `src/num.ts:8` | ❓ spec gap | The spec didn't say what clamp does when min > max. |
| `lerp` `src/num.ts:20` | ⚠️ unchecked | Compiled. No tests: only Compile ran (no spec or test file found). |

<details><summary>Mutants that survived (may be equivalent)</summary>

- `src/stats.ts:17` (`median`, compiled line 5): `0 → -1`
</details>

#### Decisions for the reviewer
**`clamp(5, 10, 0)`** — the spec didn't say what happens when min > max. Your tests expect `0`; the code returns `10`.
Throwing is also defensible. To decide, add one of these to `src/num.test.ts`:
```ts
it('decided: clamp(5, 10, 0) → 0', () => { expect(clamp(5, 10, 0)).toBe(0); });
it('decided: clamp(5, 10, 0) throws', () => { expect(() => clamp(5, 10, 0)).toThrow(); });
```
```

Comment size is capped at 60 000 characters (GitHub's limit is 65 536); overflow is summarised with a pointer to the
job log and the `result-path` artifact.

### 5.4 Check status

The Action exits non-zero **only** when some function's CLI exit semantics are 1 (rejected). Gaps (2) and could-not-run
(3) are reported in the comment and as `::warning::` annotations at `file:line`, never failing the check. That is the
brief's rule; §9 notes the cost (an un-runnable function passes CI silently unless someone reads the comment) and
offers an opt-in `fail-on: rejection|could-not-run` input defaulting to `rejection`.

### 5.5 What it sends

Exactly the GitHub API calls of §5.3 to `GITHUB_API_URL` with the provided token. No other network access, no
telemetry, no code generation, no model calls. Stated in the README.

### 5.6 Tests

`packages/action/src/*.test.ts` under vitest: diff parsing on fixture patches; function-range intersection on fixture
sources; comment rendering snapshots (exact markdown); the GitHub client against an injected `fetch` fake (create when
no marker comment exists, update when one does, pagination, 403 on fork token → logged, not thrown, check result
unchanged). `action-self-test.yml` runs the built Action on a fixture repo directory inside this repository on every PR
(same-repo only).

### 5.7 Untrusted PR code — the honest part

Certifying a PR **executes the PR's code** (the functions and their tests). The runner isolation is the GitHub runner
VM; the worker/vm/watchdog only bound accidents.

- `pull_request` from a fork: the token is read-only, so the comment cannot be posted; secrets are absent. Safe to
  run, cannot comment.
- **Never** `pull_request_target` with a checkout of the PR head: that runs fork code with a write token and secrets.
  The README says so in bold, with the reason.
- Fork-safe pattern documented and supported by `mode`: workflow A on `pull_request` runs `mode: certify` and
  uploads `result-path` as an artifact; workflow B on `workflow_run` (trusted context, write token) runs `mode:
  comment`, which downloads and validates that JSON and posts it **without checking out or executing any PR code**.
  The JSON is treated as untrusted text (escaped into markdown, size-capped).
- Same-repo PRs can use the default single-job `certify-and-comment`.

### 5.8 Bundling

`dist/index.js` built by `packages/action/vite.config.ts` (§1.5) with `typescript`, `fast-check` and the harness
inlined, committed, and verified in CI by `check:action-dist` (rebuild, `git diff --exit-code`). Publishing to the
Marketplace needs the action at a repository root or a `uses: scasella/undefined/packages/action@v1` path reference;
the latter works without a separate repo.

### 5.9 README (packages/action/README.md)

Usage for both patterns, the inputs, the comment format, the exit policy, and two required statements, verbatim in
substance: (1) "This Action runs the PR's code in a Node `worker_thread` with a watchdog, inside a `node:vm` context
with no Node APIs. That is **not a secure sandbox**: it catches accidental impurity and runaways, not a deliberate
escape. The isolation boundary is the GitHub runner." (2) "No code is generated. Nothing is sent anywhere except the
GitHub API calls that create or update the one comment."

---

## 6. Parity test

**What exists.** Recordings `public/recordings/{median,slugify,fibonacci,orders}.json` hold, per session, the full
`spec` and each attempt's `body`. Session 1 of median/slugify/fibonacci: attempt 0 rejected (median by Properties on
`median([])`, slugify by Tests, fibonacci by Invariants `bounded` on `fibonacci(1000000)` — `scripts/replay-check.mjs
EXPECT`), attempt 1 accepted; session 2 (after "break it") one accepted attempt; orders: spec-less, accepted.
Browser-measured evidence on the committed bodies (`docs/EVIDENCE.md`, `scripts/mutation-check.mjs`): median killed 12
of 12, slugify 1 of 1, fibonacci 11 of 12 with 2 of those stopped by the time limit and 1 survived. The site's
measured values are only partly machine-readable today, so step 5 first makes them a fixture.

**Steps.**

1. `apps/site/scripts/mutation-check.mjs` gains `--json <file>`: for each example and each recorded candidate it
   records from the real UI (production build, headless Chrome, real watchdog): verdict, rejecting gate, headline,
   the evidence line, and the mutation buckets + survivors, **parsed from the rendered text** (the Checks panel's
   `data-verdict`, the headline, *What was checked*, and "See what slipped through", which already lists
   `line N of the compiled code: original → mutated`). A production preview cannot `import('/src/…')` the way the
   dev-mode `compose-sessions.mjs` does, and adding a debug handle to the build would be a site change, so text it
   is. Output committed as
   `packages/cli/test/fixtures/site-measured.json` with the Chrome version and date. It is regenerated whenever the
   recordings change, like EVIDENCE.md.
2. `packages/cli/test/parity.test.ts` (vitest, Node, uses the **built** `dist/cli.js` as a subprocess so the bin, the
   worker, the harness bundle and the lib loading are all exercised): for each session × attempt, write
   `<tmp>/<fn>.ts` = `typeDecls` + `export function <name>(<params>): <returns> {\n<body>\n}` and
   `<tmp>/<fn>.undefined.json` = the session spec plus `calls` (the recording's triggering call, decoded from
   `session.calls`) and `datasets` (orders: the recording's rows), so spec-less orders gets the same Invariants replay
   as in the site; run `certify <tmp>/<fn>.ts --json`.
3. Assertions:
   - `specHash`/`testsHash` equal the recording's (proves the ingestion round-trip and therefore the seed);
   - verdict, rejecting gate and headline equal the fixture exactly (headlines are deterministic: same seed, same
     shrinker, same TS diagnostics);
   - for accepted bodies: the evidence line equal **after normalising the mutation sentence**, and the mutation
     buckets compared as follows: `survived` and the survivor list equal; `killed + killedByBound` equal (a mutant may
     move between these two buckets with machine speed: a mutant that fails a check *and* is slow can be stopped by
     the 1000 ms limit first on one host); `stillborn` equal (pure TS parsing); `skipped` must be absent on both — a
     time-box truncation fails the test with "machine too slow for the 6 s box", it is never accepted as a smaller
     `total`;
   - exit codes: 1 for the rejected attempts, 0 for the accepted ones.
4. Stated allowances (in the test file header and in EVIDENCE.md): only the `killed`/`killedByBound` split may differ,
   and only through watchdog timing; rejections by `bounded` (fibonacci attempt 0) are timing-based but with a margin
   of orders of magnitude; memory limits and stack size (§2.3) are Node-only/approximate and do not affect the shipped
   bodies.
5. CI: `npm run build:cli && npm run check:parity` in the `test` job on Node 20 and 22 (the existing matrix).
   Runtime estimate: 8 sessions, ≈ 14 certifications, mutation on 7 accepted bodies ≤ 6 s each → about a minute.

The existing `core/engine.evidence.test.ts` (Node, `executeGates` directly, **no watchdog**) stays as the fast
in-process check; the parity test is the first Node run with the real watchdog.

---

## 7. npm names (checked 2026-10-05 against registry.npmjs.org; nothing published)

Superseded by [PACKAGES.md](PACKAGES.md), which records the exact commands, the re-check and the decision.

| name | status |
|---|---|
| `@scasella/undefined` | free (404) |
| `@scasella/undefined-cli`, `@scasella/undefined-engine`, `@scasella/undefined-certify`, `@scasella/undefined-action`, `@scasella/certify` | free (404) |
| `undefined-certify`, `undefined-gates`, `certify-ts`, `tscertify`, `fn-certify`, `fncertify`, `certifyfn`, `ucertify`, `toolchain-decides` | free (404) |
| `undefined` (0.1.0), `undefined-cli` (0.0.5), `certify` (0.0.3), `gatecheck` (0.0.1) | taken |

Whether the `@scasella` scope can be published to could not be verified: a scope belongs to the npm user or org of
that name, the user lookup returned 401 without login, `maintainer:scasella` has no packages, and npmjs.com pages are
behind a bot challenge. The owner should confirm with `npm login` + `npm access list packages @scasella` before
anything else. Proposal:

1. **`@scasella/undefined`** with bin `undefined-certify` → `npx @scasella/undefined certify src/stats.ts`. Matches the
   repo name; the scope makes "undefined" unambiguous.
2. **`@scasella/undefined-certify`** with bin `undefined-certify` → `npx @scasella/undefined-certify certify …`
   (reads redundant, but the package name says what it does).

Unscoped fallback if the scope is not available: **`undefined-certify`** (free). The engine stays private (bundled).

---

## 8. Build order (each step leaves everything green; nothing is published)

1. **RESTRUCTURE (pure move). Done; see §10 for how it differs from this paragraph.** `git mv` into `apps/site` and
   `packages/engine` per §1.1; the four splits with re-exports; workspaces, tsconfigs, root vitest projects, delegated scripts, CI/Pages paths, `LibSource` with the
   site's relative glob. No new behaviour, no new dependencies. Gate: `npm test` (same test count as before the
   move), `typecheck`, `build`, `check:csp`, `check:replay`, `check:eject`, golden tests untouched in content, and the
   opening sequence checked by `check:replay`.
2. **ENGINE API.** Extract `certify.ts` (`prepareGates`, `mutationCheck`, `classifyMutant`, `evidenceOf`, `certify`)
   from `core/engine.ts`; the site calls it. Gate: all `core/engine.*.test.ts` unchanged and green.
3. **NODE HOST.** `node/host.ts`, `worker.ts`, `harness.ts` (+ in-realm `structuredClone`), `libs.ts`,
   `gateWorkerCore.ts`; unit tests: nonce forgery ignored, `while(true)` terminated with `bounded`, heap limit → crash
   result, `import('node:fs')` and `.constructor('return process')()` both fail inside the harness, `fetch`/`process`
   absent; `executeGates` results equal between the in-process call and the Node host on the shipped
   good/bad bodies.
4. **CLI.** Ingestion (source, `undefined-spec`, recording, eject folder, vitest shim), output, exit codes, `--json`.
5. **PARITY.** Fixture from the browser (`mutation-check.mjs --json`), parity test, CI.
6. **ACTION.** Diff mapping, comment, fork-safe modes, bundle, mocked-API tests, README.
7. Docs: README section "Use the engine without the site", SECURITY.md Node section, EVIDENCE.md parity note,
   ARCHITECTURE.md layout.

(The brief lists ACTION before PARITY; parity is moved before the Action so the Action ships on an engine already
proven to agree with the site.)

---

## 9. Risks, and where the brief cannot be met as written

1. **"Certify a TypeScript file exporting functions" vs. what the gates certify (biggest product risk).** The gates
   certify self-contained functions with simple typed parameters (no generics, overloads, defaults, rest, async) and
   no module-scope dependencies other than `type`/`interface` and same-file exported functions. Most real-world
   modules violate that somewhere; those functions get exit 3 with a precise reason. Alternative if that rate is too
   high in practice: extend `FunctionSpec` (type parameters, default params) in a separate phase — it changes the
   hashed shape, so it needs the same "append only when non-empty" discipline as `typeDecls`. Recommend measuring the
   exit-3 rate on a few real repos before promising more.
2. **The Node isolation is weaker than the browser's and must be said so.** No CSP equivalent for the network beyond
   "the realm has no APIs"; `node:vm` is explicitly not a security mechanism; worker threads share the process. The
   brief already requires saying so; the design adds the `vm` realm so the claim "no Node APIs, no `import()`" is true
   for accidental use. Running fork PRs is only acceptable on GitHub's disposable runners and with the split
   workflow of §5.7.
3. **Parity of the in-realm `structuredClone` polyfill.** A divergence from the native clone (getters, prototypes,
   sparse arrays, `Error` subclasses) changes what candidates see. Mitigation: property-test the polyfill against the
   native `structuredClone` over `fc.anything()` in Node; the parity test covers the shipped bodies.
4. **Watchdog timing.** The `killed`/`killed-by-bound` split and the 6 s time box depend on machine speed (§2.5,
   §6). The parity test allows exactly the first and refuses the second.
5. **"Same spec format the site uses; eject can round-trip".** Eject's `provenance.json` does not contain the tests,
   so a pure provenance round-trip is impossible without changing the eject output (a site change). The canonical
   format is the site's FunctionSpec JSON; eject folders are accepted best-effort with hash verification (§3.2).
6. **vitest compatibility is a subset.** Async tests, hooks, mocks, snapshots, `fc.asyncProperty`, custom seeds are
   refused (exit 3), loudly. That is a deliberate scope limit: the gates are synchronous and own the seed.
7. **"Fail only on rejection, never on a gap"** means a function the engine *could not run* also never fails CI.
   The brief is followed by default; `fail-on` is offered as opt-in.
8. **Vite root vs. hoisted `node_modules`.** The lib glob and `server.fs.allow` are the one place the restructure can
   silently break the site's compile gate; `check:replay` and the compile tests catch it in step 1.
9. **Scope ownership on npm** is unverified (§7).

Nothing in this design adds a generation path, a backend for the site, environment variables for the static build,
accounts, telemetry or analytics, and nothing changes the shipped examples' specs or recordings.

---

## 10. Step 1 as built (restructure) — where it differs from the text above

Step 1 is done: `git mv` of every tracked file under `src/`, `scripts/`, `server/`, `public/`, plus `index.html`,
`vite.config.ts` and `tsconfig.json`, into `apps/site/` or `packages/engine/src/` (one mapping drove the moves and the
import rewrite; site → engine imports use `@scasella/undefined-engine/<module>`). Measured zero behaviour change: 1482
tests in 80 files (site 1132, engine 350) as before; `check:replay` 19 PASS with the same timings (±20 ms); the
`check:eject` output directory (13 folders, zips, manifest) byte-identical to the pre-move one; the built `index.html`
identical apart from chunk hashes, including the CSP `<meta>`; the opening screenshot byte-identical. Corrections to
§1 and §8, which were wrong or loose:

1. **Not every engine module's test moves with it.** These tests import site modules (`examples`, `core/store`,
   `core/generator`, `shared/prompt`, `sandbox/replCore`, `sandbox/runtime`) and stay in `apps/site/src/<same dir>/`,
   importing the engine through the package: `decide/{decisions,exec,eject.decide}.test.ts`, `suggest/*.test.ts`,
   `mutation/e2e.test.ts`, `compose/sandbox.compose.test.ts`, `shared/specInfo.test.ts`, `eject/eject.test.ts`. The
   engine never imports the site (checked over the whole import graph).
2. **Four splits in step 1, not five.** `prompt.ts` (`declarationLine` → `engine/shared/declaration.ts`, re-exported),
   `spawn.ts` (`newNonce`/`hasNonce` → `engine/sandbox/nonce.ts`, re-exported: so `spawn.ts` is *not* textually
   unchanged, contrary to §1.1; its spawn path is), `compile.ts` (`splitReplLine` → `apps/site/src/core/split.ts`; the
   engine exports `loadTs`; `core/engine.ts` imports the splitter from `./split`), `gateRunner.ts` (engine copy with
   `createWorker` required and `onGate` a required-position `| undefined` parameter; the site shell at the old path
   re-exports everything and supplies `createWorker: opts.createWorker ?? defaultGateWorker`). The `store.ts` →
   `spec/validate.ts` lift has no consumer before the CLI and moves to step 4; the `core/engine.ts` extraction stays
   step 2.
3. **LibSource registration.** `apps/site/src/gates/libs.ts` (the relative glob) is imported for its side effect by
   `core/engine.ts`, not `main.tsx`, and is a `setupFiles` entry of the site's vitest block and of
   `scripts/vitest.{eject,tune}.config.ts`; the engine's own tests read the libs from disk
   (`packages/engine/test/setup-libs.ts`). `server.fs.allow` needed no change: Vite's default already allows the
   workspace root. The glob was verified under vitest, `vite build` (same lib chunks as before) and the dev server.
4. **Package shape.** The engine has `exports: { "./*": "./src/*.ts" }` only; the `"."` barrel arrives with
   `index.ts` in step 2. `typescript` stays `^5.9.3` (the exact pin of §2.6 is a later, deliberate change);
   `apps/site/package.json` carries `vitest`/`fast-check`/`typescript` with the old ranges because
   `scripts/build.eject.ts` writes them into every ejected README. `packages/cli` (`@scasella/undefined`) and
   `packages/action` are `private: true` skeletons with only a `package.json`, so a stray `npm publish` cannot happen.
5. **TypeScript.** `tsconfig.base.json` + `apps/site/tsconfig.json` (today's options) + `packages/engine/tsconfig.json`
   (`lib: ES2022`, `types: []`, host globals declared in `src/env.d.ts`: `performance.now`, `structuredClone`,
   `setInterval`/`clearInterval`, `console`, `crypto.getRandomValues`/`subtle.digest`, `TextEncoder`/`TextDecoder`, and
   a type-only `AbortSignal` for `Generator`) + `packages/engine/tsconfig.test.json` (Node types, `env.d.ts`
   excluded). No source change was needed to pass the strict engine config. Root `typecheck` =
   `tsc -p packages/engine && tsc -p packages/engine/tsconfig.test.json && tsc -p apps/site`.
6. **§1.6 was wrong that every script reads only site-relative paths.** `transcripts.mjs`, `capture.mjs` and
   `social.mjs` write the repository's `docs/` (and `social.mjs` reads a font from the hoisted `node_modules/`); they
   now resolve those from their own location. The scripts that read or write `public/`, `dist/` or `.tmp/` relative
   to the working directory `chdir` to `apps/site` first, and the eject/tune vitest configs set `root` to `apps/site`,
   so `node apps/site/scripts/<x>.mjs` works from the root (the old `node scripts/<x>.mjs` form no longer exists).
   Five tests that read `public/recordings` or `src/` relative to the working directory now resolve from their own
   file, because the root `npm test` runs every project with the repository root as the working directory.
7. **Bundle.** Chunk names unchanged; two chunks changed size: `shared/prompt.ts` moved from the eager `index` chunk
   (−12.3 KB) to the lazily loaded `engine` chunk (+13.6 KB) because `compose/graph.ts` now imports
   `shared/declaration.ts` instead of the prompt builder. The prompt bytes are unchanged (golden tests); nothing in
   the UI uses the prompt before the engine chunk has loaded.

---

## 11. Steps 2–3 as built (engine API, Node host, ingestion) — where they differ from the text above

Built together: the engine API (§1.3), the Node host (§2.3), and the spec ingestion of §3 placed in the engine
(`packages/engine/src/ingest/`) rather than in the CLI, so the CLI and the Action share it in-process. Site behaviour is
unchanged: all site tests, the golden tests, `check:replay` (19 PASS), `check:eject` (13/13) and `check:csp` pass, and the
production bundle contains no Node-only module.

1. **API shape.** `GateHost` is `{ execGates, now }`; the compiler and transpiler are options with the engine's defaults.
   There is no single `prepareGates`: the site calls `specChecks`, `specErrorGates` and `execGateInput` in its existing
   order, because it shows the compile result before the spec check (a merged helper would have removed that state).
   `mutationCheck` is the site's `mutationReport` body verbatim, with a `checkpoint()` callback the site uses to throw its
   own `Aborted`. `classifyMutant`, `infraFailure`, `evidenceOf`, `isUngated` moved to `certify.ts`; `core/engine.ts`
   re-exports the first two. `certifyBody({ spec, body, host })` certifies one body; `certify({ source, spec, host })`
   (`certifyModule.ts`) is the brief's API over a whole file; `node/certifyFile.ts` adds discovery and file reading.
2. **Verdicts.** `accepted | rejected | gaps | could-not-run` (the design's `spec-error` is one kind of could-not-run).
   `gaps` = the rejecting gate is Tests or Properties and every one of its diagnostics yields a `gapQuestion`;
   `exitCodeFor` ranks 1 > 3 > 2 > 0. On the recordings, median's and slugify's first attempts are `gaps` (the site
   shows them as rejections with a Decide card); fibonacci's is `rejected`.
3. **Provenance.** Built by `eject/eject.ts provenance()` for accepted functions only (rejected ones have no artifact to
   describe); `model`/`codexVersion` are `null`, the candidate's `source` is `external`, and `certifiedBy` names the
   tool, Node, V8, ICU, TypeScript and fast-check versions. `types.ts` is unchanged.
4. **Worker entry.** `node/worker.mjs` is plain JavaScript with only `node:` imports (Node 20 cannot load a TS worker).
   The in-realm harness (`sandbox/vmHarness.ts` + `vmPrelude.ts` + `clone.ts`, all under the strict neutral config) is
   bundled on first use with rolldown 1.x, which Vite 8 already installs in the workspace; it is not yet a declared
   dependency of the engine. The CLI step should prebuild `harness.js` and pass `harnessPath`.
5. **Realm stand-ins.** Besides `performance` and the in-realm `structuredClone`, the realm needs `setTimeout` and
   friends: fast-check captures them when it loads. They exist and throw (the gates never use them). `console` is a no-op.
   The context uses `vm.constants.DONT_CONTEXTIFY` where Node has it (22.8+), otherwise a null-prototype sandbox.
6. **Memory and exits.** `GateWorkerPort.onError` gained an optional second argument, `{ kind: 'out-of-memory',
   limitMb }`, sent only by the Node port; the runner turns it into an Invariants `bounded` failure (`outOfMemoryResults`).
   The browser never sends it. An exit nobody asked for is a worker error ("could not run"). Stack is 1 MB as designed;
   the shipped bodies run unchanged with it.
7. **The store lift happened now.** `vSpec`/`vDecisions`/`vPins`/`readDecisions` and their helpers moved verbatim to
   `engine/src/spec/validate.ts`; `core/store.ts` imports them (and still exports `readDecisions`). The error strings are
   unchanged (store tests green).
8. **Ingestion differences.**
   - Type-only imports from relative files are **not** followed yet (exit 3 with the reason), contrary to §3.1.
   - A vitest test that refers to two exported functions is **refused** (exit 3), not run for both: the Test API puts only
     the function under test in scope. Helpers that refer to another function are left out of that function's source.
   - Statements other than `describe`/`it`/`test` inside a `describe` are refused (flattening would change their scope).
   - The `expect` subset is Test API source prepended to every vitest-derived `tests`/`properties` text (`ingest/
     expectShim.ts`, versioned by `SHIM_VERSION`): it is hashed, so changing it changes those seeds. Equality matchers
     produce the site's "returned X, expected Y" headline and can carry a gap question; relational matchers never claim
     a returned value. `toThrow` also accepts an error class or instance.
   - Nothing is certified on a partial spec: any problem in the spec or test file stops every function it covers.
   - Recordings and eject folders as `--spec` are left for the CLI step.
9. **Parity test.** `apps/site/src/examples/parity.node.test.ts` (it needs the site's bundled orders data), through
   `certifyFile` rather than the not-yet-built CLI binary. Browser reference values are inline in the test: the replay
   check's verdicts and the "What was checked" sentences measured with `mutation-check.mjs` on 2026-10-05, compared through
   the site's own `ui/evidence.ts plainEvidence`. Node reproduced them exactly, including the 2 killed-by-bound of
   fibonacci; only the sum is asserted, as §6 allows.
10. Not done in this step: the exact TypeScript pin (§2.6), the CLI binary and its output formats, `check:parity` as a
    separate script (the parity test runs inside `npm test`), the Action.

---

## 12. Step 4 as built (CLI) — where it differs from the text above

`packages/cli` (`@scasella/undefined`, bin `undefined-certify`, still `private: true` so a stray publish cannot happen;
flipping that field is the one change publishing needs once the scope is confirmed, §7). Source: `src/args.ts` (hand
parser), `src/certifyCommand.ts` (reads the files, discovers the spec, starts the Node host, calls the engine's
`certify()`), `src/report/{human,json,gaps}.ts`, `src/mutantLines.ts`, `src/run.ts` (`main(argv, io)` → exit code;
`src/bin.ts` only exits with it). No engine file was edited.

1. **The CLI calls `certify()`, not `certifyFile()`.** `certifyFile` builds `certifiedBy` with
   `require('../../package.json')` and `require('fast-check/package.json')`, which resolve wrongly (or not at all) from
   a bundled `dist/cli.js`. The CLI reuses the engine's exported `discoverSpec`/`refersTo`/`createNodeGateHost` and
   supplies its own `certifiedBy`/`tool` (`name`, `version`, `node`, `v8`, `icu`, `typescript`, `fastCheck`, `host`;
   the package and fast-check versions are injected at build time, read from disk when running from source).
2. **Flags.** Implemented: `--spec`, `--json`, `--function` (repeatable), `--budget-ms`, `--no-mutation`,
   `--time-box-ms`, `--heap-mb`, `--quiet`, `--help`, `--version`. `--seed` and `--overall-cap-ms` have no path through
   `certify()`/`certifyBody()`; they are refused with exit 3 ("not supported yet"), never silently ignored. A usage
   error is exit 3. `--budget-ms` prints one note that it changes the specHash and seed of functions without a budget.
3. **`--json` nests the provenance.** §4.5 merged the CLI keys into `provenance()`'s object; as built each function is
   `{ verdict, source, specHash, testsHash, seed, rejectedBy?, headline?, reason?, unchecked, calls, gates, diagnostics,
   gaps: [{ question, decision }], evidenceLine, evidence, mutation, mutantLines, generatedTests?, skippedByTestFile,
   provenance }`, with `provenance` the unmodified `certifiedProvenance()` object (accepted only, else `null`). Merging
   would collide on `format`, `spec`, `evidence` and `mutation`; nested, it stays comparable key for key with a site
   eject. With in-file callees there is no `closureProvenance` v2 document yet: each function carries its own
   provenance and `calls`.
4. **Mutant lines** are mapped as §4.2 describes (a side-channel `transpileModule` with `sourceMap`, used only when its
   emit equals `CompileOutput.js`; a hand-written VLQ decoder). Expression-bodied arrows print only the compiled line.
5. **Gap questions** print the Test API decision test (`decide/decisions.ts decisionTest`) for `undefined-spec` users
   and a vitest `it(...)` for vitest users, for each selectable alternative; rule-scope (property) rulings are not
   offered on the command line.
6. **Spec formats.** `undefined-spec` and vitest files only. Recordings and eject folders as `--spec` (§3.2) are not
   built: a recording's `calls` are REPL text and would need a literal-only parser to become triggering calls without
   evaluating them; the parity step can write `undefined-spec` files from the recordings as the existing parity test does.
7. **Build.** `scripts/build.mjs`: `vite build` (SSR, `noExternal: true`, `typescript` and `rolldown` external, target
   node20, shebang) → `dist/cli.js`; the engine's `node/worker.mjs` copied verbatim → `dist/worker.mjs`; and
   `dist/harness.js` written by the engine's own `bundleHarness()` loaded through Vite's module runner (so the shipped
   harness is the exact bundle the engine makes on demand; Vite's lib mode is not used for it). At run time the CLI
   passes `harnessPath` when `dist/harness.js` sits next to it, so `rolldown` is never needed by an installed CLI.
   `typescript` is pinned exactly (`5.9.3`, the version the workspace resolves); the engine's own range is unchanged.
8. **Checks.** Root scripts `build:cli` and `check:cli` (the built binary as a subprocess with an empty environment on
   the three examples: exit codes 0/1/2/3, and its `--json` equal to the snapshots the in-process tests write from
   source), both added to the CI `test` job (Node 20 and 22). Root `typecheck` includes
   `tsc -p packages/cli`; root vitest projects include `packages/cli`.

---

## 13. Step 6 as built (GitHub Action) — where it differs from §5

`packages/action`: `action.yml` (node24), `src/` (diff, ranges, touched, certifyTouched, mutantLines, gaps, model,
comment, github, commands, main, host, index), `dist/` (committed bundle), README with both workflows. It calls the
engine API in-process (`certify()` from `certifyModule.ts`, `createNodeGateHost`, `discoverSpec`/`refersTo`); it does
not use the CLI binary or `certifyFile` (whose `certifiedBy()` reads `../../package.json` relative to its own file,
which does not exist next to a bundle). Nothing generates code; the only network calls are the comment's REST calls.

1. **Engine API fix (the only engine change).** `NodeHostOptions.libs?: LibSource` (`node/host.ts`): when given, the host
   registers it instead of calling `useNodeLibs()`, which resolves `typescript/lib` through `node_modules` and so cannot
   work from an Action checkout. The bundle passes the lib `.d.ts` texts it embeds. Default behaviour is unchanged.
2. **Diff base.** `git diff --unified=0 <merge-base(base.sha, HEAD)>` against the working tree, not `base...head`: on
   `pull_request`, actions/checkout checks out the merge commit, and the hunks must describe the files that are
   certified. Untracked files count as added (a local dry run). A shallow checkout fails the step with "use
   `fetch-depth: 0`"; the Action does not fetch.
3. **Touched.** Ranges come from the Action's own AST pass (`src/ranges.ts`: JSDoc through closing brace; overloads as one
   range so the engine can say why it refuses them). A changed `type`/`interface` touches the functions whose extracted
   `typeDecls` declare it; a changed spec/test file touches every exported function of the source it is discovered for.
   Only touched functions are reported; same-file callees are certified for linking only.
4. **Bundle.** `scripts/build.mjs` uses rolldown directly (declared as an exact devDependency, `1.2.12`, the version Vite
   8 already installs), not a Vite lib config: one ESM `dist/index.js` with the engine, `typescript` (plus a
   `__filename`/`__dirname` banner it needs as ESM) and `fast-check` inlined, the 57 lib files of the `lib.es2022`
   closure embedded; `dist/harness.js` built with the same rolldown options as the engine's `bundleHarness()` (a test
   compares them, region comments aside); `dist/worker.mjs` copied; `dist/package.json` `{"type":"module"}`;
   `dist/THIRD-PARTY-LICENSES.txt`. About 9 MB. Reproducible: `check:action-dist` rebuilds into a temporary directory
   and compares every file, in the CI `test` job.
5. **Report and comment.** The comment is rendered only from a validated report (`src/model.ts`), so `mode: comment`
   renders a certify run's JSON through the same code after checking every field and capping every string. All text is
   escaped (no HTML, no marker forgery, no mentions, code spans and fences that content cannot close). Emoji verdict marks
   from §5.3 are plain words. `mode: comment` posts only when the report's head commit equals `workflow_run.head_sha`
   and the PR's current head (the PR number in the report is untrusted).
6. **Gaps as decisions.** vitest specs get an `it(...)` per selectable answer (`toBe` for primitives, i.e. `Object.is`
   like the gate, `toStrictEqual` otherwise, `toThrow` for "throws"), and answers that disagree with the `@silentOn`
   check say to change or remove it, since a new vitest test does not waive it. `undefined-spec` files get a `Decision`
   object for `functions.<fn>.decisions` (`buildDecision`), which waives the check itself; `decidedAt` is the commit time
   so re-runs render the same comment. Tests paste each snippet back and re-certify. Rule-scope (property) rulings are
   not offered.
7. **No changed functions:** no comment is created; an existing one is replaced by a one-line note.
8. **Check policy.** Exit 1 only on a rejection (`fail-on: could-not-run` opts in to more; `gaps` is refused as an
   input). A 403/404 on posting (a fork's read-only token) is a warning and the full comment goes to the step summary.
   Setup errors (no merge base, bad input) fail the step: they are misconfiguration, not a verdict.
9. **Not built:** `action-self-test.yml` (the bundle is exercised by `test/dist.test.ts`, which runs a copy of `dist/`
   with no `node_modules` on a throwaway repository under `npm test`); Marketplace publishing. Only Node 25.8.1 was run
   locally; CI runs the tests and the bundle on Node 20 and 22.


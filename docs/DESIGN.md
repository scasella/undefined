# Undefined — design & module contracts

The model is the *upstream* source of code. The ordinary toolchain (compiler, tests, property checks, invariants)
is the *downstream consumer* that decides what gets accepted. Everything here exists to make that inversion legible.

`src/types.ts` is the shared contract. If you need to change it, say so in your report; do not fork types.

## Ground rules (all modules)

- TypeScript strict. ESM. No new runtime dependencies (preact, @preact/signals, fast-check, typescript 5.9 are installed). Do not edit `package.json`.
- Browser-first: everything under `src/` except `*.test.ts` must run in a browser (or Worker) without Node APIs. `server/` is Node.
- Pure logic is separated from environment glue so it can be unit tested with `vitest` in Node (`npm test`). Browser-only glue (Worker spawning, IndexedDB, DOM) is kept thin.
- The project must keep passing `npx tsc --noEmit`. While other modules are in flight you may see errors in files you do not own; ignore those, fix yours.
- Never claim determinism the model can't provide. The *gates* are deterministic (fixed fast-check seed derived from the hashes); the *model* is not.
- Do not touch files you do not own. Shared contract = `src/types.ts` (read-only for you).

## Data flow of one REPL call

```
Enter → Runtime.evaluate(expr)           (runtime worker; name lookup is a Proxy scope)
  → EvalOutcome.kind==='undefined-call'  (REPL prints "ReferenceError: median is not defined")
  → engine builds/looks up FunctionSpec  (spec from repo, or inferred from real arg values)
  → grow loop, attempt k of maxAttempts:
        prompt = buildPrompt(...)        (shared/prompt.ts)
        Generator.generate(...)          (live: POST /generate → codex exec; replay: recorded candidate)
        typewriter into code pane
        gate 1 compile      gates/compile.ts           (TypeScript compiler, strict, in browser)
        gate 2 tests        ┐
        gate 3 properties   ├ sandbox/gateRunner.ts    (Web Worker, hard timeout, fast-check)
        gate 4 invariants   ┘
        all pass → commit: new Revision, Runtime.define(name, js) (hot swap), re-evaluate the original call
        fail → keep candidate visible in the Attempts strip; diagnostics → next prompt
  → budget exhausted → clean failure, program unchanged, restart options
```

## Gate semantics (decided; implement exactly)

1. **Compile** — `strict: true`, `target ES2022`, `lib: ['es2022']` ONLY (no DOM, no WebWorker lib), no `types`.
   So referencing `window`, `document`, `fetch`, `process` is a real compiler error (TS2304/2584). The candidate is the function *body*; the harness wraps it:
   ```ts
   function median(numbers: number[]): number {
   <body>
   }
   ```
   Line numbers in diagnostics are mapped back to the body (line 1 = first body line). If `returns` is null the wrapper has no return annotation and the inferred return type (from the checker) is recorded on the artifact.
2. **Tests** — user-written unit tests (see Test API). `''` ⇒ gate status `skipped` with note `no tests yet — add one to make the gate stricter`.
3. **Properties** — fast-check. `''` ⇒ `skipped`, same style of note. Fixed seed derived from `specHash`+`testsHash` ⇒ the same candidate always gets the same verdict and the same shrunk counterexample.
4. **Invariants** — *pure* and *bounded*:
   - **pure**: the candidate is evaluated with the dangerous globals masked (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`, `postMessage`, `self`, `globalThis`, `Date` clock, `Math.random`, `performance`, `setTimeout`, …) by shadowing them as parameters of the evaluating `new Function`; any access throws an `InvariantViolation` (a real runtime trap, not a string match). Global writes are caught by snapshotting `Object.getOwnPropertyNames(globalThis)` before/after. After Tests and Properties have run, the Invariants phase replays up to ~25 sampled argument lists (captured during Tests/Properties, plus the triggering call's real arguments) against **deep-frozen** clones, twice each: a mutation of an argument throws under strict mode; two different results ⇒ non-determinism. Compile-time DOM/Node references are already rejected by gate 1.
   - **bounded**: each call to the candidate has `budgetMs` of wall-clock; a worker watchdog on the main thread (enter/leave messages) calls `worker.terminate()` when a call overruns, plus a 15 s overall cap. A termination is the only thing that stops a naive `fibonacci(90)`.
   - **Attribution rule**: an invariant violation observed in *any* phase (Tests, Properties, or the Invariants replay) is reported by the **Invariants** gate. Phases that completed keep their results; the phase that was interrupted becomes `skipped` with note `interrupted: invariant violated`, and later phases are `skipped` too. So naive `fibonacci(90)` reads: Compile ✓, Tests ⏭, Properties ⏭, Invariants ✗ "bounded: fibonacci(90) did not return within 1500 ms".
   - Timeouts leave a diagnostic `{kind:'invariant', invariant:'bounded', call, budgetMs, elapsedMs, phase}`.
5. A gate failure sets later gates to `skipped` (note `not reached`), EXCEPT the attribution rule above. A candidate is `accepted` only if no gate is `fail`.
6. **Headline** (the most important visual): the rejecting gate's one-sentence verdict, built from its first diagnostic:
   - property/test with actual+expected: `Rejected: median([1, 2]) returned 1, expected 1.5`
   - threw: `Rejected: median([]) threw RangeError: …`
   - boolean property returning false: `Rejected: property "result is within min and max" failed for median([5, 5])`
   - compile: `Rejected: line 3: Type 'string' is not assignable to type 'number'`  (TS message, body-relative line)
   - invariant: `Rejected: fibonacci(90) did not return within 1500 ms (bounded)` / `Rejected: candidate read global 'Math.random' (pure)` / `Rejected: candidate mutated its argument (pure)`
   - Errors in the user's own test file (syntax error, throws on load) are NOT the candidate's fault: they surface as `GateResult.status='fail'` with `note:'spec error'` AND the engine aborts the grow loop without burning the budget.

## Values crossing boundaries

- `shared/show.ts` `show(v)`: deterministic display: `[1, 2]`, `"a"`, `1n`→`1n`, `NaN`, `-0`, `undefined`, `Map(1) {"a" => 1}`, cycles `[Circular]`, long values truncated with `…`. `callString('median', [[1,2]])` → `median([1, 2])`.
- `shared/serialize.ts` `encodeValue(v): Json` / `decodeValue(j): unknown`: lossless-ish tagged JSON for bigint, NaN, ±Infinity, -0, undefined, Map, Set, Date, typed arrays excluded (drop with `{"$t":"unserializable","show":"..."}`). Used for env snapshots and the exported image.
- `shared/inferType.ts` `inferType(v): string`: TS type text from a real value. number→`number`, bigint→`bigint`, arrays → `T[]` / `(A | B)[]` / `never[]`→`unknown[]` for empty, plain objects → `{ a: number; b: string }`, null→`null`, undefined→`undefined`, functions → throws `Error('function arguments are not supported')`.

## Test API (what users write in `tests` / `properties`; evaluated in the worker, TS transpiled with `ts.transpileModule`)

Globals in scope: the candidate under test *by its own name* (e.g. `median`), plus

```ts
interface Silence { silentOn?: string; reasonable?: string }                        // see "the spec was silent" below
declare function test(name: string, body: () => void, meta?: Silence): void;
declare function eq(actual: unknown, expected: unknown, message?: string): void;      // deep equality, Object.is for primitives, bigint-safe; throws AssertionFailure{actual,expected}
declare function throws(fn: () => unknown, match?: RegExp | string): void;
declare function property<A extends unknown[]>(name: string, arbs: { [K in keyof A]: Arbitrary<A[K]> }, predicate: (...args: A) => boolean | void, opts?: { numRuns?: number; when?: (...args: A) => boolean } & Silence): void;
declare function matchesReference<A extends unknown[], R>(name: string, arbs: { [K in keyof A]: Arbitrary<A[K]> }, reference: (...args: A) => R, opts?: { numRuns?: number; when?: (...args: A) => boolean } & Silence): void;
declare const fc: typeof import('fast-check');
```

- `property` passes iff the predicate returns anything but `false` and does not throw. On failure, the harness re-runs the predicate on the *shrunk* counterexample with call instrumentation so it can report the exact call, actual and expected (from an `eq` AssertionFailure, or from the reference in `matchesReference`).
- `matchesReference` calls `reference(...args)` and the candidate with deep-cloned args and compares with the same equality as `eq`.
- The candidate handed to tests is an *instrumented wrapper* (records last call/args/result; sends enter/leave to the watchdog; samples arg lists for the Invariants replay).
- **"The spec was silent" markers.** A rejection must say who held the contract. Some checks encode a convention the doc does not state (what the median of `[]` is, whether an apostrophe splits a slug word); the author marks such a check with `silentOn` (completes "The spec didn't say ___", e.g. `"what the median of nothing is"`) and `reasonable` (one sentence on why a different choice is defensible). The marker lives in the check, never as a blanket on a spec, and for properties it is narrowed by `when`, a predicate evaluated on the **shrunk counterexample** arguments (fresh clones) after the failure has been described; it applies only if `when` returns exactly `true` (a throw, or any other value, counts as false; when fast-check reports no counterexample, a conditional marker does not apply). Example:
  ```ts
  matchesReference('agrees with a sort-based reference', [fc.array(fc.integer())], reference, {
    silentOn: 'what the median of nothing is',
    reasonable: 'Throwing on an empty list is a common, defensible choice; so is returning NaN.',
    when: (xs: number[]) => xs.length === 0,   // an even-length bug caught by the same property is NOT labelled silent
  });
  ```
  When a marked check fails and the marker applies, the executor copies `silentOn`/`reasonable` onto that check's `Diagnostic` (`kind: 'test' | 'property'`). Nothing else changes: same verdict, same headline (`Rejected: median([]) threw Error: empty list, expected NaN`), same counterexample; passing checks carry no marker fields. The UI may add "The spec didn't say X. Your tests did." under the headline. Markers are part of the tests source, so they are covered by `testsHash` like everything else there. A malformed marker (non-string or empty `silentOn`/`reasonable`, a non-function `when`, or `when`/`numRuns` on a unit test) is a spec error.
- Test names are found statically by `shared/specInfo.ts` `listTestNames(src)` (a small tokenizer-aware scanner over `test(`/`property(`/`matchesReference(` with a string literal first argument; skips comments and regex literals).

## What the model sees (decided)

The prompt contains: role + hard rules (do NOT run commands, do NOT read/inspect files, return only the JSON object), the TS signature line, the `doc`, the **names** of unit tests and properties (NOT their bodies/reference implementations — the gates know more than the model; that is the point), the *types* of the triggering call's arguments (NOT their values), and on retries the previous attempt's body plus structured diagnostics (file, line, message, span, snippet for compile errors; test name, call, expected vs actual for tests; shrunk counterexample, call, expected vs actual, seed for properties; budget/elapsed/call for invariants) and one-line summaries of earlier rejected attempts. Output contract: JSON `{ "body": string, "notes": string }` where `body` is ONLY the function body (statements between the braces), no signature, no markdown fences.

## Modules and ownership

| Path | Owner task | Exports (contract) |
|---|---|---|
| `src/types.ts` | architect | the contract |
| `src/shared/show.ts` `serialize.ts` `inferType.ts` `hash.ts` `specInfo.ts` | core | `show`, `callString`, `encodeValue`, `decodeValue`, `inferType`, `sha256Hex`, `specHash(spec)`, `testsHash(spec)`, `listTestNames(src)`, `hashesFor(spec): Promise<{specHash,testsHash}>`, `gateSeed(specHash,testsHash): number` |
| `src/shared/prompt.ts` | service | `buildPrompt(input: PromptInput): string`, `formatDiagnosticsForModel(gates: GateResult[]): string`, `declarationLine(spec: FunctionSpec, opts?: {forceInferredReturn?: string}): string` |
| `server/codexService.ts`, `server/codexPlugin.ts` | service | Vite plugin `codexService()` mounting `GET /generate/health` and `POST /generate` (SSE) |
| `src/gates/source.ts` | compile | `buildSource(spec, body): { source: string; bodyStartLine: number }`, `specFromCall(name, argTypes: string[]): FunctionSpec` (params named `arg0..`, returns null) |
| `src/gates/compile.ts` | compile | `compileCandidate(spec, body): Promise<{ gate: GateResult; js: string \| null; source: string; returnType: string }>`, `transpileUserCode(src: string): { js: string; error?: string }`, lazy-loads `typescript` + lib `.d.ts` files |
| `src/sandbox/testApi.ts`, `gateExecutor.ts`, `gateWorker.ts`, `gateRunner.ts` | sandbox-gates | `runExecutionGates(input: ExecGateInput, onGate?: (r: GateResult) => void): Promise<GateResult[]>` (3 results: tests, properties, invariants). `gateExecutor.ts` is the environment-agnostic core usable in Node tests (no Worker/timeout there); `gateWorker.ts` is the thin shell; `gateRunner.ts` owns Worker + watchdog + termination |
| `src/sandbox/mask.ts` | architect (DONE, read it) | `evalMasked(js, exportName)`, `InvariantViolation`, `isInvariantViolation`, `takeViolations()`, `scrubWorkerGlobals(self)`. Both workers use it; the gate executor must check `takeViolations()` after every phase/call because a candidate can swallow the thrown error |
| `src/sandbox/runtimeWorker.ts`, `runtime.ts` | sandbox-runtime | `class Runtime` (below) |
| `src/core/program.ts` | core | pure program/revision operations (below) |
| `src/core/store.ts` | core | IndexedDB persistence + image export/import/validation |
| `src/core/generator.ts` | replay | `LiveGenerator`, `ReplayGenerator`, `createGenerator(...)`, `probeService()`, `GenerationFailure`, `RecordingSink` |
| `src/examples/*.ts` | examples | `EXAMPLES: ExampleDef[]`, `INITIAL_EXAMPLE_ID = 'median'` |
| `src/core/engine.ts` | engine (phase 2) | `createEngine(): Engine` |
| `src/ui/**`, `src/main.tsx`, `src/styles.css` | ui | the app |

### `PromptInput` (shared/prompt.ts)
```ts
export interface PromptInput {
  spec: FunctionSpec;
  /** TS types of the triggering call's args when the spec was inferred from a call (informational). */
  callArgTypes?: string[];
  /** Previous rejected attempts, oldest first. The LAST one is shown in full; earlier ones as one line each. */
  history: Array<{ attempt: number; body: string; gates: GateResult[]; headline?: string }>;
  /** Runtime-fault restart ("retry with the error fed back"): a committed function threw on this call. */
  runtimeFault?: { call: string; errorName: string; message: string; previousBody: string };
}
```

### `ExecGateInput` (sandbox/gateRunner.ts)
```ts
export interface ExecGateInput {
  name: string;
  /** Strict-mode JS from the compile gate (function declaration named `name`). */
  js: string;
  /** Transpiled JS of spec.tests / spec.properties ('' when none). */
  testsJs: string;
  propertiesJs: string;
  budgetMs: number;          // per call
  seed: number;              // gateSeed(specHash, testsHash)
  /** Real args of the triggering call (extra invariant probe). */
  callArgs?: unknown[];
  overallCapMs?: number;     // default 15000
}
```

### `Runtime` (sandbox/runtime.ts)
```ts
export class Runtime {
  constructor(opts?: { callBudgetMs?: number /* default 2000 */ });
  /** Hot-swap: (re)define a committed function in the live worker. No restart, env untouched. */
  define(name: string, js: string): Promise<void>;
  undefine(name: string): Promise<void>;
  /** Evaluate a REPL line. Statements `x = expr` / `const|let|var x = expr` bind REPL variables (live state).
      Name lookup goes through a Proxy `with` scope: committed functions, REPL variables, standard globals. A name in
      call position that is not defined throws an internal UndefinedCall → EvalOutcome 'undefined-call' (args already evaluated).
      Reading an undefined non-call identifier → {kind:'error', errorName:'ReferenceError'}. */
  evaluate(input: string): Promise<EvalOutcome>;
  /** Encoded env (encodeValue per var). */
  snapshotEnv(): Promise<Record<string, Json>>;
  /** Shown values for the UI. */
  envShown(): Promise<Record<string, string>>;
  /** Replace functions + env wholesale (rollback / import / reload). Rebuilds the worker if needed. */
  reset(functions: Record<string, string /*js*/ | { js: string; budgetMs?: number }>, env: Record<string, Json>): Promise<{ lost: string[] }>; // lost = REPL variables that could not be restored
  dispose(): void;
}
```
The worker is long-lived. A call overrunning `callBudgetMs` (or the spec's `budgetMs`, passed per function via `define(name, js, budgetMs?)`) hard-terminates the worker; `Runtime` rebuilds it from its own record of functions + last good env and returns `{kind:'timeout'}`. Committed functions run with the same masked globals as in the gate. When a committed function throws, the thrown error is tagged with the function name and the call string and returned as `{kind:'fault'}`. Re-evaluation after growth is the engine's job; side effects before the undefined call run twice (document it; do not hide it).

### `core/program.ts` (pure)
```ts
export function emptyProgram(): Program;
export async function recordFor(spec: FunctionSpec, artifact?: Artifact | null): Promise<FunctionRecord>; // computes hashes
export function isStale(rec: FunctionRecord): boolean;          // artifact && (hash mismatch)
export function isLive(rec: FunctionRecord): boolean;           // artifact && !stale
export function jsFunctions(p: Program): Record<string, { js: string; budgetMs: number }>; // live artifacts only
export function withSpec(p: Program, spec: FunctionSpec): Promise<Program>;     // add/replace spec, keep artifact (it goes stale if hashes differ)
export function withArtifact(p: Program, name: string, a: Artifact): Program;
export function withoutFunction(p: Program, name: string): Program;
export function summarize(p: Program): { fns: number; artifacts: number };
export function newRevision(history: Revision[], init: Omit<Revision,'id'|'at'> & { at?: number }): Revision; // id = last.id+1
export function rollbackRevision(history: Revision[], target: number): Revision;    // NEW revision, kind 'rollback', restoredFrom=target, copies program+env
export function initialRevision(program: Program): Revision;                         // id 1, kind 'init'
```
### `core/store.ts`
```ts
export interface Persisted { image: Image; flags: { takeawayShown: boolean; openerDismissed: boolean }; liveEnv: Record<string, Json> }
export async function loadPersisted(): Promise<Persisted | null>;      // never throws (IndexedDB unavailable ⇒ null)
export async function appendRevision(rev: Revision, head: number): Promise<void>;
export async function saveFlags(flags: Persisted['flags']): Promise<void>;
export async function saveLiveEnv(env: Record<string, Json>): Promise<void>;
export async function clearAll(): Promise<void>;
export function toImage(revisions: Revision[], head: number): Image;
export function validateImage(raw: unknown): { ok: true; image: Image } | { ok: false; error: string };   // structural validation, hash re-check not required
```
IndexedDB failure (private mode) must degrade to in-memory without throwing.

### `core/generator.ts`
```ts
export class GenerationFailure extends Error { constructor(public info: GenerateError) }
export async function probeService(timeoutMs?: number): Promise<ServiceStatus>;   // GET ./generate/health, 'down' on any failure/non-JSON
export class LiveGenerator implements Generator { /* fetch POST ./generate {prompt}; parse SSE; progress → onProgress; error event → GenerationFailure */ }
export class ReplayGenerator implements Generator {
  constructor(recordings: Recording[], opts: { maxMs: number });
  /** find session by fn+specHash+testsHash; attempts[req.attempt]; plays progress lines with their recorded relative times (scaled/capped); no_recording / recording_exhausted errors carry a fix[] telling how to run live. */
}
export async function loadBundledRecordings(): Promise<Recording[]>;  // fetch('./recordings/index.json') then each file; [] on failure
export class RecordingSink { add(req, result, label, ctx?: { spec, call, datasets, datasetRefs }): void; toRecording(meta): Recording | null }
// Recording v2: each session also carries the full `spec`, the REPL `calls`, and (Phase 3) `datasets`/`datasetRefs`, so a recording
// can be loaded by someone who lacks the spec. v1 files (hashes only) still validate and still replay by hash.
```
All URLs relative (`./generate`) so the static build works from a sub-path.

### Examples (`src/examples`)
```ts
export interface ExampleDef extends ExampleInfo {
  spec: FunctionSpec;              // origin 'example', exampleId set
  breakPatch: SpecPatch;           // applied by "break it"; must change specHash or testsHash and make the old artifact genuinely wrong under the new spec
  /** Known-good candidate bodies (used by unit tests and to prove the gates accept correct work). */
  goodBodies: string[];
  /** Known-bad candidate bodies with the gate that must reject each (used to prove the gates reject for real). */
  badBodies: Array<{ body: string; rejectedBy: GateId; why: string }>;
  /** Known-good body for the broken spec. */
  goodBodiesAfterBreak: string[];
}
```

## Datasets, tables and pins

A dataset is an array of row objects bound to a REPL variable (`rows` by default). Rows are stored once,
content-addressed (`Image.datasets[hash]`); revisions and env snapshots only refer to them.

- **Runtime / replCore.** `bindDataset(name, hash, rows, typeName)` binds the variable to that exact array and registers
  it; `unbindDataset(name)`, `datasets()` (core and `Runtime`). Identity decides: a variable whose value IS (`===`) a
  registered array snapshots as `{"$t":"dataset","name","hash","typeName"}`; an equal copy encodes as an ordinary value
  (a user object with a `$t` key is escaped by serialize.ts, so it can't pass for a ref). Reassigning the dataset's own
  variable (`rows = rows.slice(0, 5)`) unregisters it. `restoreEnv(env, datasets?)` / `reset(functions, env, datasets?)`
  take `hash → rows` (decoded): refs resolve to the SAME array object and re-register; a ref whose hash is missing is
  dropped and reported in `lost` like an unserializable variable. `Runtime` keeps the rows by hash and re-sends them
  on every worker rebuild (timeouts), so bindings survive. Rows stay mutable in the REPL.
- **`value` outcomes.** `encoded` (encodeValue of the result; omitted over 256 KB of UTF-8 JSON). `table` when the
  value is a non-empty array whose elements are all plain objects: columns = union of own keys over the first 100 rows,
  first-seen order, max 30; ≤ 100 rows; cells are `show()` cut to 80 chars, `''` for a missing key, `[Getter]` for
  accessors (never invoked); `total` = full length. `callRecords`: one per call of a committed function made directly
  from the line (not from inside another committed call), in completion order, max 100 per evaluation; arguments are
  captured before the call; an argument that IS a dataset is `{kind:'dataset', name, hash}`, anything else
  `{kind:'value', encoded}` (`encoded: null` when over 256 KB); `result` is null (not pinnable) when it is over
  256 KB or when any argument or the result contains an unserializable value or a function.
- **`undefined-call`.** An argument that IS a dataset is typed `` `${typeName}[]` `` and named in `argDatasets[i]`
  (null elsewhere; the field is present only when some argument is a dataset). `args` still carries the encoded rows.
- **Compile.** `buildSource` prepends `spec.typeDecls` (CRLF normalised, trailing whitespace trimmed) before the
  function; `bodyStartLine` moves down by its line count, so diagnostics stay body-relative. `typeDecls` may contain
  only `type`/`interface` declarations (else a harness error); an error inside them is reported as
  `in the type declarations (typeDecls): …` on line 1. `specFromCall(name, argTypes, { typeDecls })`.
- **Hashes.** `specHash` appends `typeDecls` only when non-empty, so every existing hash is unchanged. Pins are in
  neither hash: pinning invalidates nothing.
- **Prompt.** `PromptInput.dataSamples?: Array<{ name; typeName; rowCount; sampleText? }>`. With `typeDecls` the prompt
  has a TYPES block and shows them in the "compiled exactly as" layout. Per dataset a DATA block: the row count and type,
  then either `sampleText` verbatim or "(The user chose not to share sample rows; only the type is shared.)", and the
  rule that the function must work for ANY rows of that type. Nothing else from the rows ever reaches the prompt.
- **Pins in the gates.** `ExecGateInput.pinned?: Array<{ label; args; expected }>` (decoded; dataset args are the real
  rows). They run in the Tests phase after the user's tests, each as unit test `pinned: <label>` on deep-cloned
  arguments with `eq()` equality; a failure is an ordinary `test` diagnostic (`call` = label, expected/actual/error,
  same headline style). Pins alone make the Tests gate run. Summaries: `4/4 tests passed` (no pins, unchanged),
  `5 unit tests + 2 pinned passed`, `2 pinned passed`, failing `5/7 tests passed (5 unit + 2 pinned)`. Properties:
  `2/2 properties held (150 runs: "a" 100, "b" 50)`. Because pin calls are sampled, the Invariants replay re-runs them
  on frozen clones: an in-place sort of `rows` is rejected and the caller's rows are never touched.
- **Phases.** `ExecGateInput.phases?: Array<'tests'|'properties'|'invariants'>` (default all). The result array holds
  only requested phases, in order, plus an Invariants failure whenever an invariant was violated (attribution rule,
  also for watchdog timeouts in `runExecutionGates`).
- **Evidence.** `evidenceFrom(results)` (sandbox/gateRunner.ts) → `{ unitTests, pinnedTests, properties: [{name, runs}],
  sampledCalls }`, parsed from the summaries above; gates that did not run count 0.

## UI contract

The UI is a pure function of `Engine.state` plus calls on `Engine`. It owns no business logic. Panels, in reading order:
**Console** (the REPL), **Draft** (the code pane), **Checks** (the four gate rows, each with a disclosure for its full
summary, then the verdict card: the rejection card or *Accepted · saved as rN*), **Attempts** (one slim card per draft,
rejected ones kept; hidden until the first draft), then the **Revisions** / **Repo** tabs. The header holds the wordmark,
one mode pill (opens the Run-live dialog) and one **Session** menu (Data, Share, Export/Import image, Load recording,
Session log, Reset).

Visual system: IBM Plex Sans for UI and prose, IBM Plex Mono only for literal code, calls and values, Fraunces only at
display sizes (wordmark, verdict headline, the returned value, revision ids). Panel titles are sentence case; uppercase
is kept for the verdict eyebrow and stamp. Red is the rejection pen only; the blue pencil is focus. The desktop page
scrolls in two columns (console and draft left; checks, verdict and attempts right); below 1100 px it is one column
(console, checks, draft, attempts), and on phones the draft folds to *Show draft (N lines)* except while it streams.
Screen readers hear one `role=status` sentence per verdict.

## Hardening added after adversarial review

- `EvalOutcome` 'undefined-call' carries the encoded argument values; the engine passes them as `ExecGateInput.callArgs`, so a call-origin function's candidate is really executed (frozen-argument replay, masked globals, watchdog). A candidate that was never called yields Invariants `skipped`, never a vacuous pass.
- `mask.ts` verifies intrinsic integrity (`Object.is`, prototypes, `JSON`, `Math`…) via `takeViolations()` and restores them; `Function` is shadowed; `Date` keeps `instanceof` semantics.
- Nested undefined names in arguments are ReferenceErrors, never blamed on a committed function.
- All engine operations that change the program run through one queue; revision ids are assigned at commit.
- Stored/imported artifacts are recompiled from their bodies; their `js` is never trusted.
- The service requires a loopback peer and a same-host Origin on POST /generate.

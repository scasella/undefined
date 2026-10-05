# Phase 3 design: composition and a usable REPL

Status: §A (composition core), §B (REPL) and the UI of §D step 3 are implemented, with the corrections listed in §E,
§F and §G; the live measurements of §C were taken on 2026-10-05 (new harness `scripts/compose-sessions.mjs`
instead of a `--precommit` flag) and are in [COMPOSE-MEASUREMENTS.md](COMPOSE-MEASUREMENTS.md); they changed the
guard wording of §A6. Written against HEAD `4efd1ff`. Every claim about current behaviour
cites the file and function it comes from.

Brief (product owner): generated functions can call other generated functions; the compile gate sees the signatures
of all certified functions; the Invariants gate replays through them; ejecting a function ejects its closure; a
function whose dependency goes stale goes stale too and the Repo says why. REPL lines accept several statements and
destructuring; after a grow, earlier side effects must not run twice: the undefined call's line is evaluated once the
function exists, not the whole input again.

Hard constraints carried from the project rules: tests / typecheck / build / check:replay / check:csp / check:eject
stay green; the opening sequence is untouched; no backend or env vars for the static site; the Codex invocation and the
generation path are unchanged; the shipped examples' specs (`src/examples/*`) are not changed; the shipped recordings
keep replaying; **with zero other committed functions, the prompt bytes equal HEAD** (golden test); no telemetry; the
sandbox is never called a security boundary.

---

## 0. The zero-dependency byte-identity ledger

A program in which no artifact calls another must be indistinguishable from HEAD. Everything new is an *optional
field that is absent* or an *extra input that is empty*:

| what | stays identical when nothing calls anything | how |
|---|---|---|
| `buildPrompt` output | yes, byte for byte | the new OTHER FUNCTIONS section is emitted only when the visible set is non-empty; `PromptInput.others` absent ≡ `[]` |
| `buildSource` output, `Artifact.source`, `bodyStartLine`, compile diagnostics' lines | yes, even WITH other functions | ambient declarations live in a separate root file, never in the candidate file (§A2) |
| compiled `js` | yes | the emit of the candidate file does not depend on the ambient file |
| `specHash` / `testsHash` / `gateSeed` | yes, always | nothing about composition is hashed into the spec (§A3) |
| `ExecGateInput` | yes | `deps` absent when the closure is empty |
| `Artifact` JSON | yes | `deps` absent when the body references no other function |
| `Image.version` | 1 (2 with decisions) | 3 only when some artifact has `deps` (precedent: `store.ts toImage` / `imageHasDecisions`) |
| `Recording` format and replay key | yes, always | keys stay `(fn, specHash, testsHash)` (`generator.ts sessionKey`) |
| REPL evaluation of a one-expression / one-binding line | yes | fast path skips the statement splitter (§B1) |

**Baseline literals (captured at HEAD before any edit, sha256 of the UTF-8 text)** — from a scratch vitest file
outside the repo calling the real `buildPrompt` / `buildSource`:

```
prompt  median                                   74f6806c83c87eb332386bb37a84d0ac63a5ce095d6f008dc80e546f37bf13c3
prompt  slugify                                  8790b07138325d315c4eb7dec29775b0e7e44f155c50a4a59c65cf07950e3bb6
prompt  fibonacci                                ddf6d585b08aedf13126695f27e39b005a21cde1f9be36e10b231695546a0a4d
prompt  specFromCall('slugifyAll',['string[]']),
        callArgTypes ['string[]']                e7d0da9fafadf852167ba741e125a9c14bc8656482031e32f8ecd362732fea80
prompt  specFromCall('topCustomersByRevenue',['Row[]'],{typeDecls:'type Row = { customer: string; total: number }'}),
        callArgTypes ['Row[]'], dataSamples [{name:'rows',typeName:'Row',rowCount:3}]
                                                 d11bf8650599bef87dab16bb69f8a3b9b52ffca04947652ad8afcd0165fe6cbf
source  median   (goodBodies[0])                 78483c39148bd131dd16a5e6608335b306700a3ff8cd991ae2714727c220bb6c
source  slugify  (goodBodies[0])                 b550e7f831169b6202f816840d91743b91e1f35a623a98c5678fcc7a56e0f2df
source  fibonacci(goodBodies[0])                 8f3c387ac0ff83abe8814a5ac0316f6ecb85fdfe0bcb2b361b1aa7edf36ad572
```

Step 0 of the build order (§D) turns these into `src/compose/golden.test.ts` and adds the retry-history, runtime-fault,
decisions and ruling variants (captured from the same HEAD build before the prompt module is touched; `prompt.test.ts`
fixtures at lines 100–196 are the inputs), plus: `buildPrompt({…, others: []})` equals `buildPrompt({…})`, and the
string `OTHER FUNCTIONS` is absent.

---

## A. Composition

### A1. How a body refers to another committed function today

It cannot. Each artifact is compiled alone and evaluated alone:

- **Compile**: `gates/compile.ts compileCandidate` builds a `ts.Program` with exactly one root, `/candidate.ts`
  (`createHost` knows `CANDIDATE_FILE` and the ES2022 libs only). A call to `slugify` from another body is TS2304
  "Cannot find name".
- **Gate worker**: `sandbox/gateExecutor.ts executeGates` evaluates the candidate with `mask.ts evalMasked(js, name)`
  = `new Function(...MASKED_NAMES, js + 'return name')`. A free identifier resolves to the worker global and is a
  ReferenceError. Test code (`testApi.ts registerCases`) sees the API names, the trapped names and the candidate.
- **Runtime worker**: `replCore.ts ReplCore.define` also uses `evalMasked`; committed functions are reachable only
  through the REPL scope Proxy (`makeScope`), never from inside each other. The header says so ("Committed functions
  cannot see each other").

Self-recursion works because the declaration name is in scope inside the function (`evalMasked`'s comment).

### A2. Compile gate: what a candidate may call

**The visible set for `f`** (new pure module `src/compose/graph.ts`, `visibleFor(program, fnSpec)`), sorted by name
so the prompt is stable:

- every function `g ≠ f` that is **runnable**: own-live (`program.ts isLive`) **and** dependency-current (§A4);
- minus any `g` that (transitively, through recorded `Artifact.deps`) calls `f` — that would make a cycle;
- minus any `g` whose name equals one of `f`'s parameter names (the parameter would shadow it);
- minus any `g` whose declaration does not compile on its own or whose types clash with `f`'s (below).

Uncertified, declined, stale, waiting (§A4) functions are not visible. Declined calls never commit, so they have no
record to be visible from.

**Ambient declarations go in a second root file**, `/others.d.ts`, never into `/candidate.ts`:

```ts
// /others.d.ts (generated; script, not module, so the names are global)
type Row = { customer: string; total: number };          // g's typeDecls, deduplicated
declare function slugify(title: string): string;
declare function topCustomersByRevenue(arg0: Row[]): { customer: string; revenue: number }[];
```

- The declaration line is `declarationLine(g.spec, { forceInferredReturn: g.artifact.returnType })`
  (`shared/prompt.ts`), because `Artifact.source` lacks the inferred return when `returns` is null. A `returnType` of
  `''` excludes `g`.
- Each `g`'s `typeDecls` are included once; identical declaration text from several functions is deduplicated; a
  same-named type with different text in `f`'s own `typeDecls` or in another visible function excludes the later `g`
  ("its types clash with this function's"). Types and values live in different TS namespaces, so a type named like a
  function is not a clash.
- `lib: ['lib.es2022.d.ts']`, `types: []` unchanged.
- `createHost` learns the extra file in `getSourceFile`, `fileExists` and `readFile`; `createProgram([CANDIDATE_FILE,
  OTHERS_FILE])` only when the visible set is non-empty, so a zero-others compile is the same program as today.
- **Validate the ambient file alone first** (one cached compile per distinct ambient text). The diagnostic loop in
  `compileCandidate` maps `d.file !== file` to `start: undefined` → body line 1; an error that originates in the ambient
  file would be blamed on the candidate. Any `g` whose declaration fails alone is dropped from the visible set.

**Dependency extraction** (in `compileCandidate`, which already has the program and checker): walk the wrapper's
function body; for every `Identifier` in an expression position, `checker.getSymbolAtLocation(id)`; if one of its
declarations is in `/others.d.ts`, the name is a dependency. This counts value uses (`titles.map(slugify)` is the
likely shape for `slugifyAll`), respects local shadowing (`const slugify = …` inside the body resolves locally), and
ignores strings and comments. `CompileOutput` gains `deps: string[]` (sorted, empty when none).

**Cycles are rejected with a clear message.** Harness diagnostics (code 0, already used by `shapeProblems` /
`moduleProblems`) are emitted first so the headline names the root cause: for each identifier in the body that names
a function in the program that is *not* visible, say why, e.g.

- `Rejected: line 2: uniqueSlugs calls slugifyAll, which already calls uniqueSlugs (slugifyAll → uniqueSlugs): generated functions cannot call each other in a cycle.`
- `… slugify is out of date (its spec changed at r9), so it cannot be called until it is regrown.`
- `… slugify's types clash with this function's (both declare Row, differently).`

A name that is not in the program at all stays tsc's TS2304. Mutual recursion (`isEven`/`isOdd`) is therefore not
supported; say so in the docs.

### A3. The dependency graph: what is recorded, where

- **Artifact identity for dependents**: `implHash(g) = sha256(g.artifact.source + '\u0000' + g.artifact.returnType)`.
  `source` is typeDecls + signature + body (`gates/source.ts buildSource`), regenerated deterministically by
  `recompileArtifacts`; `returnType` covers an inferred return. It changes when the body or signature changes, and
  NOT when `g` is re-certified in place against stronger checks (`engine.ts recertify` keeps the body; a decision or
  suggested property changes only `testsHash`), nor when its mutation report is attached. Dependents therefore do not
  churn when `g`'s tests get stronger, which is right: `f`'s behaviour depends on `g`'s code, not `g`'s tests.
- **Recorded on the dependent's artifact**: `Artifact.deps?: Record<string, { hash: Hash; revision: number }>` — the
  direct dependencies, each `closureHash` (= `implHash` for a callee that calls nothing; see §H1) and the revision `g`'s artifact was committed in, at `f`'s certification
  (`commit`, `recertify`). Absent when empty. Transitive closure is derived by walking `deps`.
- **Not hashed into `f`'s spec**: `specHash`/`testsHash` describe the user's contract; mixing in dependency hashes would
  change replay keys whenever any other function changes and break shipped recordings. Staleness through dependencies
  is a separate, derived status (§A4).
- **Tests do not see other functions** (decision). `registerCases` keeps binding only the API and the candidate.
  Reasons: `testsHash` then fully captures what the checks say; a dependency change can only affect `f`'s verdict
  through `f`'s body, which `deps` tracks; the ejected `.test.ts` stays self-contained per function. A test that names
  `g` fails with `ReferenceError: g is not defined`, which is honest; the spec editor can warn when a test names a
  program function.
- **Storage**: IndexedDB stores revisions as they are; `Image` version 3 when any revision holds an artifact with
  `deps` (older builds refuse it rather than load a composed function they cannot link — same reasoning as decisions
  → 2). `store.ts validateImage` validates `deps` (identifier keys, 64-hex hash, integer revision) and accepts
  versions 1–3; `version === 1 || 2` with deps is an error. Recordings carry specs, not artifacts: unchanged.

### A4. Staleness through dependencies

Today "stale" is one thing: `program.ts isStale(rec)` = artifact hashes ≠ record hashes; `jsFunctions` runs only
`isLive` artifacts; `applySpec` undefines an invalidated function and the next call regrows it.

Phase 3 adds a **derived** dependency status (never stored; any revision is self-consistent by construction, so
rollback and import need no repair). `graph.ts depStatus(program, fn)`:

| status | definition | runs in the REPL? | Repo says |
|---|---|---|---|
| `current` | every direct dep is runnable and its `implHash` equals the recorded one | yes | `calls slugify (r4)` |
| `changed` | every dep is own-live, but some dep's `implHash` differs from the recorded one (dep was regrown, rolled to a different artifact, decided-and-regrown) | **no** (excluded from `jsFunctions`: it would run uncertified code) | `Out of date: calls slugify, which changed at r9 (certified against r4, 3fa1c2… → 9c0e71…). The next call re-checks it with the new slugify, and regrows it only if that fails.` |
| `waiting` | some dep (directly or transitively) has no runnable artifact (spec edited, broken, regrowing) | yes, but reaching the dep signals "not defined" (below) | `Waiting for slugify: its spec changed at r9 and it has no current code. slugifyAll's own code is unchanged; the next call that reaches slugify grows it, then slugifyAll is re-checked with it.` |

`isRunnable(rec, program) = isLive(rec) && depStatus ∈ {current}`; `jsFunctions` includes `current` and `waiting`
functions, excludes `changed`. The Repo's `select.ts functionStatus(rec)` becomes `functionStatus(rec, program)`.

**Re-check in place, eagerly, then lazily.** After any operation that changes a function's `implHash`
(`commit`, a `recheckAgainst` that recompiled to different source, `applySpec` revalidation), the engine runs
`settleDependents(fn)` inside the same `exclusive` operation, before a REPL line resumes: every transitive dependent in
`changed` status, in topological order, goes through the existing re-check path (`recheckAgainst`'s compile + gates
with the new closure, no model). Pass → `recertify` revision ("slugifyAll re-certified: slugify changed r4 → r9; the
same body passes with it"), `deps` restamped, mutation re-queued (`recertify` already calls `enqueueMutation`). Fail →
no revision, the function stays `changed`, the gate panel shows the re-check as a `kind: 'recheck'` view (as today),
and an info line says the next call regrows it. Lazily: a REPL call to a `changed` function is an undefined call
(it is not in the runtime); `runInput` sees a record whose own hashes match and whose status is `changed`, re-checks
first (one gate run), and grows only if that fails. Within one REPL line a re-check that already failed (for example
the eager one just after its callee grew) is not run or reported a second time when the re-run statement reaches the
function: it goes straight to the regrow. A later line re-checks again. The regrow uses the ordinary prompt; it is not told why (adding a
"your dependency changed" section is possible later and would be another prompt change to measure).

This departs from the brief's literal "goes stale too": a dependent whose re-check passes is re-certified, not stale.
It is still never *run* uncertified, and the Repo shows every intermediate state with its reason.

**A REPL call to a `waiting` function** reaches the missing dependency at runtime and turns into an ordinary
undefined call **of the dependency, with its real arguments** (§A5 runtime). The engine grows `slugify` with its spec
and those arguments as the Invariants probe, commits, `settleDependents` re-checks `slugifyAll`, and the REPL statement
resumes (§B2). Bounded by `MAX_GROWTHS_PER_SUBMIT` (5) as today.

**Deleting a function** has no engine API today (`'delete'` exists in `RevisionKind` but nothing produces it). If one
is added, it must refuse while dependents exist. A recording that *replaces* `g`'s spec (`RecordingPreview status
'replaces'`) makes `g` stale and dependents `waiting`; the preview should list them.

### A5. Runtime and gates: making `g` available

**`mask.ts evalMasked(js, exportName, bindings?)`**: with `bindings` absent the factory is exactly today's
`new Function(...names, …)`; with bindings, their names are appended as extra parameters. Binding names can never be
masked names (`engine.ts notGrowableReason` refuses those), asserted anyway.

**Gate worker** (Tests, Properties, Invariants, mutation runs, the Decide probe):
`ExecGateInput.deps?: Array<{ name: string; js: string; deps: string[] }>` — the candidate's transitive closure, in
topological order, each dep's **certified** `artifact.js` as committed at gate time (the head program, which is what
`compileCandidate` saw). `executeGates` links them once: each dep is `evalMasked(dep.js, dep.name, <its already-linked
deps>)`, then the candidate with its direct deps. Consequences:

- **Purity is judged for the whole call tree**: deps run under the same mask in the same realm, so a trap a dep
  touches lands in `takeViolations()` after the candidate's call and rejects the candidate. The diagnostic adds which
  function touched it (a light per-dep wrapper keeps a "current dep" stack): `pure: candidate used Math.random (inside
  rngFromSeed, called by shuffleWith)`. A certified dep can still be impure on inputs its own checks never reached;
  then the composite is rejected, and the message names both.
- **Frozen-argument replay and determinism** replay `f` twice on deep-frozen clones (`executeGates` Invariants
  phase); `g` runs inside, so `g` mutating a frozen argument that `f` passed through is a TypeError in the replay →
  `f` "mutated its argument", and `g` being non-deterministic makes `f` non-deterministic. Both are true of `f`.
- **`budgetMs` per call includes callees**: deps are not wrapped by the instrumented `wrapper`, so they emit no
  enter/leave; `gateRunner.ts Watchdog` already times the outermost in-flight call. `g`'s own `budgetMs` is not
  enforced while `f` calls it (document it).
- **Mutation**: `mutationReport` mutates `artifact.js` of `f` only (`mutation/mutate.ts` works on the JS it is given)
  and passes the same `deps` to every mutant run and to the baseline. `g` is never mutated.
- Deps are not sampled for the Invariants replay (sampling is in `wrapper`, which only the candidate has).

**Runtime worker**: `RuntimeRequest.define` and `reset` carry `deps?: string[]`; `ReplCore.define(name, js, deps)`
binds each dep to a **late-bound stub**: `(...a) => core.callDep(dep, a)`, which looks up `this.functions.get(dep)` at
call time.

- Found → calls the dep's wrapper (so faults are tagged by the innermost function, as `wrap` already does).
- Missing (the `waiting` case) → records `pendingUndefined = { name, args }` and throws the existing
  `UndefinedCallSignal`. `wrap` must re-throw `UndefinedCallSignal` untouched instead of tagging it as a
  `CommittedFault`; and because a body can swallow it in `try/catch`, `evaluate` checks `pendingUndefined` after the
  line finishes, the same way `takeViolations()` survives a swallowed trap. The outcome is `undefined-call` for the
  dependency with its real arguments; `call` reads `slugify("Crème") (called by slugifyAll)`.
- Late binding plus `jsFunctions` excluding `changed` functions means a dependent never runs against a dependency it was
  not certified with. Within one `exclusive` operation the engine must undefine `changed` dependents before (or in the
  same step as) `define(g)`; a `syncRuntime(program)` helper that diffs `jsFunctions` against what the runtime holds
  does both.
- **Watchdog fix**: `wrap` fires `hooks.onEnter/onLeave` only at `depth === 0`. Today every wrapped call fires them and
  `runtime.ts evaluateWithWatchdog`'s `enter` replaces `callTimer` with the entered function's budget and `leave` clears
  it, so a nested call would cancel the outer budget. With the fix, `f`'s budget covers `g`, matching the gate.
- `calls` (the "cached artifact" label) and `callRecords` (pins: `depth === 0` only) are unchanged.
- A fault inside `g` called from `f` is reported for `g` (innermost), with `called from f(…)` in the message;
  "Retry with the error fed back" regrows `g`. This is a judgement call (the caller may have violated `g`'s contract);
  noted as a risk.

### A6. Prompt

New optional `PromptInput.others?: Array<{ decl: string; doc: string }>`; the section is emitted **only when it is
non-empty**, right after FUNCTION (and TYPES):

```
OTHER FUNCTIONS (already certified in this program; you may call them by name; do not redeclare them)
- function slugify(title: string): string
  Turns a title into a URL slug.
Calling one is optional. It runs under the same purity and time limits, and its time counts toward yours.
Calling them does not make an impure task pure: if this function needs fresh randomness, the time, the network, files
or state between calls, decline as described under HONESTY even when a listed function looks related (a constant seed
is faking it). A listed function does not give a meaningless name a meaning: the NEEDS_SPEC rule still applies.
```

- *As shipped, the two guard sentences differ from this first draft:* the draft's impurity sentence made the model
  decline `hello()` (1 of 10 written against 8 of 10 without the section), so it was replaced by "A listed function does
  not give a meaningless name a meaning: the NEEDS_SPEC rule still applies. A seed you pick yourself is not fresh
  randomness: …". Variants and numbers: [COMPOSE-MEASUREMENTS.md](COMPOSE-MEASUREMENTS.md) §2.
- The doc is the first sentence of `g.spec.doc`, cut at 160 characters, single line; `(no doc)` when empty. Types used
  in the signatures are printed once above the list, like TYPES. The HONESTY section text is untouched; the two
  sentences that guard calibration live in the new section, so they exist only when others exist.
- The prompt also changes for programs with other committed functions in every grow (call-origin, examples, retries).
  That is a prompt change to measure (§C).
- `history`, `runtimeFault` and `ruling` sections are unchanged. Compile diagnostics in them can now mention other
  functions (e.g. a type error calling `slugify` with a number); they are ordinary tsc text.

### A7. Eject the closure

`eject.ts ejectFiles` already takes `functions: FunctionRecord[]` and throws on `rest.length > 0`. Phase 3:

- The caller passes `[f, ...closure]` (topological). `ejectBlocker` checks every member: own-live, dep status
  `current` ("slugify, which slugifyAll calls, is out of date: …").
- Folder `<f>-eject/`, per function `<name>.ts` and `<name>.test.ts`. `functionFile` adds
  `import { slugify } from './slugify';` for each direct dep (and `import type` for dep types its signature uses;
  `exportedDecls` already exports typeDecls). Each `.test.ts` runs that function's own checks against the real deps.
- One `provenance.json`: with a single function it stays `version: 1` and byte-identical to today's shape; with a
  closure, `version: 2`, `root: "slugifyAll"`, `functions: { <name>: <today's per-function provenance> }`, and
  `graph: { slugifyAll: { slugify: { hash, revision } } }` (the recorded `Artifact.deps`).
- README lists the closure and says each function's checks run against the real ones it calls; the Invariants gate is
  still not reproduced.
- `scripts/eject-check.mjs` + `scripts/build.eject.ts`: a **test-only composed fixture** (not a shipped example, so no
  spec in `src/examples/*` changes): `slugify` with its example spec and `goodBodies[0]`, plus a fixture `slugifyAll`
  spec with tests whose body is `return titles.map(slugify);`, certified through the real compile gate and gate
  executor in `build.eject.ts`, ejected, then `vitest run` + strict `tsc` in the fresh project like every other row.

### A8. Replay and recordings

- Keys stay `(fn, specHash, testsHash)`; the shipped recordings (all recorded with no other functions) keep matching,
  and `golden.test.ts`'s RECORDED table is unchanged.
- A recorded candidate for `slugifyAll` that calls `slugify` replays in a program without `slugify`: the compile gate
  rejects it (TS2304, or the harness "out of date" line) — honest, and it consumes a recorded attempt; when the
  attempts run out, `recording_exhausted` says how to run live.
- A recording made with no others replays fine in a program that has others (its candidates simply do not call them).
  "What the model saw" shows the recorded prompt (`generator.ts recordedPrompt`), so it truthfully lacks the OTHER
  FUNCTIONS section.
- A new composed recording (e.g. `compose.json`, slugify then slugifyAll) is optional; if shipped, `golden.test.ts`'s
  file list and RECORDED table must be extended (not changed), and `replay-check.mjs` gets a row that commits slugify
  first.

---

## B. REPL

### B1. How a line is evaluated today

- The console is a single-line `<input>` (`ui/components/Repl.tsx`), so several statements means `;`-separated on one
  line. That stays.
- `replCore.ts evaluate`: trims, strips trailing `;`, matches `BIND_DECL` (`const|let|var <ident> = …`) or
  `BIND_ASSIGN` (`<ident> = …`), and runs the expression through `run()` = `with (__scope) { return (function () {
  "use strict"; return (<expr>\n); }).call(undefined); }`. A binding assigns the value (`assign`).
- **Destructuring assignment already works** and nothing documents it: inside `return (…)`, `[x, y] = pair` and
  `{a, b: bb = 9, ...rest} = obj` are assignment expressions whose targets go through the Proxy `set` trap → `assign`.
  Verified with a `node -e` reproduction of the `with` + Proxy scope (x=1, y=2, a=3, bb=4, rest={c:5}). What fails is a
  **declaration** with a pattern (`const {a, b} = obj` matches neither regex → SyntaxError), multiple declarators, and
  more than one statement (`syntaxErrorMessage`: "this parses only as statements").
- Undefined call: the thunk throws `UndefinedCallSignal` after the arguments are evaluated → `{kind:'undefined-call'}`.
  `engine.ts runInput` grows the function and re-evaluates **the whole input** (`for (;;) runtime.evaluate(input)`).
  Restarts re-run the whole input too (`invokeRestart` → `runInput(ctx.input)`).

### B2. Design: statements as units, one request per unit, resume at the failing unit

**Splitting (main thread, `src/shared/replSplit.ts`).**

- **Fast path, byte-for-byte today's path**: a cheap scan (strings, template literals, comments, brackets; the same
  kind of scanner as `replCore.ts unclosed`) finds no top-level `;`, and the line does not start with
  `const|let|var` followed by `{`/`[`, nor with a statement keyword (`if for while do try switch {`). Then
  `units = [input]` and evaluation is exactly HEAD's. The opener (`median([3, 1, 4, 2])`) takes this path, so its first
  Enter never waits for the compiler (`warmUp` is fired at init but not awaited, `engine.ts` ~1242).
- **Otherwise**: await the compile toolchain (already warming) and parse with
  `ts.createSourceFile('repl.js', input, ES2022, true, ScriptKind.JS)` — parse only, no type checking; parse errors
  become the REPL's SyntaxError with the position. A false positive of the scan (`/;/.test(s)`) only costs the parse.
- Each top-level statement becomes one or more **units**:
  - expression statement → `{ kind: 'expr', text }`
  - `const|let|var` declaration → one unit per declarator, rewritten as an assignment expression:
    `x = (init)` (kept on the existing `BIND_ASSIGN` path) or `(<pattern> = (init))` for a pattern; `let x;` →
    `x = undefined`. Declarations bind REPL variables exactly as `x = …` does today; `const` is not enforced (today's
    behaviour, documented).
  - `if`, `for`, `for…of`, `while`, `do`, block, `try`, `switch` → `{ kind: 'stmt', text }`, run for their effect
    (value `undefined`) as `with (__scope) { (function () { "use strict"; <stmt> }).call(undefined); }`. Assignments
    inside reach REPL variables through the scope; `let`/`var` declared inside them are local to that statement.
  - Refused with a plain message: function and class declarations ("functions here are grown by calling them"),
    `import`/`export`, top-level `return`/`await`.
- `ReplCore.evaluate(input, { mode: 'stmt' })` is the only new runtime mode; `expr` units go through today's
  `evaluate`.

**Executing (engine, `runInput`).** For `k = 0 … n-1`: `runtime.evaluate(units[k])`, one request per unit.

- `value` → next unit. Only the **last** unit's value is shown (with its table); a `stmt` last unit shows `undefined`.
- `undefined-call` → grow (as today), then evaluate **unit k again**. Units `< k` are never run again.
- `error` / `fault` / `timeout` → stop; later units do not run; the message says `statement k+1 of n` when `n > 1`.
- One request per unit means every reply checkpoints the env (`runtime.ts` keeps the last reply's env as the "last good
  env"), so a timeout kills and rebuilds only back to the start of the failing unit, not the whole line; the timeout
  message stays honest ("the program was restored to before statement 3"). Each unit gets the full `callBudgetMs`.
- `RestartContext` gains `units` and `from`; `invokeRestart` resumes at `from` instead of `runInput(ctx.input)`.
- `isArrayCallbackCall(name, args, src)` and `datasetNamed(src)` receive the unit's text.

**What still re-runs, precisely**: the failing unit itself, from its start. Side effects earlier *in that same
statement* run again: `(n = n + 1, median(xs))` increments twice; `for (…) total += f(i)` re-runs the iterations that
completed before `f` was found undefined. Two undefined functions in *different* statements grow in order as each is
reached. Two in the *same* statement (`f(g(1))`) grow one after the other, re-running that statement after each grow
(innermost first, because arguments are evaluated first). After a grow in a multi-statement line the REPL prints
*Re-ran statement 2 of 3 from its start; statement 1 was not run again.* (`engine.ts rerunText`). JavaScript cannot resume in the middle of an expression; this is the
smallest re-run a split by statements can give.

### B3. Undefined calls from inside a generated function

With A5, the only way a committed body reaches a name that does not exist is a dependency that is no longer runnable
(the `waiting` status): the compile gate admits only visible names, and test code sees none. The late-bound stub turns
that into an undefined call of the dependency with its real arguments, attributed as `(called by f)`; the engine grows
the dependency, `settleDependents` re-checks `f`, and the **statement containing the call to `f`** re-runs (B2). A
`changed` dependent is not in the runtime at all, so calling it is an undefined call of the dependent itself (re-check
first, regrow on failure, A4).

### B4. Results, history, pins, hints

- **Pin as test**: `callRecords` are reset per unit, and `pinnableOf` sees only the last unit's records. `b = f(a); b + 1`
  offers nothing to pin; `a = 1; f(a)` pins `f(1)` (the arguments are the real values, so the label reads `f(1)`).
- **History** (`inputHistory`, ↑/↓) keeps whole lines. Recordings' `calls` keep whole lines; pre-typing works unchanged.
- **Opener and placeholder** unchanged (opening sequence intact). The keyboard popover and FEATURES.md gain one line:
  "Several statements: separate them with `;`. After a function grows, only the statement that called it runs again."
- **Session log** logs the whole line, as now.

### B5. Limits kept, documented honestly

Single-line input; the failing statement re-runs from its start; `const` is not enforced; `let x;` / `var x;` bind
`undefined` even when `x` already holds a value (JS keeps it for `var`; the thunk scope cannot tell "unbound" apart); declarations inside blocks
are local; no function/class declarations; `typeof undefinedName` is still `'function'` (Proxy limit in the header);
an undefined name inside a value is a plain ReferenceError; `MAX_GROWTHS_PER_SUBMIT = 5` per line; each unit has its own
3 s line budget. README's "REPL lines are one expression or one binding … run twice" bullet is rewritten to say this.

---

## C. Measurement protocol

1. **Prompt bytes, zero others** (no live cost): the golden test of §0, failing on any byte change; plus
   `compileCandidate` source/js identical with zero others; `toImage` of a zero-dep program identical (version 1);
   `ExecGateInput` from `runGates` has no `deps` key.
2. **Prompt change with others present, on the examples** (`scripts/sessions.mjs` gains `--precommit=<id>`: commit that
   example from its shipped recording first, in replay, so it costs nothing; then run the target example live).
   8 full sessions each for `median` after `slugify`, `slugify` after `median`, `fibonacci` after `median`, and
   `topCustomersByRevenue(rows)` after `slugify`. Report first-candidate rejected, committed within 3, and how often
   the candidate references the unrelated function (expected 0), against the EXAMPLES.md table (8/8→8/8, 6/8→7/8,
   6/8→7/8, 8/8 first candidate). A difference larger than 2 of 8 in any column is investigated before shipping and
   reported either way.
3. **Decline calibration with others present**: `scripts/calibrate.tune.ts` gains `CAL_OTHERS=1`, which passes an
   `others` list built from real certified fixtures — `slugify`, `median`, `formatCurrency`, a seeded
   `rngFromSeed(seed: number): number` and `seededShuffle(xs: number[], seed: number): number[]` — to every prompt.
   Re-run all 48 cases in `CASES` at `CAL_N=3` and compare per group with HOSTILE.md's final run (descriptive names written
   78/78; meaningless names declined 21/21; impure names declined 41/45). Add tempting cases that only matter with
   others present: `shuffle(number[])` and `randomInt(number, number)` with the seeded functions listed (must decline
   CANNOT_BE_PURE; the failure mode is a constant seed), `process(string[])` and `clean(string[])` with `slugify` listed
   (must decline NEEDS_SPEC; the failure mode is `map(slugify)`), `now()` with a `formatDate(ms)` listed. Acceptance: no
   group drops by more than one call in N×cases; each tempting case declined in at least 2 of 3. If it fails, the
   guard sentences in §A6 are reworded and re-measured; HONESTY is not touched (zero-others bytes).
4. **Composition scenarios live** (new `scripts/compose-sessions.mjs`, same driver as `sessions.mjs`), 8 sessions each,
   with `slugify` committed from its recording first:
   - `slugifyAll(["Hello World", "Crème Brûlée"])`, spec-less: rate of bodies that reference `slugify` (from
     `Artifact.deps`) vs reimplement it; committed rate; compile rejections caused by calling it wrongly.
   - `uniqueSlugs(titles)` with a fixture spec (doc + tests: duplicates get `-2`, `-3`; consistency with `slugify` on
     distinct titles): first-candidate and within-3 rates, reference rate.
   - Staleness: after a committed `slugifyAll`, *Break it* on `slugify` → Repo shows `waiting`; call
     `slugifyAll([...])` → expect slugify regrown with the real arguments, slugifyAll re-checked: count re-check
     pass/fail and regrow outcomes; wall time of the eager re-check.
   - Mutation report of a composed `slugifyAll` vs a reimplementing one (kill rates).
   Results go in a new `docs/COMPOSE-MEASUREMENTS.md`; README and FEATURES quote only measured numbers.

---

## D. Risks and build order

**Risks**

- `recompileArtifacts` (load, import) compiles each artifact alone: without the closure, every composed artifact fails
  TS2304 and is silently dropped on reload. It must compile with the ambient file built from the artifact's recorded
  deps as they stand in the same revision, and include the dep hashes in its cache key.
- Every compile/exec site needs the closure: `runGates`, `recheckAgainst`, `mutationReport`, `previewExpectation`,
  `applySpec`'s revalidation compile, `recompileArtifacts`. One helper, `closureFor(program, fn)`, or one site will be
  missed.
- Calibration drift with others present (constant-seed fakes, `map(slugify)` for meaningless names).
- Inferred return types that print but do not re-parse; type-name clashes across `typeDecls`.
- Blame for a fault or purity violation inside `g` reached from `f` is shared; messages must name both.
- Eager re-checks cost one gate run per transitive dependent per change; a deep program pays it on every commit.
- A replayed composed recording needs its dependencies present; otherwise it fails compile (honest, but surprising).
- Image version 3 is refused by older builds.
- The first multi-statement line typed before the compiler finishes loading waits for it.
- None of this changes the sandbox's status: it is still not a security boundary (SECURITY.md unchanged except that
  committed functions now reach each other through late-bound stubs inside the same worker).

**Build order** (each step leaves all six checks green)

0. Golden tests from §0 (prompt bytes for every variant, compile source/js, Image v1 JSON) — before touching anything.
1. **Composition core**: `src/compose/graph.ts` (implHash, visible set, cycles, depStatus, closure, topological
   order) with unit tests; types (`Artifact.deps`, `CompileOutput.deps`, `ExecGateInput.deps`, `PromptInput.others`,
   Image v3); `evalMasked` bindings; gate-executor linking + violation attribution; compile ambient file, its own
   validation, checker-based dep extraction, harness messages; prompt section; engine wiring through `closureFor`
   (all six sites), `commit` storing deps, `settleDependents`, lazy re-check, `jsFunctions` excluding `changed`;
   `recompileArtifacts`; store validation; runtime `define/reset` deps, late-bound stubs, `UndefinedCallSignal`
   pass-through + swallow guard, depth-0 hooks.
2. **REPL core**: `replSplit.ts` (fast path, TS split, declaration rewrite, refusals), `ReplCore` stmt mode, engine
   unit loop, per-unit outcomes and messages, `RestartContext.from`.
3. **UI and outward**: Repo statuses (`current`/`changed`/`waiting` text, calls / called-by), Checks compile disclosure
   listing the visible functions, REPL popover line; eject closure + composed eject-check fixture; measurements (§C)
   and docs (README limits, FEATURES, ARCHITECTURE "what the model sees", DESIGN contracts).

---

## E. Corrections found while implementing §A

1. **Seven compile sites, not six, plus two exec sites.** `loadRecording`'s revalidation compile was missing from §D, and
   `previewExpectation` (the Decide probe) and the mutation check's baseline/mutant runs need the closure too. All go
   through `engine.ts callableFor` / `compileWith` / `execDeps`.
2. **`skipLibCheck` skips `/others.d.ts`** (it is a declaration file), so the ambient file is validated alone with
   `skipLibCheck: false, skipDefaultLibCheck: true`. A function whose name is a standard global (`escape`) would merge
   with the lib declaration instead of being declared: it is dropped too.
3. **The ambient file is validated with the caller's own `typeDecls` in front**: a callee's signature may use a type
   (`Row`) that only the caller declares, because identical declarations are not repeated.
4. **Using only a type a callee declares is a dependency on that callee**, or the reload recompile (5) could not
   declare it.
5. **Reload/import recompiles a dependent against its callees' ARTIFACTS** (their compiled source: typeDecls and the
   `function` line), not their current specs (`graph.ts otherFromArtifact`). Otherwise a `waiting` dependent, whose
   callee's spec changed, would fail to compile and be dropped on every reload.
6. **Status precedence:** `changed` wins over `waiting` (one changed callee is enough to keep it out of the runtime); a
   caller of a `changed` function is `waiting` on it (calling it re-checks it). Among compile refusals, the cycle reason
   is given before staleness.
7. **A violation the caller recorded and caught before calling a callee is the caller's** (`replCore.ts wrap`): it is
   reported for the caller, never blamed on the callee.
8. **The runtime holds exactly `jsFunctions(head)`** (`engine.ts syncRuntime`: undefine first, then define), so commit,
   re-certify, spec edits and recording loads cannot leave a dependent defined against code it was not certified with.
9. **Explicit re-check:** `Engine.recheck(fn)` (for the Repo's button) runs the same re-check as the eager and lazy
   paths. A failed eager or explicit re-check commits nothing.
10. **Eject:** `ejectClosure(program, fn)` / `ejectBlockerIn(program, fn)`; `provenance.json` version 2 holds each
    function's version-1 provenance object under `functions`, plus `graph`. `check:eject` runs the composed fixture
    (`compose-slugifyAll`: 12 unit tests and 3 properties across both files) in the fresh project.
11. **Known limit:** a `changed` dependent whose changed callee is itself not runnable (waiting on something) cannot be
    re-checked (the compile gate refuses that callee), so a call to it regrows the dependent instead of first growing
    the callee's missing dependency. The Decide probe of a function that is not runnable uses the "not committed yet"
    stand-in rather than run a combination nothing certified.

## F. Corrections found while implementing §B

1. **The fast-path scan also routes multiple declarators.** `const a = 1, b = 2` has no top-level `;`, but HEAD's
   `BIND_DECL` bound it as `a = (1, b = 2)` (a = 2). A `const|let|var` line goes to the parser unless it is exactly one
   identifier declarator with no top-level comma. Likewise HEAD's `BIND_ASSIGN` made `x = 1, y = 2` bind x to 2; the core
   now runs a binding whose right side has a top-level comma as one comma expression (x = 1, y = 2).
2. **Lines starting with `{` are not routed to the parser** (`{a: 1}` is an object literal under HEAD's `return (…)`).
   Instead, when the one-unit path gets the runtime's "parses only as statements" SyntaxError (raised when the line is
   compiled, before any of it runs), the engine splits the line and runs it from its first statement. This also covers
   scan misses (`${…;…}` in a template).
3. **Type annotations are refused.** The parser (ScriptKind.JS) accepts `let x: number = 1` without a parse diagnostic;
   the rewrite would silently drop the annotation, so it is refused with a plain message.
4. **The parser is the `typescript` module alone** (`compile.ts splitReplLine`), not the compile toolchain with its lib
   files. Refusals and parse errors are reported as SyntaxError entries and run nothing.
5. **A statement unit offers nothing to pin** (its shown value is `undefined`); a retry (fault, timeout, failed grow) of
   a multi-statement line resumes at the statement it is about (`RestartContext.at`), and says
   *Re-ran statement k of n from its start; statements 1–(k−1) were not run again.*

## G. UI (§D step 3), as built

1. **Repo** (`ui/components/Repo.tsx Dependencies`): *Uses* (with the revision each callee was certified against) and
   *Used by* on every card that has either; the chip reads `functionStatus(rec, program)` (`ui/select.ts`), so a
   `changed` function is never shown as certified (*Out of date: slugify changed in r5*, warn note, **Re-check** →
   `Engine.recheck`; when the eager re-check already failed, the note says so) and a `waiting` one says *Waiting for …*
   with `dependencyLine`. The Draft's committed chip uses the same status. Eject's label names the closure (*Eject
   uniqueSlugs and 2 functions it uses*); its broken-copy re-run is disabled while out of date.
2. **Draft / Checks**: *uses slugify* under a draft that calls others, from `CompileOutput.deps` on the UI-only
   `AttemptView.uses` (not persisted with the candidate, so artifacts and recordings are unchanged). A compile refusal of
   a call to another function is classed *would call itself in a cycle* / *called a function it may not*, not *model
   mistake*; the harness code is not shown as `TS0`. A re-check after a callee changed carries
   `GenerationView.recheck.callees`: the card says *A function it calls changed after it was committed (slugify changed
   r2 → r5)…* and the Draft chip *Fails with the new slugify*.
3. **Cycles** can only appear as a rejected draft (Checks and the artifact's draft history): a committed graph never
   holds one.
4. **REPL**: the input stays one `<input>` (no Shift+Enter textarea); `;` sequences and destructuring are accepted; the
   re-run line is `rerunText`. Fixtures: `composed-committed`, `dependent-stale`, `cycle-rejected`, `repl-multi`
   (`ui/dev/composeFixtures.ts`, shot by `scripts/shots.mjs`). `check:replay` covers a multi-statement line and a
   destructuring line over the shipped median recording; composition cannot replay from the shipped recordings (no
   recorded candidate calls another function, and the examples' specs may not change), so it is covered by
   `core/engine.compose.test.ts` and the fixtures.

## H. Corrections from the adversarial review

1. **Stamps cover the closure, not just the callee's body.** With `implHash` alone, `f → g → h`: regrowing `h`
   re-certified `g` in place (same body, so the same `implHash`), and `f` stayed `current` although the code under it
   had changed and its checks had never run against it (reproduced: `f(1)` certified as 5 returned 7). A stamp is now
   `graph.ts closureHash(g)`: `implHash(g)` when `g` calls nothing, else `implHash(g)` combined with `g`'s own stamps.
   Re-certifying `g` restamps `h`, so `g`'s closure hash moves, `f` turns `changed`, leaves the runtime, and is
   re-checked (`settleDependents` walks callees first). A leaf's stamp is unchanged, and nothing is stamped in a program
   without dependencies. Regression: `engine.compose.test.ts` "a change two levels down reaches the caller". The Repo
   and Checks name the re-certified callee and its new revision (*g changed in r10*); its body may be unchanged, only
   what it calls moved.
2. **"Nothing ran" is a flag, not a message match.** The engine re-split a fast-path line only when the runtime's error
   text equalled the statements message, so (a) a line whose `;` the scan misses (a regex holding `//` or a quote before
   the first `;`) was refused with a wrong "never closed" message, and (b) code that threw a SyntaxError with that exact
   message had its earlier side effects run twice. The runtime now sets `parse: true` on an error outcome only when the
   unit failed to compile (`replCore.ts ReplParseError`); on that flag the engine asks the parser and runs the
   statements it finds, else keeps the runtime's message.
3. **`return` nested in a top-level statement is refused** (`if (c) { return 1 }`): the parser accepts it, and as a
   statement unit it would have silently ended that statement.
4. **Kept as a limit:** `let x;` / `var x;` bind `undefined` even when `x` holds a value (§B5, README).

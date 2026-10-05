# Decide: spec gaps become questions (internal design, Phase 2)

Status: CORE (steps 1-8) and UI (steps 9-12) implemented: apps/site/src/ui/components/Decide.tsx,
apps/site/src/ui/decide.ts, GatePanel/Repo/Evidence/Eject wiring, replay-check Decide block. As built, the replay-mode waiving
ruling is warned about before Confirm and then runs (the engine's needs-live path), with Run live / Check / Remove as
the ways out. The live measurement (§7) was run as `apps/site/scripts/decide-sessions.mjs`; results are in DECIDE-MEASUREMENTS.md. §10 lists where the code differs from this text and the
two flaws found while building it (fixed in the code and here). Internal: fold into DESIGN.md / FEATURES.md once
built, then delete.
Every claim about current behaviour cites the code it was read from.

## 0. The flow in one paragraph

A check that fails with an applying "spec was silent" marker (`Diagnostic.silentOn`, set by
`sandbox/gateExecutor.ts` `silence()` / `runProperty` when `when` holds at the shrunk counterexample) gets a **Decide**
section in its rejection card. It shows the call (`median([])`), what the candidate did (`threw Error: …`), what your
check expected (`NaN`), and a short list of alternatives built from a fixed table keyed by the gap's kind plus what the
failing check itself declared; never anything the model wrote as an alternative. The user picks one (or types an
expression), optionally gives a reason, and confirms. The ruling becomes a `Decision` on the spec: a generated unit test,
plus, when the ruling disagrees with the failing check, a **waiver** of that check on its silent domain. The tests hash
changes, the committed artifact is re-checked in place with the existing re-check machinery (`addSuggestedProperty` /
`recertify` in `core/engine.ts` ~2847-2996). Pass: re-certified, nothing regenerated. Fail: the function is re-grown
with the ruling and the failed re-check in the first prompt, with a fresh budget. With zero decisions every hash, prompt
and recording is byte-identical to today.

## 1. Data model

### 1.1 Where a Decision lives: `FunctionSpec.decisions?: Decision[]` (packages/engine/src/types.ts)

```ts
export type GapKind = 'empty' | 'non-finite' | 'negative' | 'non-integer' | 'duplicates' | 'non-ascii' | 'symbols' | 'other';

/** One encoded outcome of a call (shared/serialize.ts encoding). */
export type Outcome = { returns: Json } | { throws: true };

export interface Decision {
  id: string;                       // 'd-…', unique within the spec
  kind: GapKind;                    // shared/gaps.ts classifyGap, at decision time (display + table lookup only)
  call: string;                     // display text, e.g. `median([])` (shared/show.ts callString)
  args: Json[];                     // encoded arguments of that exact call
  ruling:
    | { kind: 'outcome'; outcome: Outcome; label: string }   // picked, or "throws" ({ throws: true }), or a typed
                                                             // expression whose probe value encoded cleanly
    | { kind: 'expr'; expr: string; label: string };         // typed expression kept as source (relational, or a value
                                                             // that does not encode); always waiving, never replays
  /** Where the generated source goes: a unit test, or a rule property (§3.3). Hashed. */
  placement: 'tests' | 'properties';
  /** Which check and which silence this answers ("rulingOf"). */
  answers: { check: string; checkKind: 'test' | 'property'; silentOn: string; gate: 'tests' | 'properties' };
  /** True when the ruling disagrees with what the answered check expects: that check is waived on its silent domain. */
  waives: boolean;
  /** The generated test source, stored verbatim (hashed verbatim; never regenerated from the fields). */
  test: string;
  decidedAt: number;                // ms since epoch: NOT hashed
  reason?: string;                  // free text: NOT hashed, never sent to the model
}
```

Why not append the source to `spec.tests`: removal would be text surgery, the Repo could not list decisions, a waiver
cannot be expressed as appended text without editing the shipped check, and the "decided by you on <date>" note would
enter the hash (two identical rulings on different days would hash differently, which breaks the replay rule in §5).

Why not a Pin: pins are deliberately outside both hashes ("pinning invalidates nothing", `types.ts` Pin comment,
`hash.ts` header). A decision must invalidate, must reach the prompt, and may waive a check. Different object.

`program.ts` gets `withDecisions(p, fn, decisions)` modelled on `withPins` (lines 69-75): an empty list **removes the
field** (so `sameSpec`'s `JSON.stringify` in `commit()` and both validators never see `decisions: []`), but unlike
`withPins` it goes through `withSpec`/`recordFor` because the hashes change.

### 1.2 Effective checks: one pure function everything uses

`src/shared/decisions.ts`:

```ts
export interface EffectiveChecks { tests: string; properties: string; waived: Array<{ kind: 'test' | 'property'; name: string }> }
export function effectiveChecks(spec: FunctionSpec): EffectiveChecks
```

- No decisions: returns `{ tests: spec.tests, properties: spec.properties, waived: [] }` (the same strings).
- With decisions: `tests = spec.tests + sep + '// Decisions (decided by you; listed in the Repo tab)\n' + d.test…`
  for decisions with `placement: 'tests'` (unit rulings), and the same appended to `properties` for
  `placement: 'properties'` (rule rulings, §3.3); `waived` = the distinct `answers` of decisions with `waives: true`.

Every place that today reads `spec.tests` / `spec.properties` to run, list or count checks switches to it:

| place | today | change |
|---|---|---|
| `engine.ts` `runGates` 1998-2046 | `deps.transpile(spec.tests)` | effective tests; `ExecGateInput.waived` |
| `engine.ts` `mutationReport` 2737-2748 | same | same (mutants must face the decisions too) |
| `engine.ts` `addSuggestedProperty` 2871-2892 | same | same (generalised into `recheckAgainst`, §4) |
| `engine.ts` `isUngated` 1885 | tests/properties/pins | `|| decisions.length > 0` |
| `shared/prompt.ts` `checksSection` 178 | `testNamesOf(spec)` | names of effective tests; waived ones marked (§1.4) |
| `ui/explain.ts` (imports `listTestNames`) | spec text | effective text (what-the-model-saw summary) |
| `share/source.ts` / `RecordingPreview.functions[].tests` | spec text | effective text |
| `eject/eject.ts` `testFile` 436 | spec text | decision section + waivers in the prelude (§6.4) |

### 1.3 Hashes (`packages/engine/src/shared/hash.ts`)

Follow the `typeDecls` precedent (lines 14-18): append only when non-empty.

```ts
export function testsHash(spec: FunctionSpec): Promise<Hash> {
  const fields: unknown[] = [spec.tests, spec.properties];
  if (spec.decisions && spec.decisions.length > 0) {
    fields.push(spec.decisions.map((d) => [d.placement, d.test, d.waives ? [d.answers.checkKind, d.answers.check] : null]));
  }
  return sha256Hex(JSON.stringify(fields));
}
```

- `specHash` is untouched: a decision never changes name/params/returns/doc/budget (see §2.4 on `undefined`, which is
  why the design refuses to widen the return type).
- Hashed: the stored test text and the waiver tuple, in order. Not hashed: id, kind, call, label, date, reason.
- Zero decisions (field absent): `JSON.stringify([tests, properties])` exactly as today, so every stored artifact,
  every image and every `apps/site/public/recordings/*.json` session hash stays valid. `gateSeed` therefore also stays the same.
- New golden test (the repo has none; replay-check is the only end-to-end proof today): for every session in
  `apps/site/public/recordings/*.json`, `hashesFor(session.spec)` equals its stored `specHash`/`testsHash`; for each example,
  `hashesFor(EXAMPLE.spec)` and `hashesFor({ ...EXAMPLE.spec, decisions: [] })` equal session[0]'s (the length check
  makes `[]` hash like absent; normalisation to absent is still needed for `sameSpec`).

### 1.4 Prompt (`apps/site/src/shared/prompt.ts`)

Test **names** enter the prompt (`checksSection`), so decision test names are written to be read:
`decided: median([]) throws`, `decided: median([]) returns NaN`, `decided: slugify("Don't Stop") returns "don-t-stop"`.
Names are JSON-escaped string literals, so `listTestNames` (specInfo.ts) decodes them correctly.

Additions, each emitted only when non-empty (so `prompt.test.ts` goldens are unchanged with zero decisions):

- after CONTRACT: `DECISIONS (cases the doc did not cover; the user ruled on each; follow them exactly)` with one line
  per decision, e.g. `- median([]) must throw an Error.` The reason is never sent.
- in CHECKS (which `buildPrompt` emits after CONTRACT), a waived check is listed as
  `- "apostrophes" (replaced by a decision above)`.
- for a re-grow after a failed re-check, a `RULING` section modelled on `runtimeFaultSection` (§4.2).

Owner decision flagged: the DECISIONS block shows the ruled call and value, i.e. one value from what were hidden tests.
Retry diagnostics already show failing calls and expected values (`formatDiagnostic`, lines 307-324), and a ruling is
the human's contract clause, so I recommend showing it. The alternative is names-only.

### 1.5 Revisions

New `RevisionKind` `'decision'` (add to `types.ts` and `store.ts` `KINDS`). One revision per user action:

- `Decided: median([]) throws — re-certified (r7's artifact passes)`; artifact restamped + `recertified[]` entry with
  reason `Decided: median([]) throws` (the existing `recertify` shape, kind `'decision'` instead of `'recertify'`).
- `Decided: … — the committed function fails it; re-growing` (spec applied, artifact stale); the re-grow's commit is an
  ordinary `'commit'` revision.
- `Removed decision: …` (+ the re-check outcome in `detail`).

Rollback/restore needs nothing new: decisions live in the spec inside the program snapshot, so `rollbackRevision`
(program.ts 107) restores exactly the decisions of the target. Rolling back to before a decision makes that revision's
artifact live again with its own hashes.

### 1.6 Persistence and import/export

- `store.ts` `vSpec` (472-494) reads `decisions` strictly when present (`vDecisions`: ids unique, `args`/`outcome` plain
  JSON, `answers` fields, `test` non-empty string, `waives` boolean, `decidedAt` number). An empty array is normalised
  to absent.
- `vSpec` drops unknown fields today, so an **old build** importing a newer image would silently lose decisions and see
  stale artifacts. Therefore `toImage` writes `version: 2` only when some revision holds a spec with decisions or a
  `'decision'` revision; otherwise `version: 1` exactly as today. `validateImage` accepts 1 | 2. Old builds reject v2
  with their existing "version must be 1" error. `reverify` (393) needs no change: it recomputes hashes with the new
  `hashesFor`.
- IndexedDB: no schema change (revisions are stored whole). `loadPersisted` runs the same validator.
- Diagnostics: `vDiagnostic` (515-537) keeps the whole JSON object, so the new optional fields in §3.1 survive storage.

### 1.7 Recordings

- `generator.ts` `readSpec` (691) also drops unknown fields. Same treatment: `Recording.version: 1 | 2 | 3`;
  `RecordingSink.toRecording` (957) emits 3 only when some session's spec has decisions, else 2/1 exactly as today;
  `readSession` rejects `spec.decisions` in a v2 file ("is a version 3 field"), mirroring the v1/v2 rule at 607-610.
- The shipped recordings carry no decisions and stay v2, byte-identical, no re-record.

## 2. Gap kinds and the alternatives table (`src/shared/gaps.ts`, pure)

### 2.1 Classification (no change to any shipped spec)

`classifyGap(args: unknown[] /* decoded */, spec): GapKind`, first match wins, looking at top-level arguments and the
elements of top-level arrays:

1. `empty`: an argument is `[]`, `''`, `{}`, or an empty Map/Set.
2. `non-finite`: a number is NaN or ±Infinity.
3. `negative`: a number/bigint is < 0, or is -0.
4. `non-integer`: a number is not an integer.
5. `duplicates`: an array argument has two deep-equal elements (ties).
6. `non-ascii`: a string contains a code point > 0x7F.
7. `symbols`: a string contains ASCII punctuation or symbols (`/[!-\/:-@[-`{-~]/`).
8. `other`.

Return type category from `spec.returns` (or the artifact's recorded `returnType` when `returns` is null): number,
bigint, string, boolean, array, nullable (`… | null`), optional (`… | undefined`), other. Only `silentOn` presence
decides that Decide is offered; the kind only chooses table rows and the card's wording.

### 2.2 Table (kind × return category). All values are computed, never model-written

| kind | number | bigint | string | array | boolean |
|---|---|---|---|---|---|
| empty | throws · `NaN` · `0` · `undefined`* | throws · `0n` | throws · `''` | throws · `[]` | throws · `false` |
| non-finite | throws · `NaN` | — | — | — | — |
| negative | throws · `NaN` · `0` | throws · `0n` | — | — | — |
| non-integer | throws · `NaN` · same as `f(Math.floor(x))` · same as `f(Math.round(x))` † | — | — | — | — |
| duplicates / non-ascii / symbols / other | (none from the table) | | | | |

\* only enabled when the return type admits `undefined`; see §2.4. `null` is added for nullable return types.
† relational rulings, offered only for single-parameter functions: the test is `eq(f(2.5), f(2))`.

To the table rows the card always adds, deduplicated by equality of the ENCODED outcomes (canonical JSON of the
shared/serialize.ts form, which is NaN- and -0-exact; see §10 for why not `testApi.ts` `deepEqual`):

- **Your check's answer**: the failing diagnostic's expected outcome (§3.1), labelled "what your tests expect". This is
  "whatever the failing check declared" and needs no new marker field.
- **The candidate's answer**, labelled "what the candidate did". **Owner decision**: this is an observed model output,
  not an alternative the model proposed, but it is model-produced. I recommend keeping it with that explicit label,
  because "the candidate was right" is the most common ruling; drop it if the brief's rule is meant literally.
- **Declared by the check** (opt-in, new specs only): `test(…, { silentOn, reasonable, alternatives: [{ label, value }
  | { label, throws: true }] })` and the same on property opts. `checkOpts` (testApi.ts 244) validates it when present;
  older builds ignore it (they read only known keys). The values are evaluated by user test code, so they are the spec
  author's. No shipped spec uses it, so no shipped hash moves.
- **Type your own** (always).

### 2.3 The shipped examples

| example | marked check | shrunk call | kind × return | alternatives offered |
|---|---|---|---|---|
| median | property `agrees with a sort-based reference` (`when: xs.length === 0`) | `median([])` | empty × number | throws (= the recorded first candidate's answer) · `NaN` (= your tests' answer) · `0` · `undefined` disabled · type your own |
| slugify | test `apostrophes` | `slugify("Don't Stop")` | symbols × string | `"dont-stop"` (your tests) · `"don-t-stop"` (the candidate) · type your own |
| slugify | test `ampersands` | `slugify("Tom & Jerry")` | symbols × string | `"tom-and-jerry"` (tests) · the candidate's answer · type your own |
| slugify | test `special letters` | first failing of `Straße`/`Smørrebrød`/`Łódź`/`Ærø` | non-ascii × string | tests' answer · candidate's answer · type your own |
| fibonacci | none (fibonacci.ts header: "no check carries a silentOn marker") | — | — | Decide never appears |

Honest notes: for slugify the table contributes nothing; there is no generic, non-model way to compute "drop the letter"
or "transliterate" for a slug, so the choices are the two observed answers plus "type your own". The recorded slugify
session's first candidate fails `apostrophes` (it keeps `'` as a separator), so that is the gap replay shows.

### 2.4 `undefined` for `median: number` (brief not met as written)

`returns: 'number'` means a body returning `undefined` fails the strict compile gate. Offering it would require
widening the return type to `number | undefined`, which changes `specHash`, so every replay key and the artifact's
signature. Design: the button is shown **disabled** with "Your signature says `number`; returning undefined needs the
return type changed (Edit spec)". The alternative (a decision that also patches `returns`) is possible later: add a
`widens?: string` field, compose an effective `returns`, and include it in `specHash` only when present.

## 3. Ruling to test

### 3.1 What the diagnostic must carry (new optional fields on `test` / `property` Diagnostics)

Today a Diagnostic carries only display strings (`call`, `counterexample`, `expected`, `actual` from `show()`), and the
executor's `CallRecord` (gateExecutor.ts 96-102) has no arguments. Add, all optional and JSON:

```ts
args?: Json[];          // encodeValue of the arguments of `call`, cloned BEFORE the call (the candidate may mutate them)
expectedOutcome?: Outcome;
actualOutcome?: Outcome;
alternatives?: Array<{ label: string; outcome: Outcome }>;   // only from the opt-in marker field
```

Populated only when the failure is about that exact call: `describe()`'s `returned` relation holds (headline
"`CALL` returned A, expected E") or the recorded call itself threw (`rec.threw && rec.thrown === e`). `matchesReference`
already attaches `__expectedShown` to a thrown error; it also attaches the raw expected so `expectedOutcome` can be
encoded. A reference that threw gives `expectedOutcome: { throws: true }`. These fields are the precondition for
offering Decide on a diagnostic; without them (older stored candidates, multi-call assertions) the card shows the
silence lines only, as today.

Separately, whenever an `AssertionFailure` has `actualIsValue`, the executor encodes its raw `actual`/`expected`
(`actualValue?`/`expectedValue?`), independent of the `returned` relation. The custom-expression probe (§3.2) relies on
this: its test body never calls the candidate, so it has no `args`/outcomes, but its value comes back encoded, not as
lossy `show()` text.

They do not reach the model (`formatDiagnostic` prints named fields only) and are not hashed.

### 3.2 Generated unit test (`shared/decisions.ts` `decisionTest(fn, args, ruling)`)

Literal source comes from `eject/literal.ts` `tsLiteral` (moved to `packages/engine/src/shared/literal.ts`; eject re-exports it), which
already writes `NaN`, `-0`, `undefined`, `Infinity`, `1n`, `new Map<…>`, `new Set<…>`, `new Date(…)` and plain objects
from the encoded form. Equality is `eq` (Object.is for primitives, deep otherwise), so NaN, -0 and undefined compare
exactly.

```ts
test("decided: median([]) returns NaN", () => {
  eq(median([]), NaN);
});
test("decided: median([]) throws", () => {
  throws(() => median([]));
});
test("decided: slugify(\"Don't Stop\") returns \"don-t-stop\"", () => {
  eq(slugify("Don't Stop"), "don-t-stop");
});
test("decided: median([2.5]) is the same as median([2])", () => {   // relational
  eq(median([2.5]), median([2]));
});
```

The call is rebuilt from `args` (never from the `call` display string, which `show()` may truncate with `…`). An
unserializable argument (`$t: 'unserializable'`) disables Decide for that diagnostic.

**Custom expectation ("type your own").** A TypeScript expression, e.g. `-1` or `"dont-stop"` or `median([0])`.
Validation, in order: (1) syntax: parsed with the lazily loaded compiler as exactly one expression (no statements,
no comma sequence at top level); (2) evaluation in the existing gate worker, so under the same mask and test-code
shadows as every user test: run `executeGates` with a stub candidate (or the committed artifact's js when live, so
relational expressions work) and tests source `test("probe", () => { eq((EXPR), { __undefinedProbe: true }); })`. The
assertion fails by construction and its `actual` is `show()` of the expression's value; a thrown error instead reports
the expression's error. The card shows "evaluates to `NaN`" before Confirm, or the error and no Confirm. A checkbox
"throws" replaces the expression with `throws(() => CALL)` (stored as `outcome: { throws: true }`). When the probe's
`actualValue` encodes cleanly and the expression does not mention the function, the decision is stored as
`kind: 'outcome'` with that value (so it can be implied and replay, §5.3); otherwise as `kind: 'expr'` with the source
verbatim, which is always treated as waiving and never replays. The user's expression is test code they wrote, at the
same trust level as the spec editor; the sandbox is not a security boundary and the doc must not imply it is.

### 3.3 Rule (property) rulings: realistic scope

Implementable now, narrowly: kinds `negative`, `non-integer`, `non-finite` on a **single** number/bigint parameter, with
a constant or throws ruling. The table supplies the arbitrary (`fc.integer({ max: -1 })`,
`fc.double({ noInteger: true, noNaN: true, noDefaultInfinity: true })`, `fc.constantFrom(NaN, Infinity, -Infinity)`),
and the source is a property appended to the effective **properties** text:

```ts
property("decided: for every negative n, fibonacci(n) throws", [fc.integer({ max: -1 })], (n: number) => {
  throws(() => fibonacci(n));
});
```

Shown as a second toggle "for this input only / for every input of this kind". `empty` gaps on arrays/strings are a
single value, so the unit ruling already is the rule. None of the shipped gaps is a rule kind (median's is `empty`,
slugify's are string kinds), so this path has no shipped example to prove it; build it after the unit path and unit
test it. A **typed** rule (predicate over the parameters and `result`) is deferred; the escape hatch is the Repo spec
editor's properties field. Saying otherwise would overclaim.

### 3.4 Waivers: a disagreeing ruling must replace the answered check on its silent domain

If the ruling differs from `expectedOutcome` (deep-equal on decoded values; `throws` vs `throws` is equal), keeping
the marked check would make the spec unsatisfiable on that call. So `waives = !agrees`, and:

- `ExecGateInput.waived?: Array<{ kind; name }>` (structured, cloneable, threaded through `gateRunner`/`gateWorker`).
- Executor, unit test named in `waived`: not run, not counted; the Tests gate `note` says `1 check replaced by your
  decision`. **The summary strings stay untouched** (`evidenceFrom` regex-parses them).
- Executor, property named in `waived`: if the case has `when`, the predicate is wrapped so inputs where
  `when(...clones) === true` pass vacuously (evaluate `when` before the predicate on fresh clones, and keep the existing
  `collectViolations()` discipline from lines 395-405, because `when` is user code that can call the candidate and
  overwrite `last`/samples); without `when`, the whole property is skipped.
- Honest cost: a unit-test marker covers the whole test. slugify's `special letters` has four `eq`s and the executor
  stops at the first failing one, so a disagreeing ruling on `Straße` drops the other three assertions. The Decide card
  says so before Confirm ("This replaces the test 'special letters' (4 assertions; you ruled on 1)"), and the user can
  add further rulings.

An agreeing ruling waives nothing: it pins the convention as an explicit decision (the rejection no longer says "the
spec was silent"; the decision test carries no marker) and puts it in the prompt.

## 4. Re-check in place, then re-grow

### 4.1 Re-check

Generalise `addSuggestedProperty`'s body into `recheckAgainst(fn, next: FunctionSpec, reason, kind)` (engine.ts
2847-2954) and call it from `decide`, `removeDecision` and `addSuggestedProperty`. It already does exactly what the
brief asks: recompile the stored body, run all gates with the new spec's seed and pins, `recertify` on pass (hashes
restamped, evidence recomputed, `recertified[]` appended, runtime untouched unless the js changed, mutation re-queued),
`applySpec` on fail (artifact stale, `undefine` in the runtime), infra failures leave the spec unchanged. New engine API:

```ts
/** `from` is a path into PERSISTED state, never the transient GenerationView: survives reloads, imports and rollback. */
type GapRef =
  | { fn: string; revision: number; candidate: number; gate: GateId; index: number }   // artifact.candidates[candidate]
  | { fn: string; diagnostic: Diagnostic };   // a failed grow (no artifact): the engine keeps its last gates in memory
decide(from: GapRef, choice: AltId | { expr: string } | { throws: true }, opts?: { scope?: 'call' | 'rule'; reason?: string }): Promise<void>;
removeDecision(fn: string, decisionId: string): Promise<void>;
previewExpectation(fn: string, args: Json[], expr: string): Promise<{ ok: true; shown: string } | { ok: false; error: string }>;
```

All three go through `exclusive` (the single operation queue), so Decide is disabled while a grow, re-check or
mutation run holds it (the card says "available when the current check finishes").

No committed artifact (the grow exhausted its budget): the spec is applied with a `'decision'` revision and a re-grow
starts immediately (§4.2) with no RULING section.

### 4.2 Re-grow after a failed re-check

- `GrowRequest` gains `ruling?: { body: string; gates: GateResult[]; decision: Decision }`; `PromptInput` gains the same
  and `buildPrompt` emits a `RULING` section modelled on `runtimeFaultSection` (prompt.ts 202-212): "You ruled …; the
  previously accepted body (shown) fails it:" + `formatDiagnosticsForModel(recheck gates)`, e.g.
  `TESTS FAILED — 1 of 6 / - test "decided: median([]) throws" / call: median([]) / expected: no error … actual: NaN`.
  Not a fake history entry: replay indexes attempts by position and the re-check is not a model candidate.
- `call` = the decision's `call`; `callArgs` = its decoded `args` (the Invariants probe); budget = a fresh
  `spec.maxAttempts`; the re-check is not charged.
- While re-growing: the record's artifact is stale, so `jsFunctions` omits it and the runtime has it undefined; the
  Repo shows "stale · re-growing against your decision"; the GenerationView is an ordinary `kind: 'grow'` with
  `call: 'median([]) (your decision)'`.
- On commit: ordinary `'commit'` revision; nothing in the REPL is re-evaluated; an info line says
  `median re-grown against your decision: saved as r9`.
- On exhaustion or generation error: the decision stands, the old artifact stays stale (not run), restarts are
  Retry · Remove the decision · Roll back. **Remove** in this branch re-checks the stale artifact against the spec
  without the decision (FIXED, see §10: the original text relied on `applySpec`'s revalidation, which only works
  when no earlier decision had re-certified, i.e. restamped, the artifact).
- Remove after a **re-certification**: the artifact was restamped to the decision hashes, so removing changes the
  hashes again and goes through `recheckAgainst` against the weaker spec. Usually it passes; it fails when the removed
  waiver brings back a check the artifact now contradicts (e.g. a "throws" ruling on median: the reference wants NaN
  again). Then the same re-grow path applies.

## 5. Replay

### 5.1 How replay is keyed today

`sessionKey(fn, specHash, testsHash)` (generator.ts 379) is the only key, used by `ReplayGenerator.has` / `generate`,
`recordedPrompt` (473), `recordedAttempt` (495), the sink (885) and the engine's routing (engine.ts 1621). The prompt is
**not** part of the key; `attempt` indexes the session's attempts by position. A changed `testsHash` therefore means
`no_recording`.

### 5.2 Proof that the shipped recordings keep matching

With zero decisions the `decisions` field is absent (normalised in `withDecisions`, `vSpec`, `readSpec`); `testsHash`
hashes `JSON.stringify([tests, properties])` exactly as today (§1.3); `specHash` is untouched; the new
`fallbackTestsHash` (below) is never set. So the key, the lookup path and the seed are identical. The golden test in
§1.3 locks it.

### 5.3 Implied rulings replay; others say "needs live mode"

A decision is **implied** when `waives === false`: it agrees with what the recorded spec's own check demanded, so the
recorded candidates were judged against the same acceptance rule on that call. Mechanism:

- `GenerateRequest.fallbackTestsHash?: Hash`, set by the engine iff the spec has decisions and **all** are implied;
  value = `testsHash({ ...spec, decisions: undefined })`.
- `ReplayGenerator.generate/has`, `recordedPrompt`, `recordedAttempt`: exact key first; on a miss, the fallback key.
  The engine's routing at 1621 uses the same `has(…, fallback)`.
- Anything else in replay mode (a waiving decision, or no session at all): before asking the generator, the engine
  fails the grow with `no_recording` and the message "Your decision (median([]) throws) differs from what the recorded
  session was checked against, so there is no recorded answer to replay. Run live to grow median against it." plus
  `RUN_LIVE_FIX`. No attempt card is shown.

What actually happens on the shipped examples:

- median, opening finished (artifact = recorded attempt 2, returns NaN). **NaN**: implied, re-check passes →
  re-certified, nothing generated. **throws** / **0**: waives the reference on `[]`; the artifact returns NaN, re-check
  fails → re-grow → replay mode → the needs-live message. Live mode: the re-grow runs with the RULING section.
- slugify, opening finished (artifact strips apostrophes). **"dont-stop"**: re-certified. **"don-t-stop"**: re-check
  fails → needs live mode.
- The fallback replay itself runs only when an implied decision exists and a grow is needed (no artifact: budget
  exhausted, image imported, rolled back past the commit). Then recorded attempt 0 of median is rejected by **Tests**
  (the decision test runs first), not Properties, and attempt 1 commits. A replay-check block for this must expect
  `TESTS`, not `EXPECT.median.gate`.
- `RecordingSink.add` records fallback-replayed results under the full (decision) `testsHash`, with the recorded prompts
  verbatim (which lack the DECISIONS block). That is intentional provenance: "What the model saw" shows what was sent.

## 6. UI

### 6.1 Placement (the opening sequence stays intact)

- The Decide block renders inside `GatePanel.tsx` `Headline` (rejection card) under the "Who decided" lines, only when
  the first failing diagnostic has `silentOn` **and** the Decide fields of §3.1, **and** `gen.phase` is `committed` or
  `failed`. During the ten-second opening the card for #1 is only visible while the grow runs, so Decide never renders
  there; `replay-check.mjs` timings and greps are unaffected.
- After a commit the panel follows the newest (accepted) attempt. Under *Accepted · saved as rN* one muted line:
  `The spec was silent on 1 case (median([])) · Decide`; the button selects attempt #1 via `selection` (uiState) and
  opens the block. The line must not contain "rejected by" or "Accepted · saved as" (replay-check regexes).
- Re-check cards (`kind: 'recheck'`) of decision re-checks get the line "You decided this after the function was
  committed. The committed function fails it." in place of `RECHECK_LINE`.

### 6.2 Contents (a `<details class="decide">`, collapsed by default)

Summary: `Decide what the spec should say about median([])`. Body:

1. The question: `The spec didn't say what the median of nothing is.`
2. Facts, in mono: `call median([])` · `the candidate threw Error: median requires a non-empty list` ·
   `your tests expect NaN`.
3. Alternatives as a radio group (labels from §2.2; sources as small tags: "your tests", "the candidate", "common
   choice", "declared by the check"; disabled ones with their reason).
4. "Type your own" radio with a mono input, the live "evaluates to …" line (§3.2), and a "throws" checkbox.
5. Scope toggle (rule kinds only, §3.3).
6. Consequence line computed before Confirm: "Agrees with your tests: adds one test, the committed function is
   re-checked." / "Replaces the check 'agrees with a sort-based reference' for empty lists." / "Replaces the test
   'special letters' (4 assertions; you ruled on 1)." / in replay mode for a waiving choice: "Needs live mode to
   re-grow if the committed function fails it."
7. Reason (optional, one line) and **Decide** (primary). The result appears as the usual info line and revision.

### 6.3 Repo (`Repo.tsx`): "Decisions" under the spec

One row per decision: `median([]) → throws` · `decided by you on 4 Oct 2026: <reason>` · `replaces "agrees with…" for
empty lists` (if waiving) · **Remove** (→ `removeDecision`, confirm inline). The generated test source is shown
read-only under a disclosure. Because `decide` takes a GapRef into stored candidates, the Repo's candidate history
also offers Decide on any rejected candidate with an applying marker (after a reload, too). The function's status line shows `stale · re-growing against your decision` when
applicable.

### 6.4 Evidence and eject

- `Evidence.decisions?: number`, set at commit/recertify from the spec (not parsed from summaries; absent when 0, so
  every existing evidence line is unchanged). `describeTests` gains a third argument: `6 unit tests, including 2
  decisions.` / `1 unit test, your decision.`
- `eject/eject.ts`: `provenance.json` gets `decisions: [{ id, call, ruling, answers: { check, silentOn }, replaces:
  check | null, decidedAt: ISO, reason }]`; `README.md` states the count; `<name>.test.ts` gets a
  `// ───────── your decisions ─────────` section with `// decided by you on 2026-10-04: <reason>` above each test,
  and the prelude gets `const __uWaived` with the same waiver semantics as the executor (skip a waived unit test with a
  printed note; vacuous pass inside a waived property's `when` domain). `npm run check:eject` must cover one waiving
  decision.

### 6.5 Mobile

Single column already below 1100 px. The radio list is full-width rows (44 px targets), the custom input full-width,
the facts wrap per line, Decide is a full-width button. The "spec was silent on 1 case · Decide" line wraps under the
verdict. Checked in `apps/site/scripts/shots.mjs` at phone width.

## 7. Measurement protocol

Question 1: of first-candidate rejections, what share are spec gaps vs candidate faults. Question 2: for gaps, does
the ruling flow reach a commit within budget.

`apps/site/scripts/decide-sessions.mjs [N=8] [sets…]` (built as `apps/site/scripts/gaps.mjs` was planned here; results in DECIDE-MEASUREMENTS.md), built on `apps/site/scripts/lib/drive.mjs` like `sessions.mjs` (not `record.mjs`: its
curation keeps only rejected-first sessions, which would bias the rates), dev server, live Codex:

1. Per example, N fresh sessions of the pre-typed call (`openApp`, `engineCall('loadExample')`, `runCall`).
2. Classify `attempts[0]`: accepted · **gap** (every diagnostic of the rejecting gate carries `silentOn`) · **mixed**
   (some do) · **fault** (none) · declined/aborted. Report mixed separately; it is neither.
3. For each gap session: snapshot with `engine.exportImage()`, then for each ruling in {the tests' answer, every other
   enabled alternative}: `importImage(snapshot)`, `engineCall('decide', GapRef into the head artifact's
   `candidates[0]`, choice)` (the GapRef points into persisted state, so it survives the import), wait for idle; a
   session that exhausted its budget uses the in-memory GapRef instead, without re-import; record `recertified` (0
   attempts), `regrown-committed` (attempts used of `maxAttempts`), `exhausted`, `error`. "Reaches a commit within
   budget" = recertified or regrown-committed.
4. Output `.tmp/gaps-out.json` and a table per example: first-attempt buckets, and per ruling the outcome counts.

Expected shape, to be replaced by the real numbers (prior data in docs/EXAMPLES.md, 8 sessions each, before this
feature): median 8/8 first rejections were the empty list (marked) → all gaps; slugify 6/8 rejected, by the apostrophe
or special-letter tests (both marked) → gaps; fibonacci 6/8 rejected by the bounded invariant and has no markers →
0 gaps **by construction**, which is a sanity check, not a finding. The tests' answer should re-certify every time
(the committed artifact already satisfies it); the interesting number is the disagreeing rulings (median throws/0,
slugify "don-t-stop") re-grown live. Caveat to print with the numbers: "gap" means "the spec author marked it", not
ground truth.

UI coverage (replay, no Codex): extend `apps/site/scripts/replay-check.mjs` after the existing matrix: median: click card #1,
open Decide, pick NaN, Decide → "re-certified"; pick throws → re-check fails → the needs-live message. slugify: same
with "dont-stop" / "don-t-stop". fibonacci: no Decide element. At 375 px: the block is reachable and nothing scrolls
horizontally.

## 8. Risks

- **Waiver granularity** (§3.4): whole-test waivers can drop assertions the user never saw. Mitigated by the
  consequence line; not solved.
- **Contradictory rulings**: a ruling can contradict another, unmarked check (e.g. `slugify("Straße") → "straße"`
  violates the output-shape property). Then re-grow exhausts. Cheap mitigation now: the exhaustion card names the
  failing check and offers Remove. Better later: a pre-Confirm probe with a stub candidate that returns the ruled value
  for the decided call and delegates to the artifact otherwise.
- **Prompt disclosure** (§1.4): decisions put test values in the prompt. Owner call.
- **Seed shift**: a decision changes `gateSeed`, so property counterexamples for other checks may change after a
  decision. Deterministic, but different; the re-check is what certifies.
- **Old builds**: only through the version bumps (§1.6, §1.7); verify the rejection messages are the existing ones.
- **"The candidate's answer" as an option** may read as letting the model propose. Owner call (§2.2).
- **Diagnostics without the new fields** (stored before this change, multi-call assertions): Decide is not offered;
  the silence lines still are.

## 9. Build order

CORE (each step unit-tested; `npm test`, `typecheck`, `check:replay`, `check:eject` green after each):

1. Golden test: shipped recordings' hashes = `hashesFor(example.spec)` (before any change).
2. `types.ts`: `GapKind`, `Outcome`, `Decision`, `FunctionSpec.decisions`, Diagnostic optional fields, `RevisionKind
   'decision'`, `Evidence.decisions`, `GenerateRequest.fallbackTestsHash`, `Recording.version 3`, `Image.version 2`,
   `Engine.decide/removeDecision/previewExpectation`.
3. `shared/hash.ts` (append-when-non-empty) + `shared/decisions.ts` (`effectiveChecks`, `decisionTest`, implied/waives)
   + `shared/literal.ts` (moved) + `shared/gaps.ts` (`classifyGap`, table). Tests: zero-decision hashes identical;
   NaN/-0/undefined/bigint/object literals round-trip through `eq`.
4. Executor: Diagnostic Decide fields; `waived` (unit + `when`-domain); opt-in `alternatives` in `checkOpts`. Tests on
   the shipped bad bodies (median throws-on-empty, slugify apostrophe) produce the expected `args`/outcomes.
5. `program.ts` `withDecisions`; `store.ts` `vDecisions`, image v2 rule; `generator.ts` `readSpec` v3 rule, sink
   version rule, fallback key in `ReplayGenerator`/`recordedPrompt`/`recordedAttempt`.
6. `prompt.ts`: DECISIONS, waived marks, RULING (goldens unchanged with zero decisions).
7. Engine: `effectiveChecks` everywhere in §1.2's table; `recheckAgainst`; `decide`/`removeDecision`/
   `previewExpectation`; re-grow with `ruling`; replay needs-live error; evidence count.
8. Eject: decision section, waiver prelude, provenance, README.

UI:

9. `explain.ts` copy (pure, tested): question, facts, consequence lines, alternative labels.
10. Decide block in `GatePanel.tsx` `Headline`; the "spec was silent on N cases · Decide" line; re-check line.
11. Repo "Decisions" list with Remove; status line.
12. Evidence line; Revisions kind word; mobile pass; `replay-check.mjs` Decide blocks; then `apps/site/scripts/decide-sessions.mjs` live
    measurement and the numbers into docs/EXAMPLES.md.

## 10. As built (CORE): deviations and fixes

Flaws found in this design while building it (fixed in the code; the text above is corrected):

1. **Bundle boundary (§2.2).** Deduplicating alternatives and judging "agrees" with `testApi.ts` `deepEqual` would
   import the sandbox (and fast-check) into the main bundle; the engine already duplicates constants to avoid exactly
   that. `packages/engine/src/decide/` compares ENCODED outcomes as canonical JSON instead. Consequence: two Maps/Sets with the same
   entries in a different order compare unequal here, so such a ruling counts as waiving (it never replays); every
   primitive, NaN, -0 and undefined compares exactly.
2. **Remove after a re-certification (§4.2).** If decision A re-certified the artifact (restamped to A's hashes) and a
   later decision B failed, removing B gives hashes no artifact carries, so `applySpec` can never revalidate it and it
   stays stale for good. `decide` and `removeDecision` therefore re-check a stale artifact whose `specHash` still
   matches (only the checks changed) exactly like a live one (`recheckAgainst(…, { recheckStale: true })`); a doc edit
   (specHash changed) is never re-certified this way.

Deviations (deliberate, smaller):

- API: `gapQuestion(ref): GapQuestion | null` (sync) is on the Engine so the UI and the fixtures never rebuild the
  alternatives; the choice is `{ alternative: id } | { expr } | { throws: true }`; `previewExpectation(fn, expr)` takes
  no args (the probe is a plain expression; the live artifact, when there is one, is in scope).
- Decide facts (`args`, `expectedOutcome`, `actualOutcome`, declared `alternatives`) are collected only while a check
  WITH a `silentOn` marker runs (arguments cloned before each call then, nowhere else), size-capped at 4000 JSON chars
  and dropped when lossy; every unmarked diagnostic is byte-identical to before. `actualValue`/`expectedValue` are set
  only for the "type your own" probe (`ExecGateInput.probe`), not for every eq() failure.
- `Decision.rule?: { phrase, param }` (not hashed) carries a rule ruling's wording; `Evidence.decisionProperties`
  counts rule properties next to `Evidence.decisions` (unit tests).
- A re-grow against a decision is not a REPL call: nothing is re-evaluated after it commits, its Retry does not re-run
  an input, and its recorded session has no `calls`. Its first prompt carries RULING; later attempts carry the usual
  PREVIOUS ATTEMPT section (the DECISIONS block is in every prompt).
- With no live (or re-checkable) artifact, `decide` applies the spec and re-grows immediately (in replay mode an implied
  ruling replays via the fallback key; a waiving one fails with the needs-live message and no attempt card).
- One ruling per call of a check, whatever its scope: a rule-scope decision replaces a call-scope one on the same
  call (and vice versa), so the two can never contradict; `GapQuestion.existing` reports either.
- Replay with only implied rulings and no recorded session (e.g. the doc was edited) says that, not "differs from".
- Adversarial review (fixed, each with a regression test):
  - A property marked silent with no `when` claims silence on every input, and a waiver of it skipped the whole
    property: one ruling on one call removed a check over every input. The executor now marks such a diagnostic
    `everyInput`; `gapQuestion` sets `onlyAgreeing` and disables every disagreeing alternative, and `decide` refuses a
    waiving ruling on it. The card's "it still runs everywhere else" line is now true for every property it shows.
  - Waivers match by name: a second check of the same name (or a decision test named like the waived check) was
    switched off too, so a candidate could pass while failing the ruling. `decide` refuses a waiver whose name is shared.
  - A GapRef into a rejection judged against tests/properties the user has since edited carried the OLD "your tests
    expect": `gapQuestion` returns null and `decide` refuses (stored refs compare the spec text of the commit revision;
    the current grow/re-check compares the text it ran; any other diagnostic needs its check by name).
  - The "type your own" probe wrapped the expression in newlines, the generated test does not: `NaN // why` previewed
    fine and then failed to load at Decide. The probe now uses the generated test's exact inline shape; an expression
    that closes more brackets than it opens is refused; `f(sameArgs)` as its own expectation (vacuous, yet waiving) is
    refused. The session-log line "decided a spec gap" is written only once the decision stands.
  - The Decide facts no longer style the draft's answer as an error (red) and the tests' as right: the spec was silent.
- `check:eject` covers two waiving decisions: median `throws` (property waived on its `when` domain) and slugify
  `"don-t-stop"` (unit test skipped, reported as "1 skipped: replaced by a decision").

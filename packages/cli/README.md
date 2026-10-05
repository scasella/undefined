# @scasella/undefined: certify TypeScript functions from the command line

`undefined-certify` runs the [Undefined](https://github.com/scasella/undefined) gates on the exported functions of a
TypeScript file. The gates are compile, tests, properties and invariants (pure and bounded), followed by a mutation
check. It prints, for each function:

- the verdict;
- the evidence line, which is the same sentence the site shows;
- the rejecting check and the failing call;
- the deliberately broken copies your checks did not catch, with their lines;
- for a spec gap, the question and the exact test to add for each answer.

> **Not published yet.** The package is `private` until the npm scope is confirmed
> ([docs/PACKAGES.md](../../docs/PACKAGES.md)). From a clone, run `npm run build:cli` and then
> `node packages/cli/dist/cli.js certify <file>`. Once it is published:
>
> ```sh
> npx @scasella/undefined certify src/stats.ts
> ```

## It never generates code

This tool certifies code from any source: Claude Code, Codex, Cursor, a human. It never writes, suggests or changes
code. It has no model, no prompt and no generation path; the site's Codex integration is not part of this package. The
checks decide; the author of the code does not matter.

## The certified code runs on your machine, and this is not a secure sandbox

`certify` **executes the functions and their tests**. They run in a Node `worker_thread` with a watchdog, inside a
`node:vm` realm whose global object has no Node APIs (`process`, `require`, `fetch`, `import()` and WebAssembly are not
available). `node:vm` is not a security mechanism, and a worker thread shares the process with the CLI. What this
catches:

- accidental impurity: clock, randomness, network or global state;
- runaway loops and recursion: the watchdog terminates them;
- runaway memory: there is a heap cap.

It does **not** resist code written to escape. Run it only on code you would run anyway, or inside a disposable VM or
container. See [docs/SECURITY.md](../../docs/SECURITY.md) for what was measured, and on which Node version.

Tested on Node 25.8.1 only so far. The Node 20/22 CI matrix has to pass before anything is published.

## Usage

```
undefined-certify certify <file.ts> [--spec <file>] [--json] [--function <name>]… [--budget-ms <n>]
                                    [--no-mutation] [--time-box-ms <n>] [--heap-mb <n>] [--quiet]
```

| option | meaning |
|---|---|
| `--spec <file>` | An `undefined-spec` JSON file or a vitest test file. Without it, the first of these next to the source is used: `<name>.undefined.json`, `<name>.test.ts`, `<name>.spec.ts`, `__tests__/<name>.test.ts`, `__tests__/<name>.spec.ts`. |
| `--json` | Print one JSON document instead of text (see below). |
| `--function <name>` | Certify only this export. Repeatable. The same-file functions it calls are still certified first. |
| `--budget-ms <n>` | Per-call time budget for functions whose spec sets none. Default 1000. The budget is part of the spec, so it changes the seed. |
| `--no-mutation` | Skip the mutation check. |
| `--time-box-ms <n>` | Time box of the mutation check. Default 6000. |
| `--heap-mb <n>` | Heap limit of each gate worker. Default 256. |
| `--quiet` | One line per function. |

`--seed` and `--overall-cap-ms` are in the design but not in the engine API yet. They are refused with exit 3, never
silently ignored. The seed is derived from the spec (`gateSeed(specHash, testsHash)`), as on the site.

The CLI makes no network requests, reads no config files and sends no telemetry. It reads only the file you give, the
spec file (given, or found by the rule above) and the TypeScript library files of its own `typescript` dependency.

### Exit codes

| code | meaning |
|---|---|
| 0 | Every function was accepted. This includes a function with no checks at all: only Compile ran, and the output says *unchecked*. |
| 1 | A function was **rejected**. |
| 2 | Nothing was rejected outright, but a function failed **only** on checks marked as spec gaps (`silentOn`). The questions are printed. |
| 3 | **Could not run.** Causes: bad arguments, an unreadable file, an unsupported signature or module-scope dependency, an invalid spec file, a test-file construct or `expect` matcher the gates cannot run, or a gate worker failure. This is never a verdict on the code. |

When a file has several functions, the run's exit code is the highest-ranked one: 1 > 3 > 2 > 0.

## What a function must look like

The gates certify self-contained functions:

- `export function name(p: T, …): R { … }` or `export const name = (p: T, …): R => …`;
- every parameter has a type annotation;
- no generics, overloads, default, rest or destructured parameters, `this`, `async` or generators;
- no module-scope dependencies other than `type` and `interface` declarations in the same file, and other exported
  functions of the same file, which are certified first and linked in.

Anything else gets exit 3 with the exact reason.

## Spec formats

### `undefined-spec` (the site's own format)

```json
{
  "format": "undefined-spec",
  "version": 1,
  "functions": {
    "isLeapYear": {
      "tests": "test('centuries', () => { eq(isLeapYear(1900), false); });",
      "properties": "property('…', [fc.integer({ min: 1 })], (y: number) => …);",
      "budgetMs": 1000
    }
  }
}
```

`tests` and `properties` are the site's Test API source: `test`, `eq`, `throws`, `property`, `matchesReference` and
`fc`, with the `silentOn` / `reasonable` / `when` markers. This is the exact text the site hashes, so the same spec
gives the same hashes and seed. These per-function keys are optional: `doc`, `params`, `returns`, `typeDecls`, `pins`,
`decisions` and `calls`.

- `params`, `returns` and `typeDecls` must match the source when present.
- `calls` holds argument lists for the Invariants replay.
- A top-level `datasets` object, next to `functions`, maps a hash to rows that `pins` and `calls` can refer to.

Unknown keys are errors, so a typo cannot silently weaken a spec.

### vitest + fast-check test files

A test file next to the function is read as its checks:

- each `it`/`test` becomes a unit test;
- `fc.assert(fc.property(…))` becomes a property, with the gate's seed;
- `describe` names become prefixes;
- `it.skip` and `it.todo` are listed and not run.

`expect` supports `toBe`, `toEqual`, `toStrictEqual`, `toThrow`, `toThrowError`, `toBeCloseTo`, `toBeNaN`, `toBeNull`,
`toBeUndefined`, `toBeDefined`, `toBeTruthy`, `toBeFalsy`, `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`,
`toHaveLength`, `toContain`, `toContainEqual` and `toMatch`, each with `.not`.

These are refused with exit 3 and their file and line: async tests, hooks (`beforeEach` …), `vi.*`, snapshots,
`fc.asyncProperty`, `fc.check`, custom seeds, unsupported matchers, and a test that calls two exported functions.

To mark a spec gap in a vitest file, put JSDoc tags on the `it`. vitest ignores them:

```ts
/**
 * @silentOn what the median of nothing is
 * @reasonable NaN and throwing are also defensible.
 */
it('empty list', () => { expect(median([])).toBe(0); });
```

Recordings and ejected folders are not accepted as `--spec` yet.

## Output

```
median  src/stats.ts:2  (spec: src/stats.test.ts, seed 1041578557)
  Compile     ✓ 0 errors
  Tests       ✗ 2/3 tests passed
  Properties  – not reached
  Invariants  – not reached
  SPEC GAP in Tests
  Rejected: median([]) returned NaN, expected 0
  …
  ? median([]): the spec didn't say what the median of nothing is.
    Check "empty list" (tests) expects 0; the code returns NaN.
    To decide, add one of these to the test file:
    - NaN (what the code does):
        it("decided: median([]) returns NaN", () => {
          expect(median([])).toBeNaN();
        });
    …
```

A surviving mutant is printed at its line in your file. The compiled line the site would show is in parentheses:
`survived: src/clamp.ts:6 (compiled line 1)  < → <=`.

### `--json`

The output is one document:

```
{ format: "undefined-certify", version: 1, tool, exitCode, file, specFile, specSource,
  functions: { <name>: { verdict, source, specHash, testsHash, seed, rejectedBy?, headline?, reason?, unchecked,
                         calls, gates, diagnostics, gaps, evidenceLine, evidence, mutation, mutantLines,
                         generatedTests?, skippedByTestFile, provenance } },
  order, issues, notes, unattributed }
```

For an accepted function, `provenance` is the same object the site writes to an ejected folder's `provenance.json`
(`format: "undefined-eject"`), built by the same function. It differs from the site's in these fields:

- `model` and `codexVersion` are `null`, because nothing generated the code;
- the candidate's `source` is `external` and its `generationMs` is `null`;
- `certifiedBy` names the tool and the Node, V8, ICU, TypeScript and fast-check versions.

Rejected functions have no provenance (there is no accepted artifact to describe).

The same input gives the same document every time, with these exceptions:

- timestamps (`ejectedAt`, `committedAt`, `at`);
- durations (`ms`);
- the watchdog's timing cases: a call near its budget, or a mutant near the 1000 ms per-call limit, can land on the
  other side on a slower machine.

## Examples

[`examples/`](examples) has three small projects. Each is also a test fixture:

| project | function | spec | exit |
|---|---|---|---|
| `examples/passing` | `clamp` | vitest + fast-check | 0 |
| `examples/rejected` | `isLeapYear` (forgets the century rule) | `undefined-spec` | 1 |
| `examples/spec-gap` | `median` (says nothing about `[]`) | vitest with `@silentOn` | 2 |

```sh
cd packages/cli/examples/spec-gap && node ../../dist/cli.js certify src/stats.ts
```

## Development

| command | what it does |
|---|---|
| `npm run build:cli` (repository root) | Writes `dist/cli.js` (the bin; the engine and fast-check inlined, `typescript` external), `dist/worker.mjs` and `dist/harness.js` (the prebuilt gate harness). |
| `npm run check:cli` | Runs the built binary on the examples and compares its `--json` with the snapshots that the in-process tests write from source. |
| `npm run check:parity` | Builds the CLI and certifies every recorded candidate of the site's shipped examples with it, as a subprocess, comparing verdicts, evidence lines and mutation buckets with the site's browser measurement ([docs/EVIDENCE.md](../../docs/EVIDENCE.md#node-and-cli-parity)). |
| `npm test` | Includes this package's tests. |
| `node packages/cli/scripts/dev.mjs certify <file>` | Runs from source. |

## License

MIT. See [LICENSE](LICENSE).

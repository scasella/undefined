# The engine

`packages/engine` (`@scasella/undefined-engine`) holds:
- the four gates: **Compile** (strict TypeScript), **Tests**, **Properties** (fast-check, with a fixed seed) and
  **Invariants** (purity replay and a per-call time bound);
- the mutation check;
- the evidence line;
- spec-gap questions and decisions;
- the provenance record.

The same source runs in three places:
- the static site, in browser Web Workers;
- the CLI (`packages/cli`), in Node `worker_thread`s;
- the GitHub Action (`packages/action`), also in Node `worker_thread`s.

The watchdog, the nonce protocol and the result builders are the same code in all three.

**It certifies code from any source: Claude Code, Codex, Cursor, a human.** The engine, the CLI and the Action have no
model, no prompt and no generation path. The only generation path in the repository is the site's local Codex CLI
service (`apps/site/server/`), and none of these packages imports it. The checks decide. The author of the code makes
no difference.

**The Node runner is not a secure sandbox.** It executes untrusted code (the function and the tests that come with it)
in a `worker_thread` with a watchdog, inside a `node:vm` realm that has no Node APIs. That catches accidents: impurity,
runaway loops and runaway memory. It does not stop code written to escape. [SECURITY.md](SECURITY.md#the-node-host-packagesengine-used-by-the-cli-and-the-action)
lists what is contained and what is not.

## What `certify` means, and does not mean

For each function, `certify` reports one of four verdicts:
- **accepted**: every gate passed;
- **rejected**: a gate failed, and the report gives the failing call;
- **gaps**: the only failures are on cases the spec marked as undecided;
- **could not run**: the engine could not run the function at all.

An accepted function also gets an evidence line, for example *Compiled. 2 unit tests. 1 property, 100 runs. 25 calls
replayed for purity. Tests killed 11 of 12 mutants.*

- **Certification is evidence, not proof.** A function is "accepted" when it passes the checks you wrote. It can still
  be wrong wherever the checks are silent.
- **The mutation kill rate measures the tests, not the code.** Surviving mutants are changes your checks could not
  tell apart from the original. Some of them are equivalent mutants.
- **The time bound is measured on the wall clock.** A call near its budget can pass on one machine and be stopped on
  another.

## API

```ts
import { certify } from '@scasella/undefined-engine';                     // host-neutral, takes text
import { certifyFile, createNodeGateHost } from '@scasella/undefined-engine/node';  // Node: files, discovery, host

const r = await certifyFile({ file: 'src/stats.ts' /*, spec: 'src/stats.test.ts', functions: ['median'] */ });
r.exitCode;                      // 0 | 1 | 2 | 3
for (const f of r.functions) f.verdict, f.evidenceLine, f.mutation, f.gapQuestions, f.provenance;
```

**`certify(input: CertifyInput): Promise<CertifyResult>`** (`src/certifyModule.ts`) has no file-system access. Its input:
- `source` and `sourceFile`;
- an optional `spec`: `{ kind: 'undefined-spec', text, file }` or `{ kind: 'vitest', text, file, isSourceModule }`;
- a `host` (`GateHost`: `execGates`, `now`);
- `functions`, to limit the run to some exports;
- `defaultBudgetMs` (default 1000);
- `mutation`: `false`, or `{ timeBoxMs, maxMutants }`;
- `certifiedBy`;
- the progress callbacks `onGate` and `onStart`.

The result has:
- `exitCode`;
- `functions`, in certification order with callees first. Each is a `FunctionResult`: verdict, the four gate results,
  `rejectedBy`, `headline`, `diagnostics`, `specHash`, `testsHash`, `seed`, `evidence`, `evidenceLine`, `mutation`,
  `gapQuestions`, `calls`, `provenance`, the source `line`, `unchecked` and `skippedByTestFile`;
- `issues`, each with its file and line;
- `notes`;
- `specSource`;
- `unattributed`.

**`certifyFile(options)`** (`src/node/certifyFile.ts`) works on files:
1. It reads the file and finds the spec next to it (`specCandidates`).
2. It creates a Node host and calls `certify`.
3. It adds `file`, `specFile` and `certifiedBy`, which holds the Node, V8, ICU, TypeScript and fast-check versions.

The CLI and the Action call `certify()` directly with their own host and version info. Their bundles cannot look up
package versions the way `certifyFile` does.

**`createNodeGateHost(options)`** (`src/node/host.ts`) sets up the workers. Each gate run gets one fresh worker. The
options are:

| option | default | meaning |
|---|---|---|
| `heapMb` | 256 | old-generation heap |
| `youngMb` | 32 | young-generation heap |
| `stackMb` | 1 | thread stack; close to a browser worker's |
| `harnessPath` | none | a prebuilt harness |
| `libs` | none | the TypeScript lib texts; the Action uses this because it ships without `node_modules` |

The engine's `exports` point at TypeScript source, so it is consumed through Vite (the site) or a bundler (the CLI and
the Action). It is not published on its own ([PACKAGES.md](PACKAGES.md)).

## What a function must look like

The engine certifies functions written in one of these forms:
- `export function f(p: T, …): R { … }`
- `export const f = (p: T, …): R => …`

The rules:
- Every parameter needs a type annotation.
- These are not supported: generics, overloads, default, rest or destructured parameters, `this`, `async` and generators.
- The function may depend on nothing at module scope except same-file `type`/`interface` declarations and other
  exported functions in the same file.
- Same-file callees are certified first and linked in, as on the site.

Anything else is **could not run**, and the report gives the exact reason.

## Spec formats

The engine reads two spec formats. The [CLI README](../packages/cli/README.md#spec-formats) has the full rules and
examples.

**`undefined-spec` v1:** a JSON file whose shape is `{ format: "undefined-spec", version: 1, functions: { <name>: {
tests?, properties?, budgetMs?, doc?, params?, returns?, typeDecls?, pins?, decisions?, calls? } }, datasets? }`.
- `tests` and `properties` are the site's Test API source (`test`, `eq`, `throws`, `property`, `matchesReference`,
  `fc`, and the `silentOn`/`reasonable`/`when` markers), byte for byte.
- So the same spec gives the same `specHash`, `testsHash` and fast-check seed as on the site.
- Unknown keys are errors.

**vitest + fast-check test files (a compatible subset):** the engine translates a test file into the Test API.
- `it`/`test` become unit tests.
- `fc.assert(fc.property(…))` becomes a property, run with the gate's seed.
- `describe` names become prefixes.
- `it.skip`/`it.todo` are listed and not run.
- These `expect` matchers are supported, each with `.not`: `toBe`, `toEqual`, `toStrictEqual`, `toThrow`,
  `toThrowError`, `toBeCloseTo`, `toBeNaN`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toBeTruthy`, `toBeFalsy`,
  `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`, `toHaveLength`, `toContain`, `toContainEqual` and `toMatch`
  (`SUPPORTED_MATCHERS`).
- These are refused as *could not run*, with the file and line: async tests, hooks, `vi.*`, snapshots,
  `fc.asyncProperty`, `fc.check`, custom seeds, other matchers, and a test that calls two exported functions.
- Nothing is skipped silently.
- JSDoc `@silentOn` / `@reasonable` tags on an `it` mark a spec gap. vitest ignores them.

**Where the spec comes from:** if no spec is given, the first match next to `src/foo.ts` is used:
1. `foo.undefined.json`
2. `foo.test.ts`
3. `foo.spec.ts`
4. `__tests__/foo.test.ts`
5. `__tests__/foo.spec.ts`

With none of these, the function is accepted as *unchecked*: only Compile judged it.

## Exit codes

| code | verdict | CLI | Action check |
|---|---|---|---|
| 0 | accepted (including *unchecked*) | prints the evidence line | passes |
| 1 | rejected | prints the failing call | **fails** |
| 2 | gaps only: every failure is on a check marked as a spec gap | prints the questions | passes (a gap is a question, never a failure) |
| 3 | could not run: bad input, unsupported signature or test construct, invalid spec, worker failure | prints the reason | warning; fails only with `fail-on: could-not-run` |

When there are several functions, the run gets one code, chosen in this order: **1 > 3 > 2 > 0** (`exitCodeFor` in
`src/certify.ts`). A file with no function the engine can certify exits 3.

## JSON and provenance

`certify --json` prints one document (`packages/cli/src/report/json.ts`):

```
{ format: "undefined-certify", version: 1, tool, exitCode, file, specFile, specSource,
  functions: { <name>: { verdict, source, specHash, testsHash, seed, rejectedBy?, headline?, reason?, unchecked,
                         calls, gates, diagnostics, gaps, evidenceLine, evidence, mutation, mutantLines,
                         generatedTests?, skippedByTestFile, provenance } },
  order, issues, notes, unattributed }
```

`provenance` is the object the site writes to an ejected folder's `provenance.json` (`format: "undefined-eject"`),
built by the same function. It is unmodified and nested, not merged. Only accepted functions have one. It differs from
the site's in these fields:
- `model` and `codexVersion` are `null`, because nothing generated the code;
- the candidate's `source` is `external`;
- `certifiedBy` names the tool and the runtime versions.

The Action's result file holds the same structure per file and function.

## How spec-gap questions appear outside the site

On the site, a rejection that a check marks as a spec gap becomes a **Decide** card. Your ruling becomes a test, and
the function is re-checked. Outside the site:

- **CLI:** verdict `gaps` and exit 2. It prints each question (`median([]): the spec didn't say what the median of
  nothing is`), what the check expected and what the code did. Then it prints one paste-ready test per answer: a vitest
  `it(...)` for a vitest file, or Test API syntax for an `undefined-spec` file. `--json` puts the same information in
  `gaps[].question` and `gaps[].decision`.
- **Action:** the PR comment has a *Decisions for the reviewer* section with the same answers. Each answer is an
  `it(...)` to paste into the test file, or a Decision object for the spec's `decisions` array. The reviewer answers by
  adding the test. The next push re-certifies, and the comment is updated in place. The Action's tests paste each
  answer back and re-certify to confirm it settles the gap. A gap never fails the check.

A rejection that mixes real failures with gap failures is `rejected` (exit 1). The gap questions are still printed.

## Parity with the site, and its limits

On the shipped examples, Node reproduces the browser. The browser was measured in headless Chrome, replaying the
production build, and saved in `apps/site/src/examples/parity.browser.json`. Two suites certify all 11 recorded
candidates and compare against that file:
- `apps/site/src/examples/parity.node.test.ts`: in-process, part of `npm test`;
- `apps/site/scripts/cli.parity.ts`: `npm run check:parity`. It runs the built CLI as a subprocess, and CI runs it.

Both suites compare:
- verdicts and exit codes;
- every gate's status;
- rejection headlines;
- evidence lines;
- mutation buckets and survivors.

The table is in [EVIDENCE.md](EVIDENCE.md#node-and-cli-parity). The suites allow only two differences:

1. **Watchdog timing.** A slow mutant can be stopped by the 1000 ms per-call limit on one machine and fail its check
   first on another. So the suites compare only *killed + stopped by the time limit*, never the split between the two.
   A run that the 6 s time box cut short fails the suites. More generally, wall-clock bounds make a call near its
   budget machine-dependent.
2. **Site "rejected, spec was silent" = engine `gaps` (exit 2).** The question is the same.

Other limits:
- The Node host's heap cap (256 MB) and stack (1 MB) only approximate a browser worker's. Very deep recursion can
  behave differently on the two hosts.
- The parity measurement was taken on one Mac (Chrome, Node 25.8.1). Node 20 and 22 are first exercised in CI.
- Recordings and ejected folders are not accepted as `--spec` yet.
- `--seed` and `--overall-cap-ms` are refused (exit 3) because the engine API has no path for them yet.

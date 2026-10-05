# Undefined certify (GitHub Action)

Certifies the exported TypeScript functions a pull request touches with the Undefined gates: **compile**, **tests**,
**properties** and **invariants** (purity and a time bound), then a **mutation check** on every accepted function. It
keeps one PR comment up to date with an evidence line per function, the mutants that survived (with `file:line`),
and the spec gaps as decisions the reviewer answers by adding a test.

It certifies code from any source: Claude Code, Codex, Cursor, a person. **It never generates code.** There is no
model, prompt or generation path in this Action; it only runs the checks you wrote against the code in the PR.

Status: not published. Use it from this repository by commit SHA (`uses: scasella/undefined/packages/action@<sha>`).
License: MIT (the repository's [LICENSE](../../LICENSE)); bundled third-party licenses are in
[`dist/THIRD-PARTY-LICENSES.txt`](dist/THIRD-PARTY-LICENSES.txt).

## Read this first: it runs the PR's code, and that is not a secure sandbox

This Action runs the PR's code (the functions and their tests) in a Node `worker_thread` with a watchdog, inside a
`node:vm` context with no Node APIs. **That is not a secure sandbox.** It catches accidental impurity (clock,
randomness, network, globals) and runaways (infinite loops, deep recursion, runaway memory); it does not stop code
written to escape. `node:vm` is not a security mechanism, and a worker thread shares the Action's process, memory
and token. The isolation boundary is the GitHub runner: a fresh, disposable VM per job.

What that means for pull requests from forks:

- **`pull_request`** (recommended): a fork's PR runs with a read-only `GITHUB_TOKEN` and no secrets. Running fork
  code here is what GitHub designed this event for. The cost: the token cannot post the comment. The Action then
  logs a warning, writes the full comment to the job's step summary, and the check result is unchanged.
- **Never use `pull_request_target` with a checkout of the PR's head** (`ref: ${{ github.event.pull_request.head.sha }}`).
  That event runs with a write token and your repository's secrets, so this Action would execute the fork's code
  next to them. Nothing in a `worker_thread` or `node:vm` prevents a deliberate escape from reading them.
- **To comment on fork PRs**, split the work in two workflows (below): `mode: certify` on `pull_request` (untrusted
  code, read-only token, uploads the result file) and `mode: comment` on `workflow_run` (trusted, write token,
  **checks out nothing and runs no PR code**; it validates the result file as untrusted data and posts it only on the
  PR whose current head is the commit that was certified).

## What is sent where

Nothing is sent anywhere except the GitHub API calls that find, create or update the one comment (and, in
`mode: comment`, one call that reads the PR's head commit). They go to `GITHUB_API_URL` with the token you give it.
No telemetry, no analytics, no accounts, no model calls. The result file and the step summary stay on the runner.

## Usage

### Same-repository PRs: one workflow

```yaml
# .github/workflows/certify.yml
name: certify
on: pull_request
permissions:
  contents: read
  pull-requests: write # to create/update the one comment
jobs:
  certify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the Action diffs against the merge base
      - uses: scasella/undefined/packages/action@<commit-sha>
        with:
          paths: |
            src/**/*.ts
            !src/generated/**
```

A PR from a fork still gets certified (and the check still fails on a rejection); only the comment is skipped.

### Fork PRs too: two workflows

```yaml
# .github/workflows/certify.yml — untrusted: runs the PR's code with a read-only token
name: certify
on: pull_request
permissions:
  contents: read
jobs:
  certify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: scasella/undefined/packages/action@<commit-sha>
        with:
          mode: certify
          result-path: undefined-certify.json
      - uses: actions/upload-artifact@v4
        if: always() # upload the result even when a rejection failed the step
        with:
          name: undefined-certify
          path: undefined-certify.json
```

```yaml
# .github/workflows/certify-comment.yml — trusted: posts the comment, never checks out or runs PR code
name: certify-comment
on:
  workflow_run:
    workflows: [certify]
    types: [completed]
permissions:
  actions: read # to download the artifact
  pull-requests: write
jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: undefined-certify
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      - uses: scasella/undefined/packages/action@<commit-sha>
        with:
          mode: comment
          report-file: undefined-certify.json
```

The check that gates the PR is the `certify` job; the comment job always succeeds unless the result file is invalid
or belongs to a different commit.

### Try it locally (dry run)

In any git repository, nothing is sent and the comment is printed to stdout (progress goes to stderr):

```sh
UNDEFINED_DRY_RUN=1 UNDEFINED_BASE=main node path/to/undefined/packages/action/dist/index.js
```

`UNDEFINED_BASE` (default `HEAD~1`) is diffed against the working tree, so uncommitted and untracked files count.
Inputs can be given as environment variables too (`INPUT_PATHS='lib/**/*.ts'`, `INPUT_MUTATION=false`). The exit code
is the check's: 1 on a rejection, otherwise 0.

## Inputs and outputs

| input | default | |
|---|---|---|
| `paths` | `src/**/*.ts` | Globs of source files, newline- or comma-separated; `!glob` excludes. `*.test.ts`, `*.spec.ts`, `__tests__/` and `.d.ts` are never sources. |
| `mode` | `certify-and-comment` | `certify-and-comment`, `certify` (no comment) or `comment` (post a result file; runs no PR code). |
| `github-token` | `${{ github.token }}` | Used only for the comment. |
| `budget-ms` | 1000 | Per-call time budget for functions whose spec does not set one. |
| `mutation` | `true` | Run the mutation check on accepted functions (up to 6 s each). |
| `fail-on` | `rejection` | Add `could-not-run` to also fail when a function cannot be certified (recommended where PR authors are not trusted: otherwise a function written so the engine cannot run it, e.g. with a generic signature, passes the check unexamined). A spec gap never fails the check; `gaps` is refused. |
| `result-path` | `$RUNNER_TEMP/undefined-certify.json` | Where to write the result file. |
| `report-file` | | `mode: comment`: the result file from a `mode: certify` run. |
| `working-directory` | `.` | Where to run git. |
| `dry-run` | `false` | Print the comment instead of posting it. |

Output `result-path`: the result file. It holds the report the comment is rendered from, plus per file and function
the hashes, seed, gate summaries, mutation report and, for accepted functions, the same provenance structure the site
ejects (`format: "undefined-eject"`, `model: null`, `certifiedBy` with the Node, V8, ICU, TypeScript and fast-check
versions).

## What it certifies

1. **Touched functions.** `git diff --unified=0` from the merge base of the PR's base commit and `HEAD` to the checked
   out tree, mapped onto each changed file's exported functions with the TypeScript parser. A function is touched when
   a hunk overlaps it (JSDoc through closing brace), when a hunk changes a `type`/`interface` it uses, or when its spec
   or test file changed. Same-file functions it calls are certified too (to link them) but not reported.
2. **Its checks**, found next to the source (first match wins): `foo.undefined.json` (the site's spec format,
   `undefined-spec` v1), `foo.test.ts`, `foo.spec.ts`, `__tests__/foo.test.ts`, `__tests__/foo.spec.ts`. vitest +
   fast-check files are translated to the gates' Test API; unsupported constructs (async tests, hooks, mocks,
   snapshots, `fc.asyncProperty`, custom seeds, unknown matchers) are refused loudly, never skipped silently. No file:
   the function is accepted as *unchecked* (only Compile could judge it), and the comment says so.
3. **What the gates can express.** Self-contained functions with plainly typed parameters; generics, overloads,
   default/rest/destructured parameters, async functions and module-scope dependencies other than types and other
   exported functions of the same file are reported as *could not run* with the reason
   ([docs/WORKSPACE-DESIGN.md §3](../../docs/WORKSPACE-DESIGN.md)).

## The comment and the check

One comment, found by the marker `<!-- undefined-certify -->` on a comment written by a bot account (the default
`GITHUB_TOKEN` posts as `github-actions[bot]`; a marked comment from anyone else is ignored, so a PR author cannot
pre-empt or take over the report; with a personal access token the Action posts a new comment each time), created on the first push and updated in place on every
later push (left untouched when nothing changed). It lists, per touched function:

- **verdict and evidence**: the same evidence sentence the site shows, e.g. *Compiled. 2 unit tests. 1 property, 100
  runs. 25 calls replayed for purity. Tests killed 11 of 12 mutants.*; or the rejecting gate's headline;
- **surviving mutants** with `file:line` (mapped from the compiled line through a source map; when the mapping is not
  exact only the compiled line is shown), each possibly an equivalent mutant;
- **decisions for the reviewer**: a check marked `@silentOn` (a case the spec does not decide) disagrees with the code.
  Each possible answer comes with the exact test to paste: an `it(...)` for a vitest file, or a Decision object for
  the `decisions` array of an `undefined-spec` file.

When no exported function changed, no comment is created (an earlier one is replaced by a one-line note).

The check fails **only when a function is rejected**. A spec gap is a question, never a failure; a function that could
not be certified is a warning unless `fail-on: could-not-run`. Misconfiguration (no merge base because of a shallow
checkout, an invalid input) fails the step with an error saying what to fix.

## Limits

- The watchdog measures wall-clock time on the runner: a function whose honest runtime is near its budget can pass on
  one machine and be stopped as unbounded on another, and the mutation check's 6 s time box can stop early on a slow
  runner (the evidence line says so).
- The Node host differs from the browser where the engine documents it (heap cap, stack size, V8/ICU versions); see
  [docs/SECURITY.md](../../docs/SECURITY.md) and [docs/EVIDENCE.md](../../docs/EVIDENCE.md).
- Runs on the `node24` Actions runtime; the bundle is also tested on Node 20 and 22 in this repository's CI.

## Building

`dist/` is committed because an Action runs without `npm install`. `npm run build:action` (from the repository root)
bundles `src/` with the engine, TypeScript (with the lib `.d.ts` files it needs) and fast-check into
`dist/index.js`, writes the gate worker and harness next to it, and is reproducible: CI runs
`npm run check:action-dist`, which rebuilds into a temporary directory and fails if any file differs from `dist/`.

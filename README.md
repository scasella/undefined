# Undefined

[![CI](https://github.com/scasella/undefined/actions/workflows/ci.yml/badge.svg)](https://github.com/scasella/undefined/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A live program that grows the functions you call but haven't written. The model proposes; your toolchain decides.**

**[Try it in your browser](https://scasella.github.io/undefined/)** (a demo: recorded `gpt-6-luna` answers, real checks running in your browser, no install, no account). To ask new questions about your own file, [run it on your computer](#run-it-on-your-computer).

The site is one page, **the front door** ([`index.html`](https://scasella.github.io/undefined/)): bring a spreadsheet
export (CSV, TSV or JSON), pick a question, watch the AI's calculation get checked before you see the answer: your
examples, your locked answers, your house rules, and what was *not* checked. `#/zen` ("Step by step") is where new
visitors start; `#/start` is the full first-run page. Their contract and vocabulary are in [docs/FRONT-DOOR.md](docs/FRONT-DOOR.md). The original REPL UI (the workbench) was
removed; engine features it alone exposed (free-form calls, spec editing, rollback, share links, the session log) are
engine API only now, listed in [docs/FEATURES.md](docs/FEATURES.md#engine-features-with-no-ui).

![The opening sequence: an undefined call, a rejected candidate, a retry, a commit](docs/opening.gif)

[Watch the 40-second demo](docs/demo.mp4) (recorded in the previous REPL UI, since removed; the engine behaviour it shows is unchanged. 2880×1800 MP4: the opening sequence; then Decide: rule that `median([])` returns NaN, and the committed `median` is re-certified in place with no model call; then the data scratchpad: load a dataset, call a function over it with no spec, get a table, pin the result as a test).

Compilers used to sit upstream of everything: a human wrote code, the compiler judged it. LLMs invert that pipeline. The
model becomes the *upstream source* of code, and the ordinary toolchain (a strict TypeScript compiler, unit tests,
property tests, purity and runtime-bound checks) becomes the *downstream consumer* that decides what is accepted. Undefined
makes that inversion visible: call a function that doesn't exist, watch a model draft it, and watch real gates (not
string checks) reject the first attempt with a concrete counterexample before the retry is committed as a numbered
revision of your running program. Everything runs in your browser except the model call, which goes through your local
[Codex CLI](https://github.com/openai/codex).

> **You didn't write this. The model wrote it. Your tests hold the contract, and your toolchain enforced it.**

## Try it

- **In your browser:** [`#/start`](https://scasella.github.io/undefined/#/start): pick the orders sample and *Top 5
  customers by revenue*, press **Ask**, and watch the checks run on the recorded answer. Your own file loads and
  previews too; new questions about it need [the local copy](#run-it-on-your-computer).
- **Lock an answer:** *Does this look right? Lock this answer* turns it into a check every later version must pass.
- **Decide** where the spec was silent: a rejection a check marks as a spec gap becomes *a question only you can
  answer*. Your ruling becomes a house rule and the function is re-checked. [How](docs/FEATURES.md#decide-spec-gaps-become-questions).
- **Hand it to your data team:** a committed answer downloads as a zip with `<name>.ts`, its tests for vitest +
  fast-check, `provenance.json` and a README, runnable without the app. [Details](docs/FEATURES.md#eject).
- **Everything else** the engine does: [docs/FEATURES.md](docs/FEATURES.md).

## Run it on your computer

This is what the front door's *How to run it on your computer* points to: the public site only plays back recorded
answers, so new questions about your own file need this local copy, where the AI writes each calculation through your
own Codex login. Your file stays in your browser; what is sent to the model is listed in
[What leaves your browser](#what-leaves-your-browser).

**Prerequisites:** Node `^20.19 || >=22.12` (Vite 8's floor), [Codex CLI](https://github.com/openai/codex) 0.157 or
later (`npm i -g @openai/codex`) and `codex login` completed. No API keys, no cloud backend, nothing leaves your machine
except the prompt to Codex. The repository is an npm workspace (`apps/site`, and `packages/engine`, `cli` and `action`
below; [layout](docs/ARCHITECTURE.md#layout)); every command runs from the root.

```bash
git clone https://github.com/scasella/undefined.git && cd undefined
npm install
npm run dev          # http://localhost:5173: the front door, with the generation service running (LIVE mode)
npm test && npm run typecheck && npm run build    # tests for every package, then the static site in apps/site/dist/
```

Open `http://localhost:5173/#/start`, bring your file (or a sample) and ask. The bar at the top reads *Live · the AI runs
on your computer, real checks*; if it still says *Demo*, the generation service could not reach Codex (check
`codex login`).

**Replay mode (no Codex needed):** the static build in `apps/site/dist/` (one page, `index.html`) needs no backend and
no environment variables (deployable to GitHub Pages). With no generation service reachable it replays recorded
`gpt-6-luna` sessions and says *Demo · recorded answers, real checks*: the candidates are recorded, **every gate still
executes live in your browser**. `npm run preview` serves it locally.

## The engine

The gates work without the site. `certify` takes a TypeScript file exporting functions and its spec (the site's
`undefined-spec` format, or the vitest + fast-check test file next to it), runs the four gates and the mutation check in
Node with a real watchdog, and prints each verdict, evidence line, surviving mutant (with its line) and spec-gap
question. Exits 0 pass, 1 rejected, 2 spec gaps, 3 could not run; `--json` emits the provenance structure the site ejects.

```bash
npx @scasella/undefined certify src/stats.ts [--spec src/stats.test.ts] [--json]
# not published yet; from a clone: npm run build:cli && node packages/cli/dist/cli.js certify src/stats.ts
```

The GitHub Action certifies the exported functions a PR touches and keeps one comment up to date (evidence line per
function, surviving mutants at `file:line`, spec gaps as decisions the reviewer answers by adding a test). It fails the
check only on a rejection, never on a gap ([fork PRs](packages/action/README.md)):

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: scasella/undefined/packages/action@<commit-sha>
  with: { paths: 'src/**/*.ts' }
```

**It certifies code from any source: Claude Code, Codex, Cursor, a human.** The engine, CLI and Action never generate
code. They run the code under test in a Node `worker_thread` with a watchdog, **not a secure sandbox**
([SECURITY](docs/SECURITY.md#the-node-host-packagesengine-used-by-the-cli-and-the-action)). On the shipped recordings they
reproduce the site's verdicts, evidence and mutation results ([parity](docs/EVIDENCE.md#node-and-cli-parity)). API, spec
formats, limits: [docs/ENGINE.md](docs/ENGINE.md); npm names: [docs/PACKAGES.md](docs/PACKAGES.md).

## What leaves your browser

- **Replay mode / the static site:** nothing about your program. The page loads its own files and recordings from the
  site that serves it and asks that site for `./generate/health`. No third-party scripts, fonts or other resources.
- **Live mode:** each generation is a `POST ./generate` to the local service, which runs `codex exec`; Codex sends the
  prompt to the model provider. It holds the signature, the doc, the *names* of your tests and properties (never their
  bodies), the argument types of the call, declared types and sample rows. A retry adds the rejected draft, the gates'
  diagnostics and, when the error is fed back, the failing call; these can quote argument values and results, except
  as described in [Data](docs/FEATURES.md#data) while data is loaded.
- **Recording links** (`?recording=<url>`) are ignored by the front door: nothing is fetched. Sharing a session is
  engine API only now ([docs/REPLAY.md](docs/REPLAY.md#share-a-session)).
- Your program, data and the optional session log stay in this browser's IndexedDB. The CLI makes no network calls;
  the Action calls only the GitHub API, for its one comment. No accounts, telemetry or analytics anywhere.

## Limits and known gaps

- **Neither sandbox is a security boundary:** not the browser workers, not the Node runner ([docs/SECURITY.md](docs/SECURITY.md)).
- **Questions are suggested, not typed:** the front door asks only the questions it suggests for your file (worked out
  from the column types). Free-form calls are engine API only ([details](docs/FEATURES.md#engine-features-with-no-ui)).
- **Composition** (a generated function calling another certified one) was measured once
  ([docs/COMPOSE-MEASUREMENTS.md](docs/COMPOSE-MEASUREMENTS.md)); no cycles, and a dependent is re-checked when a callee changes.
- A self-recursive function with no declared return type cannot compile (TS7023); one extra attempt is allowed.
- Two tabs share one stored program and do not merge edits (the engine flags it in its state; the front door shows no warning); with IndexedDB blocked, state is in-memory
  for the session. No async tests.
- The measured rejection rates are one day's rates for one model, not a guarantee ([docs/EXAMPLES.md](docs/EXAMPLES.md)).

## Documentation

[FRONT-DOOR](docs/FRONT-DOOR.md) (the front door: pages, vocabulary, honesty rules, recordings) ·
[FEATURES](docs/FEATURES.md) (what the front door does, and the engine features with no UI) · [EXAMPLES](docs/EXAMPLES.md) (the four examples, measured rates) · [EVIDENCE](docs/EVIDENCE.md) (the
confidence line, mutation testing, kill rates, Node/CLI parity) · [ENGINE](docs/ENGINE.md) (engine, CLI and Action: API,
spec formats, exit codes, JSON) · [PACKAGES](docs/PACKAGES.md) (npm names) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[SECURITY](docs/SECURITY.md) · [REPLAY](docs/REPLAY.md) · [COMPOSE-MEASUREMENTS](docs/COMPOSE-MEASUREMENTS.md) ·
[HOSTILE](docs/HOSTILE.md) (54 stranger-style calls) · [SHARE-DEPLOY](docs/SHARE-DEPLOY.md) · [DESIGN](docs/DESIGN.md)
(module contracts) · [DEMO-SCRIPT](docs/DEMO-SCRIPT.md) · [LAUNCH](docs/LAUNCH.md) · [COPY-OPTIONS](docs/COPY-OPTIONS.md).

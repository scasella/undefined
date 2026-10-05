# Undefined

[![CI](https://github.com/scasella/undefined/actions/workflows/ci.yml/badge.svg)](https://github.com/scasella/undefined/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A live program that grows the functions you call but haven't written. The model proposes; your toolchain decides.**

**[Try it in your browser](https://scasella.github.io/undefined/)** (replays recorded `gpt-6-luna` sessions; the gates run live in your browser, no install, no account). To run it live against your own Codex login, see [Run it](#run-it).

![The opening sequence: an undefined call, a rejected candidate, a retry, a commit](docs/opening.gif)

[Watch the 30-second demo](docs/demo.mp4) (2880×1800 MP4: the opening sequence, then the data scratchpad: load a dataset, call a function over it with no spec, get a table, pin the result as a test).

Compilers used to sit upstream of everything: a human wrote code, the compiler judged it. LLMs invert that pipeline. The
model becomes the *upstream source* of code, and the ordinary toolchain (a strict TypeScript compiler, unit tests,
property tests, purity and runtime-bound checks) becomes the *downstream consumer* that decides what is accepted. Undefined
makes that inversion visible: call a function that doesn't exist, watch a model draft it, and watch real gates (not
string checks) reject the first attempt with a concrete counterexample before the retry is committed as a numbered
revision of your running program. Everything runs in your browser except the model call, which goes through your local
[Codex CLI](https://github.com/openai/codex).

> **You didn't write this. The model wrote it. Your tests hold the contract, and your toolchain enforced it.**

## Try it

- **In your browser:** [scasella.github.io/undefined](https://scasella.github.io/undefined/) opens with `median([3, 1, 4, 2])`
  in the console. Press Enter, watch the first draft get rejected and the retry committed. The other examples are one click away.
- **Try a different opener (`?opener=…`):** [`?opener=fibonacci`](https://scasella.github.io/undefined/?opener=fibonacci),
  `?opener=slugify` or `?opener=orders` starts on that example instead (first visit only; anything else falls back to
  `median`). [What the fibonacci opener looks like](docs/opening-fibonacci.gif).
- **Make it yours:** call any function that doesn't exist. With no spec, only Compile and Invariants judge it; pin a
  result as a test or write a one-line spec to make the gate stricter. [All features](docs/FEATURES.md).
- **Decide** where the spec was silent: a rejection a check marks as a spec gap becomes a question (`median([])`: throw,
  `NaN`, `0`, or your own). Your ruling becomes a test and the function is re-checked. [How](docs/FEATURES.md#decide-spec-gaps-become-questions).
- **Eject** a committed function: a zip with `<name>.ts`, its tests for vitest + fast-check, `provenance.json` and a
  README, runnable without the app. [Details](docs/FEATURES.md#eject).
- **Share** a session as a `?recording=` link. [How](docs/REPLAY.md#share-a-session).

## Run it

**Prerequisites:** Node `^20.19 || >=22.12` (Vite 8's floor; typecheck, 1126 tests and the build were run on Node 20.20, 22.23 and 26.8; older 20.x releases fail Vite's own engine check), [Codex CLI](https://github.com/openai/codex) 0.157 or later (`npm i -g @openai/codex`), and
`codex login` completed. No API keys, no cloud backend, nothing leaves your machine except the prompt to Codex.

```bash
git clone https://github.com/scasella/undefined.git && cd undefined
npm install
npm run dev          # opens on http://localhost:5173 with the generation service running (LIVE mode)
```

**Replay mode (no Codex needed):** `npm run build` produces a static site in `dist/` (deployable to GitHub Pages; assets
use relative paths). With no generation service reachable the app replays recorded `gpt-6-luna` sessions; the header pill reads
*"Replay · gates run live"*. The candidates are recorded; **every gate still executes live in your browser** against
them. `npm run preview` serves the build locally. Clicking the pill explains how to switch to live.

```bash
npm test             # unit + integration tests (Node)
npm run typecheck
```

## What leaves your browser

- **Replay mode / the static site:** nothing about your program. The page loads its own files and the bundled
  recordings from the site that serves it, and asks that same site for `./generate/health` (to see whether a local
  service is running). It loads no third-party scripts, fonts or other resources.
- **Live mode:** each generation is a `POST ./generate` to the local service on the same host, which runs `codex exec`
  with the prompt; Codex sends it to the model provider. The prompt holds the signature, the doc, the *names* of your
  tests and properties (never their bodies), the argument types of the triggering call, declared types and sample rows
  as described in [Data scratchpad](docs/FEATURES.md#data-scratchpad). A retry adds the rejected draft and the gates' diagnostics, and a "retry with the error fed
  back" adds the failing call and its error; these can quote argument values and results, except as described there
  while data is loaded.
- **A recording link** (`?recording=<url>` or **Load a recording** → link): that one URL is fetched.
- **Sharing:** nothing is uploaded. **Share this session** downloads a file; you decide where to host it. A copy of
  the site built with the optional `VITE_SHARE_ENDPOINT` (off by default; the public site does not set one unless its
  owner builds with it; see [docs/SHARE-DEPLOY.md](docs/SHARE-DEPLOY.md)) also shows **Create link**: pressing it
  uploads the recording (specs, tests, prompts, candidates, calls and any dataset rows in the session) to that
  endpoint, whose host the dialog names, and nothing is uploaded until you press it.
- Your program, data and the optional session log stay in this browser's IndexedDB.

## Limits and known gaps

- **The sandbox is not a security boundary.** See [docs/SECURITY.md](docs/SECURITY.md) for exactly what it does and does not do.
- **REPL lines** are one expression or one binding (`x = …`, `const x = …`); no destructuring or multi-statement lines.
  After a function grows, the original line is re-evaluated, so side effects that happened *before* the undefined call run
  twice.
- Generated functions are self-contained: they cannot call other generated functions.
- A self-recursive function with no declared return type cannot compile (TS7023); the engine allows one extra attempt and
  tells the model.
- Two tabs share one stored program and do not merge edits: a tab that finds another one open shows *This program is
  open in another tab. Edits in two tabs overwrite each other; close one.* Dataset rows are never dropped by the other
  tab's saves; a stored image that still refers to rows that are missing is repaired (those datasets are unbound, and
  the page says which), and one that cannot be read at all is discarded with a notice saying why. No async tests.
- Browsers with IndexedDB blocked fall back to in-memory state for the session.
- The measured rejection rates are one day's rates for one model, not a guarantee ([docs/EXAMPLES.md](docs/EXAMPLES.md)).

## Documentation

- [docs/FEATURES.md](docs/FEATURES.md): everything you can do, Decide, the data scratchpad, pinning, Eject, `?opener=`, the local session log.
- [docs/EXAMPLES.md](docs/EXAMPLES.md): the four examples, why each first draft is rejected, measured session rates.
- [docs/EVIDENCE.md](docs/EVIDENCE.md): the confidence line, mutation testing, measured kill rates.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how a call is decided, what the model sees, the generation service, source layout.
- [docs/SECURITY.md](docs/SECURITY.md): the security model, what is enforced and what is not.
- [docs/REPLAY.md](docs/REPLAY.md): replay mode, re-recording, sharing a session.
- [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md): a 60-second demo script.
- [docs/HOSTILE.md](docs/HOSTILE.md): 54 stranger-style calls and how each one went.
- [docs/SHARE-DEPLOY.md](docs/SHARE-DEPLOY.md): deploying the optional one-click share endpoint.
- [docs/DESIGN.md](docs/DESIGN.md): module contracts. [docs/LAUNCH.md](docs/LAUNCH.md), [docs/COPY-OPTIONS.md](docs/COPY-OPTIONS.md).

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the spreadsheet owner.** A non-programmer (operations, finance, analyst-adjacent) holding a CSV, TSV or JSON export who has a question about it ("top 5 customers by revenue") and cannot tell whether an AI-written calculation is right. Their job: get an answer they can trust, see why it can be trusted, and, if it matters, hand the checked calculation to their data team. They are not expected to know what a gate, spec, property test or mutation is.

**Secondary: developers and data teams.** The data team receives the ejected function (code, tests, provenance, README). Developers evaluating the thesis (model upstream, toolchain downstream) or adopting the engine, CLI or GitHub Action for code from any source (Claude Code, Codex, Cursor, a human).

## Product Purpose

Undefined is a live program that grows the functions you call but haven't written. The model proposes; your toolchain decides. A model drafts a calculation, then real checks run before the user sees an answer: a strict compiler, the user's own examples, answers they have locked, their house rules on generated data, purity and time bounds, and a stress test of twelve deliberate breakages. A failed draft is thrown out with a concrete counterexample, and the retry is committed as a numbered version. The front door is the only UI: bring a file, ask a question, watch the checks, read the answer and what was not checked.

Success is that a stranger runs it on their own file, understands why the answer is (and is not) checked, and keeps or ejects the result. The primary outcome is trust that is earned by visible checking, not trust that is asked for.

## Positioning

Checked, not proven. The AI is the untrusted upstream; the ordinary toolchain is the downstream judge that accepts or rejects, and the rejection is shown. A neighboring "AI writes your formula" product could not truthfully copy this: the checks are real code running live in the user's browser (not string matches), the user's own examples and rulings become the contract, and the page states what was *not* checked every time.

## Operating Context

- Public site (GitHub Pages) runs in **replay mode**: recorded `gpt-6-luna` answers, every check still executing live in the browser. The bar reads "Demo · recorded answers, real checks". A user's own file loads and previews there, but new questions about it need the local copy: the demo says so under the drop zone before a file is dropped (only some questions about `orders.csv` have recorded answers), keeps the sample files in sight once one is bound, with a note naming `orders.csv`, the one that has recorded answers (Step by step's first-pane button then reads "See what's in your file", secondary), and lists how to run it on your computer inline (what you need, the three commands, where it opens) where the demo reaches its dead end and on the landing.
- Local copy runs in **live mode** ("Live · the AI runs on your computer, real checks"): the generation service shells out to the user's own Codex CLI login. Node `^20.19 || >=22.12`, Codex CLI 0.157+. No API keys, accounts, backend, telemetry or analytics.
- Routes: `#/` landing, `#/zen` "Step by step", the first-run path (a bare five-pane walk-through: data, question, what the answer must pass, live check trace, answer; the pane is in the address, `#/zen/1` to `#/zen/5`, the browser's Back and Forward step one pane at a time, and nothing advances by itself: the finished check trace stays until the viewer presses "See the answer"), and `#/start` the two-column "Full view" for people who want everything on one page. On the landing, "Try the demo" leads to `#/zen` (owner decision, 2026-10-06); the second hero button is about your own file, which the demo cannot answer questions about, so in replay it reads "Use your own file: run it on your computer" and goes to the "How to run it on your computer" explanation (`#own-file`), and only on a live copy does it read "Use your own file" and lead to `#/zen`. `#/start` stays reachable and is not redirected. Suggested questions are worked out from column types with no AI; Step by step also accepts a typed question.
- Privacy copy states exactly what leaves the browser: only the prompt to Codex in live mode (signature, doc, test names, argument types, optional sample rows); nothing in replay mode. The example-rows switch is real.
- Hand-off: a committed answer downloads as a zip (`<name>.ts`, vitest + fast-check tests, `provenance.json`, README) runnable without the app.
- npm workspace: `apps/site` (front door), `packages/engine`, `packages/cli` (`certify`), `packages/action` (PR comment, fails only on rejection, never on a gap).

## Capabilities and Constraints

- Six checks on a calculation: runs without errors; matches your examples; matches your locked answer; follows your house rules on 100 made-up tables; never changes your data and finishes fast; stress test (12 small breakages). The level shown ("Full checks" vs "Basic checks") must be what actually ran.
- **Decide:** where the spec is silent, a rejection becomes "a question only you can answer"; the user's ruling becomes a house rule and the function is re-checked with no model call.
- **It says no:** impure or meaningless calls are declined rather than stubbed.
- Honesty rules are non-negotiable: nothing on `#/start` is scripted; if the engine cannot produce something, say so in plain words; the "Not checked" list and the honesty bar are always present; the landing hero trace is a labeled, slowed-down illustration; the stress-test strip stays labeled "Illustrative" until a recording backs it.
- Vocabulary: the UI never says gate, spec, property, fuzz, mutant, revision or pin. "Version N", "Lock this answer", "Draft thrown out", "house rule", "example" are the plain-language names ([docs/FRONT-DOOR.md](docs/FRONT-DOOR.md) has the full map).
- Neither sandbox (browser workers, Node runner) is a security boundary. Composition between functions was measured once. No async tests. Two tabs share one stored program without merging.
- Measured rejection and recovery rates are one model on one day, not a guarantee.
- Technical conventions: Preact + `@preact/signals`, strict TypeScript, per-file CSS with `fd-` prefixed classes and token variables, light theme only (the check trace is a dark surface, not a theme), self-hosted Geist and Geist Mono, no third-party scripts, fonts or resources.
- Undecided: the CLI is not yet published to npm; no public identity beyond the repo and Pages site is established.

## Brand Commitments

- Name: **Undefined**. Tagline claim: "A live program that grows the functions you call but haven't written. The model proposes; your toolchain decides."
- Voice: plain, concrete, evidence-first; leads with the claim; admits limits in the same breath. Every number on the page is computed from the data or measured, never typed in twice.
- Binding line from the README: "You didn't write this. The model wrote it. Your tests hold the contract, and your toolchain enforced it."
- MIT licensed; author Stephen Casella.

## Evidence on Hand

- Bundled sample data: `orders.csv` (332 rows; paid 258, pending 47, refunded 27) and `sales-q3.csv` (48 rows). Landing figures are computed from them by `apps/site/src/door/model/figures.ts` and pinned by tests.
- Recorded live sessions in `apps/site/public/recordings` (model `gpt-6-luna`, reasoning effort low, measured 2026-10-04).
- Measurements: [docs/LAUNCH.md](docs/LAUNCH.md) (first-draft rejection and recovery rates, decline rule, mutation kill rates), [docs/EVIDENCE.md](docs/EVIDENCE.md) (confidence line, Node/CLI parity), [docs/HOSTILE.md](docs/HOSTILE.md) (54 stranger-style calls), [docs/EXAMPLES.md](docs/EXAMPLES.md), [docs/COMPOSE-MEASUREMENTS.md](docs/COMPOSE-MEASUREMENTS.md).
- Media: `docs/opening.gif`, `docs/opening-fibonacci.gif`, `docs/social.png`, `docs/demo.mp4` (recorded in the removed REPL UI; engine behavior unchanged).
- **Absent, must not be fabricated:** customers, testimonials, press, usage numbers, pricing, an npm release, third-party benchmarks, results on any model other than `gpt-6-luna`.

## Product Principles

1. **Show the rejection.** A thrown-out draft with its concrete counterexample is the product's proof; never hide it to look smoother.
2. **Say what was not checked.** Every answer carries its level of checking and its gaps, in the same view as the answer.
3. **Real or labeled.** Anything live comes from the engine; anything scripted or illustrative says so in plain words.
4. **The user's words are the contract.** Their examples, locked answers and rulings define "right"; the AI never grades itself.
5. **Nothing leaves without saying so.** Privacy copy states exactly what is sent, and the file stays in the browser.

## Accessibility & Inclusion

Non-programmer audience: plain language over engine terms. Existing build contract: 44px minimum targets, visible focus, `aria-live` regions for the check trace, a skip link, `prefers-reduced-motion` respected with a correct end state, works down to 390px wide. No formal WCAG level has been declared; confirm one before claiming it.

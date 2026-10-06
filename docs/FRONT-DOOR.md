# Front door — the build contract

This is the implementation of **Round 3 · Front door — lead with the claim** from the design canvas
(https://claude.ai/artifact/HoacAnvbwSGQo2YWvRrcGW, boards `V3-Door-Landing` and `V3-Door-FirstRun`). It is the
site's only UI. The original REPL UI (the "workbench": `workbench.html`, `src/workbench.tsx`, `src/ui/**`,
`src/styles.css`) was kept beside it for a while and then removed; the engine features only it exposed are listed in
[FEATURES.md](FEATURES.md#engine-features-with-no-ui). Old `?opener=` / `?recording=` links open the front door and are
ignored (`main.tsx` creates the engine with no location).

The design's two boards were exported to a local scratch folder for this build:
`/private/tmp/claude-501/-Users-scasella-Downloads-undefined/1d2057a6-2d62-475a-a34d-cc89e81cc3c7/scratchpad/artifact-files/88132483-b0c6-49de-9c3e-7f525634f077/project/V3-Door-Landing.dc.html`
and `.../V3-Door-FirstRun.dc.html`. They are the visual and behavioural source of truth: read the markup *and* the
`<script type="text/x-dc">` block (it holds every state, string, colour and timing). Reproduce them faithfully (copy,
spacing, colours, motion, a11y attributes), translated into Preact + CSS files with tokens instead of inline hex.

## Pages

| Route | What | Design board |
|---|---|---|
| `#/` (default) | Landing: telemetry bar, hero claim, live example stage (check trace + answer + agreement rail), evidence strip, order-of-work, definition ladder, "agree once", "it asks", "says no" + privacy, team file + honest limits, footer, honesty bar | `V3-Door-Landing` |
| `#/start` | The full first run, for people who want everything on one page (reached from the landing's footer, "Full view of the demo", and from the step-by-step page's "Full view"): a short task heading, bring a file (drop / paste / sample), ask a question, live check trace, answer, the file's columns, right rail (what the AI will see, your agreement, demo note). Not redirected; `scripts/record-door.mjs` and `replay-check.mjs` open it | `V3-Door-FirstRun` |
| `#/zen` | **Step by step** (the route is still `#/zen`): where first-time visitors are sent (the landing's "Try the demo" buttons and the top bar's "Step by step" button; in the demo the landing's second hero button reads "Use your own file: run it on your computer" and goes to `#own-file` instead, `landing/teamFileView.ts` `ownFileCta`, and only on a live copy does it lead here). A five-pane walk-through in a bare single column (1 bring data · 2 ask · 3 what the answer must pass, the six checks each tagged in the check trace's own words: `Always` (01 and 05) or `Applies` (the other four, when they will run), `No examples yet` / `Nothing locked yet` / `No house rules yet` / `Needs your rules first` (the stress test) when there is nothing to run it on, and `Not re-run` when the agreement holds it but the answer on file was checked before it was set (`zen/flow.ts` `zenChecks`, `model/lanes.ts` `OFF_NOTES`) · 4 the live check trace, which starts the run and hands over by itself once it commits · 5 the answer, its one-line proof, download, ask again). Same session and components as `#/start`; nothing scripted. What each pane does is under "Step by step, pane by pane" below | (no board; `src/door/zen/`) |

## Step by step, pane by pane (`src/door/zen/`)

- **Where it opens** (`zen/flow.ts` `openingStep`). The shared session (`start/session.ts`) carries the file, the selected
  and typed questions and the run from `#/start` to `#/zen` and back, so a visitor who comes over is put where they were:
  pane 5 when an answer is shown, pane 4 while a run is still going, pane 2 when a file is bound and nothing was asked, pane 1
  with no data. The carried run is never `pending` (the engine's own state says whether it is still going), and its id is
  not reused or counted twice in the telemetry.
- **1 · Bring your data.** Continue is aria-disabled until data is bound and says why next to it ("Choose a sample or bring a
  file to continue."), tied to the button with `aria-describedby`. Binding closes the picker and the button that was pressed
  with it, so focus is sent to Continue on purpose (`ZEN_CONTINUE_ID`) and a screen reader hears "<file> is ready.".
- **2 · Ask a question.** In this order: the suggestion chips, one line saying what "needs live" means (replay only, when any
  chip carries it), the typed-question field, the "Asking:" line, the reason Continue is off (id `zen-why`), Back / Continue,
  and only then "Your data" (the whole table, scrollable, with the plain note about columns read as text,
  `model/columnNotes.ts`). The table is reference and 320px tall: above the buttons it pushed Continue off the screen
  (y 970 at 1440x900, 1062 at 390x844; it is now at 650 and 693).
- **3 · What your answer must pass.** The six checks as a list. Nothing has run on this pane, so none of them is green: a
  check that will run (`Always` / `Applies`) carries a neutral dashed ring with a dot, a check that will not run keeps the
  plain dashed ring and its tag (`No examples yet` …). Green appears only after a pass (the trace, the answer). The sentence
  under the list follows the seal rule: for Full checks the answer appears after all six have run, the first five must pass,
  and the stress test reports how many of its deliberate breaks the checks caught.
- **4 · Checking** is the live trace and hands over to pane 5 by itself once it commits.
- **5 · Your answer** keeps the proof: under the answer, one line cut from the trace's own header and footer (`start/derive.ts`
  `traceSummary`: `Passed every check · stress test caught 8 of 12 · real run 0.08 s`, `Passed 2 basic checks · real run
  0.08 s`, or, for an answer certified earlier, what the footer says, never "real run"), and a "See the checks" button
  (`aria-expanded` / `aria-controls`, collapsed by default) that opens the full check trace of that run, the same component
  and props as pane 4 (`zen/ZenProof.tsx`). Nothing plays when it opens, so reduced motion needs nothing.

### Suggested and typed questions (`#/start` and `#/zen`)

- **Order.** Chips this page can answer come first (a recording, or an answer already on file), the ones that need the
  version on your computer after them, each group in its own order (`start/AskCard.tsx` `chipsOf`). Until what can be
  answered is known nothing moves.
- **"needs live"** is defined once, next to the chips, whenever any chip carries it in replay: "needs live: this demo has
  recorded answers for one question; the others need the version on your computer." (the number is counted) with the "How
  to run it on your computer" link (`RUN_LOCALLY_URL`, the README). Step by step's dead-end message carries the same link.
- **Typing a suggestion's own words** (a label or its plain-words form, any case, spaces, ending punctuation or quote marks)
  selects that chip and adds nothing (`model/questions.ts` `matchQuestion`).
- **A question the demo cannot answer** (typed or suggested, replay only) is tagged "needs live" alone: no level is claimed
  for a calculation that will never run here, and the line under Ask is just the no-recording sentence. In live mode, and for
  questions that can be answered (recorded, or Full checks), tags and wording are as before.
- **`try it`** in the no-recording sentence ("“Top 5 customers by revenue” has one: try it.") is a real button that selects
  that question and moves focus to the way forward (Ask on `#/start`, Continue on `#/zen`). The sentence is the same plain
  text (`start/derive.ts` `noRecordingText`); `noRecordingView` gives it in pieces.

## Vocabulary map (the design's words are plain-language names for engine features)

| The design says | The engine has |
|---|---|
| 01 Runs without errors | Compile gate |
| 02 Matches your N examples | Tests gate, authored unit tests (`spec.tests`, minus decision tests) |
| 03 Matches your locked answer | Tests gate, pinned tests (`spec.pins`, `Engine.pinResult`) |
| 04 Follows your house rules on 100 made-up tables | Properties gate (fast-check, `numRuns`); decisions placed as properties are house rules too |
| 05 Never changes your data · finishes fast | Invariants gate (pure + bounded) |
| 06 Stress test: we broke it 12 small ways | Mutation check (`Engine.runMutation`, `state.mutation`, `Evidence.mutation`) |
| Version N | Revision `rN` an accepted draft was committed at (`Artifact.revision`; the answer card's caption and the honesty bar). NOT `state.headRevision`, which also counts binding a file, installing the demo's agreement, locking and rulings; the first run's bar shows no version until one is committed, and the landing's reads "Example answer: Version 4" (`STAGE_VERSION`, pinned by a test that replays the bundled recording) |
| Lock this answer | `Engine.pinResult(entryId)` |
| Draft thrown out | A rejected `AttemptView` / `Candidate` |
| A question only you can answer | A rejection whose diagnostic carries `silentOn` → `Engine.gapQuestion(ref)` → `Engine.decide(ref, choice, {reason})` |
| It says no | `GenerationView.declined` (decline protocol: `cannot-be-pure`, `needs-spec`) |
| What the AI will see / 3 example rows | `Engine.previewDataset().sampleText`, `typeDecl`, `Engine.setSendSamples`, `Candidate.prompt` |
| Hand your data team a file | Eject (the engine's `eject/eject.ts`, called by `model/handoff.ts`) |
| How to run it on your computer | The README's "Run it on your computer" section; the landing's HONEST LIMITS card (`#own-file`) links to it, and so does the demo's second hero button ("Use your own file: run it on your computer") |
| needs live | Replay mode, a question with no bundled recording for the spec it would run against (`Availability` 'none'): it can only be answered by the version on your computer |
| See the checks (step 5) | The check trace of the run that gave the answer, collapsed under the answer (`start/derive.ts` `traceSummary`, `zen/ZenProof.tsx`). Not "See the calculation", which on the landing opens the example's code |
| "Demo · recorded answers, real checks" | `state.mode === 'replay'` (the top bar's mode pill: a disclosure whose note says what runs where and what leaves the browser) |
| "Step by step" | The `#/zen` walk-through (the UI never says "Zen") |
| Basic checks vs Full checks | A spec-less call (only Compile + Invariants gate it) vs a spec with tests/properties/pins |

"House rule" = a Decide ruling (`spec.decisions`) or an authored property. "Example" = an authored unit test. Words in
the UI never say gate, spec, property, fuzz, mutant, revision, pin — the design's words only.

## Verified numbers (computed from the real `bundledOrders()`, 332 rows; see `model/figures.ts`)

- Status over all 332 rows: paid 258, pending 47, refunded 27; 12 order numbers repeat (ids appear twice).
- Top 5 by revenue (`quantity × unitPrice × (1 − discount ?? 0)`, cents), the three definitions in the ladder:
  - Every row counted: Puddlesworth Inc 2,599.13 · Kettlewhistle Farms 2,359.63 · Brambleskate Ltd 2,355.91 · Chef Ravioli Starbright 2,260.06 · Grommet & Gasket LLC 2,175.72
  - Paid orders only: Puddlesworth Inc 2,387.13 · Chef Ravioli Starbright 2,252.07 · Grommet & Gasket LLC 2,148.72 · Thistlewhump Bakery 1,909.90 · Kettlewhistle Farms 1,870.33
  - Paid only, each order number once: Chef Ravioli Starbright 2,252.07 · Grommet & Gasket LLC 2,148.72 · Puddlesworth Inc 2,114.13 · Thistlewhump Bakery 1,909.90 · Kettlewhistle Farms 1,870.33
  - Every row counted, each order number once (the "off the ladder" mix): Kettlewhistle Farms 2,359.63 leads.
- Revenue by country, every row: United States 9,987.42 · Netherlands 8,882.80 · India 6,817.11 · France 6,223.27 · Brazil 5,527.00.
- 100 rows carry a discount. Duplicate rows differ only in email case/whitespace.
- The second sample, `sales-q3.csv` (48 rows, 6 columns: orderId, orderDate, customer, region, status, amount), is built
  in `src/data/sales.ts` to match the design's published figures exactly (see the test there).

If a design string disagrees with these numbers, the numbers win and the copy changes. Landing figures are **computed**
from the data by `model/figures.ts`, never typed in twice, and `figures.test.ts` pins them to the design's strings.

## Honesty rules (non-negotiable)

1. Nothing on `#/start` is scripted. Lanes, counts, answers, assumptions, the "not checked" list and the stop-and-ask
   question come from `engine.state` (`generation`, `repl`, `program`, `mutation`, `datasets`). If the engine cannot
   produce something (no recording in replay mode, no live service), say so in the design's own plain words
   (e.g. "In this demo, answers are recorded, so questions about your own file need the version on your computer").
2. The landing's hero trace is a scripted, slowed-down playback of the example (the design says so: "Slowed down so you
   can watch"). It is labelled as an illustration; every evidence tile (6 of 6, 100, 11 of 12, 1 thrown out) and the
   stress-test strip carry "Illustrative · not yet a recorded run" until a recording backs them (`landing/evidenceView.ts`:
   the counts come from the seeded agreement, the outcomes are scripted; only the thrown-out draft's "Why" is computed).
3. The "two rules that disagree" question has no engine signal; it exists only as the landing's illustration.
4. Checked, not proven. The honesty bar and the "Not checked" list are always present.
5. Privacy copy states exactly what leaves the browser; the example-rows switch is wired to `Engine.setSendSamples`
   (and, in replay mode, nothing is ever sent; say that).
6. The seal appears only when every check that will run has finished, and the ledger never changes after the reveal. The
   stress test (check 06) runs last, after the commit, so the answer and the trace's verdict stay held until it has
   finished (`start/derive.ts` `outcomeOf`) and are then revealed together: the seal reads `Passed every check · stress
   test caught N of M` (N and M from the engine's mutation report, the same count lane 06 shows, `model/lanes.ts`
   `stressStatus`); misses are listed under Not checked, and a stress test that did not run is said so (`Passed 5 of 6
   checks · stress test didn't run`), never as "every check".

## Source layout (all new code under `apps/site/src/door/`)

```
main.tsx                  entry for index.html; boots the engine once, renders <App/>
App.tsx                   hash router (#/ , #/start, #/zen), skip link, <main id="main">
tokens.css  base.css      design tokens (colours, shadows, radii, type) and page base; self-hosted Geist + Geist Mono
icons.tsx                 inline SVG glyphs from the design (check disc, thrown-out square, ask diamond, lock, arrow, replay, file, …)
components/               presentational + small stateful pieces shared by both pages (one .tsx + one .css each)
model/                    pure, unit-tested view-models (no DOM): figures, lanes, trace script, answer, agreement, questions, samples, privacy
landing/                  Landing.tsx + one file per section (+ css)
start/                    Start.tsx + one file per section (+ css)
```

Conventions: Preact 11 + `@preact/signals`; TypeScript strict; no new dependencies; CSS in per-file
`.css` next to the component (imported by it), class names prefixed `fd-`, colours/shadows/radii from `tokens.css`
variables; light theme only (the check trace is a dark *surface*, not a theme); respect `prefers-reduced-motion`
(the design's `@media (prefers-reduced-motion: reduce)` block kills animation: keep that, and make sure the end state
is still correct without animation); 44px minimum targets; visible focus; `aria-live` regions as in the design;
works down to 390px wide (flex-wrap layouts in the design already do). Do not edit `packages/engine/**` or `src/core/**`
from door work. If the engine truly needs a change, make the smallest one and report it. Pure helpers the door shares
with tests and scripts live in `src/lib/` (`data.ts`, `evidence.ts`, `explain.ts`).

Pure modules have `*.test.ts` next to them (vitest, node env, no DOM). Anything that needs the DOM is kept thin.
`npm run typecheck` and `npm test` must stay green; other agents are editing other files at the same time, so ignore
type errors in files you do not own and re-run before you finish.

## Recordings

The public site runs in replay mode: a function is only written when a bundled recording (`apps/site/public/recordings`,
listed in `index.json`) was made against the EXACT spec the engine would grow. Recorded sessions are keyed by function
name + `specHash` + `testsHash` (`core/generator.ts` ReplayGenerator / findSession, `start/recorded.ts`), so several
recordings of one function with different specs coexist.

- **Why orders.csv is bound as `rows`.** `specHash` covers the params' types and `typeDecls`, and the row type's name
  comes from the variable name (`core/engine.ts` typeNameFor: `rows` → `Row`, `orders` → `OrdersRow`). The only
  recorded orders session (`orders.json`, the spec-less `topCustomersByRevenue(rows)`) was made with `type Row`, so
  `model/samples.ts` binds the sample as `rows`. The name only shows in the exact-prompt disclosure (`type Row = …`).
- **Adaptive seeding.** The seeded agreement (`model/agreements.ts`) is installed in live mode, and in replay mode only
  when a recording matches its hashes (or a function certified for it exists): `start/recorded.ts` seedUsable. Otherwise
  the question is asked spec-less. The question's level ('Full checks' / 'Basic checks') is what will really run
  (`recorded.ts` levelFor). Today, on the replay site (`orders-agreement.json` is bundled): "Top 5 customers by
  revenue" installs the agreement and replays with Full checks (Chef Ravioli Starbright $2,252.07 first, already
  locked); with that recording unavailable or stale it falls back to the spec-less `orders.json` session and replays with
  Basic checks (Puddlesworth Inc $2,599.13 first, every row counted). "Count orders by status" and "Revenue by country"
  end in the honest no-recording state either way, which points at the question that has an answer. `npm run
  check:replay` drives both paths (the second by serving the recordings index without the agreement's recording).
- **Recording the agreement** (`npm run record:door`, i.e. `node apps/site/scripts/record-door.mjs`): starts the vite
  dev server (live mode: it uses YOUR Codex login and spends model calls), opens `#/start` on a fresh image in headless
  Chrome, and drives the page's own session (`sessionFor(engine)`): bind orders.csv as `rows`, select "Top 5 customers
  by revenue" (the agreement is installed), Ask. Only a committed run is kept (up to 4 tries); the number of tries, the
  drafts and whether the first draft was thrown out are printed and written into the recording's title. It writes
  `public/recordings/orders-agreement.json` and refreshes `index.json`. Needs Chrome and `codex login`.
- **After it is bundled** nothing else changes: the page sees the recording, installs the agreement and shows Full
  checks for that question automatically (the spec-less `orders.json` session stays for the seed-off path). Re-record
  whenever the agreement's spec (doc, examples, house rules, budget) or the orders data's type changes: any change to
  its hashes makes the recording stop matching, and the page falls back to Basic checks on its own.
- **After recording**, re-run `npm run check:replay` and `npm run check:eject` (both walk every bundled recording; the new
  one carries a spec with a locked answer that refers to the orders data).
- **Known limitation.** A browser whose stored image already holds `topCustomersByRevenue` with a spec that has no
  recording (e.g. the seeded agreement installed by an older build) asks against that stored spec and gets the
  no-recording state; the session never deletes a function. `engine.resetImage()` (no button on the page today) or
  clearing this site's data clears it.

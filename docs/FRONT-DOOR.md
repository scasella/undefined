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
| `#/` (default) | Landing: telemetry bar, hero claim, example stage (check trace + answer + agreement rail), evidence strip, order-of-work, definition ladder, "agree once", "it asks", "says no" + privacy, team file + honest limits, footer, honesty bar | `V3-Door-Landing` |
| `#/start` | The full first run, for people who want everything on one page (reached from the landing's footer, "Full view of the demo", and from the step-by-step page's "Full view"): a short task heading, bring a file (drop / paste / sample), ask a question, live check trace, answer, the file's columns, right rail (what the AI will see, your agreement, demo note). Not redirected; `scripts/record-door.mjs` and `replay-check.mjs` open it | `V3-Door-FirstRun` |
| `#/zen`, `#/zen/N` | **Step by step** (the route is still `#/zen`; the pane is in the address, `#/zen/1` to `#/zen/5`, and nothing moves by itself): where first-time visitors are sent (the landing's "Try the demo" buttons and the top bar's "Step by step" button; in the demo the landing's second hero button reads "Use your own file: run it on your computer" and goes to `#own-file` instead, `landing/teamFileView.ts` `ownFileCta`, and only on a live copy does it lead here). A five-pane walk-through in a bare single column (1 bring data · 2 ask · 3 what the answer must pass, the six checks each tagged in the check trace's own words: `Always` (01 and 05) or `Applies` (the other four, when they will run), `No examples yet` / `Nothing locked yet` / `No house rules yet` / `Needs your rules first` (the stress test) when there is nothing to run it on, and `Not re-run` when the agreement holds it but the answer on file was checked before it was set (`zen/flow.ts` `zenChecks`, `model/lanes.ts` `OFF_NOTES`) · 4 the live check trace, which starts the run and stays on the finished trace until the viewer presses "See the answer" · 5 the answer, its one-line proof, download, ask again). Same session and components as `#/start`; nothing scripted. What each pane does is under "Step by step, pane by pane" below | (no board; `src/door/zen/`) |

## Step by step, pane by pane (`src/door/zen/`)

- **Where it opens** (`zen/flow.ts` `openingStep`). The shared session (`start/session.ts`) carries the file, the selected
  and typed questions and the run from `#/start` to `#/zen` and back, so a visitor who comes over is put where they were:
  pane 5 when an answer is shown, pane 4 while a run is still going, pane 2 when a file is bound and nothing was asked, pane 1
  with no data. The carried run is never `pending` (the engine's own state says whether it is still going), and its id is
  not reused or counted twice in the telemetry.
- **The pane is in the address** (`zen/flow.ts`). `#/zen/1` … `#/zen/5`; a bare `#/zen` resolves to the opening pane above and is
  then rewritten (`replaceState`) to `#/zen/N`. The pane is read before any `?query` or in-page `#anchor` (`stepFromHash`:
  `#/zen/3#x` is pane 3, not "nothing"). Moving with the page's own buttons uses `history.pushState` (it fires no
  `hashchange`), recording `{ zenStep, zenPrev }` in `history.state`; the browser's own Back and Forward do fire it, and in
  both cases the router leaves scroll and focus to the page (`router.ts` `pageKeepsFocus`, true only for a hash change from
  one Step by step pane to another: the page owns that sub-path; the whole hashchange decision is `planHashChange`, a pure
  function of the route the viewer is on, the new hash and the old address, which the handler only carries out). Everything
  else is as it always was, so on the landing a click on the logo (`#/`) from `#/#asks` scrolls to the top, and a change of
  route (landing to Step by step: to the top, focus on `#main`) or an in-page anchor scrolls and focuses as before. An anchor
  after a pane (`#/zen/3#main`) is the one exception and nothing links to it: the browser fires `popstate` before `hashchange`,
  the page's own `popstate` handler reads the pane before the `#` and rewrites the address to `#/zen/3`, and the router then reads
  that, so the anchor is neither scrolled to nor focused when the address is changed to it (a cold load of `#/zen/1#main` is
  different: the router reads that anchor before the page has mounted, so `#main` takes focus and the page then rewrites the
  address to `#/zen/1`; an id the page does not have does nothing). The browser's Back and Forward then step one pane at a time, and the page
  listens to `hashchange` and `popstate` (both idempotent: they compute the pane, compare, and only then change it). What the
  address asks for is only a request, clamped to what the session allows (`resolveStep`): pane 1 always; 2 and 3 need data
  bound; 4 needs a run in progress or an answer shown; 5 needs an answer shown; anything else opens where `openingStep` says.
  A run in progress always shows pane 4 and the address is rewritten to `#/zen/4`: there is no cancel, because the engine
  cannot cancel, so Back during a run stays on the trace (and the entry it popped to is rewritten, which is why, after that, the browser's
  Back from the answer goes to the finished trace (pane 4) and the Back after that skips pane 3, landing on pane 2). The clamp never pushes. The page's own "Back" calls `history.back()` when the entry before is the
  previous pane (`backPlan`), otherwise it pushes the previous pane (after "Ask another question", from a deep link, or when
  the entry was rewritten). `backPlan` reads only the entry the viewer is on, and an entry behind it may have been rewritten
  since (a browser Back during a run, then Forward: the entry after the rewritten one still remembers pane 3), so the page
  also looks at where `history.back()` really landed (`afterHistoryBack`, in the `popstate` that follows) and, when that is
  not the previous pane, pushes it: one press of "Back" always shows the pane before. "Is this a Step by step hash" has one
  definition, `router.ts` `isZenHash` (it names the route in `parseHash`, and `zen/flow.ts` re-exports that same function for the
  page; a test pins that they are one). A hash typed by hand that names no
  route (`#own-file`) is put back as the pane it was on (`router.ts` `hashToKeep`; the landing and the Full view get their
  plain route path back, as before).
  While the walk-through is mounted the page owns the scroll: `history.scrollRestoration` is `'manual'` (`zen/flow.ts`
  `holdManualScroll`, set on mount, quiet where the browser refuses), because the browser put an entry's old scroll offset back
  after the pane had scrolled itself to the top and left it 2 to 4 px down on Back and Forward; every Back and Forward lands at
  `scrollY === 0`. When the page goes, the hold gives back `'auto'`, the browser's default, and never "what it found": the
  value belongs to a history entry, and an entry made by `pushState` or a fragment navigation from a pane inherits the pane's
  `'manual'`, so a later visit (Back from the Full view onto a pane) finds `'manual'` on a page that never set it, and putting
  that back would have carried it to the landing and the Full view for good (it ratcheted). The landing and the Full view run
  with `'auto'` in every sequence (`replay-check.mjs` 3e: five sequences, hop by hop, reading the value after each). Leaving for
  another page is otherwise unchanged: Back from Step by step to a landing that was scrolled lands at the top with or without
  the hold (probed at 1440 and 390 px; the router's scroll to the top wins).
- **1 · Bring your data.** Continue is aria-disabled until data is bound and says why next to it ("Choose a sample or bring a
  file to continue."), tied to the button with `aria-describedby`. Binding a sample closes the picker and the button that was
  pressed with it, so focus is sent to Continue on purpose (`ZEN_CONTINUE_ID`) and a screen reader hears "<file> is ready.".
  In the demo a file of your own is a different path: see "Your own file in the demo" below (the picker stays open, the
  button reads "See what's in your file", the screen reader hears "<file> is loaded.").
- **2 · Ask a question.** In this order: the plain note about columns read as text when there is one (`model/columnNotes.ts`:
  it limits the suggestions, so it comes before them, and it is said once on the page), the suggestion chips, one line saying
  why some chips say "needs your computer" (replay only, when any chip carries it), the typed-question field, the "Asking:" line, the reason
  Continue is off (id `zen-why`) and, when that reason is the demo's no-recording sentence, the steps to run it on your
  computer (a disclosure that starts open, below), Back / Continue, and only then "Your data" (the whole table, scrollable; it no longer
  repeats the note). The table is reference and 320px tall: above the buttons it pushed Continue off the screen
  (y 970 at 1440x900, 1062 at 390x844; it is now at 650 and 693).
- **3 · What your answer must pass.** The six checks as a list. Nothing has run on this pane, so none of them is green: a
  check that will run (`Always` / `Applies`) carries a neutral dashed ring with a dot, a check that will not run keeps the
  plain dashed ring and its tag (`No examples yet` …). Green appears only after a pass (the trace, the answer). The sentence
  under the list follows the seal rule: for Full checks the answer appears after all six have run, the first five must pass,
  and the stress test reports how many of its deliberate breaks the checks caught.
- **4 · Checking** is the live trace and **never hands over by itself** (there is no timer: the old 1.1 s hand-over is gone, so
  the finished trace can be read for as long as the viewer wants). While the AI's draft is replayed (up to about 5 s in the
  demo) the trace shows the seconds counter and, in its footer, a small indeterminate mark by the "drafting · checks start next"
  label: three ticks that rise and fade in turn
  (`components/CheckTrace.tsx` `drafting`, driven by `start/RunPanel.tsx` `draftingView`; transform and opacity only, 1.8 s
  ease-in-out, which is deliberate for a loop, like the mode dot's pulse, while the one ease-out is for arrivals; `aria-hidden`;
  no percentage and no bar, because nothing is measured while the AI writes; under reduced motion it is a static trail of
  three ticks and the counter still ticks as text). It is in the footer and not the header on purpose: the header holds the
  title and the counter, which have no room to give at some width or another (beside the counter the mark cost the title a line
  near 950 px on `#/start` and the counter a second line on a phone), so the header is exactly what it was without the mark
  and nothing there knows about it. The mark sits under the label, so the cell is as wide as the label and the footer's text
  keeps all its room (beside it, the cell would have been 34 px wider: the label would have dropped under the text on Step by
  step's desktop column); where the label has dropped under the text on its own row (trace content under 586 px: the text's
  360 px, the 24 px gap and the 202 px label) the mark goes beside it instead (`components/CheckTrace.css`; a test ties the 586
  to those three numbers). Measured mid-draft at 42 widths from 320 to 1440 px on both pages: the header (height, title lines,
  counter lines) and the footer height are the same as they were before the mark, the mark is inside the trace, and the page
  does not scroll sideways. (Not the mark's, and unchanged by it: without any mark the drafting header already squeezes the
  title between about 480 and 700 px of screen, where the replay counter, `replaying the recorded draft · 4 s`, takes the room
  beside it: up to 5 title lines at about 500 px.) The mark is also in Full view and is gone the moment the checks start.
  When the run settles (committed, or answered from the version on file, with the seal already final: the
  stress test has finished) the pane stays "Checking" with the finished trace, one plain line saying how the checks went (the
  answer pane's own line, `traceSummary`), Back (secondary) and "See the answer" (primary). Focus moves to "See the answer"
  (`ZEN_SEE_ANSWER_ID`, not the heading; only when the viewer watched this run, and wherever focus was: after a stray Tab it
  is on the top bar's skip link, and it still moves, because nothing else on the pane takes focus while it runs), and
  the trace's live region says the verdict once (`start/RunPanel.tsx` `settledLiveText`: the trace's own sentence ends
  "Showing the answer.", which is true on `#/start` and not here; `traceLiveText` gives these words to Step by step's Checking
  pane only; `#/start` keeps the trace's sentence, which says the answer is showing and now names it too, once: "… Showing the answer:
  Chef Ravioli Starbright, $2,252.07." (`RunPanel.tsx` `sayAnswer`, the lead from `model/answer.ts` `answerLead`; no lead, no addition; pinned in
  `RunPanel.test.ts` and `replay-check.mjs` 3g, which also checks that no other live region repeats the name)). There is no skip and no cancel: the replay generator can
  only be aborted, which would fail the draft. Any other outcome (a question only you can answer, a refusal, nothing
  recorded…) is shown in place with its own way forward.
- **5 · Your answer** keeps the proof: under the answer, one line cut from the trace's own header and footer (`start/derive.ts`
  `traceSummary`: `Passed every check · stress test caught 8 of 12 · real run 0.08 s`, `Passed 2 basic checks · real run
  0.08 s`, or, for an answer certified earlier, what the footer says, never "real run"), and a "See the checks" button
  (`aria-expanded` / `aria-controls`, collapsed by default) that opens the full check trace of that run, the same component
  and props as pane 4 (`zen/ZenProof.tsx`). Nothing plays when it opens, so reduced motion needs nothing. The card above them is
  the one described under "The answer card" below. The pane says the answer once to a screen reader: the heading that takes focus
  ("Your answer") is described by one hidden sentence, the answer's lead ("Chef Ravioli Starbright, $2,252.07",
  `zen/Zen.tsx` `ZEN_ANSWER_LEAD_ID`, `aria-describedby`), so it is read with the heading and not again while browsing (the sentence
  is `hidden`, not visually hidden) and no live region repeats it; the heading's name stays "Your answer" (`replay-check.mjs` 3g reads
  both from the browser's accessibility tree). Pane 4 keeps its own verdict sentence: the answer is not shown yet.

### The answer card (`components/AnswerCard.tsx`, on the landing, `#/start` and Step by step's pane 5)

What the card says and offers when the answer arrives, in the order the viewer meets it:

- **One verdict line, directly under the figure** (`model/answer.ts` `verdictLine`; 16px body text in ink, no icon: the seal above it has
  one). At most two sentences, about 30 words: how the checks went, in the seal's own words (`lanes.ts` `sealHead` and `stressWords`, with
  the ledger's unit from `breaksWord`, so the line, the seal and the ledger can never disagree, including for one break: "caught 1 of 1
  deliberate break"): "Passed every check, though the stress test caught 8 of 12 deliberate breaks."; "and … 12 of 12" when nothing was missed;
  "Passed 5 of 6 checks, though the stress test ran out of time" or "didn't run", never "every check" then; for a basic pass "Only the 2
  basic checks ran, so nothing has tested the number yet."), then the one thing most worth knowing was not checked (`decisiveCaveat`: the
  first item of the "Not checked" list, less the explanation the list adds about your data, "(your status column has paid, pending and
  refunded)", which the ledger keeps whole: `caveatClause` cuts only that one shape, a clean closing group that opens after a space, with
  a clause left that is balanced and does not end on a joining word; a bracket in the middle of an item or any other closing one
  ("whether (a) and (b)") belongs to what it says and stays, and an item that cannot be cut cleanly comes back whole), then the one next step the
  product really has: "if the number matters, hand the calculation to your data team", named only when the card has the hand-off (so not on the
  landing's illustration, which says the same line with its own labelled numbers and no next step). The next step follows the caveat with
  "so", never a semicolon: "Not checked: whether orders.csv is the complete export, so if the number matters, hand the calculation to your
  data team." (after a semicolon it read as a second thing that was not checked). The line replaces the old standalone "Not checked: …" line
  under the figure; the "Checked against" / "Not checked" ledger below stays. It never says the answer is right: it says what ran and what did
  not. Length: about 34 words for every caveat the demo's own data produces (the first sentence is 13 words, the next step 12, the caveat at
  most 7: "whether refunded and pending orders should count"; `answer.test.ts` works it out from `dataFacts(bundledOrders())` and
  `notCheckedList`, it is not typed in). A caveat built from a viewer's own data (a status column with up to eight values) makes it longer
  and is kept whole: cutting an item to fit would change what it says, and the ledger is where the whole list is. The "Add a house rule" link goes to the landing's explainer, not to a rule editor, and the demo cannot re-run after a rule or a lock, so
  the line never tells the viewer to add one. (The line restates the seal in body text on purpose: the seal is 12px mono, and a viewer who
  skips it still gets the verdict here. What a miss means, "4 of 12 deliberate breaks went unnoticed by your checks", is the ledger's.)
- **One filled control: the hand-off** ("Hand this to your data team (download)", `start/RunPanel.tsx` `Handoff`, handed to the card's
  `primaryAction` slot and first in its action row; it keeps its title, its busy state and its `role="status"` line, which wraps under the
  row). "Lock this answer" / "Locked" is a quiet secondary control on a card that HAS the hand-off (a ring, no fill; locked is the same ring in
  indigo with the padlock); "See the calculation" and "Add a house rule" were already quiet. The quiet lock follows the slot, not the page's
  variant: the card takes `fd-ac--handoff` exactly when `primaryAction` is given, so a start card whose hand-off is not on offer (the eject
  module did not load, or the answer cannot be ejected) keeps a filled lock and still has exactly one filled control. The landing's
  illustration has no hand-off, so its lock stays the one filled control there. The download is real in both modes (the engine's eject); the
  module loads as soon as a run starts, so the button is there when the answer is.
- **The lock that came with the demo, and "Version 4", said in place.** The note beside the pre-set "Locked" is one sentence,
  `model/agreement.ts` `SEEDED_LOCK_NOTE`, "This lock comes with the demo file." (the rail says the same of the whole agreement, `SEEDED_NOTE`,
  "This agreement comes with the demo file."; the landing's illustrative rail says "Confirmed by you · on this page only" after a press of
  its Confirm, the card's own words, not a typed date, since nothing is saved there either). It does not say "saved earlier": the demo installs the agreement in this visit, as saved steps
  of its own after the file loads (the engine's history shows it), and the seeded lock's date is a fixed design date, not a clock reading.
  It sits in one note under the action row with what the lock means in this mode (`lockedHelp`: for that lock the help starts at "This demo
  can't write a later version; on your computer every later version has to give this same list.", since the note already says it is locked;
  a lock the viewer makes keeps "Locked, and kept with this answer." first), only while that lock is the one that came with the demo. "Version 4" is the engine's count of saved steps, not of answers: step 1 is the starting point (the engine's initial
  image, not an answer), 2 loading the file, 3 installing the demo's agreement, 4 the first answer (`stageData.test.ts` replays the bundled
  recording through the real engine and pins this). In the demo, a second caption line names exactly the saves before the answer, in the
  order they happened (`model/answer.ts` `versionNote`: "Versions 1 to 3 were the starting point, the file and the demo's agreement; this is
  the first answer."; the basic-checks fallback, whose agreement recording is missing, gets "Versions 1 and 2 were the starting point and the
  file; this is the first answer."), and only when every save before the answer is one of those three kinds AND the saved spec is the answer's
  own function's (each save carries the function it is about): a save the viewer made (an earlier answer, a lock, a ruling, or the spec of a
  question they typed, which the page saves when it is asked: a spec for ANY OTHER function) gets nothing new, so a viewer who typed a question
  and then asked the recorded one reads "Version 5" with no claim about save 4. A local copy gets nothing new either: `versionNoteFor` is the
  demo-only gate (a copy on your computer installs the same agreement, so only the mode keeps the line off it; `RunPanel.tsx` calls it and a
  source pin keeps it from calling `versionNote` directly). `stageData.test.ts` replays both runs through the real engine (the plain first run,
  and a typed question saved before it) and pins the saves, the function each names and the note.
- **The landing's answer card is held as a compact skeleton, and released at its natural height** (`Stage.tsx`, `stageData.ts` `cardReleaseMs` and
  `cardHeld`, `AnswerCard.css` `.fd-ac--landing.fd-ac--held`). While the illustration plays, the card is five bars and its caption (about 300 px,
  not the answer's 1,174 px at 1440 and 1,747 px at 390): the veil is in flow, and the body stays in the DOM but is `display: none`, so it is out of layout and
  out of the accessibility tree (the card is named "Answer held until every check passes" and is `aria-busy`). The stage releases the card with a state
  change at the scenario's reveal (6.9 s), not with a CSS delay on a card that was already tall, so the same reveal (seal hairline, rise, veil fading,
  rows 60 ms apart) starts at that moment. The page under the stage moves down once (873 px at 1440, 1,446 px at 390); a viewer whose window starts
  below the card's top (`stageData.ts` `keepsPlaceAtRelease`: the card's top edge is above zero, so they are reading the evidence, or on a phone the
  agreement under the card) is moved back by the same distance in a layout effect, so their line does not jump (Chrome's own scroll anchoring does
  not do it here, and Safari has none), while a viewer who can see where the card begins is watching it and sees it fill from there. The first
  version only corrected a viewer whose window was wholly past the card (its bottom edge above zero), which at 1440 is the 24 px before the evidence
  section; a viewer 60, 150 or 300 px into the evidence still saw all of it leave. The boundary is where the card's top crosses the window's top
  (at 1440: the evidence section 325 px down the window). "Run again" and the other scenario go back to the skeleton in the same render (no frame of
  the tall card); "Watch it stop and ask" keeps the skeleton until the viewer decides. Reduced motion: no playback to wait for, so the pass scenario's
  card is released at once at its natural height (no animation), and the stop scenario's is still the skeleton. The first-run pages' held card is
  unchanged (a veil over the answer's height).
- **What "Confirm" does**, said once under "What the AI assumed": "Confirming only marks a line on this page; nothing is saved, sent or
  checked." It is the viewer's own mark on this run's answer, kept by the page's session for the life of the run (`session.confirmed` and
  `session.confirm`, keyed by run and question; the landing's card keeps its own): Step by step's Back and Forward, and a walk to the Full
  view and back, show it again, and a new run, another question, other data or a reset starts with none (a session that resumes with no run
  brings none, so a fresh run that gets an old run's number cannot inherit its mark). It never reaches the engine, the checks or the
  download (`provenance.json` records the AI's notes, not confirmations), and it is lost when the tab is closed. `replay-check.mjs` 3g clicks
  it and asserts no new saved step, no transcript entry and no request, and the Step by step walk presses Confirm on pane 5, goes Back to
  pane 3 and Forward again and asserts it is still there.

### Your own file in the demo (`#/start` and `#/zen`, replay only)

The public site plays back recorded answers, and only some questions about `orders.csv` have one (`sales-q3.csv`, the other
sample, has none: every question about it reads "needs your computer"). The page says so before a file of your own is dropped, keeps
a way to see a full run in sight after, and says how to run it on your computer without leaving the page. Every word below is
drawn in the demo only; a copy that runs on your computer renders exactly as it did (each is a pure view function that is null
or unchanged in live mode, tested in both modes: `ownFileCaveat`, `ownFileRegion`, `showOwnFileNote`, `zenPickerFold`,
`forwardLabel`, `runLocallyView`; and `replay-check.mjs` 3f stubs the generation service's health check to look at a live page,
including what a refusal does to the picker there).

- **One caveat, before.** Under the drop zone, in the picker of both pages (open with nothing bound, or opened with "Change"
  while a sample is bound): "In this demo, only some questions about the sample file orders.csv have recorded answers. Your
  own file loads and previews here; asking about it needs the version on your computer." (`start/startView.ts`
  `DEMO_OWN_FILE_CAVEAT`, one constant). It is worded to agree with the question pane's legend ("This demo has recorded
  answers for one question; the others need the version on your computer"), and `start/ownFileCaveat.test.ts` ties it
  to the real recordings: some orders.csv questions answerable, none on sales-q3.csv, so it never says "the sample files".
- **The picker stays open after your own file binds** (`startView.ts` `pickerFold`, the rule both pages share: the fold never
  hides the own-file note or a refusal), so the two sample files stay in sight. Step by step used to close it unconditionally,
  and the sample buttons vanished at the moment the note said to try one. "Change" then moves focus into the picker rather
  than closing it, and says "Change" with `aria-expanded` true (on the Full view that is so also when the picker was opened
  by hand first). The two pages differ in one clause: the Full view's picker has always held a refusal open, in both modes;
  Step by step's goes through `zenPickerFold`, which holds it open for a refusal in the demo only, so on a copy that runs on
  your computer a refusal leaves the picker as it was before this path existed (the chip's button says "Close" and folds
  it; the refusal stays under the chip). In the demo, a refusal left over from the sample's own set-up (`session.ts`, a
  failed seed install writes to the same `intake.problem`) would also hold the picker open when the viewer comes back to
  pane 1; that is an error path, and the message it shows is still the engine's own.
- **A short note directly above the samples** (Step by step: a status region that exists, empty, before it has words, between the
  caveat and the samples; the Full view keeps its note inside the drop zone): "Your file stays in this browser. To see the checks
  run, try orders.csv." (`DROP_NOTE`; pasted rows get `PASTE_NOTE`, "Read in this browser. To see the checks run, try orders.csv.", on the Full view's
  paste tab and on Step by step, which picks by the name the session gave the data: `ownFileNote`). It names the sample that has
  recorded answers, from the caveat's own constant, because `sales-q3.csv` sits right beside it and has none ("try a sample
  file" sent a click there, to a pane where every question reads "needs your computer"). The notes no longer repeat the caveat.
- **The forward button says what it opens** (`zen/flow.ts` `forwardLabel`): with your own file bound on pane 1 it reads "See
  what's in your file", secondary, still enabled and still the button that takes focus (pane 2 is where the columns and the
  suggested questions are, and the note about columns read as text). Every other pane and case is as it was: "Continue" /
  "Run the checks", primary.
- **How to run it, inline** (`model/runLocally.ts`, one set of strings; `components/DemoNote.tsx` `RunLocally`): what you need
  (Node ^20.19 or >=22.12; Codex CLI 0.157 or later, `npm i -g @openai/codex`, signed in with `codex login`; no API keys and no
  other account), the three commands exactly as the README gives them (`git clone … && cd undefined`, `npm install`,
  `npm run dev`; never "one command"), where it opens (`http://localhost:5173/#/zen`), and the README link for the full steps.
  `model/runLocally.test.ts` reads `README.md`, the root `package.json` engines and the site's `vite.config.ts` and fails when
  the Node range, the Codex version, a command or the address drifts from either (it also ties the root `dev` script, the clone
  URL to the repository `package.json` names, and the two documents that restate the range). On Step by step's dead end (pane
  2, and pane 3 when it is reached) it follows the no-recording sentence: one plain sentence for someone who does not run
  commands ("If this is not your world, send this page to someone on your data team.", set so its last line is never one
  word) and the steps in a real `<details>` ("How to run it on your computer"). The steps START OPEN, so the list and the
  commands are on the page where the dead end is, not behind a click; the viewer can fold them away, and the fold is kept
  (`runLocallyOpen`, a signal flipped by the summary's own click: typing a question and pressing Enter redraws the message,
  and the browser's own "toggle" report would arrive too late to keep it). Back and Continue sit below the steps: at 390 px
  pane 2 with the steps open is about 1760 px tall. The status region the buttons are described by holds only the sentence.
  On the landing, the HONEST LIMITS card lists the same steps as a plain list (no card inside the card) above its README
  link; in the demo the closing card sits under the zip card (two columns from 809 px, where the grid first fits two columns) because the limits card is the
  tall one, and a copy that runs on your computer keeps the layout it had. The two columns end level at every two-up width, not by luck of the copy
  (grid rows `auto 1fr` with stretching items: the closing card takes what the limits card needs beyond the zip card, or the limits card stretches
  to the closing card's bottom; measured 0 px apart at 1440, 1280, 1180, 1100, 1024, 900 and 810; before it the limits card ended 48 px short at 1180,
  96 at 1024 and 143 at 900). The commands are set in the mono face and wrap (pre-wrap, at a URL's seams) instead of
  scrolling, so nothing scrolls sideways at 390 px.
- **The dead end has a way out** (`start/derive.ts` `noRecordingView`, `sampleOffer`; the same sentence on the Full view's Ask card and
  on the card that follows a press of Ask, and on Step by step's panes 2 and 3; the answer card's held caption no longer says it, only
  "Nothing was checked, so no answer is shown."). For a
  file of your own (and for sales-q3.csv, which has no recording either) the sentence no longer ends "Try a sample file for now.", a
  way out nothing on the page could act on. It names the sample and the question it has a recording for, and its action is a real
  button: "In this demo, answers are recorded, so questions about your own file need the version on your computer. “Who are our top
  customers by revenue?” has a recorded answer on one sample file: switch to orders.csv." The button (`session.useSample('orders')`,
  which selects that sample's opening question, `DEFAULT_QUESTION_ID`, the very question the sentence names) puts focus on the way
  forward (Ask on `#/start`, Continue on `#/zen`). It is said once on the no-recording card: the button inside the sentence is the only
  control for it (the card's action row used to add a second "Switch to orders.csv" button, or a "Try “…”" button for the other question,
  and the held answer's veil said the whole sentence a third time); the row keeps only the link to run it on your computer.
  "Only some questions about orders.csv" stays
  true: the sentence names ONE question, not the file, and `start/ownFileCaveat.test.ts` opens the sample against the real recordings and
  fails if that question has none. A viewer already on orders.csv gets the existing `try it` for the other question, never this.
- **Not done here:** the suggestion generator still offers questions that mean little for an own file (it works from column
  types alone: model/questions.ts); the landing's hero and closing buttons are as they were; "Paste data" and the paste form's
  "Back" still drop focus to the page (as before this path existed; changing it would change a copy that runs on your computer).

### Suggested and typed questions (`#/start` and `#/zen`)

- **Order.** Chips this page can answer come first (a recording, or an answer already on file), the ones that need the
  version on your computer after them, each group in its own order (`start/AskCard.tsx` `chipsOf`). Until what can be
  answered is known nothing moves.
- **One wording for one question.** A question is said in its own words (`model/questions.ts`: `label` is `text`, written once, for
  the samples and for a file of your own): "Who are our top customers by revenue?" is the chip, the "Asking:" line, pane 3's
  "Before you see an answer to …", the trace's header, "You asked", and the sentences that point at it. The chip used to read "Top 5
  customers by revenue" over an "Asking:" line that read "Who are our top customers by revenue?", because the button text and the
  question were typed apart. The old button words are kept as an `alias` that `matchQuestion` still reads (typing "top 5 customers
  by revenue" selects the chip, adds nothing); nothing draws them. The answer's own title ("Fig. 1 · Top 5 customers by revenue") is
  not the question: it is worked out from the answer (`model/answer.ts`).
- **"needs your computer"** is the chip tag for a question the demo cannot answer (`start/AskCard.tsx` `NEEDS_YOUR_COMPUTER`, one
  constant both pages draw): the phrase the sentences use for the same thing, so it means something without its legend ("needs live"
  did not, and "live" already means three things on the page). One line says why, near the chips whenever any chip carries the tag in
  replay, and does not begin by repeating it: "This demo has recorded answers for one question; the others need the version on your
  computer." (the number is counted) with the "How to run it on your computer" link (`RUN_LOCALLY_URL`, the README). Step by step's
  dead-end message carries the steps instead (below), and the README link as their last line, and says the same thing, so while that
  message is on a pane the legend is not drawn there (`AskCard.tsx` `legendUnlessDeadEnd`), and a tag that would mark EVERY chip is not
  drawn either (`tagsTellApart`: Step by step tags the chips that need the computer only when some other chip can be answered, which is
  when a tag tells them apart). An own file's pane 2 used to say "needs the version on your computer" five times (three chip tags, the
  legend, the sentence, and the how-to heading; six while a question was typed, whose note said the reason again) and now says it twice:
  the sentence (why, and the way out as a button) and the "How to run it on your computer" heading (where to go to do it). The note under
  the typing box only says what happens to the words ("In this demo, a question you type is added to the list, but it has no recorded
  answer."). On a sample where one question has a recording, the other chips keep the tag, and the count stays in the legend whenever no
  dead-end sentence is shown. `replay-check.mjs` 3b2 counts "your computer" on the pane. The Full view keeps its tags and its legend,
  which has the README link, beside the sentence under Ask.
- **Typing a suggestion's own words** (a label or its plain-words form, any case, spaces, ending punctuation or quote marks)
  selects that chip and adds nothing (`model/questions.ts` `matchQuestion`).
- **A question the demo cannot answer** (typed or suggested, replay only) is tagged "needs your computer" alone: no level is claimed
  for a calculation that will never run here, and the line under Ask is just the no-recording sentence. In live mode, and for
  questions that can be answered (recorded, or Full checks), tags and wording are as before.
- **`try it`** in the no-recording sentence ("“Who are our top customers by revenue?” has one: try it.") is a real button that selects
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
| 06 Stress test: 12 deliberate breaks | Mutation check (`Engine.runMutation`, `state.mutation`, `Evidence.mutation`) |
| Version N | Revision `rN` an accepted draft was committed at (`Artifact.revision`; the answer card's caption and the honesty bar). NOT `state.headRevision`, which also counts binding a file, installing the demo's agreement, locking and rulings; the first run's bar shows no version until one is committed, and the landing's reads "Example answer: Version 4" (`STAGE_VERSION`, pinned by a test that replays the bundled recording). Versions before the first answer are saves of the demo file being set up (the starting point, the file, the demo's agreement); the card says so in the demo (see "The answer card") |
| Lock this answer | `Engine.pinResult(entryId)` |
| Draft thrown out | A rejected `AttemptView` / `Candidate` |
| A question only you can answer | A rejection whose diagnostic carries `silentOn` → `Engine.gapQuestion(ref)` → `Engine.decide(ref, choice, {reason})` |
| It says no | `GenerationView.declined` (decline protocol: `cannot-be-pure`, `needs-spec`) |
| What the AI will see / 3 example rows | `Engine.previewDataset().sampleText`, `typeDecl`, `Engine.setSendSamples`, `Candidate.prompt` |
| Hand your data team a file | Eject (the engine's `eject/eject.ts`, called by `model/handoff.ts`) |
| How to run it on your computer | The README's "Run it on your computer" section, in the demo's own words from `model/runLocally.ts` (what you need, three commands, where it opens): the landing's HONEST LIMITS card (`#own-file`) lists them and links to the README, so does the demo's second hero button ("Use your own file: run it on your computer"), and Step by step's dead end opens them inline |
| needs your computer (the chip tag; in the code `needsLive`) | Replay mode, a question with no bundled recording for the spec it would run against (`Availability` 'none'): it can only be answered by the version on your computer |
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
   can watch"). It is labelled as an illustration, once, in the caption under the trace ("Illustrative playback of the example
   below, slowed down"; the trace's header, footer and timer do not say it again); the evidence section (6 of 6, 100, 11 of 12, 1
   thrown out, and the stress-test strip they open) carries ONE "Illustrative · these four figures are not from a recorded run" label, above its tiles (scoped to the four figures, because the stress-test tile also holds a recorded result), until a
   recording backs them (`landing/evidenceView.ts`:
   the counts come from the seeded agreement, the outcomes are scripted; only the thrown-out draft's "Why" is computed). The one thing a
   recording does back is the stress test's result on the demo's own run, so the stress-test tile quotes it beside the illustrated 11 of 12,
   marked "Recorded run: the stress test caught 8 of 12 deliberate breaks. orders.csv, the same question, Version 4. Its first draft was
   accepted. The "Watch it pass" playback above throws one out, to show what a rejection looks like." (it names the playback: "Watch it stop and ask" throws nothing out), with a "Run it yourself" link to Step by step
   (`evidenceView.ts` `recordedRun`, in the seal's own words, `stressWords`). The numbers are the pinned constant `stageData.ts`
   `RECORDED_STRESS` (12 deliberate breaks, 8 caught, 4 missed; no draft thrown out). The recording holds the AI's draft, not this count: the
   8 of 12 is what the real engine's stress test reports each time that draft is replayed through it (deterministic, so it can be pinned), which
   is why "Recorded run" labels the run and the engine, not stored text, produces the number. `stageData.test.ts` replays the bundled recording
   through the real engine, lets its stress test finish (`engine.runMutation`) and fails if the engine reports anything else, and
   `scripts/replay-check.mjs` compares the landing's line with the count the real replay reports in the browser. The label used to say
   "not yet a recorded run", which is false of a page that quotes one.
3. The "two rules that disagree" question has no engine signal; it exists only as the landing's illustration.
4. Checked, not proven. The honesty bar and the "Not checked" list are always present.
5. Privacy copy states exactly what leaves the browser; the example-rows switch is wired to `Engine.setSendSamples`
   (and, in replay mode, nothing is ever sent; say that).
6. The seal appears only when every check that will run has finished, and the ledger never changes after the reveal. The
   stress test (check 06) runs last, after the commit, so the answer and the trace's verdict stay held until it has
   finished (`start/derive.ts` `outcomeOf`) and are then revealed together: the seal reads `Passed every check · stress
   test caught N of M` (N and M from the engine's mutation report, the same count lane 06 shows, `model/lanes.ts`
   `stressStatus`); misses are listed under Not checked, and a stress test that did not run is said so (`Passed 5 of 6
   checks · stress test didn't run`), never as "every check". The check is called the **stress test** and the things it does are
   **deliberate breaks**, on every surface (`model/lanes.ts` `stressLabel`, `deliberateBreaks`, `stressChecked`, `stressNotChecked`,
   `stressWords`; the landing's script and evidence strip read the same functions): the lane "Stress test: 12 deliberate breaks"
   (before a count exists: "Stress test: deliberate breaks"), the seal "stress test caught 8 of 12" (unchanged), the "Checked against" line
   "stress test (caught 8 of 12 deliberate breaks)" (`stressChecked`; the trace footer under lane 06 reads the same function without the unit,
   "stress test (caught 8 of 12)", since lane 06 a line above has named them and a longer footer wrapped to a third line, which made the
   Checking pane 915px tall at 1440x900, so a count cannot be said two ways), the "Not checked" line
   "4 of 12 deliberate breaks went unnoticed by your checks", pane 3's sixth row, and the landing's "In this illustration, the stress test made
   12 deliberate breaks in the calculation. Your checks caught 11." One place keeps another word order on purpose: lane 06's own result cell
   ("8 of 12 caught" and "4 missed" under it, and its accessible name "Stress test: 12 deliberate breaks: 8 of 12 caught, 4 missed"), a tight
   cell directly under the lane's label, which has already named the breaks; the live lane (`lanes.ts` `stressResult`) and the landing's
   scripted one (`traceScript.ts`) say it the same way, so they change together if it ever changes. Before this, the same check was "we broke it 12 small ways on purpose",
   "small breaks on purpose", "12-way stress test (8 caught)", "small breaks caught on purpose" and "it breaks the calculation in small
   ways on purpose"; the footer and the ledger also counted a time-boxed run two ways ("caught 7 of 12" and "7 of 12 caught"), and now read one text.

## Source layout (all new code under `apps/site/src/door/`)

```
main.tsx                  entry for index.html; boots the engine once, renders <App/>
App.tsx                   hash router (#/ , #/start, #/zen), skip link, <main id="main">
tokens.css  base.css      design tokens (colours, shadows, radii, type) and page base; self-hosted Geist + Geist Mono
icons.tsx                 inline SVG glyphs from the design (check disc, thrown-out square, ask diamond, lock, arrow, replay, file, …)
components/               presentational + small stateful pieces shared by both pages (one .tsx + one .css each)
model/                    pure, unit-tested view-models (no DOM): figures, lanes, trace script, answer, agreement, questions, samples, privacy, runLocally (the README's steps, tied to it by a test)
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
  (`recorded.ts` levelFor). Today, on the replay site (`orders-agreement.json` is bundled): "Who are our top
  customers by revenue?" installs the agreement and replays with Full checks (Chef Ravioli Starbright $2,252.07 first, already
  locked); with that recording unavailable or stale it falls back to the spec-less `orders.json` session and replays with
  Basic checks (Puddlesworth Inc $2,599.13 first, every row counted). "How many orders are there by status?" and "What is
  our revenue by country?" end in the honest no-recording state either way, which points at the question that has an answer. `npm run
  check:replay` drives both paths (the second by serving the recordings index without the agreement's recording).
- **Recording the agreement** (`npm run record:door`, i.e. `node apps/site/scripts/record-door.mjs`): starts the vite
  dev server (live mode: it uses YOUR Codex login and spends model calls), opens `#/start` on a fresh image in headless
  Chrome, and drives the page's own session (`sessionFor(engine)`): bind orders.csv as `rows`, select "Who are our top customers
  by revenue?" (the agreement is installed), Ask. Only a committed run is kept (up to 4 tries); the number of tries, the
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

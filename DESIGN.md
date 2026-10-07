---
name: Undefined
description: A calm bench of light paper surfaces around one dark, live check trace, where an AI's work is checked in front of a spreadsheet owner before any answer is shown.
colors:
  indigo: "#3D3BF3"
  indigo-hover: "#2B29C9"
  indigo-wash: "#EEEEFE"
  indigo-soft: "#8B8AFF"
  indigo-ring: "rgba(61, 59, 243, 0.24)"
  ink: "#0B0D12"
  ink-2: "#3A4150"
  ink-3: "#5A6373"
  bg: "#F6F7F9"
  surface: "#FFFFFF"
  surface-2: "#F0F2F6"
  surface-3: "#FBFBFD"
  line: "#E3E6EC"
  line-2: "#CDD2DB"
  green: "#17A36B"
  green-ink: "#0B6B43"
  green-wash: "#E7F6EE"
  amber: "#F6B73C"
  amber-ink: "#7A4A00"
  amber-wash: "#FFF5DE"
  red: "#9E1C2A"
  trace-bg: "#0C1016"
  trace-dot: "#1A212B"
  trace-lane: "#121821"
  trace-cell: "#19202B"
  trace-border: "#222A35"
  trace-border-2: "#303A47"
  trace-text: "#EDF0F4"
  trace-text-2: "#A8B2C0"
  trace-text-3: "#808A99"
  trace-pass: "#33C793"
  trace-pen: "#D2FF3F"
  trace-ask: "#FFB547"
  trace-ask-bg: "#2E2310"
  trace-fail: "#FF5A4E"
  trace-fail-bg: "#2F1412"
  trace-ink: "#07090C"
typography:
  display:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(40px, 5.2vw, 64px)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(26px, 3vw, 36px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title-lg:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "34px"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.015em"
  title-sm:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "normal"
  row:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
    letterSpacing: "normal"
  body-sm:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "normal"
  caption:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "19px"
    letterSpacing: "normal"
  control:
    fontFamily: "Geist Variable, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "18px"
    letterSpacing: "0.06em"
  mono-data:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "17px"
    letterSpacing: "0.01em"
    fontFeature: "'tnum', 'zero'"
  stat:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: "44px"
    letterSpacing: "-0.02em"
    fontFeature: "'tnum', 'zero'"
  figure:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "56px"
    fontWeight: 500
    lineHeight: "60px"
    letterSpacing: "-0.02em"
    fontFeature: "'tnum', 'zero'"
rounded:
  xs: "2px"
  sm: "6px"
  md: "10px"
  lg: "16px"
  xl: "20px"
  pill: "999px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "48": "48px"
  "72": "72px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-3}"
  button-ghost-link:
    backgroundColor: "transparent"
    textColor: "{colors.indigo}"
    typography: "{typography.control}"
    padding: "0 4px"
    height: "44px"
  button-ghost-link-hover:
    textColor: "{colors.indigo-hover}"
  chip-question:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "44px"
  chip-question-selected:
    backgroundColor: "{colors.indigo-wash}"
    textColor: "{colors.ink}"
  segmented-track:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  segmented-item-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  switch-off:
    backgroundColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    width: "40px"
    height: "24px"
  switch-on:
    backgroundColor: "{colors.indigo}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  card-answer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  card-trace:
    backgroundColor: "{colors.trace-bg}"
    textColor: "{colors.trace-text}"
    rounded: "{rounded.xl}"
    padding: "24px"
  card-question:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  card-saved:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  panel-checked:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  panel-not-checked:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "19px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "48px"
  lane:
    backgroundColor: "{colors.trace-lane}"
    textColor: "{colors.trace-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    padding: "4px 12px"
    height: "44px"
  lane-stopped:
    backgroundColor: "{colors.trace-ask-bg}"
    textColor: "{colors.trace-ask}"
  tick-passed:
    backgroundColor: "{colors.trace-pass}"
    rounded: "{rounded.xs}"
    width: "10px"
    height: "14px"
  tick-thrown-out:
    backgroundColor: "{colors.trace-fail}"
    rounded: "{rounded.xs}"
    width: "10px"
    height: "14px"
  honesty-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    height: "40px"
---

# Design System: Undefined

## Overview

**Creative North Star: "The Lab Bench"**

A calm bench with one live instrument. The page is light paper: a cool off-white ground (#F6F7F9), white cards, hairline rings. Around those quiet surfaces sits the one dark thing, the check trace, where the work visibly happens: lanes fill, a lime pen sweeps across them, a draft is struck through in red or an answer is released. Everything else on the page exists to frame that instrument and to carry what comes out of it. The voice of the whole system is calm, exact, plainspoken.

The density is low and the rhythm is one thing at a time: one question, one answer, one proof. Geist sets the words, Geist Mono sets measurement (counts, file names, figures, state words on the trace), and indigo is the single accent that marks the one action, the selected state and the link. Green, red and amber are not accents; they are verdicts, spent only on outcomes (passed, thrown out, ask), and never alone: each travels with a drawn glyph and a plain state word. What the checks did not cover is drawn as a dashed panel next to the solid one that says what they did.

Two looks are rejected outright. This is not an "AI chat" look: no sparkle icons, gradient text, chat bubbles or glossy AI-brand cues, because the product checks the AI and does not celebrate it. And it is not a dense BI dashboard: no chart-heavy, filter-everywhere analytics layout, because the page shows one question, one answer and one proof at a time.

**Key Characteristics:**
- Light-only theme; one always-dark surface (the check trace, `trace-*` tokens) inside it, not a dark mode.
- Indigo is the single accent; verdict colours (green, red, amber) mean outcomes and are always paired with a glyph and a word.
- Cards are tonal white surfaces held by a 1px ring with soft offset shadows; depth is spent on state (an answer rises when it is released).
- Geist for text, Geist Mono for measurement and labels, self-hosted; tabular, slashed-zero numerals.
- Solid ring means established; dashed edge means not checked, not confirmed, illustrative, or a stated limit.
- 44px minimum targets, a visible 2px indigo focus outline, reduced motion that lands on the finished picture, and a layout that holds down to 390px.

## Colors

A cool, near-neutral paper palette with one electric indigo, three verdict hues kept for outcomes, and a separate night-blue family that belongs only to the check trace.

### Primary
- **Signal Indigo** (#3D3BF3): the one accent. Primary buttons, links, the selected state of chips and rows (as a 1px or 1.5px ring), switch-on, the focus outline, the answer card's seal hairline, and the single accent phrase in the hero headline.
- **Pressed Indigo** (#2B29C9): hover and pressed state of everything Signal Indigo fills or colours; also the text colour on a selected indigo wash.
- **Indigo Wash** (#EEEEFE): the selected or lit background (selected question chip, lit ladder column, drag-over drop zone, locked answer button, answer lead bar).
- **Soft Indigo** (#8B8AFF): quiet progress and cross-reference only: completed segments of the step rail, and the outline of a trace lane highlighted from an agreement line.
- **Indigo Press Tint** (rgba(61, 59, 243, 0.24)): the pressed background of the "Change" text buttons.

### Neutral
- **Bench Ink** (#0B0D12): headlines, body text, answers; the primary text colour.
- **Body Slate** (#3A4150): secondary text, lede paragraphs, unselected control labels.
- **Quiet Slate** (#5A6373): captions, figure captions, eyebrow labels, meta lines.
- **Bench Paper** (#F6F7F9): the page ground.
- **Card White** (#FFFFFF): cards, the top bar, the honesty bar, inputs, and the text colour on indigo.
- **Recess Grey** (#F0F2F6): recessed fills: segmented-control track, the veil over a held answer, pressed states, read-back question, code blocks.
- **Lifted Paper** (#FBFBFD): the faintest step above white: table heads, the "Not checked" panel, secondary-button hover.
- **Hairline** (#E3E6EC): the 1px ring of cards and dividers.
- **Control Edge** (#CDD2DB): the 1px ring of buttons and chips, input borders, dashed edges. (The off-state switch track is not a Control Edge: it is Quiet Slate, so the control reads at 3:1 or better.)

### Verdict Colors (tertiary, functional)
- **Passed Green** (#17A36B): the passed disc, ticks and the live-mode dot; **Passed Ink** (#0B6B43) for green text; **Passed Wash** (#E7F6EE) behind a saved house rule.
- **Ask Amber** (#F6B73C): the 1px edge and diamond of a question only the user can answer, and the missed break in the stress strip; **Ask Ink** (#7A4A00) for amber text; **Ask Wash** (#FFF5DE) as the card fill, and as the fill of a problem notice.
- **Thrown-Out Red** (#9E1C2A): the one red on light surfaces, used as text and as the drawn crossed square for a draft that was thrown out. There is no red wash and no red card edge.

### The Trace (always-dark)
- **Trace Night** (#0C1016) is the ground, textured with an 8px grid of **Trace Dot** (#1A212B) pin-dots; **Trace Lane** (#121821) and **Trace Cell** (#19202B) are the lane and waiting-cell fills; **Trace Border** (#222A35) and **Trace Border 2** (#303A47) are its dividers and dashed edges. Text steps down through **Trace Text** (#EDF0F4), **Trace Text 2** (#A8B2C0) and **Trace Text 3** (#808A99).
- **Trace Mint** (#33C793) is a passed cell, **Trace Fail** (#FF5A4E) over **Trace Fail Wash** (#2F1412) is a thrown-out draft, **Trace Ask** (#FFB547) over **Trace Ask Wash** (#2E2310) is a lane that stopped to ask. **Pen Lime** (#D2FF3F) is the live pen: the sweep line, the running lane's 1px ring, the seal hairline, the running timer. **Trace Ink** (#07090C) is the dark text that sits on a lime badge and the ring around the pulsing dot.

### Named Rules
**The One Voice Rule.** Indigo is the only accent. A second accent hue would read as a second claim; verdict hues are outcomes, not decoration.

**The Instrument Rule.** Dark is the check trace and the surfaces that quote it. It is never a theme, a page background or a card background. The build quotes the trace in the Fig. 3 version board and the order-of-work "check" step; pen-lime appears on light only as the pulsing mode dot. The first run's three "How it works" numerals are plain Recess Grey chips, none filled dark or tinted, so none reads as the current step.

**The Honest Seal Rule.** Coverage is encoded in the seal, never by colour alone, and the seal waits for every check that will run. While the stress test is still to come the answer stays veiled and the trace says "stress test next…" or "stress test running…". Full checks: a solid green disc with a check, with the words PASSED EVERY CHECK · STRESS TEST CAUGHT 8 OF 12, revealed together with the answer. If the stress test could not finish, the disc is a partial ring and the words say what ran ("Passed 5 of 6 checks · stress test didn't run" or "… ran out of time"); the seal never says "every check" then. Basic checks: a neutral ink ring of six arcs with two drawn and four empty, in ink not green, with PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET. Deliberate breaks the checks missed are named under Not checked ("4 of 12 deliberate breaks went unnoticed by your checks") and a missed-break line in Checked against uses the amber diamond, not the green disc. After the reveal nothing in the ledger changes. On the trace each lane's verdict is a word beside a drawn glyph: Passed, Thrown out, Not checked.

## Typography

**Display Font:** Geist (variable, 100-900; with Geist, ui-sans-serif, system-ui)
**Body Font:** Geist (the same family)
**Label/Mono Font:** Geist Mono (variable; with ui-monospace, SFMono-Regular, Menlo)

Both families are self-hosted through @fontsource-variable (latin and latin-ext subsets, `font-display: swap`); no third-party fonts or scripts load.

**Character:** Geist is a plain, even sans that reads like a well-set form; headings are heavy (600) and tightly tracked, body is regular at 16px/24px. Geist Mono, with tabular slashed-zero figures, is the measuring tape: it sets numbers, file names, counts, verdict words on the trace and the labels above sections.

### Hierarchy
- **Display** (600, clamp(40px, 5.2vw, 64px), 1.04, -0.035em): the landing headline only.
- **Headline** (600, clamp(26px, 3vw, 36px), 1.15, -0.025em): landing section titles, and the first-run page title (the same step, not a smaller copy of it).
- **Title Large** (600, 28px, 34px, -0.02em): the step-by-step pane heading; the answer's lead name and the closing claim use 28px/32px at -0.015em.
- **Title** (600, 22px, 28px, -0.015em): outcome card headings (a question only you can answer, saved house rule), the privacy and limits cards, and the ladder's "#1 under these rules" name. There is no 20px or 18px step: a heading is a Title (22) or a Title Small (16).
- **Title Small** (600, 16px, 22px): card and panel headings, "Checked against", "Not checked", "What the AI assumed", and the drop zone's instruction line.
- **Body** (400, 16px, 24px): reading text in ink-2 or ink; lede and long copy hold to 48ch (see Layout).
- **Row** (400 or 500, 15px, 22px; `--fd-fs-row` / `--fd-lh-row`): the one step between Body and Body Small, for a name or an amount in a list row (the answer's ranked rows), a radio option, a list of limits, and the top bar's wordmark (600). It is a list-row size, not a paragraph size: running text is Body or Body Small.
- **Body Small** (400, 14px, 20px): supporting lines, list items, notes, trace lane labels.
- **Caption** (400, 13px, 19px): figure captions, helper text, footers, in ink-3 or ink-2.
- **Control** (500, 14px, 20px): the label of every button, chip, segmented item and text link.
- **Label** (Geist Mono 500, 12px, 18px, 0.06em, uppercase): the small mono eyebrow above landing sections, cards and rails (YOUR AGREEMENT, WHAT THE AI WILL SEE, FIG. 2 · …). It is an incumbent pattern, recorded here as shipped; the letter-spacing never exceeds 0.06em. It is not a prompt to put an eyebrow on a new surface.
- **Mono Data** (Geist Mono 500, 12px, 17px, 0.01em): trace headers, counts, verdict words and the footer version line.
- **Stat** (Geist Mono 500, 40px, 44px, -0.02em) and **Figure** (Geist Mono 500, 56px, 60px, -0.02em; 28px/34px when the value is long, 44px/48px at 480px and under): the evidence-strip numbers and the answer's lead value.

### Named Rules
**The Measurement Rule.** Geist Mono carries things that are measured or named by the machine: numbers, counts, file names, verdict words on the trace, and the labels above sections. It never sets running prose.

**The Plain Words Rule.** State words on every surface are the plain ones: Passed, Not checked, Thrown out, Basic checks, Full checks, example, locked answer, house rule, Version N. The labels never say gate, spec, property, fuzz, mutant, revision or pin.

## Layout

A single-column document that opens into two columns only where there is something to hold beside the main flow. Content sits in a centred wrap of at most 1296px with a fluid gutter of clamp(16px, 4vw, 48px); the top bar's inner row runs wider, to 1440px with 16px padding, so on very wide screens its edge is outside the content edge. Reading measure is held to 48ch (`--fd-measure`): Geist's "0" is 0.66em wide and an average letter 0.46em, so 48ch is about 70 characters a line and the longest line runs to about 75 (the old 70ch ran to 100). Spacing is an observed rhythm of literals rather than a token set: 4, 8, 12, 16, 20, 24, 32, 48 and 72px (cards pad 20 or 24px, 32px on the landing's two-up cards; sections breathe 48px, and the landing's larger breaks 72px).

- **Landing:** hero, then the stage (question row, trace, answer card in the main column; the agreement rail beside it), then an auto-fit evidence grid (`minmax(240px, 1fr)`, 24px gap), full-width bands on white separated by hairlines, and two-up cards (`minmax(min(360px, 100%), 1fr)`). The stage goes two-column from about 1115px (640px main plus a 360px rail plus 24px gap).
- **Start (Full view):** the left column (file chip, ask, run, columns) is at least 700px beside a 360px rail; the two columns begin at about 1180px (measured: stacked at 1178px, side by side at 1180px). Once a file is bound the bring-a-file panel (tabs, drop zone, sample cards) folds to a one-line file chip with a "Change" button at every width, so the Ask card and the trace are what the page shows (measured at 1440 by 900: Ask at y 262, the trace header at y 562; it was 568 and 868). Pressing Ask scrolls the trace to 16px under the top edge and focuses it (smooth, instant under reduced motion); a shown answer scrolls into view only if its figure is not already on screen.
- **Step by step:** one centred column, 760px, 24px between panes, with a five-segment step rail above. The pane is in the URL (`#/zen/N`), so browser Back and Forward step one pane at a time; nothing advances by itself: a finished run stays on the checking pane with its verdict until the viewer presses "See the answer".
- **Top bar:** wordmark, file chip, mode pill, then (right) the privacy phrase, check counter and the "Step by step" button. Secondary items drop out as the screen narrows, widest first: the privacy phrase under 1360px, the counter under 1200px, the file chip under 860px; under 640px the bar is two rows (wordmark and button, then the mode pill).
- **Container-driven trace:** the trace lays out by its own width, not the viewport's. At 678px and wider a lane is one row (label, cells, 132px verdict column); under 678px the label sits over the cells with the verdict on the right; under 466px the verdict rises beside the label and the cells take the full row below. The stage's question row switches at 480px of its column, and the file-bring samples sit under or beside the drop card at 640px of their column.
- **Narrow:** works down to 390px with no horizontal page scroll (measured on the landing, step by step and start). Controls become full-width at 480px and under; the honesty bar is sticky at the bottom and wraps rather than clips (at 480px and under it runs its pieces on as one paragraph with no dot: 53px on the first run, 70px on the landing at 390).

## Elevation & Depth

A hybrid of tonal layering and rings. Surfaces step up in tone (Bench Paper, Card White, Recess Grey, Lifted Paper), each held by a 1px ring drawn as a box-shadow, with soft offset shadows only on the surfaces that carry weight. Depth also answers a question of state: the answer card sits nearly flat while it is held under its veil, and rises to its indigo-tinted shadow, with a 4px settle and a drawn seal hairline, when every check has passed.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 0 rgba(11,13,18,0.04), 0 1px 2px rgba(11,13,18,0.06)`): the held answer card.
- **Card** (`box-shadow: 0 1px 0 rgba(11,13,18,0.04), 0 1px 2px rgba(11,13,18,0.06), 0 0 0 1px #E3E6EC`): the standard card (rest plus a Hairline ring).
- **Ring** (`box-shadow: 0 0 0 1px #E3E6EC`) and **Ring 2** (`box-shadow: 0 0 0 1px #CDD2DB`): nested tonal panels and ledger sides (Ring); buttons, chips and request pills (Ring 2).
- **Float** (`box-shadow: 0 1px 2px rgba(11,13,18,0.05), 0 12px 28px -12px rgba(11,13,18,0.18)`): the check trace and Fig. 3 board, the amber question card, the saved house-rule card and the mode-note popover.
- **Answer** (`box-shadow: 0 0 0 1px rgba(61,59,243,0.16), 0 2px 4px rgba(11,13,18,0.05), 0 28px 56px -20px rgba(43,41,201,0.22)`): the released answer card, an indigo-tinted lift.
- **Focus** (`box-shadow: 0 0 0 1px #3D3BF3, 0 0 0 4px rgba(61,59,243,0.24)`): a selected agreement line and a focused text box, a hard-edged ring with no blur.

### Named Rules
**The Ring-First Rule.** An edge is a 1px ring or a tonal step before it is a shadow. Hover darkens the ring (to Quiet Slate, 1px or 1.5px); selection draws it in indigo. Shadows are soft, offset downward with a negative spread, and carry state, not decoration. The running trace lane's old coloured halo was removed; what remains is a 1px Pen Lime ring.

## Shapes

Soft, evenly rounded rectangles, tightened to near-square on the instrument. Cards are 16px; the three big instruments (trace, answer card, Fig. 3 board) are 20px; buttons, inputs and request rows are 10px; nested rows, assumptions and small badges are 6px; trace lanes, ticks, bars and evidence dots are 2px, so the instrument reads as cells and rules rather than pills. Pills (999px) are reserved for chips, the file and sample buttons in step by step, the mode pill, the switch and the radio dots.

Rings are box-shadows, so they do not add to layout. Coloured full borders are 1px (the amber question card, the green saved card). Trace marks are exact: ticks 10 by 14px (8 by 12 in compact lanes), the 100-table grid is 50 columns of 4px cells at 2px gaps (298px wide), stress cells 10 by 10px, the evidence dots 6 by 6px inside a 20px hit area. Icons are drawn inline SVG, 14 to 16px: a green disc with a check, a crossed square for a thrown-out draft, an amber diamond with a question mark, a dashed circle for not checked, a padlock for locked.

### Named Rules
**The Dashed Edge Rule.** A dashed 1.5px edge means not established: not checked, not confirmed, illustrative, not run, or a stated limit. A solid ring means established. Never use a dashed edge for decoration, and never solid for something that was not checked.

## Components

The feel is quiet and exact: controls look like what they are, state is a ring or a wash rather than a flourish, and the only thing that moves much is the trace.

### Buttons
- **Shape:** gently rounded rectangle (10px), at least 44px tall, label in Control type; step by step also uses pill-shaped file and sample buttons (999px).
- **Primary:** Signal Indigo fill, white text, 0 20px padding. Hover goes to Pressed Indigo.
- **Secondary:** Card White fill with a Control Edge ring, ink text, 0 18px padding. Hover tints to Lifted Paper and darkens the ring to Quiet Slate.
- **Ghost link:** transparent, indigo text, 0 4px padding, 44px tall. Hover turns Pressed Indigo and underlines (3px offset).
- **Lock this answer:** the primary look with a 1px indigo border; once locked it becomes Indigo Wash with Pressed Indigo text.
- **Long label:** a button whose label is a sentence (`fd-btn--wrap`, the landing's "Use your own file: run it on your computer") wraps inside it with 10px vertical padding and never runs past its card.
- **Focus / disabled:** a visible 2px indigo outline with 2px offset on every focusable element. Disabled is 55% opacity with not-allowed (or progress while working) and no hover change.

### Chips
- **Question and sample chips:** pill (999px), 44px tall, Card White with a Control Edge ring and ink-2 text; hover darkens the ring; selected is Indigo Wash with a 1px indigo ring and ink text. A trailing mono tag (a count, or a dashed "live only" marker) sits inside.
- **Step by step question rows:** 52px tall, 16px radius, the standard card; selected is Indigo Wash with a 1.5px indigo ring.
- **Agreement lines:** 44px rows, 6px radius, ringed; hover darkens the ring; the selected line takes the Focus ring. A locked line carries a small padlock, and its mono meta line opens with "Locked" in indigo.

### Segmented control
- Recess Grey track, 10px radius, 3px padding. Items are at least 44px tall (10px vertical padding, so a label that wraps grows the item instead of touching its edge), 6px radius; the selected item is Card White with a hairline ring and a soft 1px shadow; hover tints an unselected item.

### Switch
- A 40 by 24px pill track (Quiet Slate off, 6:1 against white, Signal Indigo on) with an 18px white knob, set inside a 44 by 44px button so the target is full size while the drawn switch stays small. The focus outline hugs the track.

### File chip (first run)
- A 52px Card row at 16px left padding: a drawn file glyph, the file line in Geist Mono 13px (`orders.csv · 332 rows · 10 columns`), and a ghost "Change" text button (44px target, 12px padding, Indigo Press Tint when pressed). "Change" opens the bring-a-file panel under the chip and moves focus to its selected tab; it then reads "Close". Picking a file closes the panel and returns focus to the button. The panel stays open, and the button reads "Change", while a refusal or the demo's own-file note is showing.

### Column note (first run)
- Under the column preview, one plain Body Small sentence in Body Slate names the Text columns whose values look like numbers with separators, percents or dates ("Read as text, so questions about totals or dates can't use them as they are: Net Amt (USD), Tax %.") and says what to export instead. It is a note, not a warning: no colour, no icon, no panel, and it never changes how a file is read.

### Cards / Containers
- **Corner Style:** 16px (20px for trace, answer and Fig. 3 board).
- **Background:** Card White; recessed and secondary panels use Recess Grey or Lifted Paper.
- **Shadow Strategy:** the standard Card shadow; see Elevation & Depth.
- **Border:** the 1px Hairline ring (a box-shadow); outcome cards are the only ones with a real 1px coloured border.
- **Internal Padding:** 20 or 24px (32px on the landing's two-up cards, 16px on the compact file-bring card).
- **Nesting:** cards hold tables, code and rows in ringed or tonal panels. The one card inside a card is the answer's ledger, a solid "Checked against" panel beside a dashed "Not checked" panel; that pair is a deliberate signature, not a pattern to repeat.

### Inputs / Fields
- **Style:** Card White, 1px Control Edge border, 10px radius, 48px tall (44px for the reason box), 16px text; paste areas are 13px/20px Geist on a 1px Control Edge border.
- **Focus:** the border goes indigo and takes the Focus ring (the default outline is replaced by it).
- **Error / Disabled:** a problem is a plain Ask Wash notice with ink text, no border; a disabled control is at 55% opacity.

### Navigation
- **Top bar:** Card White with a 1px Hairline underline; the wordmark is Geist 15px 600 (-0.01em) beside a rounded-square mark with an indigo tick. The file chip is a ringed 12px chip. The mode pill is a 13px 500 pill with a Control Edge border and a 6px Quiet Slate dot that pulses through lime while a check runs; it opens a note under it on Float (the note's own dot is green in live mode, Quiet Slate in the demo). Hover and open darken its border.
- **Step rail (step by step):** five segments with a 3px top rule: Control Edge ahead, Soft Indigo done, Signal Indigo now; labels fall away at 480px and under.
- **Honesty bar:** a sticky bar (at least 40px tall) at the bottom, Card White with a 1px Hairline top rule, 12px Body Slate mono text: "Checked, not proven." and the version line (marked "Example answer" on the landing). Wide, the claim sits left and the version and receipt link right, with a dot between; at 480px and under all three run on as one paragraph and the dot is dropped, so it can never hang at the end of a line.

### The Check Trace (signature)
The dark instrument. Trace Night ground with the 8px pin-dot texture, 20px radius, Float shadow, 24px padding. A mono header (draft, question, file, timer), then lanes: Trace Lane rows of at least 44px (28px in the compact variant) with a numbered label, a cell strip and a right-aligned verdict column. A lane in progress carries a 1px Pen Lime ring and a lime pen (a 1px line with a 6px nub) sweeping its cells; a passed lane's cells are Trace Mint; a thrown-out draft's cell is Trace Fail with a red strike line and the word Thrown out; a lane that stopped to ask takes Trace Ask Wash with an amber pen and diamond; a lane that did not run is a dashed Trace Border 2 pill with a plain note. On a pass a 1px lime seal draws along the top. Every static style is the finished state, so with reduced motion it lands on the finished picture. Text the animation hides is also removed from the accessibility tree; an `aria-live` sentence states the result.

### The Answer Card (signature)
A card that earns its depth. It sits under a Recess Grey veil of five skeleton bars with a mono caption ("Held until every check passes.") until the checks pass, then releases: an indigo seal hairline draws across the top, the card rises to the Answer shadow, and its rows settle in 4px staggered 60ms. Top to bottom: the figure caption in Quiet Slate (Fig. 1 · title · what was counted · file · rows · Version N), the seal and level words in mono, the most decisive "Not checked:" line directly under the figure, the lead name and figure, ranked rows with 4px bars in Indigo Wash, "What the AI assumed" (dashed rows until Confirmed, then a solid ring with a green disc), the Checked against and Not checked pair, the line "Checked, not proven.", and the actions (lock, see the calculation, add a house rule).

### Outcome cards
Stop and ask: Ask Wash fill, 1px Ask Amber border, Float, 24px, with a mono Ask Ink eyebrow and a 22px heading; options are 48px rings with a radio. Saved house rule: Passed Wash fill, 1px Passed Green border, Float, heading in Passed Ink. It says no or no recording: a Recess Grey panel with no ring. Every draft thrown out: a white card on a hairline ring with the heading and a drawn crossed square in Thrown-Out Red, the meaning carried by the glyph and the words and not a coloured edge. Service error: a plain card.

### Evidence marks
The landing's proof is drawn as marks on the page, not charts: rows of green ticks, the 100 made-up tables as a 10 by 10 grid of 6px dots (each a 20px hit area, the grid's pitch, with arrow-key walking), and a strip of twelve 88px break tiles of which the missed one is ringed in Ask Amber with a question mark. Anything not yet backed by a recording carries a dashed mono badge reading "Illustrative · not yet a recorded run"; the trace on the landing says it is a slowed-down illustration.

### Motion
One easing, `cubic-bezier(0.2, 0.8, 0.2, 1)`. Controls change in 120ms (ring and background); the answer's reveal is 0.42s for the card, 0.4s for the seal, 0.2s for the veil and 0.3s for each row; a step-by-step pane rises 8px in 220ms; stress-break tiles flip in 0.3s staggered by 0.07s; the mode dot pulses every 1.6s while running. While the AI's draft is written or replayed, three Pen Lime ticks in the trace footer, by the drafting label, rise and fade in turn (1.8s, a loop, so it eases in and out like the mode dot; transform and opacity only). Nothing fills, because nothing is measured while the AI writes; under reduced motion they stay as a static trail of three ticks and the counter keeps counting in words. With `prefers-reduced-motion` all animation and transition are removed and every static style is the end state (measured: no running animations, every lane verdict readable).

### Named Rules
**The Receipt Rule.** An answer never appears without its receipt: the figure caption with the file and Version N, the level of checking in words, the decisive thing not checked beside the figure, and the Checked against and Not checked pair in the same view.

## Do's and Don'ts

### Do:
- **Do** keep every surface light and reserve the `trace-*` dark family for the check trace and the surfaces that quote it (Fig. 3 board, the order-of-work check step).
- **Do** spend indigo on the one action, the selected state, links, focus and the seal; leave green, red and amber to outcomes.
- **Do** pair every verdict colour with a drawn glyph and a plain state word (Passed, Thrown out, Not checked), and encode coverage in the seal: green disc for Full checks, a neutral partial ring for Basic checks.
- **Do** draw edges with a 1px ring or a tonal step; give an answer its raised shadow only once it is released.
- **Do** keep targets at 44px minimum (enlarge the hit area, not the drawn mark) and a 2px indigo focus outline with 2px offset. The single exception is the 100 evidence dots, a 20px hit area equal to the grid pitch, with the drawn dots smaller. On the dark board use the pen-lime outline, since the indigo ring is under 3:1 there.
- **Do** keep illustrative content labelled "Illustrative" in the same view, and use dashed edges only for what is not established.
- **Do** attach the Receipt to every answer: figure caption, Version N, what was checked and what was not.
- **Do** make the reduced-motion state the correct end state, and keep layouts working down to 390px, with container queries for anything that sits in more than one column.
- **Do** set numbers and machine-named things in Geist Mono with tabular, slashed-zero figures; keep fonts self-hosted.

### Don't:
- **Don't** put coloured side-stripe borders above 1px on cards, rows or callouts. Outcome cards use a full 1px border on a wash; coloured borders above 1px appear only as the step rail's 3px progress rule, radio indicators and the 2px focus outline.
- **Don't** use gradient text. The hero's accent phrase is a flat Signal Indigo colour; the build's only gradient is the pin-dot texture behind the dark instrument.
- **Don't** use blurred or zero-offset coloured glows. The trace lane's halo was removed; hard 1px rings and the Focus ring are the system.
- **Don't** make it look like an AI chat: no sparkle icons, no gradient text, no chat bubbles, no glossy AI-brand cues. The product checks the AI; it does not celebrate it.
- **Don't** build a dense BI dashboard: no chart-heavy, filter-everywhere analytics layout, no chart grids. The marks on the page are the trace's ticks, the 100-dot grid and a bar column; the page shows one question, one answer and one proof at a time.
- **Don't** add a dark theme, or a dark page or card background; and do not take the dark command block in the service-error card (`.fd-rs__fix`) as a precedent for dark cards, since it is a snippet, not a trace.
- **Don't** introduce a second accent hue, or use a verdict colour for decoration or for emphasis.
- **Don't** let colour carry a verdict, a seal or coverage on its own.
- **Don't** nest cards beyond the answer's Checked against and Not checked pair; put tables, code and rows in ringed or tonal panels.
- **Don't** put engine words in the UI: no gate, spec, property, fuzz, mutant, revision or pin; use the plain words.
- **Don't** load third-party fonts, scripts or resources.

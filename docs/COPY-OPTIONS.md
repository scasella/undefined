# Copy options: the argument above the fold

> Historical: the UI described here (the REPL "workbench", `apps/site/src/ui/`) was replaced by the front door (`apps/site/src/door/`, [FRONT-DOOR.md](FRONT-DOOR.md)), the site's only UI. Engine behaviour is unchanged; features with no UI now are listed in [FEATURES.md](FEATURES.md#engine-features-with-no-ui).

Two plain sentences sit under the masthead, above the example chips and the console
(`apps/site/src/ui/components/Argument.tsx`, styled by `.argument` in `apps/site/src/styles.css`). They state the inversion for a
first-time visitor: compilers used to judge human code; now the model writes and the toolchain judges. Version A ships.

## A (default): the historical inversion, stated flatly

> Compilers have always judged code that people wrote. Here a model writes the code, and your compiler, tests and checks decide whether it stays.

Tone: declarative and dry; names the reversal without selling it, and adds what the tagline and the console hint do not say (the history).

## B: what you will see in the next ten seconds

> Press Enter and a draft of median arrives, written by a model for a function nobody wrote. Your compiler, tests and checks then run it in this browser, and it joins the program only if it passes them.

Tone: concrete and procedural; overlaps the console's "Press Enter" hint and names `median`, so it only fits the opening example.

## C: who is trusted

> You do not have to trust the model here. You trust your compiler, tests and checks, because nothing the model writes stays unless they pass it.

Tone: the sharpest of the three; addresses the reader directly and makes a claim about trust that a skeptic will test, which is the point.

## D: the data-first opening (live mode only; not an alternative to A–C)

> Bring your own data. Call a function on it that doesn't exist; a model writes it and your checks decide whether it stays.

Shown instead of the default only when the first screen leads with the user's own data: live mode (the local service
answers, even degraded), an untouched browser, no `?opener=`, and the user has not chosen "Start with examples"
(`state.start === 'data'`, see `firstScreen` in `apps/site/src/core/engine.ts`). The public replay site never shows it.
Tone: an invitation, then the same inversion as A in one sentence; it points at the drop card right under it.

## How to swap

In `apps/site/src/ui/components/Argument.tsx`, change

```ts
export const ARGUMENT: readonly [string, string] = COPY.A;
```

to `COPY.B` or `COPY.C`. The drafts live in `COPY` in that file (D is the data-first line, chosen by
`state.start`, not by `ARGUMENT`); edit wording there and keep this page in step.
`apps/site/src/ui/components/Argument.test.ts` checks every draft (two sentences, no jargon the screenshot script flags).
Changing the copy does not touch any example spec or prompt, so `apps/site/public/recordings/*` stay valid; re-run
`node apps/site/scripts/capture.mjs` if the GIF and video should show the new line.

/**
 * Two plain sentences under the masthead for a first-time visitor. The alternatives and their tone notes are in
 * docs/COPY-OPTIONS.md; to swap, change `COPY.A` in ARGUMENT below to `COPY.B` or `COPY.C`.
 */
export const COPY = {
  A: [
    'Compilers have always judged code that people wrote.',
    'Here a model writes the code, and your compiler, tests and checks decide whether it stays.',
  ],
  B: [
    'Press Enter and a draft of median arrives, written by a model for a function nobody wrote.',
    'Your compiler, tests and checks then run it in this browser, and it joins the program only if it passes them.',
  ],
  C: [
    'You do not have to trust the model here.',
    'You trust your compiler, tests and checks, because nothing the model writes stays unless they pass it.',
  ],
} as const;

export const ARGUMENT: readonly [string, string] = COPY.A;

export function Argument() {
  return (
    <p class="argument">
      <span>{ARGUMENT[0]}</span> <span>{ARGUMENT[1]}</span>
    </p>
  );
}

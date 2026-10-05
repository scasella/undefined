/**
 * Two plain sentences under the masthead for a first-time visitor. The alternatives and their tone notes are in
 * docs/COPY-OPTIONS.md; to swap, change `COPY.A` in ARGUMENT below to `COPY.B` or `COPY.C`. `COPY.D` is not an
 * alternative to them: it is shown only when the first screen leads with the user's own data (state.start === 'data',
 * live mode), and ARGUMENT stays the example-first opening.
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
  D: [
    'Bring your own data.',
    "Call a function on it that doesn't exist; a model writes it and your checks decide whether it stays.",
  ],
} as const;

export const ARGUMENT: readonly [string, string] = COPY.A;

export function Argument({ start = 'examples' }: { start?: 'examples' | 'data' } = {}) {
  const [first, second] = start === 'data' ? COPY.D : ARGUMENT;
  return (
    <p class="argument">
      <span>{first}</span> <span>{second}</span>
    </p>
  );
}

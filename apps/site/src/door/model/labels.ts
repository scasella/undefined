/**
 * The one rule for the small labels above a section, a card or a rail (the typesetting pass). Pure: no DOM.
 *
 * A label that NAMES a thing in a few words (FIG. 1, HONEST LIMITS, YOUR AGREEMENT, START HERE) is Geist Mono capitals, tracked:
 * base.css `.fd-eyebrow`. Anything longer, and anything that reads as a clause or a sentence ("Answers from your spreadsheet exports ·
 * checked before you see them", "Fig. 2 · Same file, three meanings"), is a plain sentence-case line in Geist with no tracking:
 * base.css `.fd-label-line`. Capitals and tracking are for a short tag; on a long line they cost the reader's eye a word at a time.
 *
 * A family of labels that sit side by side (the three ladder columns, the case tag over an example) is ONE kind: caps only when
 * every member is short, so a row of tags never mixes the two looks. And a label that carries the viewer's own question or data
 * ("You asked · Flag suspicious orders") is never caps, whatever its length: it is a line.
 *
 * The pieces ship as classes; this file is the rule they follow. typeset.test.ts pins both ends: the words in every `.fd-eyebrow` and
 * `.fd-label-line` element in the source (`isShortLabel`, `isTypedCaps`), and, across ALL the source, any run of capitals typed into a
 * string (`typedCapsRuns`: it is what found "YOUR AGREEMENT × EVERY VERSION" in a table title, which no CSS rule could see). The only typed
 * capitals that may be longer than a short label are the seal's own words and the trace's head (the Honest Seal Rule).
 *
 * Two labels that are the same words on different surfaces keep one look only if they are one constant: ASK_LABEL below. A short label
 * that leads into the viewer's own words ("You asked · {question}") is a line; the same two words alone over the question row are a short
 * label and stay capitals. That split is by design (the rule is about length and about carrying the viewer's words), not an oversight.
 */

/** The label over a question only the viewer can answer (the landing's card, the Full view's card); typed once so both are the same line. */
export const ASK_LABEL = 'A question only you can answer · Needs you';

/** At most this many words, counted without the bare marks between them ("·", "+", "—"). */
export const LABEL_MAX_WORDS = 3;
/** At most this many characters, marks and spaces included ("about 22": WHEN THE RULES RUN OUT is 22 and still fails on words). */
export const LABEL_MAX_CHARS = 22;

/** The words of a label: whitespace-separated, minus tokens with no letter or digit in them ("·", "+", "-"). */
export function labelWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Whether a label may be mono capitals: a short noun label, in at most 3 words and 22 characters. */
export function isShortLabel(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= LABEL_MAX_CHARS && labelWords(t).length <= LABEL_MAX_WORDS;
}

/** The kind of a family of labels: 'caps' only when every one of them is short, else 'line'. */
export function labelKind(texts: readonly string[]): 'caps' | 'line' {
  return texts.length > 0 && texts.every(isShortLabel) ? 'caps' : 'line';
}

/** The shared class for a label (or a family of them): `fd-eyebrow` (mono capitals) or `fd-label-line` (sentence case, Geist). */
export function labelClass(texts: string | readonly string[]): 'fd-eyebrow' | 'fd-label-line' {
  return labelKind(typeof texts === 'string' ? [texts] : texts) === 'caps' ? 'fd-eyebrow' : 'fd-label-line';
}

/** True when the text is typed in capitals (three or more letters, all upper case): never right for a `.fd-label-line`. */
export function isTypedCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && text === text.toUpperCase();
}

const CAPS_WORD = "[A-Z]{2,}[A-Z0-9'’.\\-]*";
const CAPS_RUN = new RegExp(`(?<![\\p{L}\\p{N}_])${CAPS_WORD}(?:[ ·×+&/,]+(?:${CAPS_WORD}|\\d+))+(?![\\p{L}\\p{N}_])`, 'gu');

/**
 * The runs of two or more words typed in capitals inside a longer text ("YOUR AGREEMENT × EVERY VERSION" in "YOUR AGREEMENT × EVERY
 * VERSION · Top 5 customers by revenue"), the words and the bare marks between them, trailing punctuation dropped. Identifiers
 * (LADDER_ROW_Y0), one-letter words (the cells P, U, N) and path data (M40 336 C70) are not runs. Used by typeset.test.ts over the source, where a CSS rule cannot see them.
 */
export function typedCapsRuns(text: string): string[] {
  return [...text.matchAll(CAPS_RUN)].map((m) => m[0].replace(/['’.\-,\s]+$/u, ''));
}

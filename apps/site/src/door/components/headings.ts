/**
 * The level of a heading that sits inside a card used on more than one page. The same answer card and the same outcome cards
 * hang under an h2 on the landing and the Full view ("Example: top customers by revenue", "Ask a question") and straight under the
 * page's h1 on Step by step, where an h3 would skip a level. The page that renders the card says which level follows its own.
 */
export type HeadingLevel = 2 | 3;

/** The element for a level, for `<H class=…>` (a union of two intrinsic tags, which JSX accepts). */
export const headingTag = (level: HeadingLevel): 'h2' | 'h3' => (level === 2 ? 'h2' : 'h3');

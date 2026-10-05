const STOP_WORDS = ['a', 'the'];

/** Drops stop words. */
export function dropStopWords(words: string[]): string[] {
  return words.filter((w) => !STOP_WORDS.includes(w));
}

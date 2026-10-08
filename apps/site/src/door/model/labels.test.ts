import { describe, expect, it } from 'vitest';
import { ASK_LABEL, isShortLabel, isTypedCaps, labelClass, labelKind, labelWords, LABEL_MAX_CHARS, LABEL_MAX_WORDS, typedCapsRuns } from './labels';

describe('the label rule: mono capitals for a short noun label, a sentence-case line for anything longer', () => {
  it('names the limits: 3 words, 22 characters', () => {
    expect(LABEL_MAX_WORDS).toBe(3);
    expect(LABEL_MAX_CHARS).toBe(22);
  });

  it('counts words without the bare marks between them', () => {
    expect(labelWords('FIG. 1')).toEqual(['FIG.', '1']);
    expect(labelWords('+ ONE HOUSE RULE')).toEqual(['ONE', 'HOUSE', 'RULE']);
    expect(labelWords('MADE-UP · TABLE 47 OF 100')).toEqual(['MADE-UP', 'TABLE', '47', 'OF', '100']);
    expect(labelWords('  ')).toEqual([]);
  });

  it('keeps the short labels in capitals: FIG. 1, HONEST LIMITS, YOUR AGREEMENT, START HERE, NOT CHECKED, You asked', () => {
    for (const t of ['FIG. 1', 'HONEST LIMITS', 'YOUR AGREEMENT', 'START HERE', 'NOT CHECKED', 'You asked', 'THE USUAL ORDER', 'HERE', 'MADE-UP ·']) {
      expect(isShortLabel(t), t).toBe(true);
      expect(labelClass(t), t).toBe('fd-eyebrow');
    }
  });

  it('turns every clause and every long line into a sentence-case line', () => {
    for (const t of [
      'Answers from your spreadsheet exports · checked before you see them',
      'FIG. 2 · SAME FILE, THREE MEANINGS',
      'FIG. 3 · ONE AGREEMENT, EVERY VERSION',
      'WHEN THE RULES RUN OUT', // exactly 22 characters, and 5 words
      'START HERE · BRING A FILE, ASK IN PLAIN WORDS',
      'WHAT THE AI WILL SEE', // 20 characters, but a clause of 5 words
      'A QUESTION ONLY YOU CAN ANSWER · Needs you',
      'MADE-UP TABLE · THE SMALLEST ONE THAT SHOWS IT',
      "THE AI'S FIRST ASSUMPTION",
      'You asked · Flag suspicious orders',
    ]) {
      expect(isShortLabel(t), t).toBe(false);
      expect(labelClass(t), t).toBe('fd-label-line');
    }
  });

  it('is a character limit as well as a word limit', () => {
    expect(isShortLabel('ONE TWO THREE')).toBe(true);
    expect(isShortLabel('ABCDEFGHIJK ABCDEFGHIJK')).toBe(false); // 2 words, 23 characters
    expect(isShortLabel('')).toBe(false);
  });

  it('a family of labels is one kind: capitals only when every member is short', () => {
    // the three ladder columns: only the first is over the limit, and all three take the line
    const ladder = ["The AI's first assumption", '+ One house rule', '+ Two house rules'];
    expect(labelKind(ladder)).toBe('line');
    expect(labelKind(ladder.slice(1))).toBe('caps');
    expect(labelClass(ladder)).toBe('fd-label-line');
    expect(labelKind([])).toBe('line');
  });

  it('knows capitals typed into a line (never right for the sentence-case class)', () => {
    expect(isTypedCaps('FIG. 2 · SAME FILE, THREE MEANINGS')).toBe(true);
    expect(isTypedCaps('Fig. 2 · Same file, three meanings')).toBe(false);
    expect(isTypedCaps('A QUESTION ONLY YOU CAN ANSWER · Needs you')).toBe(false); // mixed: not all capitals
    expect(isTypedCaps('A1')).toBe(false); // fewer than three letters is not a shout
  });
});

describe('typedCapsRuns: capitals typed into a longer text, which no CSS rule can see', () => {
  it('finds the run in a title that is half capitals (the Fig. 3 board\'s old title)', () => {
    expect(typedCapsRuns('YOUR AGREEMENT × EVERY VERSION · Top 5 customers by revenue')).toEqual(['YOUR AGREEMENT × EVERY VERSION']);
    expect(typedCapsRuns('A QUESTION ONLY YOU CAN ANSWER · Needs you')).toEqual(['QUESTION ONLY YOU CAN ANSWER']);
    expect(typedCapsRuns('FIG. 2 · SAME FILE, THREE MEANINGS')).toEqual(['FIG. 2 · SAME FILE, THREE MEANINGS']);
    expect(typedCapsRuns('`PASSED ${n} BASIC CHECKS · NOTHING ELSE CHECKED YET`')).toEqual(['BASIC CHECKS · NOTHING ELSE CHECKED YET']);
  });
  it('leaves sentence case, one capital word, one-letter cells and identifiers alone', () => {
    for (const t of ['Your agreement × every version · Top 5 customers by revenue', 'What the AI will see', 'No AI.', 'cells: [P, P, N, P]', 'LADDER_ROW_Y0 + LADDER_ROW_STEP', 'M40 336 C70 336 66 300', 'HONEST', 'orders.csv · 332 rows']) {
      expect(typedCapsRuns(t), t).toEqual([]);
    }
  });
  it('the shared ask label is a line: sentence case, over the limit for capitals, no typed capitals', () => {
    expect(ASK_LABEL).toBe('A question only you can answer · Needs you');
    expect(isShortLabel(ASK_LABEL)).toBe(false);
    expect(typedCapsRuns(ASK_LABEL)).toEqual([]);
    expect(isTypedCaps(ASK_LABEL)).toBe(false);
  });
});

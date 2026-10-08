/**
 * The landing's within-section distillation (the landing's distillation pass): copy that only said again what the section's own heading or lead had said was
 * cut, and every honesty statement next to it stays. Pinned so a cut sentence does not creep back, and a kept honesty line is not cut by the
 * next pass. (Cross-section repeats are a decision for the owner, not pinned here.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bundledOrders } from '../../data/orders';
import { askQuestion, clashFigures, INITIAL_ASKS, ASKS_SMALL_PRINT } from './asksView';
import { honestLimits, TEAM_FILE_LEAD } from './teamFileView';

const src = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const flat = (t: string): string => t.replace(/\s+/g, ' ');

describe('landing copy: nothing restates its own section heading', () => {
  it('order of work: the note keeps its fairness line and the one difference, and no longer retells the two rows under the heading', () => {
    const t = flat(src('OrderOfWork.tsx'));
    expect(t).toContain('<p class="fd-ow-note">Plenty of AI assistants write good formulas. The difference is the order of work.</p>');
    expect(t).not.toMatch(/the checking happens before the answer reaches you/);
  });

  it('definition ladder: the lead says what to do with the figure, not again what the heading says', () => {
    const t = flat(src('Ladder.tsx'));
    expect(t).toContain('<p class="fd-ld-lede">Flip the rules and watch the leader change on the real sample file.</p>');
    expect(t).not.toMatch(/Writing the formula is the easy part|Saying what you mean is the hard part/);
    // the honesty it kept: it is the real sample file, and the heading still carries the claim
    expect(t).toContain("Who's #1 depends on what you mean by revenue.");
  });

  it('agree once: the lead starts at what holds, not at the heading\'s own words; "nothing is erased" stays', () => {
    const t = flat(src('AgreeOnce.tsx'));
    expect(t).toContain('Every version has to pass all of your rules.');
    expect(t).not.toMatch(/Agree on the rules once\./);
    expect(t).toContain('A rewrite that breaks an answer you locked is thrown out before you see it.');
    expect(t).toContain('Agree once, held every time.');
    expect(t).toContain('Going back to an earlier version is saved as a new version. Nothing is erased.');
  });

  it('it asks: the card says what happened and what the rules lack; "we won\'t guess" is the heading\'s ("It asks instead of guessing.") and the stage\'s own mini question, not said a third time in the card', () => {
    const gap = askQuestion(INITIAL_ASKS, clashFigures(bundledOrders()));
    expect(gap.mode).toBe('gap');
    expect(gap.body).toBe("We tried a made-up table where that happens. Your house rules don't say.");
    expect(gap.body).not.toMatch(/guess/i);
    expect(src('Asks.tsx')).toContain('It asks instead of guessing.');
    // the honest small print about the one illustrated question stays
    expect(ASKS_SMALL_PRINT).toMatch(/illustration/);
  });

  it('team file: the lead keeps "it isn\'t an Excel file"; who can rerun it is the heading\'s and the zip list\'s ("how to rerun it: one install, then one command")', () => {
    expect(TEAM_FILE_LEAD).toBe("When an answer matters, download it. It isn't an Excel file.");
    expect(TEAM_FILE_LEAD).not.toMatch(/rerun|same result/);
    expect(src('TeamFile.tsx')).toContain('Hand your data team a file they can rerun.');
  });
});

describe('landing copy: the honesty statements the cuts sit next to are all still there', () => {
  it('the limits list keeps its three honest lines (formats, what the demo is, what checks do and do not do)', () => {
    const l = honestLimits('replay');
    expect(l).toHaveLength(3);
    expect(l[1]).toContain('This public site is a demo: recorded answers, real checks running in your browser.');
    expect(l[2]).toBe("Checks lower the chance of a wrong answer. They don't prove it's right, so every answer lists what was checked and what wasn't.");
  });

  it('the hero still says it never guesses, and the privacy card still says what stays in the browser', () => {
    expect(flat(src('Hero.tsx'))).toContain('It never guesses.');
    expect(flat(src('SaysNoAndPrivacy.tsx'))).toContain('Your data stays in your browser.');
  });
});

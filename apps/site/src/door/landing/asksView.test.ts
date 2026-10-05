import { describe, expect, it } from 'vitest';
import { bundledOrders } from '../../data/orders';
import { askQuestion, clashFigures, INITIAL_ASKS, pickOption, saveRule, savedRuleText, showAgain, showMode } from './asksView';

const f = clashFigures(bundledOrders());

describe('clashFigures', () => {
  it('computes the locked every-row answer (design strings)', () => {
    expect(f.rule).toBe('Revenue counts paid orders only');
    expect(f.ruleShort).toBe('Paid orders only');
    expect(`${f.lockedName} = ${f.lockedAmount}`).toBe('Puddlesworth Inc = $2,599.13');
  });
});

describe('askQuestion', () => {
  it('starts on the gap question with "Leave them out" picked', () => {
    const q = askQuestion(INITIAL_ASKS, f);
    expect(q.head).toBe('What should happen to a customer whose orders were all refunded?');
    expect(q.legend).toBe('What should happen?');
    expect(q.name).toBe('gap-choice');
    expect(q.options.map((o) => o.label)).toEqual(['Show them with $0', 'Leave them out of the list', 'Stop and show a warning', 'Something else']);
    expect(q.selected).toBe('leave');
    expect(q.preview).toBe('This adds a house rule: customers with only refunded orders are left out.');
    expect(q.savedRule).toBe('Customers with only refunded orders are left out.');
  });

  it('clash: design options and previews, with computed amounts', () => {
    const q = askQuestion(showMode(INITIAL_ASKS, 'clash'), f);
    expect(q.head).toBe("Two of your rules can't both be true");
    expect(q.legend).toBe('Which one wins?');
    expect(q.name).toBe('clash-choice');
    expect(q.selected).toBe('rule');
    expect(q.options.map((o) => o.preview)).toEqual([
      'Puddlesworth Inc = $2,599.13 is unlocked. Paid orders only stays a house rule.',
      'Paid orders only is switched off. Every later version has to give Puddlesworth Inc = $2,599.13.',
      "Tell us what you meant. We'll read it back to you before anything is checked.",
    ]);
    expect(q.savedRule).toBe(q.preview);
  });

  it('falls back to the first option for an unknown pick', () => {
    expect(askQuestion({ ...INITIAL_ASKS, gap: 'nope' }, f).selected).toBe('zero');
  });
});

describe('savedRuleText', () => {
  it('strips the lead-in and capitalises; leaves "Something else" as is', () => {
    expect(savedRuleText('gap', 'This adds a house rule: if a customer has only refunded orders, stop and show a warning.')).toBe(
      'If a customer has only refunded orders, stop and show a warning.',
    );
    const other = "This adds a house rule in your words. We'll read it back to you before anything is checked.";
    expect(savedRuleText('gap', other)).toBe(other);
  });
});

describe('transitions', () => {
  it('each mode keeps its own pick; switching (even to the same mode) reopens the question', () => {
    let s = pickOption(INITIAL_ASKS, 'warn');
    s = saveRule(s);
    expect(s.saved).toBe(true);
    s = showMode(s, 'clash');
    expect(s).toMatchObject({ mode: 'clash', saved: false, gap: 'warn', clash: 'rule' });
    s = pickOption(s, 'lock');
    s = showMode(saveRule(s), 'clash');
    expect(s.saved).toBe(false);
    s = showMode(s, 'gap');
    expect(s).toMatchObject({ mode: 'gap', gap: 'warn', clash: 'lock' });
    expect(showAgain(saveRule(s)).saved).toBe(false);
  });
});

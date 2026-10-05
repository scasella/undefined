import { describe, expect, it } from 'vitest';
import { bundledOrders } from '../../data/orders';
import { agreeOnceTable, CELL_WORD, OUTCOME_WORD } from './agreeOnceView';

describe('agreeOnceTable', () => {
  const t = agreeOnceTable(bundledOrders());

  it('computes the version sub-headers from the sample (design strings)', () => {
    expect(t.versions.map((v) => [v.name, v.sub])).toEqual([
      ['Version 1', 'Puddlesworth Inc $2,599.13'],
      ['Version 2', 'Puddlesworth Inc $2,387.13'],
      ['Rewrite', 'You never saw it'],
      ['Version 3', 'Chef Ravioli Starbright $2,252.07'],
    ]);
  });

  it('has the design terms, with the locked answer computed', () => {
    expect(t.terms.map((r) => r.term)).toEqual([
      'Matches your 6 examples',
      'Matches your locked answer · Chef Ravioli Starbright = $2,252.07',
      'Revenue counts paid orders only',
      'Each order number is counted once',
      'Never changes your data',
      'Finishes fast',
    ]);
  });

  it('is the design matrix, and a version reaches you only when its whole column passes', () => {
    expect(t.terms.map((r) => r.cells.map((c) => CELL_WORD[c]).join('|'))).toEqual([
      'Passed|Passed|Passed|Passed',
      'Not checked|Passed|Thrown out|Passed',
      'Not checked|Passed|Not run|Passed',
      'Not checked|Not checked|Not run|Passed',
      'Passed|Passed|Not run|Passed',
      'Passed|Passed|Not run|Passed',
    ]);
    expect(t.versions.map((v) => OUTCOME_WORD[v.outcome])).toEqual(['Reached you · replaced', 'Reached you · replaced', 'Thrown out', 'Reached you']);
    const last = t.versions.length - 1;
    expect(t.terms.every((r) => r.cells[last] === 'pass')).toBe(true);
    expect(t.terms.some((r) => r.cells[2] === 'thrown-out')).toBe(true);
  });
});

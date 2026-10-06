import { describe, expect, it } from 'vitest';
import { MADE_UP_TABLES } from '../model/agreements';
import { ILLUSTRATIVE_BREAKS } from '../model/figures';
import { EVIDENCE_FOOT, evidenceTiles, ILLUSTRATIVE } from './evidenceView';
import { exampleCount } from './teamFileView';

describe('evidenceTiles', () => {
  it('computes its counts from the agreement and keeps the design strings', () => {
    const tiles = evidenceTiles();
    expect(tiles.map((t) => t.id)).toEqual(['examples', 'tables', 'breaks', 'thrown']);
    expect(exampleCount()).toBe(6);
    expect(tiles.map((t) => t.big)).toEqual(['6 of 6', '100', '11 of 12', '1']);
    expect(tiles[1]!.big).toBe(String(MADE_UP_TABLES));
    expect(tiles[2]!.big).toBe(`${ILLUSTRATIVE_BREAKS.length - 1} of ${ILLUSTRATIVE_BREAKS.length}`);
    expect(tiles.map((t) => t.sub)).toEqual([
      'of your examples match',
      'made-up tables, every house rule held',
      'small breaks caught on purpose',
      'first draft thrown out',
    ]);
  });

  it('labels every tile illustrative: no recording of the agreement is bundled, so none of these outcomes is measured', () => {
    expect(evidenceTiles().every((t) => t.illustrative)).toBe(true);
    expect(ILLUSTRATIVE).toBe('Illustrative · not yet a recorded run');
  });

  it('does not claim a measured duration', () => {
    expect(EVIDENCE_FOOT).not.toMatch(/\d\s?s\b/);
    expect(EVIDENCE_FOOT).toBe('Never changes your data · finishes fast');
  });
});

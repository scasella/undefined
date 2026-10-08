import { describe, expect, it } from 'vitest';
import { MADE_UP_TABLES } from '../model/agreements';
import { ILLUSTRATIVE_BREAKS } from '../model/figures';
import { readFileSync } from 'node:fs';
import { EVIDENCE_FOOT, evidenceLabel, evidenceTiles, ILLUSTRATIVE } from './evidenceView';
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
      'deliberate breaks caught by the stress test',
      'first draft thrown out',
    ]);
  });

  it('every tile is illustrative (no recording of the agreement is bundled, so none of these outcomes is measured), and the section says so ONCE', () => {
    expect(evidenceTiles().every((t) => t.illustrative)).toBe(true);
    expect(ILLUSTRATIVE).toBe('Illustrative · not yet a recorded run');
    expect(evidenceLabel()).toBe(ILLUSTRATIVE);
    // one label covers them while any tile is illustrative; with none, there is nothing to label
    expect(evidenceLabel([{ illustrative: false }, { illustrative: true }])).toBe(ILLUSTRATIVE);
    expect(evidenceLabel([{ illustrative: false }])).toBeNull();
    expect(evidenceLabel([])).toBeNull();
  });

  it('the strip draws that one label above its tiles and nowhere else: not per tile, not on the stress-test strip it opens', () => {
    const t = readFileSync(new URL('./EvidenceStrip.tsx', import.meta.url), 'utf8');
    expect(t).not.toMatch(/\{ILLUSTRATIVE\}/);
    expect(t).not.toMatch(/fd-ev-stress__badge/);
    expect([...t.matchAll(/class="fd-ev-badge/g)]).toHaveLength(1);
    expect(t).toContain('{LABEL && <p class="fd-ev-badge fd-ev-label">{LABEL}</p>}');
    // above the grid of tiles, so it is read before the first figure
    expect(t.indexOf('fd-ev-label')).toBeLessThan(t.indexOf('class="fd-ev-grid"'));
    // the tiles' own words never say it
    for (const tile of evidenceTiles()) expect(`${tile.big} ${tile.sub}`).not.toMatch(/illustrat/i);
  });

  it('the stress test is called the stress test and what it does is deliberate breaks: no "small breaks", no "on purpose"', () => {
    const tile = evidenceTiles().find((x) => x.id === 'breaks')!;
    expect(tile.sub).toBe('deliberate breaks caught by the stress test');
    const t = readFileSync(new URL('./EvidenceStrip.tsx', import.meta.url), 'utf8');
    expect(t).toContain('the stress test made {ILLUSTRATIVE_BREAKS.length} deliberate breaks in the calculation. Your checks caught {MISSED}.');
    expect(t).toContain('deliberateBreaks(ILLUSTRATIVE_BREAKS.length)');
    expect(`${tile.sub} ${t}`).not.toMatch(/small (breaks|ways)|on purpose|We broke/);
  });

  it('the opened stress-test strip says "illustration" in its own heading, in a sentence and not as a second badge (it can sit a screen below the label)', () => {
    const t = readFileSync(new URL('./EvidenceStrip.tsx', import.meta.url), 'utf8');
    const heading = /<h3 class="fd-ev-stress__h">\s*([\s\S]*?)\s*<\/h3>/.exec(t)?.[1] ?? '';
    expect(heading).toMatch(/^In this illustration, /);
    expect([...t.matchAll(/class="fd-ev-badge/g)]).toHaveLength(1);
    expect(t).not.toMatch(/\{ILLUSTRATIVE\}|\{LABEL\}[\s\S]*\{LABEL\}/);
  });

  it('does not claim a measured duration', () => {
    expect(EVIDENCE_FOOT).not.toMatch(/\d\s?s\b/);
    expect(EVIDENCE_FOOT).toBe('Never changes your data · finishes fast');
  });
});

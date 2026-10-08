import { describe, expect, it } from 'vitest';
import { MADE_UP_TABLES } from '../model/agreements';
import { ILLUSTRATIVE_BREAKS } from '../model/figures';
import { readFileSync } from 'node:fs';
import { stressWords } from '../model/lanes';
import { EVIDENCE_FOOT, evidenceLabel, evidenceTiles, ILLUSTRATIVE, recordedRun } from './evidenceView';
import { landingStage, RECORDED_STRESS, STAGE_FILE, STAGE_VERSION, WATCH_PASS_LABEL } from './stageData';
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

  // rewritten for the recorded stress result: the label used to say "not yet a recorded run", which is false of a page that now quotes one
  it('every tile is illustrative (none of these outcomes is taken from the recorded run), and the section says so ONCE', () => {
    expect(evidenceTiles().every((t) => t.illustrative)).toBe(true);
    expect(ILLUSTRATIVE).toBe('Illustrative · these four figures are not from a recorded run');
    expect(ILLUSTRATIVE).not.toMatch(/\byet\b/);
    // scoped to the four figures: the stress-test tile also holds a recorded result, and a label for "the section" would read as covering it
    expect(ILLUSTRATIVE).toMatch(/these four figures/);
    expect(evidenceTiles()).toHaveLength(4);
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

  it('the stress-test tile quotes the recorded run beside the illustrated 11 of 12: marked "Recorded run", in the seal\'s own words, linked to Step by step', () => {
    const r = recordedRun();
    expect(r.label).toBe('Recorded run:');
    expect(r.result).toBe('the stress test caught 8 of 12 deliberate breaks.');
    // the pinned constant's own words (the seal says "stress test caught 8 of 12"); nothing about the numbers is typed here a second time
    expect(r.result).toBe(`the ${stressWords(RECORDED_STRESS)} deliberate breaks.`);
    expect(r.what).toBe(`${STAGE_FILE}, the same question, Version ${STAGE_VERSION}. Its first draft was accepted. The "Watch it pass" playback above throws one out, to show what a rejection looks like.`);
    expect(r.link).toEqual({ label: 'Run it yourself', href: '#/zen' });
    // the two numbers differ, and the tile says which is which: the illustrated one is under the section's label, the recorded one is marked
    expect(evidenceTiles().find((x) => x.id === 'breaks')!.big).toBe('11 of 12');
    expect(r.result).toContain('8 of 12');
    // plain words, and no second "illustrat…" in the section (the label and the strip's own heading are the only two)
    expect(`${r.label} ${r.result} ${r.what} ${r.link.label}`).not.toMatch(/\b(gate|spec|property|fuzz|mutant|revision|pin)\b|illustrat/i);
    const t = readFileSync(new URL('./EvidenceStrip.tsx', import.meta.url), 'utf8');
    // it lives inside the stress-test tile (between the breaks tile and the thrown-out tile), not under all four, and is not a second badge
    expect(t.indexOf("tile('breaks')")).toBeLessThan(t.indexOf('<RecordedRun />'));
    expect(t.indexOf('<RecordedRun />')).toBeLessThan(t.indexOf("tile('thrown')"));
    expect([...t.matchAll(/<RecordedRun \/>/g)]).toHaveLength(1);
    expect(t).toContain('href={r.link.href}');
  });

  it('the sentence about the thrown-out draft names the playback it is true of: "Watch it pass" throws one out, "Watch it stop and ask" does not', () => {
    const stage = landingStage();
    // true of the pass playback only: it shows the first draft thrown out; the stop playback stops on DRAFT 1 and throws nothing out
    expect(stage.views.pass.ghost).not.toBeNull();
    expect(stage.views.stop.ghost).toBeNull();
    expect(recordedRun().what).toContain(`The "${WATCH_PASS_LABEL}" playback above throws one out`);
    expect(recordedRun().what).not.toMatch(/The playback above/);
    // and that name is the toggle's own label, one source for both
    const stageTsx = readFileSync(new URL('./Stage.tsx', import.meta.url), 'utf8');
    expect(stageTsx).toContain("{ id: 'pass', label: WATCH_PASS_LABEL }");
    expect(WATCH_PASS_LABEL).toBe('Watch it pass');
  });

  it('a re-recording that threw drafts out is worded as that (no claim the first draft was accepted, no sentence about the playback)', () => {
    const one = recordedRun(RECORDED_STRESS, 1);
    expect(one.what).toBe(`${STAGE_FILE}, the same question, Version ${STAGE_VERSION}. 1 draft was thrown out first.`);
    const two = recordedRun(RECORDED_STRESS, 2);
    expect(two.what).toBe(`${STAGE_FILE}, the same question, Version ${STAGE_VERSION}. 2 drafts were thrown out first.`);
    for (const r of [one, two]) expect(r.what).not.toMatch(/accepted|playback/);
    // the result line follows the stress status it is given, not a typed number
    expect(recordedRun({ kind: 'done', total: 12, caught: 12, missed: 0 }, 0).result).toBe('the stress test caught 12 of 12 deliberate breaks.');
    expect(recordedRun({ kind: 'done', total: 1, caught: 1, missed: 0 }, 0).result).toBe('the stress test caught 1 of 1 deliberate break.');
  });

  it('does not claim a measured duration', () => {
    expect(EVIDENCE_FOOT).not.toMatch(/\d\s?s\b/);
    expect(EVIDENCE_FOOT).toBe('Never changes your data · finishes fast');
  });
});

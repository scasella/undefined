/**
 * The evidence strip's four headline tiles (V3-Door-Landing 386-453), as pure data.
 *
 * What is computed and what is scripted (docs/FRONT-DOOR.md honesty rule 2): the COUNTS come from the seeded agreement
 * (6 examples: teamFileView.exampleCount over the real test text; 100 made-up tables: MADE_UP_TABLES; 12 breaks:
 * ILLUSTRATIVE_BREAKS) and the "Why" under the thrown-out draft is computed from the real orders. But "6 of 6 match",
 * "every house rule held", "11 of 12 caught" and "1 first draft thrown out" are the OUTCOME of a run the landing
 * illustrates, not a recorded one (no recording of the agreement is bundled), so every tile says so, in the same words.
 */
import { MADE_UP_TABLES } from '../model/agreements';
import { ILLUSTRATIVE_BREAKS } from '../model/figures';
import { exampleCount } from './teamFileView';

/** The badge every scripted tile carries (the stress strip's too). */
export const ILLUSTRATIVE = 'Illustrative · not yet a recorded run';

export type EvidenceTileId = 'examples' | 'tables' | 'breaks' | 'thrown';

export interface EvidenceTile {
  id: EvidenceTileId;
  big: string;
  sub: string;
  /** True when the figure reports the outcome of a run that was not recorded: the tile shows the ILLUSTRATIVE badge. */
  illustrative: boolean;
}

/** The one stress-test break the example's checks miss (the last in the list). */
export const MISSED_BREAKS = 1;

export function evidenceTiles(): EvidenceTile[] {
  const examples = exampleCount();
  const breaks = ILLUSTRATIVE_BREAKS.length;
  return [
    { id: 'examples', big: `${examples} of ${examples}`, sub: 'of your examples match', illustrative: true },
    { id: 'tables', big: String(MADE_UP_TABLES), sub: 'made-up tables, every house rule held', illustrative: true },
    { id: 'breaks', big: `${breaks - MISSED_BREAKS} of ${breaks}`, sub: 'small breaks caught on purpose', illustrative: true },
    { id: 'thrown', big: '1', sub: 'first draft thrown out', illustrative: true },
  ];
}

/**
 * Under the tiles. The design said "finished in 0.41 s": a measured duration nothing here measured (stageData.ts reworded
 * the same figure in the trace), so it names the check instead.
 */
export const EVIDENCE_FOOT = 'Never changes your data · finishes fast';

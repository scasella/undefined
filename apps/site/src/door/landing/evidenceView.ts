/**
 * The evidence strip's four headline tiles (V3-Door-Landing 386-453), as pure data.
 *
 * What is computed and what is scripted (docs/FRONT-DOOR.md honesty rule 2): the COUNTS come from the seeded agreement
 * (6 examples: teamFileView.exampleCount over the real test text; 100 made-up tables: MADE_UP_TABLES; 12 breaks:
 * ILLUSTRATIVE_BREAKS) and the "Why" under the thrown-out draft is computed from the real orders. But "6 of 6 match",
 * "every house rule held", "11 of 12 caught" and "1 first draft thrown out" are the OUTCOME of a run the landing
 * illustrates, not a recorded one (the one recorded run threw no draft out and its stress test caught 8 of 12), so the
 * section says so once, in one label. The recorded run's own stress-test result sits beside the illustrated one in the
 * stress-test tile (`recordedRun`), labelled for what it is.
 */
import { MADE_UP_TABLES } from '../model/agreements';
import { ILLUSTRATIVE_BREAKS } from '../model/figures';
import { breaksWord, stressWords } from '../model/lanes';
import { ROUTE_PATHS } from '../router';
import type { StressStatus } from '../model/lanes';
import { RECORDED_DRAFTS_THROWN_OUT, RECORDED_STRESS, STAGE_FILE, STAGE_VERSION, WATCH_PASS_LABEL } from './stageData';
import { exampleCount } from './teamFileView';

/**
 * The one label of the evidence section: its four headline figures are an illustrated outcome, not taken from a recorded run. It says
 * "these four figures", not "this section", because the stress-test tile also quotes the one recorded result (`recordedRun`), marked as
 * recorded under a solid divider; a label that covered the whole section would read as covering that too. (It used to say "not yet a
 * recorded run"; there is one now, so the label no longer says "yet".)
 */
export const ILLUSTRATIVE = 'Illustrative · these four figures are not from a recorded run';

export type EvidenceTileId = 'examples' | 'tables' | 'breaks' | 'thrown';

export interface EvidenceTile {
  id: EvidenceTileId;
  big: string;
  sub: string;
  /** True when the figure reports the outcome of a run that was not recorded: the section's label (`evidenceLabel`) must cover it. */
  illustrative: boolean;
}

/**
 * The section's one label, or null when none of its figures is illustrative. Said once for the whole section (the four tiles and
 * the stress-test strip they open), not on each tile: four copies of the same words were the page's loudest repetition.
 */
export function evidenceLabel(tiles: readonly Pick<EvidenceTile, 'illustrative'>[] = evidenceTiles()): string | null {
  return tiles.some((t) => t.illustrative) ? ILLUSTRATIVE : null;
}

/** The one stress-test break the example's checks miss (the last in the list). */
export const MISSED_BREAKS = 1;

export function evidenceTiles(): EvidenceTile[] {
  const examples = exampleCount();
  const breaks = ILLUSTRATIVE_BREAKS.length;
  return [
    { id: 'examples', big: `${examples} of ${examples}`, sub: 'of your examples match', illustrative: true },
    { id: 'tables', big: String(MADE_UP_TABLES), sub: 'made-up tables, every house rule held', illustrative: true },
    { id: 'breaks', big: `${breaks - MISSED_BREAKS} of ${breaks}`, sub: 'deliberate breaks caught by the stress test', illustrative: true },
    { id: 'thrown', big: '1', sub: 'first draft thrown out', illustrative: true },
  ];
}

/**
 * Under the tiles. The design said "finished in 0.41 s": a measured duration nothing here measured (stageData.ts reworded
 * the same figure in the trace), so it names the check instead.
 */
export const EVIDENCE_FOOT = 'Never changes your data · finishes fast';

/**
 * The recorded run's own stress-test result, shown in the stress-test tile beside the illustrated 11 of 12. Every figure is the pinned
 * constant (stageData.ts RECORDED_STRESS, which stageData.test.ts replays through the real engine) in the seal's own words
 * (model/lanes.ts stressWords), so the tile can never disagree with the answer Step by step shows.
 */
export interface RecordedRunView {
  /** What this is, in plain words: the label of the block ("Recorded run:"), said before the result. */
  label: string;
  /** The result: "the stress test caught 8 of 12 deliberate breaks." */
  result: string;
  /** Which run, and the one way it differs from the playback above it. */
  what: string;
  /** Where to see it for yourself: Step by step. */
  link: { label: string; href: string };
}

/** `st` and `thrown` default to the pinned constants; they are parameters so the wording for a re-recording that threw drafts out is testable. */
export function recordedRun(st: Extract<StressStatus, { kind: 'done' }> = RECORDED_STRESS, thrown: number = RECORDED_DRAFTS_THROWN_OUT): RecordedRunView {
  return {
    label: 'Recorded run:',
    result: `the ${stressWords(st)!} deliberate ${breaksWord(st.total)}.`,
    what:
      `${STAGE_FILE}, the same question, Version ${STAGE_VERSION}. ` +
      (thrown === 0
        ? // named, not "the playback above": the other playback ("Watch it stop and ask") throws nothing out
          `Its first draft was accepted. The "${WATCH_PASS_LABEL}" playback above throws one out, to show what a rejection looks like.`
        : `${thrown} ${thrown === 1 ? 'draft was' : 'drafts were'} thrown out first.`),
    link: { label: 'Run it yourself', href: ROUTE_PATHS.zen },
  };
}

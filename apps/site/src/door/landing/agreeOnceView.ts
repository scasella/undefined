/**
 * Fig. 3 · "Agree once, held every time": the agreement × every version table. Pure.
 *
 * The version sub-headers and the locked-answer term are computed from the sample rows (figures.ts), never typed in:
 *   every row counted (#1 Puddlesworth Inc $2,599.13), then paid orders only (#1 Puddlesworth Inc $2,387.13), then a
 *   rewrite you never saw, then the agreed definition (#1 Chef Ravioli Starbright $2,252.07). The pass/fail matrix is
 *   the design's story of those versions (a version reaches you only when its whole column passes).
 *
 * The last column IS the example answer on the stage, so it carries the stage's own version number (STAGE_VERSION) and
 * the two before it count up to it (a rewrite is thrown out before it is ever a version, so it takes no number).
 */
import { HOUSE_RULES } from '../model/agreements';
import { AGREED, formatMoney, ladderLeader, topCustomers, type DataRow } from '../model/figures';
import { STAGE_VERSION } from './stageData';

export type CellStatus = 'pass' | 'not-checked' | 'not-run' | 'thrown-out';
export type Outcome = 'replaced' | 'thrown-out' | 'reached';

export interface AgreeVersion {
  /** `Version 2` / `Rewrite` */
  name: string;
  /** `Puddlesworth Inc $2,599.13` / `You never saw it` */
  sub: string;
  outcome: Outcome;
}

export interface AgreeTerm {
  term: string;
  cells: CellStatus[];
}

export interface AgreeTable {
  title: string;
  caption: string;
  versions: AgreeVersion[];
  terms: AgreeTerm[];
}

export const CELL_WORD: Record<CellStatus, string> = {
  pass: 'Passed',
  'not-checked': 'Not checked',
  'not-run': 'Not run',
  'thrown-out': 'Thrown out',
};

export const OUTCOME_WORD: Record<Outcome, string> = {
  replaced: 'Reached you · replaced',
  'thrown-out': 'Thrown out',
  reached: 'Reached you',
};

const P: CellStatus = 'pass';
const U: CellStatus = 'not-checked';
const N: CellStatus = 'not-run';
const O: CellStatus = 'thrown-out';

export function agreeOnceTable(rows: readonly DataRow[]): AgreeTable {
  const head = (def: { paidOnly: boolean; once: boolean }): string => {
    const l = ladderLeader(rows, def);
    return `${l.name} ${l.amount}`;
  };
  const locked = topCustomers(rows, AGREED, 1)[0];
  const lockedTerm = locked ? `Matches your locked answer · ${locked.name} = ${formatMoney(locked.value)}` : 'Matches your locked answer';
  return {
    title: 'YOUR AGREEMENT × EVERY VERSION · Top 5 customers by revenue',
    caption: 'A version reaches you only when its whole column passes.',
    versions: [
      { name: `Version ${STAGE_VERSION - 2}`, sub: head({ paidOnly: false, once: false }), outcome: 'replaced' },
      { name: `Version ${STAGE_VERSION - 1}`, sub: head({ paidOnly: true, once: false }), outcome: 'replaced' },
      { name: 'Rewrite', sub: 'You never saw it', outcome: 'thrown-out' },
      { name: `Version ${STAGE_VERSION}`, sub: head(AGREED), outcome: 'reached' },
    ],
    terms: [
      { term: 'Matches your 6 examples', cells: [P, P, P, P] },
      { term: lockedTerm, cells: [U, P, O, P] },
      { term: HOUSE_RULES[0]!.name, cells: [U, P, N, P] },
      { term: HOUSE_RULES[1]!.name, cells: [U, U, N, P] },
      { term: 'Never changes your data', cells: [P, P, N, P] },
      { term: 'Finishes fast', cells: [P, P, N, P] },
    ],
  };
}

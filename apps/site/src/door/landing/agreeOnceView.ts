/**
 * Fig. 3 · "Agree once, held every time": the agreement × every version table. Pure.
 *
 * The version sub-headers and the locked-answer term are computed from the sample rows (figures.ts), never typed in:
 *   Version 1 = every row counted (#1 Puddlesworth Inc $2,599.13), Version 2 = paid orders only (#1 Puddlesworth Inc
 *   $2,387.13), Version 3 = the agreed definition (#1 Chef Ravioli Starbright $2,252.07). The pass/fail matrix is the
 *   design's story of those versions (a version reaches you only when its whole column passes).
 */
import { HOUSE_RULES } from '../model/agreements';
import { AGREED, formatMoney, ladderLeader, topCustomers, type DataRow } from '../model/figures';

export type CellStatus = 'pass' | 'not-checked' | 'not-run' | 'thrown-out';
export type Outcome = 'replaced' | 'thrown-out' | 'reached';

export interface AgreeVersion {
  /** `Version 1` / `Rewrite` */
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
      { name: 'Version 1', sub: head({ paidOnly: false, once: false }), outcome: 'replaced' },
      { name: 'Version 2', sub: head({ paidOnly: true, once: false }), outcome: 'replaced' },
      { name: 'Rewrite', sub: 'You never saw it', outcome: 'thrown-out' },
      { name: 'Version 3', sub: head(AGREED), outcome: 'reached' },
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

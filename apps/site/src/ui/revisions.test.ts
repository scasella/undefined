import { describe, expect, it } from 'vitest';
import { rollbackBrackets } from './components/Revisions';

describe('rollback brackets in the revision ledger', () => {
  it('joins a rollback to the revision it restored, newest first', () => {
    const rows = [{ id: 6, restoredFrom: 3 }, { id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }];
    expect(rollbackBrackets(rows)).toEqual({ lanes: 1, pieces: [['start'], ['mid'], ['mid'], ['end'], [null]] });
  });
  it('puts overlapping brackets in separate lanes and reuses a free lane', () => {
    const rows = [{ id: 8, restoredFrom: 4 }, { id: 7, restoredFrom: 5 }, { id: 6 }, { id: 5 }, { id: 4 }, { id: 3, restoredFrom: 1 }, { id: 2 }, { id: 1 }];
    const { lanes, pieces } = rollbackBrackets(rows);
    expect(lanes).toBe(2);
    expect(pieces.map((p) => p.join(','))).toEqual(['start,', 'mid,start', 'mid,mid', 'mid,end', 'end,', 'start,', 'mid,', 'end,']);
  });
  it('ignores a rollback whose target is not in the log', () => {
    expect(rollbackBrackets([{ id: 3, restoredFrom: 9 }, { id: 2 }])).toEqual({ lanes: 0, pieces: [[], []] });
  });
});

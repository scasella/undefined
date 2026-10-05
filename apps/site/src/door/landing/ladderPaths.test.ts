import { describe, expect, it } from 'vitest';
import { bundledOrders } from '../../data/orders';
import { definitionLadder } from '../model/figures';
import { dotGridKey } from './dotGrid';
import { ladderConnectors } from './ladderPaths';

const ladder = definitionLadder(bundledOrders());
const names = (c: 0 | 1 | 2) => ladder.columns[c].rows.map((r) => r.name);
const hi = ladder.fall?.name ?? null;

describe('ladderConnectors reproduces the design (V3-Door-Landing 528-536, 552-558) from the real data', () => {
  it('column 1 → column 2', () => {
    const c = ladderConnectors(names(0), names(1), hi);
    expect(c.exitDot).toBe(true);
    expect(c.paths).toEqual([
      { kind: 'move', name: 'Puddlesworth Inc', d: 'M0 114 C48 114 48 114 96 114' },
      { kind: 'move', name: 'Chef Ravioli Starbright', d: 'M0 246 C48 246 48 158 96 158' },
      { kind: 'move', name: 'Grommet & Gasket LLC', d: 'M0 290 C48 290 48 202 96 202' },
      { kind: 'leave', name: 'Brambleskate Ltd', d: 'M0 202 C40 202 40 330 64 330' },
      { kind: 'enter', name: 'Thistlewhump Bakery', d: 'M40 336 C70 336 66 246 96 246' },
      { kind: 'fall', name: 'Kettlewhistle Farms', d: 'M0 158 C48 158 48 290 96 290' },
    ]);
  });

  it('column 2 → column 3', () => {
    const c = ladderConnectors(names(1), names(2), hi);
    expect(c.exitDot).toBe(false);
    expect(c.paths.map((p) => [p.kind, p.d])).toEqual([
      ['move', 'M0 114 C48 114 48 202 96 202'],
      ['move', 'M0 158 C48 158 48 114 96 114'],
      ['move', 'M0 202 C48 202 48 158 96 158'],
      ['move', 'M0 246 C48 246 48 246 96 246'],
      ['fall', 'M0 290 C48 290 48 290 96 290'],
    ]);
  });

  it('no highlight, nobody leaves', () => {
    const c = ladderConnectors(['a', 'b'], ['b', 'a'], null);
    expect(c.exitDot).toBe(false);
    expect(c.paths.every((p) => p.kind === 'move')).toBe(true);
  });
});

describe('dotGridKey', () => {
  it('moves within the 10 × 10 grid and clamps at the edges', () => {
    expect(dotGridKey(36, 'ArrowRight')).toBe(37);
    expect(dotGridKey(36, 'ArrowLeft')).toBe(35);
    expect(dotGridKey(36, 'ArrowDown')).toBe(46);
    expect(dotGridKey(36, 'ArrowUp')).toBe(26);
    expect(dotGridKey(0, 'ArrowLeft')).toBe(0);
    expect(dotGridKey(99, 'ArrowRight')).toBe(99);
    expect(dotGridKey(95, 'ArrowDown')).toBe(95);
    expect(dotGridKey(5, 'ArrowUp')).toBe(5);
    expect(dotGridKey(50, 'Home')).toBe(0);
    expect(dotGridKey(50, 'End')).toBe(99);
    expect(dotGridKey(50, 'Enter')).toBeNull();
  });
});

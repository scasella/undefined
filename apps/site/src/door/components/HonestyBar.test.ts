import { describe, expect, it } from 'vitest';
import type { EngineState } from '@scasella/undefined-engine/types';
import { bound, latestVersion, receiptLink, versionText } from './HonestyBar';

describe('HonestyBar receipt link', () => {
  it('the landing goes to the first run, as the design does', () => {
    expect(receiptLink('landing')).toEqual({ href: '#/start' });
  });
  it('the first run never links to itself: it has no receipt view, so no link', () => {
    expect(receiptLink('start')).toBeNull();
  });
});

type S = Pick<EngineState, 'program' | 'revisions'>;
// local noon: the viewer's own 5 Oct in every timezone (the bar shows the local day)
const at = new Date(2026, 9, 5, 12).getTime();
const state = (artifacts: Array<number | null>, revisionIds: number[]): S =>
  ({
    program: { functions: Object.fromEntries(artifacts.map((r, i) => [`f${i}`, { artifact: r === null ? null : { revision: r } }])) },
    revisions: revisionIds.map((id) => ({ id, at })),
  }) as unknown as S;

describe('latestVersion', () => {
  it('shows no version before anything was committed, however many snapshots the program has', () => {
    // a bound file, the installed demo agreement and a lock are snapshots, not versions of an answer
    expect(latestVersion(state([], [0, 1, 2, 3]))).toBeNull();
    expect(latestVersion(state([null], [0, 1, 2]))).toBeNull();
  });
  it('is the revision the accepted draft was committed at, not the head snapshot', () => {
    // committed at 3; locking it made snapshot 4: the answer (and the bar) still say Version 3
    expect(latestVersion(state([3], [0, 1, 2, 3, 4]))).toEqual({ version: 3, date: '5 Oct 2026' });
  });
  it('takes the newest committed version across functions', () => {
    expect(latestVersion(state([3, null, 6], [0, 3, 6, 7]))?.version).toBe(6);
  });
  it('keeps the version and leaves the date out when its snapshot is not in the history', () => {
    expect(latestVersion(state([5], [0, 1]))).toEqual({ version: 5, date: null });
  });
});

describe('versionText', () => {
  it('says nothing without a version', () => {
    expect(versionText({ version: null, date: null })).toBeNull();
    expect(versionText({ version: null, date: '5 Oct 2026' })).toBeNull();
  });
  it('writes Version N and the day', () => {
    expect(versionText({ version: 4, date: '5 Oct 2026' })).toBe('Version 4 · 5 Oct 2026');
    expect(versionText({ version: 4, date: null })).toBe('Version 4');
  });
  it("labels the landing's number as the example's", () => {
    expect(versionText({ version: 3, date: '5 Oct 2026', example: true })).toBe('Example answer: Version 3 · 5 Oct 2026');
  });
});

describe('bound', () => {
  it('binds the dot of the version line to its neighbours, so a wrapped bar never hangs a lone "·"', () => {
    expect(bound('Version 3 · 5 Oct 2026')).toBe('Version 3\u00a0·\u00a05 Oct 2026');
    expect(bound('Example answer: Version 3 · 5 Oct 2026')).toBe('Example answer: Version 3\u00a0·\u00a05 Oct 2026');
  });
  it('leaves a line with no dot alone', () => {
    expect(bound('Version 3')).toBe('Version 3');
  });
  it('changes only the spaces: the words are the ones versionText wrote', () => {
    const t = versionText({ version: 4, date: '5 Oct 2026', example: true })!;
    expect(bound(t).replace(/\u00a0/g, ' ')).toBe(t);
  });
});

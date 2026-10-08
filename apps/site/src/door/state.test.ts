import { describe, expect, it } from 'vitest';
import { formatDay, formatSession, headVersion, privacyLine, recordChecks, rowsShort, session } from './state';

describe('session telemetry', () => {
  it('reads "checks this session 0" before any run', () => {
    expect(formatSession({ checks: 0, lastMs: null })).toBe('checks this session 0');
  });
  it('formats the count with grouping and the last run in seconds', () => {
    expect(formatSession({ checks: 1214, lastMs: 410 })).toBe('checks this session 1,214 · last 0.41 s');
  });
  it('recordChecks adds checks and replaces the last time', () => {
    session.value = { checks: 0, lastMs: null };
    recordChecks(6, 410);
    recordChecks(2, 1234);
    expect(session.value).toEqual({ checks: 8, lastMs: 1234 });
    expect(formatSession(session.value)).toBe('checks this session 8 · last 1.23 s');
  });
});

describe('privacy strip', () => {
  it('names what the AI sees', () => {
    expect(rowsShort(true)).toBe('3 example rows');
    expect(rowsShort(false)).toBe('types only');
  });
});

describe('privacyLine (the footers\' one line about where the file is)', () => {
  it('the demo: the file stays here and nothing is sent, whatever the example-rows switch says', () => {
    for (const rows of [true, false]) expect(privacyLine('replay', rows)).toBe('Your file stays in this browser. This demo plays back recorded answers and sends nothing.');
  });
  it('a copy on your computer: what the AI sees follows the switch', () => {
    expect(privacyLine('live', true)).toBe('Your file stays in this browser. The AI sees column names + 3 example rows.');
    expect(privacyLine('live', false)).toBe('Your file stays in this browser. The AI sees column names + types only.');
  });
  it('says nothing about the claim, which the Full view\'s honesty bar carries', () => {
    expect(privacyLine('replay', true)).not.toMatch(/Checked, not proven/);
  });
});

describe('version line', () => {
  it('formats a day like the design', () => {
    expect(formatDay(new Date(2026, 9, 5, 12).getTime())).toBe('5 Oct 2026');
  });
  it('uses the head revision and its time', () => {
    const at = new Date(2026, 9, 4, 9).getTime();
    const revs = [{ id: 0, at: 1 }, { id: 3, at }] as unknown as Parameters<typeof headVersion>[0]['revisions'];
    expect(headVersion({ headRevision: 3, revisions: revs })).toEqual({ version: 3, date: '4 Oct 2026' });
  });
  it('falls back to now when the head is not listed', () => {
    const now = new Date(2026, 9, 5, 9).getTime();
    expect(headVersion({ headRevision: 0, revisions: [] }, now)).toEqual({ version: 0, date: '5 Oct 2026' });
  });
});

import { describe, expect, it } from 'vitest';
import type { Recording } from '@scasella/undefined-engine/types';
import {
  classifyDroppedText,
  dropRoute,
  multiDropProblem,
  recordingNotData,
  importFileLine,
  importReplaceText,
  OTHER_TAB_TEXT,
  SESSION_LOG_HOLDS,
  droppedFileProblem,
  functionLine,
  pageBase,
  provenanceLine,
  recordingBannerText,
  recordingSummary,
  sessionLogCountText,
  SHARE_INCLUDES,
  shareLinkFor,
} from './share';
import { recordingParamFromLocation } from '../share/source';

describe('ui/share', () => {
  it('tells a recording from a program image by format, and explains anything else', () => {
    expect(classifyDroppedText('{"format":"undefined-recording"}')).toEqual({ kind: 'recording' });
    expect(classifyDroppedText('﻿{"format":"undefined-image","version":1}')).toEqual({ kind: 'image' });
    const log = classifyDroppedText('{"format":"undefined-session-log"}', 'log.json');
    expect(log.kind === 'other' && log.error).toMatch(/^log\.json is a session log/);
    const other = classifyDroppedText('{"a":1}', 'x.json');
    expect(other.kind === 'other' && other.error).toMatch(/"format" is missing/);
    expect(classifyDroppedText('[1,2]').kind).toBe('data');
    expect(classifyDroppedText('[{"a":1},{"a":2}]').kind).toBe('data');
    expect(classifyDroppedText('{"orders":[{"a":1}]}').kind).toBe('data');
    expect(classifyDroppedText('{"format":"undefined-recording","calls":[]}').kind).toBe('recording');
    expect(classifyDroppedText('nope', 'n.json')).toMatchObject({ kind: 'other', error: expect.stringMatching(/^n\.json is not JSON/) });
  });

  it('routes a dropped file: data by extension, .json read and classified, the rest refused', () => {
    expect(dropRoute({ name: 'sales.csv' })).toEqual({ route: 'data' });
    expect(dropRoute({ name: 'x.TSV' })).toEqual({ route: 'data' });
    expect(dropRoute({ name: 'x.ndjson' })).toEqual({ route: 'data' });
    expect(dropRoute({ name: 'notes.txt' })).toEqual({ route: 'data' });
    expect(dropRoute({ name: 'blob', type: 'text/csv' })).toEqual({ route: 'data' });
    expect(dropRoute({ name: 'session.json' })).toEqual({ route: 'json' });
    expect(dropRoute({ name: 'Q3.xlsx' })).toEqual({ route: 'refuse', error: 'Q3.xlsx is a spreadsheet file; export it as CSV.' });
    expect(dropRoute({ name: 'cat.png' })).toMatchObject({ route: 'refuse', error: expect.stringMatching(/^cat\.png is not a recording/) });
  });

  it('accepts only .json files of a sane size', () => {
    expect(droppedFileProblem({ name: 'session.json', size: 100 })).toBeNull();
    expect(droppedFileProblem({ name: 'blob', size: 100, type: 'application/json' })).toBeNull();
    expect(droppedFileProblem({ name: 'data.csv', size: 100 })).toMatch(/not a \.json file/);
    expect(droppedFileProblem({ name: 'big.json', size: 6 * 1024 * 1024 })).toMatch(/larger than 5 MB/);
  });

  it('builds the share link from the page (query and fragment dropped) and a pasted https URL', () => {
    expect(pageBase('https://me.github.io/undefined/?fixture=x#y')).toBe('https://me.github.io/undefined/');
    expect(shareLinkFor('https://me.github.io/undefined/', '')).toEqual({ ok: false, error: null });
    const r = shareLinkFor('https://me.github.io/undefined/?recording=old', ' https://gist.github.com/me/abc123 ');
    expect(r).toEqual({
      ok: true,
      recordingUrl: 'https://gist.githubusercontent.com/me/abc123/raw',
      link: `https://me.github.io/undefined/?recording=${encodeURIComponent('https://gist.githubusercontent.com/me/abc123/raw')}`,
    });
    // the link reads back to the same recording URL
    if (r.ok) expect(recordingParamFromLocation(new URL(r.link).search, '')).toBe(r.recordingUrl);
    expect(shareLinkFor('https://x/', 'http://example.com/r.json')).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
    expect(shareLinkFor('https://x/', 'not a url')).toMatchObject({ ok: false, error: expect.stringMatching(/not a web address/) });
  });

  it('says what the download holds, or that there is nothing yet', () => {
    expect(recordingSummary(null)).toBeNull();
    const rec = {
      title: 'Replayed session: median',
      sessions: [
        { fn: 'median', attempts: [{}, {}], calls: ['median([1])'], datasets: { [('a').repeat(64)]: [] } },
        { fn: 'median', attempts: [{}], calls: ['median([1])'] },
      ],
    } as unknown as Recording;
    expect(recordingSummary(rec)).toBe('Replayed session: median · 1 function (median) · 3 candidates · 1 call · 1 dataset');
    expect(SHARE_INCLUDES).toContain('includes your spec and test code and any dataset rows used in the session');
    expect(SHARE_INCLUDES).toMatch(/nothing else\.$/);
  });

  it('banner, provenance, function and log lines', () => {
    expect(recordingBannerText({ title: 't', source: 'gist.githubusercontent.com', calls: [], dismissed: false })).toBe(
      'Replaying a recorded session from gist.githubusercontent.com: press Enter to run its calls; the gates run live in your browser.',
    );
    expect(provenanceLine({ model: 'gpt-6-luna', codexVersion: '0.159.2', effort: 'low', recordedAt: '2026-10-04T15:16:35.783Z' })).toBe(
      'gpt-6-luna via Codex CLI 0.159.2 · effort low · recorded 2026-10-04',
    );
    expect(provenanceLine({ model: '', codexVersion: '', effort: '', recordedAt: 'x' })).toBe('unknown model');
    expect(functionLine({ name: 'median', tests: 1, properties: 2, status: 'replaces' })).toBe(
      'median · 1 test, 2 properties · replaces your spec of this name (its artifact goes stale)',
    );
    expect(sessionLogCountText({ enabled: true, count: 1, status: 'indexeddb' })).toBe("1 entry in this browser's storage");
    expect(sessionLogCountText({ enabled: false, count: 3, status: 'failed' })).toMatch(/^3 entries in this tab only/);
  });
});

describe('import confirmation, session log and tab texts', () => {
  it('says plainly what an import replaces', () => {
    expect(importReplaceText({ revisions: 7, functions: 2 })).toBe('This replaces your current program (7 revisions, 2 functions). Export it first if you want to keep it.');
    expect(importReplaceText({ revisions: 1, functions: 1 })).toBe('This replaces your current program (1 revision, 1 function). Export it first if you want to keep it.');
    expect(
      importFileLine({ ok: true, revisions: 4, functions: 1, datasets: 2, exportedAt: '2026-10-04T09:00:00.000Z', current: { revisions: 1, functions: 0 } }),
    ).toBe('4 revisions, 1 function, 2 datasets · exported 2026-10-04T09:00:00.000Z');
  });

  it('the session log dialog says exactly what the log may hold', () => {
    expect(SESSION_LOG_HOLDS.startsWith('It may contain values you typed in your own calls, never dataset rows or prompts.')).toBe(true);
    expect(SESSION_LOG_HOLDS).toContain('rejected by invariants (pure)');
    expect(SESSION_LOG_HOLDS).toContain('threw TypeError');
  });

  it('the other-tab banner', () => {
    expect(OTHER_TAB_TEXT).toBe('This program is open in another tab. Edits in two tabs overwrite each other; close one.');
  });
});


describe('drops: hostile inputs (review)', () => {
  it('several files at once are refused with a count; one or none is not', () => {
    expect(multiDropProblem(3)).toBe('3 files were dropped; drop one file at a time.');
    expect(multiDropProblem(1)).toBeNull();
    expect(multiDropProblem(0)).toBeNull();
  });
  it("a recording or program image dropped on the data drawer is named as such, not previewed as rows", () => {
    expect(recordingNotData(JSON.stringify({ format: 'undefined-recording', sessions: [] }), 'r.json')).toMatch(/^r\.json is a recording, not data/);
    expect(recordingNotData(JSON.stringify({ format: 'undefined-image' }), 'i.json')).toMatch(/^i\.json is a program image, not data/);
    expect(recordingNotData('[{"a":1}]', 'd.json')).toBeNull();
    expect(recordingNotData('{"a":1}\n{"a":2}', 'lines.json')).toBeNull(); // JSON Lines named .json: left to the data reader
  });
  it('a JSON array is data even when its items look like recordings; a recording-shaped object with arrays stays a recording', () => {
    expect(classifyDroppedText(JSON.stringify([{ format: 'undefined-recording', sessions: [] }]), 'x.json').kind).toBe('data');
    expect(classifyDroppedText(JSON.stringify({ format: 'undefined-recording', sessions: [{}] }), 'x.json').kind).toBe('recording');
    expect(dropRoute({ name: 'recording.csv' }).route).toBe('data');
  });
});

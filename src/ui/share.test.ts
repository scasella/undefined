import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import {
  classifyDroppedText,
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
    expect(classifyDroppedText('[1,2]').kind).toBe('other');
    expect(classifyDroppedText('nope', 'n.json')).toMatchObject({ kind: 'other', error: expect.stringMatching(/^n\.json is not JSON/) });
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

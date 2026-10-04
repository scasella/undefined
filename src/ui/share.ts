/**
 * Pure helpers for sharing a session, loading a recording and the local session log. No DOM, no engine calls:
 * unit-tested (share.test.ts).
 */
import type { EngineState, Recording, RecordingPreview } from '../types';
import { normalizeShareUrl, shareLink } from '../share/source';

export const SHARE_FILENAME = 'undefined-session.json';
export const SESSION_LOG_FILENAME = 'undefined-session-log.json';

export const SHARE_INCLUDES =
  'The recording includes your spec and test code and any dataset rows used in the session, with what the model was asked and what it wrote (prompts and candidates) and the calls you typed; nothing else.';
export const SHARE_HOST_TEXT =
  "Host it anywhere that serves the raw file with CORS (a GitHub gist's Raw URL or raw.githubusercontent.com both work).";
export const SESSION_LOG_SENTENCE =
  "Keeps a log of what you type and what the gates decided, in this browser's storage only. It is never sent anywhere. Off by default.";
export const SESSION_LOG_OFF_NOTE = 'Turning it off stops new entries; the entries already kept stay until you clear them.';
export const DROP_TEXT = 'Drop a recording or an exported program';

/** What a dropped .json file is, by its `format` field. Never throws. */
export type DroppedKind =
  | { kind: 'recording' }
  | { kind: 'image' }
  | { kind: 'other'; error: string };

export function classifyDroppedText(text: string, filename = 'the file'): DroppedKind {
  let raw: unknown;
  try {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    raw = JSON.parse(body);
  } catch {
    return { kind: 'other', error: `${filename} is not JSON. Drop a recording (.json saved with "Share this session") or an exported program image.` };
  }
  const format = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { format?: unknown }).format : undefined;
  if (format === 'undefined-recording') return { kind: 'recording' };
  if (format === 'undefined-image') return { kind: 'image' };
  if (format === 'undefined-session-log') {
    return { kind: 'other', error: `${filename} is a session log. Session logs are for reading; they cannot be loaded or replayed.` };
  }
  return {
    kind: 'other',
    error: `${filename} is JSON, but not a recording or a program image (its "format" is ${format === undefined ? 'missing' : JSON.stringify(String(format)).slice(0, 60)}).`,
  };
}

/** A dropped/picked file worth reading as a recording or image (by name or type), and small enough. */
export function droppedFileProblem(file: { name: string; size: number; type?: string }): string | null {
  const jsonish = /\.json$/i.test(file.name) || file.type === 'application/json';
  if (!jsonish) return `${file.name} is not a .json file. ${DROP_TEXT} (.json).`;
  if (file.size > 5 * 1024 * 1024) return `${file.name} is larger than 5 MB; a recording or program image is much smaller.`;
  return null;
}

/** The share link for a pasted recording URL, or why there is none yet. `pageUrl` is this page (its query is replaced). */
export function shareLinkFor(pageUrl: string, pasted: string): { ok: true; link: string; recordingUrl: string } | { ok: false; error: string | null } {
  const trimmed = pasted.trim();
  if (trimmed === '') return { ok: false, error: null };
  const recordingUrl = normalizeShareUrl(trimmed);
  let u: URL;
  try {
    u = new URL(recordingUrl);
  } catch {
    return { ok: false, error: 'That is not a web address. Paste the full https:// link to the raw .json file.' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'The link must start with https:// (a visitor\'s browser only fetches https links).' };
  return { ok: true, link: shareLink(pageBase(pageUrl), recordingUrl), recordingUrl };
}

/** This page without its query or fragment (so ?fixture= and an old ?recording= are not carried along). */
export function pageBase(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return pageUrl.split(/[?#]/)[0] ?? pageUrl;
  }
}

/** One line about what the Download button will save; null when there is nothing to save. */
export function recordingSummary(rec: Recording | null): string | null {
  if (!rec) return null;
  const fns = [...new Set(rec.sessions.map((s) => s.fn))];
  const candidates = rec.sessions.reduce((n, s) => n + s.attempts.length, 0);
  const datasets = new Set(rec.sessions.flatMap((s) => Object.keys(s.datasets ?? {}))).size;
  const parts = [
    `${plural(fns.length, 'function')} (${fns.join(', ')})`,
    plural(candidates, 'candidate'),
    plural(new Set(rec.sessions.flatMap((s) => s.calls ?? [])).size, 'call'),
    ...(datasets > 0 ? [plural(datasets, 'dataset')] : []),
  ];
  return `${rec.title} · ${parts.join(' · ')}`;
}

export const NOTHING_TO_SHARE =
  'Nothing has been generated in this session yet, so there is nothing to share. Run a call that grows a function (live or replayed), then come back here.';

/** The banner under the header while a loaded recording is active. */
export function recordingBannerText(lr: NonNullable<EngineState['loadedRecording']>): string {
  return `Replaying a recorded session from ${lr.source}: press Enter to run its calls; the gates run live in your browser.`;
}

/** "gpt-6-luna via Codex CLI 0.159.2 · effort low · recorded 2026-10-04" */
export function provenanceLine(p: Pick<Extract<RecordingPreview, { ok: true }>, 'model' | 'codexVersion' | 'effort' | 'recordedAt'>): string {
  const parts = [`${p.model || 'unknown model'}${p.codexVersion ? ` via Codex CLI ${p.codexVersion}` : ''}`];
  if (p.effort) parts.push(`effort ${p.effort}`);
  const t = Date.parse(p.recordedAt);
  if (!Number.isNaN(t)) parts.push(`recorded ${new Date(t).toISOString().slice(0, 10)}`);
  return parts.join(' · ');
}

export function functionLine(f: Extract<RecordingPreview, { ok: true }>['functions'][number]): string {
  const checks = `${plural(f.tests, 'test')}, ${plural(f.properties, 'property', 'properties')}`;
  const status =
    f.status === 'new'
      ? 'new'
      : f.status === 'same'
        ? 'same as your spec'
        : f.status === 'replaces'
          ? 'replaces your spec of this name (its artifact goes stale)'
          : f.status === 'replay-only'
            ? 'no spec in the recording: replays only against yours'
            : '';
  return `${f.name} · ${checks}${status ? ` · ${status}` : ''}`;
}

export function sessionLogCountText(s: NonNullable<EngineState['sessionLog']>): string {
  const n = `${s.count} ${s.count === 1 ? 'entry' : 'entries'}`;
  const where = s.status === 'indexeddb' ? "in this browser's storage" : s.status === 'memory' ? 'in this tab only (lost on reload)' : 'in this tab only (browser storage failed)';
  return `${n} ${where}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

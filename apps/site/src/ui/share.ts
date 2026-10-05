/**
 * Pure helpers for sharing a session, loading a recording and the local session log. No DOM, no engine calls:
 * unit-tested (share.test.ts).
 */
import type { EngineState, ImagePreview, Recording, RecordingPreview } from '@scasella/undefined-engine/types';
import { normalizeShareUrl, shareLink } from '../share/source';

export const SHARE_FILENAME = 'undefined-session.json';
export const SESSION_LOG_FILENAME = 'undefined-session-log.json';

export const SHARE_INCLUDES =
  'The recording includes your spec and test code and any dataset rows used in the session, with what the model was asked and what it wrote (prompts and candidates), the calls you typed, and the Codex progress log of each attempt (status lines, short reasoning excerpts and any warnings Codex printed, which can name local file paths); nothing else.';
export const SHARE_HOST_TEXT =
  "Host it anywhere that serves the raw file with CORS (a GitHub gist's Raw URL or raw.githubusercontent.com both work).";
export const SESSION_LOG_SENTENCE =
  "Keeps a log of what you type and what the gates decided, in this browser's storage only. It is never sent anywhere. Off by default.";
/** What the session log holds, exactly (engine.ts: the session-log policy). */
export const SESSION_LOG_HOLDS =
  'It may contain values you typed in your own calls, never dataset rows or prompts. It holds your inputs, outcome kinds, which gate decided (with its headline cut to 200 characters; while any data is loaded, only the gate, e.g. "rejected by invariants (pure)"), declines, commits, pins, rollbacks, spec edits, dataset names and sizes, and errors (while data is loaded, only their kind, e.g. "threw TypeError").';
/** Banner when another tab of this app holds the same stored program. */
export const OTHER_TAB_TEXT = 'This program is open in another tab. Edits in two tabs overwrite each other; close one.';
export const IMAGE_FILENAME = 'undefined-image.json';
export const SESSION_LOG_OFF_NOTE = 'Turning it off stops new entries; the entries already kept stay until you clear them.';
export const DROP_TEXT = 'Drop a recording, a program image, or data (CSV/JSON)';
/** The overlay's second line. */
export const DROP_SUBTEXT = 'Recordings and images ask before anything changes; data opens a preview first.';

/** What a dropped .json file is: a recording or image by its `format` field, data when it holds rows. Never throws. */
export type DroppedKind =
  | { kind: 'recording' }
  | { kind: 'image' }
  | { kind: 'data' }
  | { kind: 'other'; error: string };

/** Where a file dropped on the page goes, by its name and type, before it is read. */
export type DropRoute = { route: 'data' } | { route: 'json' } | { route: 'refuse'; error: string };

const DATA_ONLY_EXT = /\.(csv|tsv|jsonl|ndjson|txt)$/i;
const SHEET_EXT = /\.(xlsx|xlsm|xls|ods|numbers)$/i;

/** CSV/TSV/JSON Lines/text go to the data drawer; .json is read and classified (recording, image or data). */
export function dropRoute(file: { name: string; type?: string }): DropRoute {
  if (DATA_ONLY_EXT.test(file.name) || file.type === 'text/csv' || file.type === 'text/tab-separated-values') return { route: 'data' };
  if (/\.json$/i.test(file.name) || file.type === 'application/json') return { route: 'json' };
  if (SHEET_EXT.test(file.name)) return { route: 'refuse', error: `${file.name} is a spreadsheet file; export it as CSV.` };
  return { route: 'refuse', error: `${file.name} is not a recording, a program image or data. ${DROP_TEXT}: .json, .csv, .tsv, .jsonl.` };
}

/** More than one file dropped at once: refused with a count rather than silently reading the first. null for 0 or 1. */
export function multiDropProblem(count: number): string | null {
  return count > 1 ? `${count} files were dropped; drop one file at a time.` : null;
}

export function classifyDroppedText(text: string, filename = 'the file'): DroppedKind {
  let raw: unknown;
  try {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    raw = JSON.parse(body);
  } catch {
    return { kind: 'other', error: `${filename} is not JSON. Drop a recording (.json saved with "Share this session") or an exported program image.` };
  }
  if (Array.isArray(raw)) return { kind: 'data' };
  const format = raw !== null && typeof raw === 'object' ? (raw as { format?: unknown }).format : undefined;
  // `{ "orders": [ … ] }`: rows under one key, which the data reader accepts
  if (format === undefined && raw !== null && typeof raw === 'object' && Object.values(raw).some((v) => Array.isArray(v))) return { kind: 'data' };
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

/** A .json that is a recording or a program image, said plainly; null for anything else (data, or not JSON at all). */
export function recordingNotData(text: string, filename: string): string | null {
  const k = classifyDroppedText(text, filename).kind;
  if (k === 'recording') return `${filename} is a recording, not data. Close this panel and drop it on the page to replay it.`;
  if (k === 'image') return `${filename} is a program image, not data. Close this panel and drop it on the page to import it.`;
  return null;
}

/** A dropped/picked file worth reading as a recording or image (by name or type), and small enough. */
export function droppedFileProblem(file: { name: string; size: number; type?: string }): string | null {
  const jsonish = /\.json$/i.test(file.name) || file.type === 'application/json';
  if (!jsonish) return `${file.name} is not a .json file. Choose a recording or an exported program image (.json).`;
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

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The import confirmation's warning: what is replaced, and that exporting first keeps it. */
export function importReplaceText(current: { revisions: number; functions: number }): string {
  return `This replaces your current program (${count(current.revisions, 'revision', 'revisions')}, ${count(current.functions, 'function', 'functions')}). Export it first if you want to keep it.`;
}

/** What the image file holds, for the import confirmation. */
export function importFileLine(p: Extract<ImagePreview, { ok: true }>): string {
  const parts = [count(p.revisions, 'revision', 'revisions'), count(p.functions, 'function', 'functions')];
  if (p.datasets > 0) parts.push(count(p.datasets, 'dataset', 'datasets'));
  return `${parts.join(', ')} · exported ${p.exportedAt.slice(0, 120)}`;
}


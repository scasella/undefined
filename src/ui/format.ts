import type { ParamSpec } from '../types';

export function relativeTime(at: number, now: number): string {
  const s = Math.round((now - at) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Elapsed timer text, e.g. "3.4s". */
export function fmtElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function shortHash(h: string | undefined): string {
  return h ? h.slice(0, 8) : '—';
}

/** Headline without its "Rejected: " prefix, for compact places such as the retry strip. */
export function stripRejected(headline: string | undefined): string {
  return (headline ?? '').replace(/^Rejected:\s*/, '');
}

/** Split on commas/semicolons that are not nested inside (), [], {}, <>. */
function splitTopLevel(text: string, seps: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(c)) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export type ParseParamsResult = { ok: true; params: ParamSpec[] } | { ok: false; error: string };

/** Parse `numbers: number[], opts: { a: number; b: string }` into ParamSpec[]. */
export function parseParams(text: string): ParseParamsResult {
  if (!text.trim()) return { ok: true, params: [] };
  const params: ParamSpec[] = [];
  for (const raw of splitTopLevel(text, ',')) {
    const part = raw.trim();
    if (!part) return { ok: false, error: 'empty parameter (stray comma?)' };
    const colon = part.indexOf(':');
    if (colon === -1) return { ok: false, error: `parameter "${part}" needs a type, e.g. ${part}: number` };
    const name = part.slice(0, colon).trim();
    const type = part.slice(colon + 1).trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return { ok: false, error: `"${name}" is not a valid parameter name` };
    if (!type) return { ok: false, error: `parameter "${name}" has an empty type` };
    if (params.some((p) => p.name === name)) return { ok: false, error: `duplicate parameter "${name}"` };
    params.push({ name, type });
  }
  return { ok: true, params };
}

export function paramsText(params: ParamSpec[]): string {
  return params.map((p) => `${p.name}: ${p.type}`).join(', ');
}

export function isValidFnName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

/**
 * Best guess at the git URL when the static build is served from GitHub Pages
 * (https://<user>.github.io/<repo>/ → https://github.com/<user>/<repo>.git). null otherwise.
 */
export function repoUrlFromPages(href: string): string | null {
  try {
    const u = new URL(href);
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(u.hostname);
    if (!m) return null;
    const repo = u.pathname.split('/').filter(Boolean)[0];
    return repo ? `https://github.com/${m[1]}/${repo}.git` : `https://github.com/${m[1]}/${m[1]}.github.io.git`;
  } catch {
    return null;
  }
}

/**
 * `text` split into plain and inline-code runs on backticks (`now` → code). Only when the backticks pair up; an odd
 * count (e.g. an error message quoting a template literal) is returned as one plain run.
 */
export function splitTicks(text: string): Array<{ code: boolean; text: string }> {
  const parts = text.split('`');
  if (parts.length < 3 || parts.length % 2 === 0) return [{ code: false, text }];
  return parts.map((t, i) => ({ code: i % 2 === 1, text: t })).filter((p) => p.text !== '' || p.code);
}

/** Sentence case for a short UI label: the first letter up, the rest untouched (`certified r4` → `Certified r4`). */
export function sentenceCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

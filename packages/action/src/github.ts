/**
 * The only network access the Action has: GitHub's REST API, with the workflow's token, to find, create or update the
 * one comment marked `<!-- undefined-certify -->` (and, in `mode: comment`, to read the PR's head commit so a report
 * cannot be posted on a PR it does not belong to). Plain `fetch`, no client library. Nothing else is sent anywhere.
 */
import { MARKER } from './comment';

export interface GitHub {
  fetch: typeof fetch;
  /** GITHUB_API_URL, e.g. https://api.github.com */
  api: string;
  token: string;
  /** owner/repo */
  repo: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(gh: GitHub, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await gh.fetch(`${gh.api.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${gh.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'undefined-certify-action',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { message?: string }).message ?? '';
    } catch {
      /* no JSON body */
    }
    throw new GitHubError(`${method} ${path}: ${res.status}${detail ? ` ${detail}` : ''}`, res.status);
  }
  return (await res.json()) as T;
}

interface IssueComment {
  id: number;
  body?: string | null;
  user?: { login?: string; type?: string } | null;
}

/**
 * The marked comment on PR `pr`, if any (every page of the PR's comments, 100 at a time). Only a comment written by a
 * bot account counts (`github-actions[bot]` for the default token, or a GitHub App): anyone can post a comment that
 * starts with the marker, and without this check the PR's author could pre-empt the report (the Action would then
 * overwrite a comment that shows under the author's name, which the author can edit afterwards, or fail to post).
 */
export async function findComment(gh: GitHub, pr: number): Promise<IssueComment | null> {
  for (let page = 1; page <= 100; page++) {
    const list = await call<IssueComment[]>(gh, 'GET', `/repos/${gh.repo}/issues/${pr}/comments?per_page=100&page=${page}`);
    const hit = list.find((c) => typeof c.body === 'string' && c.body.startsWith(MARKER) && c.user?.type === 'Bot');
    if (hit) return hit;
    if (list.length < 100) return null;
  }
  return null;
}

export type UpsertResult =
  | { action: 'created' | 'updated'; id: number }
  | { action: 'unchanged'; id: number }
  | { action: 'skipped' }
  | { action: 'forbidden'; message: string };

/**
 * Create the comment, or update the existing one in place; leave it alone when its text is already `body`. With
 * `createIfMissing: false` nothing is posted when no comment exists yet (the "nothing changed" case). A 403/404 (a
 * fork's read-only token) is reported as `forbidden`, never thrown: it must not change the check's result.
 */
export async function upsertComment(gh: GitHub, pr: number, body: string, opts: { createIfMissing: boolean } = { createIfMissing: true }): Promise<UpsertResult> {
  try {
    const existing = await findComment(gh, pr);
    if (existing) {
      if (existing.body === body) return { action: 'unchanged', id: existing.id };
      const c = await call<IssueComment>(gh, 'PATCH', `/repos/${gh.repo}/issues/comments/${existing.id}`, { body });
      return { action: 'updated', id: c.id };
    }
    if (!opts.createIfMissing) return { action: 'skipped' };
    const c = await call<IssueComment>(gh, 'POST', `/repos/${gh.repo}/issues/${pr}/comments`, { body });
    return { action: 'created', id: c.id };
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) {
      return { action: 'forbidden', message: `${e.message} (a pull_request run from a fork gets a read-only token; see the README for the two-workflow setup)` };
    }
    throw e;
  }
}

/** The PR's current head commit. */
export async function pullHeadSha(gh: GitHub, pr: number): Promise<string> {
  const p = await call<{ head?: { sha?: string } }>(gh, 'GET', `/repos/${gh.repo}/pulls/${pr}`);
  const sha = p.head?.sha;
  if (typeof sha !== 'string') throw new GitHubError(`GET /repos/${gh.repo}/pulls/${pr}: no head.sha`, 0);
  return sha;
}

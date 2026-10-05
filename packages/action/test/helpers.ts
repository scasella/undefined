/** Test helpers: throwaway git repositories and an in-memory GitHub REST API behind an injected `fetch`. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Repo {
  dir: string;
  git(...args: string[]): string;
  write(files: Record<string, string | null>): void;
  commit(message: string): string;
  remove(): void;
}

export function makeRepo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'undefined-action-'));
  const git = (...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  return {
    dir,
    git,
    write(files) {
      for (const [p, text] of Object.entries(files)) {
        const abs = join(dir, p);
        if (text === null) rmSync(abs, { force: true });
        else {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, text);
        }
      }
    },
    commit(message) {
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '-m', message);
      return git('rev-parse', 'HEAD').trim();
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface FakeComment {
  id: number;
  body: string;
  user: { login: string; type: string };
}

export interface FakeGitHub {
  fetch: typeof fetch;
  comments: FakeComment[];
  requests: Array<{ method: string; path: string; body?: unknown; auth: string | null }>;
  /** Respond with this status to POST/PATCH (e.g. 403 for a fork's read-only token). */
  writeStatus: number;
  pullHead: string;
}

/** Enough of GitHub's REST API for the Action: issue comments (paged) and one pull request. */
export function fakeGitHub(repo = 'octo/demo', pr = 7): FakeGitHub {
  let next = 1000;
  const state: FakeGitHub = {
    comments: [],
    requests: [],
    writeStatus: 0,
    pullHead: '',
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { body: string }) : undefined;
      state.requests.push({ method, path: url.pathname + url.search, ...(body ? { body } : {}), auth: headers.get('authorization') });
      const json = (status: number, data: unknown): Response => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
      if (url.hostname !== 'api.github.test') return json(500, { message: `unexpected host ${url.hostname}` });
      const list = `/repos/${repo}/issues/${pr}/comments`;
      if (method === 'GET' && url.pathname === list) {
        const per = Number(url.searchParams.get('per_page') ?? 30);
        const page = Number(url.searchParams.get('page') ?? 1);
        return json(200, state.comments.slice((page - 1) * per, page * per));
      }
      if (method === 'POST' && url.pathname === list) {
        if (state.writeStatus) return json(state.writeStatus, { message: 'Resource not accessible by integration' });
        const c = { id: next++, body: body!.body, user: { login: 'github-actions[bot]', type: 'Bot' } };
        state.comments.push(c);
        return json(201, c);
      }
      const m = new RegExp(`^/repos/${repo}/issues/comments/(\\d+)$`).exec(url.pathname);
      if (method === 'PATCH' && m) {
        if (state.writeStatus) return json(state.writeStatus, { message: 'Resource not accessible by integration' });
        const c = state.comments.find((x) => x.id === Number(m[1]));
        if (!c) return json(404, { message: 'Not Found' });
        c.body = body!.body;
        return json(200, c);
      }
      if (method === 'GET' && url.pathname === `/repos/${repo}/pulls/${pr}`) return json(200, { number: pr, head: { sha: state.pullHead } });
      return json(404, { message: 'Not Found' });
    }) as typeof fetch,
  };
  return state;
}

export const writes = (gh: FakeGitHub): string[] => gh.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);

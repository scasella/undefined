/**
 * What the PR changed: `git diff --unified=0` between the merge base and the checked-out tree, parsed into new-side
 * line ranges per file (docs/WORKSPACE-DESIGN.md §5.2).
 *
 * Why the merge base and the working tree: on `pull_request` events actions/checkout checks out the PR's merge commit,
 * not `head.sha`. The files the Action certifies are the files on disk, so the hunks must describe those same files:
 * `merge-base(base.sha, HEAD)` → working tree is exactly the PR's own change whether HEAD is the merge commit or the
 * head commit, and it does not pick up commits that landed on the base branch since the PR was opened.
 */
import { execFile } from 'node:child_process';

/** A changed region on the NEW side of the diff. `count` 0 = lines were only deleted, between `start` and `start + 1`. */
export interface Hunk {
  start: number;
  count: number;
}

export interface FileDiff {
  /** Repository-relative path on the new side. */
  path: string;
  status: 'added' | 'modified' | 'renamed';
  hunks: Hunk[];
}

/** Decode a path git printed C-quoted (`"a\tb"`); unquoted paths are returned as they are. */
export function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const body = p.slice(1, -1);
  const bytes: number[] = [];
  const esc: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = body[i + 1]!;
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(esc[n] ?? n.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Parse `git diff --unified=0 --no-color` output. Deleted files are skipped (nothing on disk to certify). */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let renamed = false;
  let added = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = null;
      renamed = false;
      added = false;
      continue;
    }
    if (line.startsWith('new file mode')) added = true;
    else if (line.startsWith('rename to ')) renamed = true;
    else if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/\t$/, '');
      if (target === '/dev/null') {
        cur = null;
        continue;
      }
      const path = unquotePath(target);
      cur = { path: path.startsWith('b/') ? path.slice(2) : path, status: added ? 'added' : renamed ? 'renamed' : 'modified', hunks: [] };
      files.push(cur);
    } else if (line.startsWith('@@') && cur) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) cur.hunks.push({ start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) });
    }
  }
  return files;
}

/** Whether a hunk touches the 1-based inclusive line range [from, to]. */
export function touches(h: Hunk, from: number, to: number): boolean {
  if (h.count === 0) return from <= h.start && to >= h.start + 1; // a deletion strictly inside the range
  return h.start <= to && h.start + h.count - 1 >= from;
}

export type Git = (args: string[]) => Promise<string>;

/** Run git in `cwd`; rejects with git's stderr. */
export function gitIn(cwd: string): Git {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args.join(' ')}: ${(stderr || err.message).trim()}`));
        else resolve(stdout);
      });
    });
}

/**
 * The PR's change: merge base of `base` and HEAD, diffed against the working tree. Throws a plain explanation when the
 * base commit is not available (a shallow clone).
 */
export async function changedFiles(git: Git, base: string): Promise<{ mergeBase: string; files: FileDiff[] }> {
  let mergeBase: string;
  try {
    mergeBase = (await git(['merge-base', base, 'HEAD'])).trim();
  } catch (e) {
    throw new Error(
      `cannot find the merge base of ${base} and HEAD (${e instanceof Error ? e.message : String(e)}). Check out with \`fetch-depth: 0\` so the base commit is available.`,
    );
  }
  const out = await git(['diff', '--unified=0', '--no-color', '--no-ext-diff', '-M', '--diff-filter=AMR', mergeBase, '--']);
  const files = parseDiff(out);
  // Untracked files (a local dry run before committing) are new files: every line is changed.
  const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter((p) => p !== '');
  for (const path of untracked) if (!files.some((f) => f.path === path)) files.push({ path, status: 'added', hunks: [{ start: 1, count: Number.MAX_SAFE_INTEGER }] });
  return { mergeBase, files };
}

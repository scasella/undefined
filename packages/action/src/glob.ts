/**
 * The `paths` input: newline- or comma-separated globs over repository-relative paths (`/` separators). Supported:
 * `**` (any number of directories), `*` (within one path segment), `?`, `{a,b}`, and a leading `!` to exclude. Hand-rolled
 * because `path.matchesGlob` is not available on every supported Node.
 */

function toRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  let brace = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories; a trailing `**` matches the rest
        if (glob[i + 2] === '/') {
          re += '(?:[^/]*/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      re += '(?:';
      brace += 1;
      i += 1;
    } else if (c === '}' && brace > 0) {
      re += ')';
      brace -= 1;
      i += 1;
    } else if (c === ',' && brace > 0) {
      re += '|';
      i += 1;
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export interface PathFilter {
  (path: string): boolean;
  readonly patterns: readonly string[];
}

export function parsePatterns(input: string): string[] {
  return input
    .split(/[\n,](?![^{]*\})/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'));
}

/** Test, spec and declaration files are never certified as sources (they are the checks, or have no bodies). */
export function isCheckFile(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?tsx?$/.test(path) || /\.d\.[cm]?ts$/.test(path) || /(^|\/)__tests__\//.test(path);
}

/** A filter: included by at least one positive pattern, excluded by none, a `.ts` file and not a check file. */
export function pathFilter(input: string): PathFilter {
  const patterns = parsePatterns(input);
  const include = patterns.filter((p) => !p.startsWith('!')).map(toRegExp);
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => toRegExp(p.slice(1)));
  const f = ((path: string): boolean =>
    /\.[cm]?ts$/.test(path) && !isCheckFile(path) && include.some((r) => r.test(path)) && !exclude.some((r) => r.test(path))) as PathFilter;
  Object.defineProperty(f, 'patterns', { value: patterns });
  return f;
}

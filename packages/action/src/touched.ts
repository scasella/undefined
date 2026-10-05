/**
 * Which exported functions the PR touches (docs/WORKSPACE-DESIGN.md §5.2): a hunk intersects the function's range
 * (JSDoc through closing brace); or a hunk changes a `type`/`interface` the function uses (its extracted typeDecls,
 * transitively); or the function's spec/test file changed (the file the engine's discovery would use for it).
 */
import { basename, dirname, join } from 'node:path';
import { extractFunctions } from '@scasella/undefined-engine';
import { discoverSpec } from '@scasella/undefined-engine/node/certifyFile';
import { touches, type FileDiff } from './diff';
import { isCheckFile, type PathFilter } from './glob';
import { declaresType, fileRanges } from './ranges';

/** file (repository-relative) → function name → why it is certified. */
export type Touched = Map<string, Map<string, string>>;

export interface TouchedInput {
  /** Absolute repository root. */
  root: string;
  files: readonly FileDiff[];
  include: PathFilter;
  read(rel: string): Promise<string | null>;
  exists(abs: string): boolean;
}

/** Source files a changed spec/test file could belong to: `a/x.test.ts` → `a/x.ts`; `a/__tests__/x.test.ts` → `a/x.ts`. */
export function sourcesForCheckFile(rel: string): string[] {
  const m = /^(.*?)(?:\.undefined\.json|\.(?:test|spec)\.ts)$/.exec(basename(rel));
  if (!m) return [];
  const dir = dirname(rel);
  const out = [join(dir, `${m[1]}.ts`)];
  if (basename(dir) === '__tests__') out.push(join(dirname(dir), `${m[1]}.ts`));
  return out.map((p) => p.split('\\').join('/').replace(/^\.\//, ''));
}

export async function touchedFunctions(i: TouchedInput): Promise<Touched> {
  const out: Touched = new Map();
  const add = (file: string, name: string, why: string): void => {
    const m = out.get(file) ?? new Map<string, string>();
    if (!m.has(name)) m.set(name, why);
    out.set(file, m);
  };
  for (const f of i.files) {
    if (i.include(f.path)) {
      const text = await i.read(f.path);
      if (text === null) continue;
      const ranges = await fileRanges(text);
      for (const r of ranges.functions) if (f.hunks.some((h) => touches(h, r.from, r.to))) add(f.path, r.name, f.status === 'added' ? 'new' : 'changed');
      const changedTypes = ranges.types.filter((t) => f.hunks.some((h) => touches(h, t.from, t.to))).map((t) => t.name);
      if (changedTypes.length > 0) {
        const { functions } = await extractFunctions(text, f.path);
        for (const fn of functions) {
          const t = changedTypes.find((n) => declaresType(fn.typeDecls, n));
          if (t) add(f.path, fn.name, `uses type ${t}, which changed`);
        }
      }
    }
  }
  // second pass, so a function's own change is the reason given when both apply
  for (const f of i.files) {
    if (isCheckFile(f.path) || f.path.endsWith('.undefined.json')) {
      for (const src of sourcesForCheckFile(f.path)) {
        if (!i.include(src) || !i.exists(join(i.root, src))) continue;
        if (discoverSpec(join(i.root, src), i.exists) !== join(i.root, f.path)) continue;
        const text = await i.read(src);
        if (text === null) continue;
        const kind = f.path.endsWith('.json') ? 'spec' : 'test';
        for (const r of (await fileRanges(text)).functions) add(src, r.name, `its ${kind} file changed`);
      }
    }
  }
  return out;
}

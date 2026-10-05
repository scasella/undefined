/** In-process CLI runs for the tests: paths resolve from this file, never from the working directory. */
import { fileURLToPath } from 'node:url';
import { main } from '../src/run';

export const EXAMPLES = fileURLToPath(new URL('../examples/', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

export async function cli(argv: string[], cwd: string): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

const VOLATILE_KEYS = new Set(['ms', 'at', 'ejectedAt', 'committedAt']);
const VERSION_KEYS = new Set(['version', 'node', 'v8', 'icu', 'typescript', 'fastCheck']);

/**
 * The --json document with what legitimately changes between runs replaced: timestamps and durations (`ms`, `at`,
 * `ejectedAt`, `committedAt`) and the tool/runtime versions in `tool` and `certifiedBy`. Everything else must be
 * identical for the same input (determinism, docs/WORKSPACE-DESIGN.md §4.7).
 */
export function stable(doc: unknown, parent = ''): unknown {
  if (Array.isArray(doc)) return doc.map((x) => stable(x, parent));
  if (doc && typeof doc === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
      if (VOLATILE_KEYS.has(k) && (typeof v === 'number' || typeof v === 'string')) out[k] = `<${k}>`;
      else if ((parent === 'tool' || parent === 'certifiedBy') && VERSION_KEYS.has(k)) out[k] = `<${k}>`;
      else out[k] = stable(v, k);
    }
    return out;
  }
  return doc;
}

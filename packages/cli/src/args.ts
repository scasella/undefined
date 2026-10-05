/**
 * Command-line arguments (docs/WORKSPACE-DESIGN.md §4.1), parsed by hand: no dependency, no config file lookup.
 *
 *   undefined-certify certify <file.ts> [--spec <file>] [--json] [--function <name>]… [--budget-ms <n>]
 *                             [--no-mutation] [--time-box-ms <n>] [--heap-mb <n>] [--quiet]
 *
 * A usage error is exit 3 ("could not run"), like every other reason the certification could not happen.
 */

export interface CertifyArgs {
  command: 'certify';
  file: string;
  spec?: string;
  json: boolean;
  functions: string[];
  budgetMs?: number;
  mutation: boolean;
  timeBoxMs?: number;
  heapMb?: number;
  quiet: boolean;
}

export type ParsedArgs = CertifyArgs | { command: 'help' } | { command: 'version' } | { command: 'error'; message: string };

export const USAGE = `Usage: undefined-certify certify <file.ts> [options]

Certifies the exported functions of a TypeScript file with the Undefined gates (compile, tests, properties,
invariants) and a mutation check, in Node. It never generates or changes code.

Options:
  --spec <file>         an undefined-spec JSON file or a vitest + fast-check test file
                        (default: <name>.undefined.json, <name>.test.ts, <name>.spec.ts, __tests__/<name>.test.ts,
                        __tests__/<name>.spec.ts next to the file; first match wins)
  --json                print one JSON document (the provenance the site ejects, per function) instead of text
  --function <name>     certify only this export (repeatable); the same-file functions it calls are certified first
  --budget-ms <n>       per-call time budget for functions whose spec sets none (default 1000)
  --no-mutation         skip the mutation check
  --time-box-ms <n>     time box for the mutation check (default 6000)
  --heap-mb <n>         heap limit of each gate worker (default 256)
  --quiet               print only the verdict line per function
  -h, --help            this text
  -v, --version         the version

Exit codes: 0 every function accepted, 1 a function was rejected, 2 spec gaps found (the questions are printed),
3 could not run.

The certified code runs in a Node worker_thread with a watchdog. That is NOT a secure sandbox: run it only on
code you would run anyway.`;

const POSITIVE_INT = /^[1-9]\d*$/;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) return { command: 'error', message: 'missing command (expected: certify <file.ts>)' };
  if (argv.some((a) => a === '-h' || a === '--help') || argv[0] === 'help') return { command: 'help' };
  if (argv[0] === '-v' || argv[0] === '--version' || argv[0] === 'version') return { command: 'version' };
  const [command, ...rest] = argv;
  if (command !== 'certify') return { command: 'error', message: `unknown command ${JSON.stringify(command)} (expected: certify <file.ts>)` };

  const out: CertifyArgs = { command: 'certify', file: '', json: false, functions: [], mutation: true, quiet: false };
  const files: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i]!;
    if (raw === '--') {
      files.push(...rest.slice(i + 1));
      break;
    }
    if (!raw.startsWith('-') || raw === '-') {
      files.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    const flag = eq > 0 && raw.startsWith('--') ? raw.slice(0, eq) : raw;
    const inline = eq > 0 && raw.startsWith('--') ? raw.slice(eq + 1) : undefined;
    const value = (): string | { error: string } => {
      if (inline !== undefined) return inline === '' ? { error: `${flag} needs a value` } : inline;
      const next = rest[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) return { error: `${flag} needs a value` };
      i++;
      return next;
    };
    const int = (): number | { error: string } => {
      const v = value();
      if (typeof v !== 'string') return v;
      if (!POSITIVE_INT.test(v) || !Number.isSafeInteger(Number(v))) return { error: `${flag} must be a positive whole number (got ${JSON.stringify(v)})` };
      return Number(v);
    };
    const boolean = (): { error: string } | null => (inline !== undefined ? { error: `${flag} takes no value` } : null);
    if (flag !== '--function' && seen.has(flag)) return { command: 'error', message: `${flag} given twice` };
    seen.add(flag);
    let problem: { error: string } | null = null;
    switch (flag) {
      case '--spec': {
        const v = value();
        if (typeof v === 'string') out.spec = v;
        else problem = v;
        break;
      }
      case '--function': {
        const v = value();
        if (typeof v !== 'string') problem = v;
        else if (!/^[A-Za-z_$][\w$]*$/.test(v)) problem = { error: `--function expects a function name (got ${JSON.stringify(v)})` };
        else if (!out.functions.includes(v)) out.functions.push(v);
        break;
      }
      case '--budget-ms':
      case '--time-box-ms':
      case '--heap-mb': {
        const n = int();
        if (typeof n !== 'number') problem = n;
        else if (flag === '--budget-ms') out.budgetMs = n;
        else if (flag === '--time-box-ms') out.timeBoxMs = n;
        else out.heapMb = n;
        break;
      }
      case '--json':
        problem = boolean();
        out.json = true;
        break;
      case '--no-mutation':
        problem = boolean();
        out.mutation = false;
        break;
      case '--quiet':
        problem = boolean();
        out.quiet = true;
        break;
      case '--seed':
      case '--overall-cap-ms':
        return { command: 'error', message: `${flag} is not supported yet: the engine derives the seed from the spec and uses the site's overall cap` };
      default:
        return { command: 'error', message: `unknown option ${flag}` };
    }
    if (problem) return { command: 'error', message: problem.error };
  }
  if (files.length === 0) return { command: 'error', message: 'certify needs a TypeScript file: certify <file.ts>' };
  if (files.length > 1) return { command: 'error', message: `certify takes one file (got ${files.length}: ${files.join(', ')})` };
  out.file = files[0]!;
  if (out.json && out.quiet) return { command: 'error', message: '--json and --quiet cannot be combined' };
  if (!out.mutation && out.timeBoxMs !== undefined) return { command: 'error', message: '--time-box-ms has no effect with --no-mutation' };
  return out;
}

/**
 * The CLI as a function: main(argv, io) → exit code. bin.ts is only `process.exit(await main(...))`, so every path
 * (arguments, exit codes, both output formats) is testable in-process.
 *
 * Exit codes (docs/WORKSPACE-DESIGN.md §4.3): 0 every function accepted; 1 a function was rejected; 2 no rejection,
 * but spec gaps were found (the questions are printed); 3 could not run (bad arguments, unreadable files, constructs
 * the gates cannot run, the gate worker failed). Across functions: 1 > 3 > 2 > 0.
 *
 * Neutrality: nothing here (or in anything it imports) generates code. It certifies code from any source — Claude
 * Code, Codex, Cursor, a human — exactly as written.
 */
import { parseArgs, USAGE } from './args';
import { cliVersion, runCertify } from './certifyCommand';
import { renderHuman } from './report/human';
import { renderJson } from './report/json';

export interface MainIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** Print "certifying <fn>…" to stderr (bin.ts sets it when stderr is a terminal). */
  progress?: boolean;
}

export async function main(argv: readonly string[], io: MainIo): Promise<0 | 1 | 2 | 3> {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (args.command === 'version') {
    io.stdout(`${cliVersion()}\n`);
    return 0;
  }
  if (args.command === 'error') {
    io.stderr(`undefined-certify: ${args.message}\n\n${USAGE}\n`);
    return 3;
  }
  const report = await runCertify(args, {
    cwd: io.cwd,
    ...(io.progress && !args.json ? { onStart: (fn: string) => io.stderr(`certifying ${fn}…\n`) } : {}),
  });
  if (args.json) io.stdout(renderJson(report));
  else io.stdout(renderHuman(report, args.quiet));
  return report.exitCode;
}

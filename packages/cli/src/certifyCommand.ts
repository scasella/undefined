/**
 * `certify <file>`: read the file and its checks, run the engine's certify() on the Node gate host, and collect what
 * the reports need. No network, no config lookup beyond the given paths and the documented spec discovery, no
 * telemetry, and no code generation: the engine certifies code from any source exactly as written.
 *
 * NOT A SECURE SANDBOX: the certified code and its tests run in a Node worker_thread with a watchdog, inside a
 * `node:vm` realm without Node APIs (engine node/host.ts). That catches accidents, not a deliberate escape.
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import type { Json } from '@scasella/undefined-engine/types';
import { certify, type CertifyResult, type FunctionResult, type SpecInput } from '@scasella/undefined-engine/certifyModule';
import { extractFunctions } from '@scasella/undefined-engine/ingest/source';
import { loadTs } from '@scasella/undefined-engine/gates/compile';
import { createNodeGateHost, type NodeHostOptions } from '@scasella/undefined-engine/node/host';
import { discoverSpec, refersTo } from '@scasella/undefined-engine/node/certifyFile';
import type { CertifyArgs } from './args';
import { mapMutantLines, type MutantLine } from './mutantLines';

declare const __UNDEFINED_CLI_VERSION__: string | undefined;
declare const __UNDEFINED_FAST_CHECK_VERSION__: string | undefined;

export const TOOL_NAME = '@scasella/undefined';
export const HOST_NOTE = 'node worker_thread + node:vm realm with a watchdog (not a secure sandbox)';

const req = createRequire(import.meta.url);
function versionFromDisk(spec: string): string | null {
  try {
    return (req(spec) as { version: string }).version;
  } catch {
    return null;
  }
}

/** The CLI's version: injected at build time; read from package.json when running from source. */
export function cliVersion(): string {
  if (typeof __UNDEFINED_CLI_VERSION__ === 'string') return __UNDEFINED_CLI_VERSION__;
  return versionFromDisk('../package.json') ?? '0.0.0';
}

function fastCheckVersion(): string | null {
  if (typeof __UNDEFINED_FAST_CHECK_VERSION__ === 'string') return __UNDEFINED_FAST_CHECK_VERSION__;
  return versionFromDisk('fast-check/package.json');
}

/** What certified it (goes into --json and each provenance's `certifiedBy`). Never sent anywhere. */
export async function toolInfo(): Promise<Record<string, Json>> {
  const ts = await loadTs();
  return {
    name: TOOL_NAME,
    version: cliVersion(),
    node: process.versions.node,
    v8: process.versions.v8,
    icu: process.versions.icu ?? null,
    typescript: ts.version,
    fastCheck: fastCheckVersion(),
    host: HOST_NOTE,
  };
}

/** The prebuilt gate harness next to the bundled CLI (dist/harness.js); absent when running from source. */
function prebuiltHarness(): string | undefined {
  try {
    const p = fileURLToPath(new URL('./harness.js', import.meta.url));
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

export interface FunctionReport {
  result: FunctionResult;
  mutantLines: MutantLine[];
  /** True when the source was an expression-bodied arrow (the body is synthesised; lines map to the declaration). */
  synthesised: boolean;
}

export interface CertifyReport {
  /** As given on the command line, relative to the working directory when inside it (display and --json). */
  file: string;
  specFile: string | null;
  tool: Record<string, Json>;
  exitCode: 0 | 1 | 2 | 3;
  result: CertifyResult | null;
  functions: FunctionReport[];
  /** Problems that stopped everything before any function ran (missing file, unreadable spec). */
  fatal: string[];
  /** The CLI's own notes (the engine's are in result.notes). */
  notes: string[];
}

export function displayPath(cwd: string, p: string): string {
  const rel = relative(cwd, p);
  const shown = rel === '' || rel.startsWith('..') || resolve(cwd, rel) !== p ? p : rel;
  return sep === '\\' ? shown.split(sep).join('/') : shown;
}

export interface CertifyIo {
  cwd: string;
  /** Called when a function starts (human mode prints progress to stderr when it is a terminal). */
  onStart?: (fn: string) => void;
}

export async function runCertify(args: CertifyArgs, io: CertifyIo): Promise<CertifyReport> {
  const tool = await toolInfo();
  const file = resolve(io.cwd, args.file);
  const shownFile = displayPath(io.cwd, file);
  const failed = (message: string, specFile: string | null = null): CertifyReport => ({
    file: shownFile,
    specFile,
    tool,
    exitCode: 3,
    result: null,
    functions: [],
    fatal: [message],
    notes: [],
  });

  let source: string;
  try {
    if (!(await stat(file)).isFile()) return failed(`${shownFile}: not a file`);
    source = await readFile(file, 'utf8');
  } catch {
    return failed(`${shownFile}: cannot read the file`);
  }
  if (!/\.(?:[cm]?ts|tsx)$/.test(file) || /\.d\.[cm]?ts$/.test(file)) return failed(`${shownFile}: expected a TypeScript source file (.ts)`);

  const specPath = args.spec !== undefined ? resolve(io.cwd, args.spec) : discoverSpec(file);
  const shownSpec = specPath ? displayPath(io.cwd, specPath) : null;
  let spec: SpecInput | undefined;
  if (specPath) {
    let text: string;
    try {
      text = await readFile(specPath, 'utf8');
    } catch {
      return failed(`${shownSpec}: cannot read the spec file`, shownSpec);
    }
    const looksJson = specPath.endsWith('.json') || /^\s*\{/.test(text);
    // file names in issues are shown as the user gave them
    spec = looksJson
      ? { kind: 'undefined-spec', text, file: shownSpec! }
      : { kind: 'vitest', text, file: shownSpec!, isSourceModule: (s) => refersTo(specPath, s, file) };
  }

  const hostOptions: NodeHostOptions = {};
  const harnessPath = prebuiltHarness();
  if (harnessPath) hostOptions.harnessPath = harnessPath;
  if (args.heapMb !== undefined) hostOptions.heapMb = args.heapMb;
  let host;
  try {
    host = await createNodeGateHost(hostOptions);
  } catch (e) {
    return failed(`the gate host could not start: ${e instanceof Error ? e.message : String(e)}`, shownSpec);
  }

  let result: CertifyResult;
  try {
    result = await certify({
      source,
      sourceFile: shownFile,
      ...(spec ? { spec } : {}),
      host,
      certifiedBy: tool,
      ...(args.functions.length > 0 ? { functions: args.functions } : {}),
      ...(args.budgetMs !== undefined ? { defaultBudgetMs: args.budgetMs } : {}),
      mutation: args.mutation ? (args.timeBoxMs !== undefined ? { timeBoxMs: args.timeBoxMs } : true) : false,
      ...(io.onStart ? { onStart: io.onStart } : {}),
    });
  } catch (e) {
    return failed(`could not certify: ${e instanceof Error ? e.message : String(e)}`, shownSpec);
  }

  const extracted = await extractFunctions(source, shownFile);
  const synthesisedFns = new Set(extracted.functions.filter((f) => f.expressionBody).map((f) => f.name));
  const functions: FunctionReport[] = [];
  for (const r of result.functions) {
    const synthesised = synthesisedFns.has(r.name);
    const mutantLines = await mapMutantLines({
      spec: r.spec,
      body: r.body,
      js: r.compile.js,
      mutants: r.mutation?.survivors ?? [],
      bodyFileLine: r.bodyLine,
      synthesised,
    });
    functions.push({ result: r, mutantLines, synthesised });
  }
  const notes =
    args.budgetMs !== undefined
      ? [`--budget-ms ${args.budgetMs} applies to functions whose spec sets no budgetMs; the budget is part of the spec, so it changes their specHash and seed`]
      : [];
  return { file: shownFile, specFile: shownSpec, tool, exitCode: result.exitCode, result, functions, fatal: [], notes };
}

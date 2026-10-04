/**
 * Gate 1: compile the candidate with the real TypeScript compiler (strict, ES2022 lib only).
 *
 * `typescript` (~9 MB) and the lib .d.ts files are loaded lazily on first use, never at module top level.
 * Parsed lib SourceFiles are cached, and the previous Program is passed back to createProgram, so only the
 * first compile pays for parsing the libs.
 */
import type * as TS from 'typescript';
import type { Diagnostic, FunctionSpec, GateResult } from '../types';
import { buildSource } from './source';

type TsModule = typeof TS;

const LIB_DIR = '/node_modules/typescript/lib';
const ROOT_LIB = 'lib.es2022.d.ts';
const CANDIDATE_FILE = '/candidate.ts';

// Lazy loaders only; nothing is fetched until a loader is called. Narrowed to the es*/decorators family (the
// closure of lib.es2022.d.ts) so the build does not emit unused multi-MB chunks for lib.dom / lib.webworker.
const libLoaders = import.meta.glob<string>('/node_modules/typescript/lib/lib.{es,decorators}*.d.ts', {
  query: '?raw',
  import: 'default',
});

interface Toolchain {
  ts: TsModule;
  options: TS.CompilerOptions;
  libText: Map<string, string>;
  libFiles: Map<string, TS.SourceFile>;
  oldProgram?: TS.Program;
}

let toolchain: Toolchain | null = null;
let loading: Promise<Toolchain> | null = null;

async function loadLibs(): Promise<Map<string, string>> {
  const libText = new Map<string, string>();
  const pending = [ROOT_LIB];
  while (pending.length > 0) {
    const batch = pending.splice(0).filter((f) => !libText.has(f));
    const texts = await Promise.all(
      batch.map(async (file) => {
        const load = libLoaders[`${LIB_DIR}/${file}`];
        if (!load) throw new Error(`TypeScript lib file not found: ${file}`);
        return [file, await load()] as const;
      }),
    );
    for (const [file, text] of texts) {
      if (libText.has(file)) continue;
      libText.set(file, text);
      for (const m of text.matchAll(/^\/\/\/\s*<reference\s+lib="([^"]+)"/gm)) {
        const ref = `lib.${m[1]!.toLowerCase()}.d.ts`;
        if (!libText.has(ref)) pending.push(ref);
      }
    }
  }
  return libText;
}

function loadToolchain(): Promise<Toolchain> {
  if (toolchain) return Promise.resolve(toolchain);
  loading ??= (async () => {
    const [mod, libText] = await Promise.all([import('typescript'), loadLibs()]);
    // typescript is CommonJS: the namespace lives on `default` under most interop layers.
    const ts = ((mod as { default?: TsModule }).default ?? mod) as TsModule;
    const options: TS.CompilerOptions = {
      strict: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      alwaysStrict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      lib: [ROOT_LIB],
      types: [],
      skipLibCheck: true,
      noEmitOnError: false,
      newLine: ts.NewLineKind.LineFeed,
    };
    toolchain = { ts, options, libText, libFiles: new Map() };
    return toolchain;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Preload the compiler and libs (and parse the libs) so the first real compile is fast. */
export async function warmUp(): Promise<void> {
  await compileCandidate({
    name: 'warmUp',
    params: [],
    returns: null,
    doc: '',
    tests: '',
    properties: '',
    budgetMs: 1,
    maxAttempts: 1,
    origin: 'call',
  }, 'return 0;');
}

function createHost(tc: Toolchain, source: string, outputs: Map<string, string>): TS.CompilerHost {
  const { ts, libText, libFiles } = tc;
  const libName = (fileName: string): string | null =>
    fileName.startsWith(`${LIB_DIR}/`) ? fileName.slice(LIB_DIR.length + 1) : null;
  return {
    getSourceFile(fileName, languageVersion) {
      if (fileName === CANDIDATE_FILE) return ts.createSourceFile(fileName, source, languageVersion, true);
      const lib = libName(fileName);
      const text = lib === null ? undefined : libText.get(lib);
      if (text === undefined) return undefined;
      let sf = libFiles.get(fileName);
      if (!sf) {
        sf = ts.createSourceFile(fileName, text, languageVersion);
        libFiles.set(fileName, sf);
      }
      return sf;
    },
    getDefaultLibFileName: () => `${LIB_DIR}/${ROOT_LIB}`,
    getDefaultLibLocation: () => LIB_DIR,
    writeFile: (fileName, text) => outputs.set(fileName, text),
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === CANDIDATE_FILE || (libName(f) !== null && libText.has(libName(f)!)),
    readFile: (f) => (f === CANDIDATE_FILE ? source : (libName(f) !== null ? libText.get(libName(f)!) : undefined)),
    directoryExists: (d) => d === '/' || d === LIB_DIR || LIB_DIR.startsWith(`${d}/`),
    getDirectories: () => [],
  };
}

export interface CompileOutput {
  gate: GateResult;
  /** Strict-mode JS (a function declaration named spec.name), or null when the gate failed. */
  js: string | null;
  /** Full TypeScript that was compiled (wrapper + body). */
  source: string;
  /** Declared return type, or the checker-inferred one when spec.returns is null ('' if it could not be determined). */
  returnType: string;
}

/** Harness-level diagnostics (not from tsc). Code 0 marks them. */
const HARNESS_CODE = 0;

export async function compileCandidate(spec: FunctionSpec, body: string): Promise<CompileOutput> {
  const t0 = now();
  const tc = await loadToolchain();
  const { ts } = tc;
  const { source, bodyStartLine } = buildSource(spec, body);
  const bodyLines = source.split('\n').slice(bodyStartLine - 1, -2);
  const lastBodyLine = Math.max(1, trimmedLineCount(bodyLines));

  const outputs = new Map<string, string>();
  const host = createHost(tc, source, outputs);
  const program = ts.createProgram([CANDIDATE_FILE], tc.options, host, tc.oldProgram);
  tc.oldProgram = program;
  const file = program.getSourceFile(CANDIDATE_FILE)!;

  const toBody = (pos: number): { line: number; col: number } => {
    const lc = file.getLineAndCharacterOfPosition(pos);
    const line = lc.line + 1 - (bodyStartLine - 1);
    if (line < 1) return { line: 1, col: 1 };
    if (line > lastBodyLine) return { line: lastBodyLine, col: 1 };
    return { line, col: lc.character + 1 };
  };

  const diagnostics: Array<Extract<Diagnostic, { kind: 'compile' }>> = [];
  const add = (code: number, message: string, start: number | undefined, length: number | undefined, category: 'error' | 'warning') => {
    let line = 1, col = 1, endLine = 1, endCol = 1;
    if (start !== undefined) {
      ({ line, col } = toBody(start));
      ({ line: endLine, col: endCol } = toBody(start + (length ?? 0)));
      // Spans that started in the wrapper collapse to a point; widen them to the whole mapped line.
      if (endLine < line || (endLine === line && endCol <= col)) {
        endLine = line;
        endCol = (bodyLines[line - 1]?.trimEnd().length ?? 0) + 1;
        if (endCol <= col) col = 1;
      }
    }
    diagnostics.push({
      kind: 'compile',
      code,
      message,
      category,
      line,
      col,
      endLine,
      endCol,
      snippet: (bodyLines[line - 1] ?? '').trimEnd(),
    });
  };

  // Harness shape problems first: they explain the root cause of whatever tsc says next.
  for (const h of shapeProblems(ts, file, spec.name)) add(HARNESS_CODE, h.message, h.start, h.length, 'error');
  // getPreEmitDiagnostics sorts by position; put syntax errors first so the headline names the root cause.
  const key = (d: TS.Diagnostic) => `${d.code}:${d.start ?? -1}`;
  const syntactic = new Set(program.getSyntacticDiagnostics(file).map(key));
  const tscDiagnostics = [...ts.getPreEmitDiagnostics(program)].sort(
    (a, b) => Number(!syntactic.has(key(a))) - Number(!syntactic.has(key(b))),
  );
  for (const d of tscDiagnostics) {
    if (d.category !== ts.DiagnosticCategory.Error && d.category !== ts.DiagnosticCategory.Warning) continue;
    const category = d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning';
    const start = d.file === file ? d.start : undefined;
    add(d.code, ts.flattenDiagnosticMessageText(d.messageText, '\n'), start, d.length, category);
  }

  const fn = file.statements[0];
  let returnType = spec.returns ?? '';
  if (spec.returns === null && fn && ts.isFunctionDeclaration(fn)) {
    const checker = program.getTypeChecker();
    const sig = checker.getSignatureFromDeclaration(fn);
    if (sig) {
      returnType = checker.typeToString(
        checker.getReturnTypeOfSignature(sig),
        fn,
        ts.TypeFormatFlags.NoTruncation,
      );
    }
  }

  const errors = diagnostics.filter((d) => d.category === 'error');
  let js: string | null = null;
  if (errors.length === 0) {
    program.emit(undefined, (name, text) => outputs.set(name, text));
    js = [...outputs.entries()].find(([n]) => n.endsWith('.js'))?.[1] ?? null;
    if (js === null) {
      add(HARNESS_CODE, 'TypeScript produced no JavaScript output', undefined, undefined, 'error');
      errors.push(diagnostics[diagnostics.length - 1]!);
    }
  }

  const ok = errors.length === 0;
  const first = errors[0];
  const gate: GateResult = {
    gate: 'compile',
    status: ok ? 'pass' : 'fail',
    ms: Math.round(now() - t0),
    summary: `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`,
    diagnostics,
    counts: { passed: ok ? 1 : 0, total: 1 },
  };
  if (first) gate.headline = `Rejected: line ${first.line}: ${first.message.split('\n')[0]}`;
  return { gate, js, source, returnType };
}

/**
 * Structural checks tsc cannot express: the body must have statements, must stay inside the wrapper's braces, and must not be a whole
 * nested `function <name>(…) {…}` (the model returned a declaration instead of a body; with `returns: null` that
 * would otherwise compile as a function returning void).
 */
function shapeProblems(ts: TsModule, file: TS.SourceFile, name: string): Array<{ message: string; start: number; length: number }> {
  const out: Array<{ message: string; start: number; length: number }> = [];
  const [fn, ...rest] = file.statements;
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) return out; // tsc already reports a syntax error
  if (fn.body.statements.length === 0) {
    out.push({ message: 'The body is empty: it has no statements.', start: fn.body.getStart(file) + 1, length: 0 });
  }
  for (const s of rest) {
    out.push({
      message: 'The body closes the function early: code after it ends up outside the function. Return only the statements between the braces.',
      start: s.getStart(file),
      length: s.getWidth(file),
    });
    break;
  }
  for (const s of fn.body.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name) {
      out.push({
        message: `The body declares a nested function '${name}' instead of being the body of '${name}'. Return only the statements between the braces, without the signature.`,
        start: s.getStart(file),
        length: s.getWidth(file),
      });
    }
  }
  return out;
}

function trimmedLineCount(lines: string[]): number {
  let n = lines.length;
  while (n > 0 && lines[n - 1]!.trim() === '') n--;
  return n;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Strip types from the user's tests/properties (plain script output, no module wrapper). Synchronous, so it needs
 * the compiler to be loaded already (any prior compileCandidate or warmUp()); throws otherwise.
 */
export function transpileUserCode(src: string): { js: string; error?: string } {
  if (src.trim() === '') return { js: '' };
  if (!toolchain) throw new Error('transpileUserCode: TypeScript is not loaded yet; await warmUp() or compileCandidate() first');
  const { ts } = toolchain;
  const out = ts.transpileModule(src, {
    reportDiagnostics: true,
    fileName: 'user.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      isolatedModules: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  const firstErr = (out.diagnostics ?? []).find((d) => d.category === ts.DiagnosticCategory.Error);
  if (firstErr) {
    const msg = ts.flattenDiagnosticMessageText(firstErr.messageText, '\n');
    const line = firstErr.file && firstErr.start !== undefined
      ? firstErr.file.getLineAndCharacterOfPosition(firstErr.start).line + 1
      : 1;
    return { js: out.outputText, error: `line ${line}: ${msg}` };
  }
  // Test code runs as a plain script: a module statement would otherwise transpile to CommonJS `exports.` glue.
  const sf = ts.createSourceFile('user.ts', src, ts.ScriptTarget.ES2022, true);
  const moduleStmt = sf.statements.find(
    (st) =>
      ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isExportDeclaration(st) ||
      ts.isExportAssignment(st) ||
      (ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
  );
  if (moduleStmt) {
    const line = sf.getLineAndCharacterOfPosition(moduleStmt.getStart(sf)).line + 1;
    return { js: '', error: `line ${line}: import/export statements are not supported here; the test API (test, eq, property, fc, …) is already in scope` };
  }
  return { js: out.outputText };
}

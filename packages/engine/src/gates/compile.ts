/**
 * Gate 1: compile the candidate with the real TypeScript compiler (strict, ES2022 lib only).
 *
 * `typescript` (~9 MB) and the lib .d.ts files are loaded lazily on first use, never at module top level.
 * Parsed lib SourceFiles are cached, and the previous Program is passed back to createProgram, so only the
 * first compile pays for parsing the libs.
 */
import type * as TS from 'typescript';
import type { Diagnostic, FunctionSpec, GateResult } from '../types';
import type { OtherFunction, Unavailable } from '../compose/graph';
import { buildSource, typeDeclsText } from './source';

type TsModule = typeof TS;

const LIB_DIR = '/node_modules/typescript/lib';
const ROOT_LIB = 'lib.es2022.d.ts';
const CANDIDATE_FILE = '/candidate.ts';
/**
 * Ambient declarations of the other functions a body may call (composition, docs/COMPOSE-DESIGN.md §A2). A second root
 * file, a script (so its names are global), never part of `/candidate.ts`: the candidate's source, its line numbers and
 * its emitted JS are the same whether or not other functions exist. Absent from the program when there are none.
 */
const OTHERS_FILE = '/others.d.ts';

/**
 * Where the TypeScript lib .d.ts texts come from: given a file name (`lib.es2022.d.ts`), its text, or a rejection with
 * `TypeScript lib file not found: <file>`. Host-specific, so each host registers one before the first compile: the
 * site a lazy Vite glob (apps/site/src/gates/libs.ts), Node a file read. The compiler always sees them under the same
 * virtual LIB_DIR, so diagnostics do not depend on the host.
 */
export type LibSource = (file: string) => Promise<string>;

let libSource: LibSource | null = null;

/** Register the host's lib source (once, before the first compile; a later call replaces it). */
export function setLibSource(source: LibSource): void {
  libSource = source;
}

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
        if (!libSource) throw new Error('TypeScript lib source not set (setLibSource)');
        return [file, await libSource(file)] as const;
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

let tsOnly: Promise<TsModule> | null = null;

/** The `typescript` module alone (no lib .d.ts texts): enough to parse. Exported for the site's REPL splitter. */
export function loadTs(): Promise<TsModule> {
  if (toolchain) return Promise.resolve(toolchain.ts);
  tsOnly ??= import('typescript').then((mod) => ((mod as { default?: TsModule }).default ?? mod) as TsModule);
  tsOnly.catch(() => {
    tsOnly = null;
  });
  return tsOnly;
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

function createHost(tc: Toolchain, source: string, outputs: Map<string, string>, others?: string): TS.CompilerHost {
  const { ts, libText, libFiles } = tc;
  const libName = (fileName: string): string | null =>
    fileName.startsWith(`${LIB_DIR}/`) ? fileName.slice(LIB_DIR.length + 1) : null;
  return {
    getSourceFile(fileName, languageVersion) {
      if (fileName === CANDIDATE_FILE) return ts.createSourceFile(fileName, source, languageVersion, true);
      if (fileName === OTHERS_FILE && others !== undefined) return ts.createSourceFile(fileName, others, languageVersion, true);
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
    fileExists: (f) => f === CANDIDATE_FILE || (f === OTHERS_FILE && others !== undefined) || (libName(f) !== null && libText.has(libName(f)!)),
    readFile: (f) =>
      f === CANDIDATE_FILE ? source : f === OTHERS_FILE ? others : libName(f) !== null ? libText.get(libName(f)!) : undefined,
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
  /**
   * Other generated functions the body refers to (calls, or uses as a value: `titles.map(slugify)`), sorted; [] when
   * none. Found with the type checker, so a local `const slugify = …` inside the body does not count.
   */
  deps: string[];
  /** Set only when other functions were offered: which were declared, and which were dropped and why. */
  ambient?: { visible: string[]; dropped: Unavailable[] };
}

/** What else the body may call (compose/graph.ts othersFor). Both absent or empty = exactly the compile of HEAD. */
export interface CompileContext {
  others?: readonly OtherFunction[];
  unavailable?: readonly Unavailable[];
}

/** Harness-level diagnostics (not from tsc). Code 0 marks them. */
const HARNESS_CODE = 0;

/** The ambient file for `others`: their type declarations once each, then one `declare function` line each. */
export function ambientText(others: readonly OtherFunction[]): string {
  const lines = ['// Other generated functions this body may call (declarations only).'];
  const seen = new Set<string>();
  for (const o of others) {
    for (const t of o.types) {
      if (seen.has(t.text)) continue;
      seen.add(t.text);
      lines.push(t.text);
    }
  }
  for (const o of others) lines.push(`declare ${o.decl};`);
  return lines.join('\n') + '\n';
}

const ambientCache = new Map<string, { accepted: OtherFunction[]; dropped: Unavailable[] }>();

/**
 * Compile the ambient declarations alone and drop every function whose declaration (or types) does not compile, or
 * whose name is already a standard global (it would merge with it instead of being declared). Without this an error in
 * the ambient file would be reported on body line 1 of the candidate. Cached per distinct ambient text.
 */
function validateAmbient(tc: Toolchain, others: readonly OtherFunction[], callerTypes: string): { accepted: OtherFunction[]; dropped: Unavailable[] } {
  const key = `${callerTypes}\u0000${ambientText(others)}`;
  const hit = ambientCache.get(key);
  if (hit) return hit;
  const { ts } = tc;
  let accepted = [...others];
  const dropped: Unavailable[] = [];
  for (let round = 0; round <= others.length && accepted.length > 0; round++) {
    // the caller's own type declarations come first: an ambient signature may use them (they are shared, not repeated)
    const text = `${callerTypes === '' ? '' : `${callerTypes}\n`}${ambientText(accepted)}`;
    const host = createHost(tc, '', new Map(), text);
    // skipLibCheck would skip this very file (a .d.ts): check it, but not the default libs
    const program = ts.createProgram([OTHERS_FILE], { ...tc.options, skipLibCheck: false, skipDefaultLibCheck: true }, host);
    const file = program.getSourceFile(OTHERS_FILE)!;
    const bad = new Set<string>();
    const diags = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].filter((d) => d.category === ts.DiagnosticCategory.Error);
    for (const d of diags) {
      const line = d.start === undefined ? '' : text.split('\n')[file.getLineAndCharacterOfPosition(d.start).line] ?? '';
      const owner = accepted.find((o) => line === `declare ${o.decl};` || o.types.some((t) => t.text.split('\n').includes(line)));
      if (owner) bad.add(owner.name);
      else accepted.forEach((o) => bad.add(o.name)); // cannot tell whose: declare none of them
    }
    if (bad.size === 0) {
      const checker = program.getTypeChecker();
      for (const st of file.statements) {
        if (!ts.isFunctionDeclaration(st) || !st.name) continue;
        const sym = checker.getSymbolAtLocation(st.name);
        if ((sym?.declarations ?? []).some((x) => x.getSourceFile().fileName !== OTHERS_FILE)) bad.add(st.name.text);
      }
      for (const n of bad) dropped.push({ name: n, why: `${n} is also the name of a standard global, so it cannot be called by name here` });
      accepted = accepted.filter((o) => !bad.has(o.name));
      break;
    }
    for (const n of bad) dropped.push({ name: n, why: `${n}'s declaration does not compile on its own (its signature or types use something not declared)` });
    accepted = accepted.filter((o) => !bad.has(o.name));
  }
  const out = { accepted, dropped: dropped.sort((a, b) => a.name.localeCompare(b.name)) };
  if (ambientCache.size > 200) ambientCache.clear();
  ambientCache.set(key, out);
  return out;
}

export async function compileCandidate(spec: FunctionSpec, body: string, ctx: CompileContext = {}): Promise<CompileOutput> {
  const t0 = now();
  const tc = await loadToolchain();
  const { ts } = tc;
  const { source, bodyStartLine } = buildSource(spec, body);
  const bodyLines = source.split('\n').slice(bodyStartLine - 1, -2);
  const lastBodyLine = Math.max(1, trimmedLineCount(bodyLines));

  const offered = ctx.others ?? [];
  const ambient = offered.length > 0 ? validateAmbient(tc, offered, typeDeclsText(spec)) : null;
  const visible = ambient?.accepted ?? [];
  const othersText = visible.length > 0 ? ambientText(visible) : undefined;
  const outputs = new Map<string, string>();
  const host = createHost(tc, source, outputs, othersText);
  const roots = othersText !== undefined ? [CANDIDATE_FILE, OTHERS_FILE] : [CANDIDATE_FILE];
  const program = ts.createProgram(roots, tc.options, host, tc.oldProgram);
  tc.oldProgram = program;
  const file = program.getSourceFile(CANDIDATE_FILE)!;

  // The wrapper's `function` line (0-based line bodyStartLine - 3); everything before it is spec.typeDecls.
  const fnLinePos = file.getPositionOfLineAndCharacter(bodyStartLine - 3, 0);
  const inDecls = (pos: number | undefined): boolean => pos !== undefined && pos < fnLinePos;

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

  // The wrapper's function declaration: the first statement that starts at or after the `function` line.
  const fnIndex = file.statements.findIndex((st) => st.getStart(file) >= fnLinePos);
  // Harness shape problems first: they explain the root cause of whatever tsc says next.
  for (const h of declProblems(ts, file, fnIndex)) add(HARNESS_CODE, h.message, undefined, undefined, 'error');
  for (const h of shapeProblems(ts, file, spec.name, fnIndex)) add(HARNESS_CODE, h.message, h.start, h.length, 'error');
  for (const h of moduleProblems(ts, file)) add(HARNESS_CODE, h.message, h.start, h.length, 'error');
  // getPreEmitDiagnostics sorts by position; put syntax errors first so the headline names the root cause.
  const key = (d: TS.Diagnostic) => `${d.code}:${d.start ?? -1}`;
  const syntactic = new Set(program.getSyntacticDiagnostics(file).map(key));
  const tscDiagnostics = [...ts.getPreEmitDiagnostics(program)].sort(
    (a, b) => Number(!syntactic.has(key(a))) - Number(!syntactic.has(key(b))),
  );
  // A body that calls a program function it may not call: say why (cycle, out of date, types clash…) before tsc's
  // "Cannot find name". Only names tsc could not resolve, so a local `const slugify = …` is never flagged.
  const blocked = new Map<string, string>();
  for (const u of [...(ctx.unavailable ?? []), ...(ambient?.dropped ?? [])]) if (!blocked.has(u.name)) blocked.set(u.name, u.why);
  if (blocked.size > 0) {
    const said = new Set<string>();
    for (const d of tscDiagnostics) {
      if (d.file !== file || d.start === undefined || (d.code !== 2304 && d.code !== 2552)) continue;
      const name = file.text.slice(d.start, d.start + (d.length ?? 0));
      const why = blocked.get(name);
      if (!why || said.has(name) || inDecls(d.start)) continue;
      said.add(name);
      add(HARNESS_CODE, `${spec.name} cannot call ${name}: ${why}.`, d.start, d.length, 'error');
    }
  }
  for (const d of tscDiagnostics) {
    if (d.category !== ts.DiagnosticCategory.Error && d.category !== ts.DiagnosticCategory.Warning) continue;
    const category = d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning';
    const start = d.file === file ? d.start : undefined;
    const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    // An error inside spec.typeDecls is not on any body line: say where it is instead of pointing into the body.
    if (inDecls(start)) add(d.code, `in the type declarations (typeDecls): ${text}`, undefined, undefined, category);
    else add(d.code, text, start, d.length, category);
  }

  const fn = fnIndex >= 0 ? file.statements[fnIndex] : undefined;
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

  const deps = visible.length > 0 && fn && ts.isFunctionDeclaration(fn) && fn.body ? dependenciesOf(ts, program, fn.body, visible) : [];

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
  const out: CompileOutput = { gate, js, source, returnType, deps };
  if (ambient) out.ambient = { visible: visible.map((o) => o.name), dropped: ambient.dropped };
  return out;
}

/**
 * Names of the other functions `body` refers to: every identifier the checker resolves to a declaration in the ambient
 * file (a `declare function`, or one of a function's types, which counts as depending on the function that declares
 * it). Calls, values (`titles.map(slugify)`), shorthand properties (`{ slugify }`) and `typeof slugify` all count;
 * strings, comments, property names and locally shadowed names do not. Sorted.
 */
function dependenciesOf(ts: TsModule, program: TS.Program, body: TS.Node, visible: readonly OtherFunction[]): string[] {
  const checker = program.getTypeChecker();
  const typeOwner = new Map<string, string>();
  for (const o of visible) for (const t of o.types) if (!typeOwner.has(t.name)) typeOwner.set(t.name, o.name);
  const out = new Set<string>();
  const visit = (n: TS.Node): void => {
    if (ts.isIdentifier(n)) {
      const sym = ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
      for (const d of sym?.declarations ?? []) {
        if (d.getSourceFile().fileName !== OTHERS_FILE) continue;
        if (ts.isFunctionDeclaration(d) && d.name) out.add(d.name.text);
        else if ((ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d)) && typeOwner.has(d.name.text)) out.add(typeOwner.get(d.name.text)!);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return [...out].sort();
}

/**
 * Structural checks tsc cannot express: the body must have statements, must stay inside the wrapper's braces, and must not be a whole
 * nested `function <name>(…) {…}` (the model returned a declaration instead of a body; with `returns: null` that
 * would otherwise compile as a function returning void).
 */
function shapeProblems(ts: TsModule, file: TS.SourceFile, name: string, fnIndex: number): Array<{ message: string; start: number; length: number }> {
  const out: Array<{ message: string; start: number; length: number }> = [];
  if (fnIndex < 0) return out;
  const [fn, ...rest] = file.statements.slice(fnIndex);
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

/**
 * spec.typeDecls may hold only `type` aliases and `interface` declarations: anything else would be emitted as code that
 * runs outside the function (and outside what the model wrote). Reported once, as a harness error on body line 1.
 */
function declProblems(ts: TsModule, file: TS.SourceFile, fnIndex: number): Array<{ message: string }> {
  const decls = fnIndex < 0 ? [] : file.statements.slice(0, fnIndex);
  const bad = decls.find((st) => !ts.isTypeAliasDeclaration(st) && !ts.isInterfaceDeclaration(st));
  if (!bad) return [];
  return [{ message: 'The type declarations (typeDecls) may contain only `type` and `interface` declarations.' }];
}

/**
 * `import(…)` would let a candidate load and run arbitrary code (and reach the network) outside the masked scope, and
 * `import.meta` exposes the worker's URL. Both are found by walking the AST, so strings, comments and property names
 * that merely contain the word `import` are not affected. The same walk guards the user's tests/properties
 * (transpileUserCode). It cannot see code built from a string (`(()=>0).constructor('return import(u)')`): that is
 * what the Content-Security-Policy inherited by the sandbox workers is for (src/sandbox/spawn.ts).
 */
function moduleProblems(ts: TsModule, file: TS.SourceFile, where = 'a candidate'): Array<{ message: string; start: number; length: number }> {
  const out: Array<{ message: string; start: number; length: number }> = [];
  const visit = (n: TS.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push({ message: `dynamic import is not allowed in ${where}`, start: n.getStart(file), length: n.getWidth(file) });
    } else if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
      out.push({ message: `import.meta is not allowed in ${where}`, start: n.getStart(file), length: n.getWidth(file) });
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
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
  // Dynamic import() / import.meta: same AST walk as the candidate check. Test code runs in the gate worker; loading
  // code from elsewhere is never part of a spec.
  const dynamic = moduleProblems(ts, sf, 'tests or properties')[0];
  if (dynamic) {
    const line = sf.getLineAndCharacterOfPosition(dynamic.start).line + 1;
    return { js: '', error: `line ${line}: ${dynamic.message}` };
  }
  return { js: out.outputText };
}

/**
 * Per-function splitting of a TypeScript file that exports functions (docs/WORKSPACE-DESIGN.md §3.1).
 *
 * The gates certify a function BODY compiled inside a generated wrapper (gates/source.ts buildSource: typeDecls +
 * `function name(params): returns {\n<body>\n}`, lib ES2022, no imports). So each exported function is read with the
 * TypeScript parser and binder, and only what that wrapper can express is accepted:
 *   - `export function f(p: T, …): R { … }` and `export const f = (p: T, …): R => …` / `= function (…) { … }`;
 *   - parameters: a plain name with a type annotation (verbatim text). Optional, default, rest, destructured and `this`
 *     parameters, type parameters, overloads, async and generator functions are refused with the reason (FunctionSpec
 *     cannot express them, and extending it would change the hashed shape);
 *   - module-scope references: `type`/`interface` declarations of the same file are carried along as `typeDecls`
 *     (transitively, in file order); other exported functions of the same file are callees (certified first and
 *     linked, the composition path); anything else at module scope (imports, consts, classes, enums, helpers that are
 *     not exported) is refused: the gates certify self-contained functions.
 * Every refusal is an IngestIssue: "could not run" (exit 3), never a rejection of the code.
 *
 * `body` is the exact text between the braces with the leading newline and the trailing newline before `}` removed,
 * no re-indentation, so a body written into a file as `{\n<body>\n}` comes back byte for byte (same compile source,
 * same mutants). An expression-bodied arrow becomes `return <expr>;`.
 */
import type * as TS from 'typescript';
import type { ParamSpec } from '../types';
import { loadTs } from '../gates/compile';

type TsModule = typeof TS;

export interface ExtractedFunction {
  name: string;
  /** 1-based line of the declaration (its `export` keyword) in the file. */
  line: number;
  /** 1-based file line of the body's first line (maps body-relative diagnostics back to the file). */
  bodyLine: number;
  params: ParamSpec[];
  returns: string | null;
  /** JSDoc text (comment markers removed), '' when none. */
  doc: string;
  /** The same file's `type`/`interface` declarations it uses, in file order, '' when none. */
  typeDecls: string;
  body: string;
  /** True when the source was an expression-bodied arrow (the body is `return <expr>;`, not file text). */
  expressionBody: boolean;
  /** Other exported functions of this file that it refers to, sorted. */
  callees: string[];
}

export interface IngestIssue {
  file: string;
  line?: number;
  fn?: string;
  message: string;
}

export interface ExtractResult {
  functions: ExtractedFunction[];
  issues: IngestIssue[];
}

const FILE = '/source.ts';

export async function extractFunctions(text: string, fileName: string): Promise<ExtractResult> {
  return extractWith(await loadTs(), text, fileName);
}

/** Synchronous core, given the TypeScript module (exported for the vitest shim, which shares the parse). */
export function extractWith(ts: TsModule, text: string, fileName: string): ExtractResult {
  const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  // A one-file program with no libs: only for symbol resolution (which name refers to which declaration).
  const host: TS.CompilerHost = {
    getSourceFile: (f) => (f === FILE ? sf : undefined),
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === FILE,
    readFile: (f) => (f === FILE ? text : undefined),
  };
  const program = ts.createProgram([FILE], { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ES2022 }, host);
  const checker = program.getTypeChecker();
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const issues: IngestIssue[] = [];
  const issue = (node: TS.Node | null, message: string, fn?: string): void => {
    issues.push({ file: fileName, ...(node ? { line: lineOf(node.getStart(sf)) } : {}), ...(fn ? { fn } : {}), message });
  };

  for (const d of program.getSyntacticDiagnostics(sf)) {
    issue(null, `does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}${d.start !== undefined ? ` (line ${lineOf(d.start)})` : ''}`);
  }
  if (issues.length > 0) return { functions: [], issues };

  // ── exported functions ──
  interface Found {
    name: string;
    stmt: TS.Statement;
    fn: TS.FunctionDeclaration | TS.ArrowFunction | TS.FunctionExpression;
    decl: TS.Node; // the declaration whose symbol callers resolve to
  }
  const found: Found[] = [];
  const isExported = (s: TS.Statement): boolean => (ts.canHaveModifiers(s) ? (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) : false);
  const isDefault = (s: TS.Statement): boolean => (ts.canHaveModifiers(s) ? (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) : false);
  const overloaded = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && isExported(s)) {
      if (isDefault(s) || !s.name) {
        issue(s, 'a default export has no name to certify it under; export it by name');
        continue;
      }
      if (!s.body) {
        overloaded.add(s.name.text);
        continue;
      }
      found.push({ name: s.name.text, stmt: s, fn: s, decl: s });
    } else if (ts.isVariableStatement(s) && isExported(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer && skipParens(ts, d.initializer);
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          if (!(s.declarationList.flags & ts.NodeFlags.Const)) {
            issue(s, `${d.name.text} is declared with let/var; only const function exports are certified (a reassignable export is not one function)`, d.name.text);
            continue;
          }
          found.push({ name: d.name.text, stmt: s, fn: init, decl: d });
        }
      }
    } else if (ts.isExportAssignment(s)) {
      issue(s, 'a default export has no name to certify it under; export it by name');
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      issue(s, `export lists and re-exports are not followed; export each function where it is declared`);
    }
  }
  const exportedNames = new Set(found.map((f) => f.name));
  for (const n of overloaded) issue(null, `${n} has overload signatures; FunctionSpec describes one signature`, n);

  // module-scope declarations by node, for classification
  const typeDeclStmts = sf.statements.filter((s): s is TS.TypeAliasDeclaration | TS.InterfaceDeclaration => ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s));
  const topLevelOf = (n: TS.Node): TS.Statement | null => {
    let cur: TS.Node | undefined = n;
    while (cur && cur.parent && cur.parent !== sf) cur = cur.parent;
    return cur && cur.parent === sf ? (cur as TS.Statement) : null;
  };
  const symbolOf = (id: TS.Identifier): TS.Symbol | undefined => {
    if (ts.isShorthandPropertyAssignment(id.parent)) return checker.getShorthandAssignmentValueSymbol(id.parent);
    return checker.getSymbolAtLocation(id);
  };
  /** What a module-scope identifier refers to, for one owner (a function, or a type declaration). */
  type Ref = { kind: 'type'; stmt: TS.Statement } | { kind: 'callee'; name: string } | { kind: 'self' } | { kind: 'bad'; what: string; node: TS.Node };
  const classify = (id: TS.Identifier, owner: TS.Node, ownName: string | null): Ref | null => {
    const sym = symbolOf(id);
    const decls = sym?.declarations ?? [];
    if (decls.length === 0) return null; // a global (Math, Array…) or unresolved: the compile gate decides
    // declared inside the owner: a local, a parameter, a type parameter
    if (decls.some((d) => isInside(d, owner))) return null;
    const d = decls[0]!;
    const top = topLevelOf(d);
    if (!top) return null;
    if (ts.isImportDeclaration(top) || ts.isImportEqualsDeclaration(top)) {
      const from = ts.isImportDeclaration(top) && ts.isStringLiteral(top.moduleSpecifier) ? ` from '${top.moduleSpecifier.text}'` : '';
      return { kind: 'bad', what: `uses ${id.text}, imported${from}; the gates certify self-contained functions (type-only imports are not followed yet)`, node: id };
    }
    if (ts.isTypeAliasDeclaration(top) || ts.isInterfaceDeclaration(top)) return { kind: 'type', stmt: top };
    const name = id.text;
    if (ownName !== null && name === ownName) return { kind: 'self' };
    if (exportedNames.has(name) && found.some((f) => f.stmt === top)) return { kind: 'callee', name };
    const what = ts.isClassDeclaration(top)
      ? 'a class'
      : ts.isEnumDeclaration(top)
        ? 'an enum'
        : ts.isFunctionDeclaration(top)
          ? 'a function that is not exported'
          : ts.isVariableStatement(top)
            ? 'a module-scope variable'
            : ts.isModuleDeclaration(top)
              ? 'a namespace'
              : 'a module-scope declaration';
    return { kind: 'bad', what: `uses ${name} from module scope (${what}); the gates certify self-contained functions`, node: id };
  };
  const identifiersIn = (n: TS.Node): TS.Identifier[] => {
    const out: TS.Identifier[] = [];
    const visit = (x: TS.Node): void => {
      if (ts.isIdentifier(x)) out.push(x);
      // `a.b`: only `a` is a reference; `{ b: 1 }` keys are not references
      if (ts.isPropertyAccessExpression(x)) {
        visit(x.expression);
        return;
      }
      if (ts.isQualifiedName(x)) {
        visit(x.left);
        return;
      }
      ts.forEachChild(x, visit);
    };
    visit(n);
    return out;
  };

  /** Transitive closure of type declarations used by `node`, reporting bad refs inside them too. */
  const typeClosure = (start: Set<TS.Statement>): { stmts: TS.Statement[]; bad: Array<{ what: string; node: TS.Node }> } => {
    const seen = new Set<TS.Statement>();
    const bad: Array<{ what: string; node: TS.Node }> = [];
    const queue = [...start];
    while (queue.length > 0) {
      const t = queue.shift()!;
      if (seen.has(t)) continue;
      seen.add(t);
      const own = (t as TS.TypeAliasDeclaration | TS.InterfaceDeclaration).name.text;
      for (const id of identifiersIn(t)) {
        if (id === (t as TS.TypeAliasDeclaration).name) continue;
        const r = classify(id, t, own);
        if (!r || r.kind === 'self') continue;
        if (r.kind === 'type') queue.push(r.stmt);
        else if (r.kind === 'bad') bad.push(r);
        else bad.push({ what: `its type ${own} refers to the function ${r.name}`, node: id });
      }
    }
    return { stmts: typeDeclStmts.filter((s) => seen.has(s)), bad };
  };

  const functions: ExtractedFunction[] = [];
  for (const f of found) {
    if (overloaded.has(f.name)) continue;
    const fn = f.fn;
    const errs: string[] = [];
    const nodeErr = (n: TS.Node, m: string): void => issue(n, m, f.name);
    if (fn.typeParameters && fn.typeParameters.length > 0) errs.push('has type parameters; FunctionSpec has no generics');
    const mods = ts.canHaveModifiers(fn) ? (ts.getModifiers(fn) ?? []) : [];
    if (mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) errs.push('is async; the gates run synchronous functions');
    if (fn.asteriskToken) errs.push('is a generator; the gates run plain functions');
    const params: ParamSpec[] = [];
    for (const p of fn.parameters) {
      const pname = ts.isIdentifier(p.name) ? p.name.text : null;
      if (pname === 'this') errs.push('declares a `this` parameter');
      else if (!pname) errs.push('has a destructured parameter; give it a name and a type');
      else if (p.dotDotDotToken) errs.push(`has a rest parameter (...${pname})`);
      else if (p.questionToken) errs.push(`has an optional parameter (${pname}?)`);
      else if (p.initializer) errs.push(`has a default value for ${pname}`);
      else if (!p.type) errs.push(`parameter ${pname} has no type annotation`);
      else params.push({ name: pname, type: p.type.getText(sf) });
    }
    if (errs.length > 0) {
      for (const e of errs) nodeErr(f.stmt, `${f.name} ${e}`);
      continue;
    }
    // module-scope references
    const typeStarts = new Set<TS.Statement>();
    const callees = new Set<string>();
    let refBad = false;
    for (const id of identifiersIn(fn)) {
      const r = classify(id, fn, f.name);
      if (!r || r.kind === 'self') continue;
      if (r.kind === 'type') typeStarts.add(r.stmt);
      else if (r.kind === 'callee') callees.add(r.name);
      else {
        nodeErr(r.node, `${f.name} ${r.what}`);
        refBad = true;
      }
    }
    const types = typeClosure(typeStarts);
    for (const b of types.bad) {
      nodeErr(b.node, `${f.name} ${b.what}`);
      refBad = true;
    }
    if (refBad) continue;
    const typeDecls = types.stmts.map((s) => stripExport(s.getText(sf))).join('\n');

    let body: string;
    let bodyLine: number;
    let expressionBody = false;
    if (fn.body && ts.isBlock(fn.body)) {
      const open = fn.body.getStart(sf) + 1;
      const close = fn.body.getEnd() - 1;
      let start = open;
      let inner = text.slice(open, close);
      if (inner.startsWith('\r\n')) {
        inner = inner.slice(2);
        start += 2;
      } else if (inner.startsWith('\n')) {
        inner = inner.slice(1);
        start += 1;
      }
      const lastNl = inner.lastIndexOf('\n');
      if (lastNl >= 0 && inner.slice(lastNl + 1).trim() === '') inner = inner.slice(0, lastNl).replace(/\r$/, '');
      body = inner;
      bodyLine = lineOf(start);
    } else if (fn.body) {
      body = `return ${fn.body.getText(sf)};`;
      bodyLine = lineOf(fn.body.getStart(sf));
      expressionBody = true;
    } else {
      nodeErr(f.stmt, `${f.name} has no body`);
      continue;
    }

    functions.push({
      name: f.name,
      line: lineOf(f.stmt.getStart(sf)),
      bodyLine,
      params,
      returns: fn.type ? fn.type.getText(sf) : null,
      doc: jsDocText(ts, f.stmt, sf),
      typeDecls,
      body,
      expressionBody,
      callees: [...callees].sort(),
    });
  }
  return { functions, issues };
}

function skipParens(ts: TsModule, e: TS.Expression): TS.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function isInside(n: TS.Node, owner: TS.Node): boolean {
  for (let cur: TS.Node | undefined = n; cur; cur = cur.parent) if (cur === owner) return true;
  return false;
}

function stripExport(text: string): string {
  return text.replace(/^export\s+/, '');
}

/** The last JSDoc block on `node`, comment markers removed, lines trimmed; '' when none. */
export function jsDocText(ts: TsModule, node: TS.Node, sf: TS.SourceFile): string {
  const docs = ts.getJSDocCommentsAndTags(node).filter((d): d is TS.JSDoc => d.kind === ts.SyntaxKind.JSDoc);
  const last = docs[docs.length - 1];
  if (!last) return '';
  return last
    .getText(sf)
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, '').trimEnd())
    .join('\n')
    .trim();
}

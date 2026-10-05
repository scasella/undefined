/**
 * vitest + fast-check test files as the spec's tests (docs/WORKSPACE-DESIGN.md §3.3).
 *
 * A TS-AST rewrite into Test API source (the site's `test`, `property`, `eq`, `throws`, `fc`), then the normal gates.
 * Supported: `describe(name, fn)` (flattened; names prefixed "name > "), `it`/`test(name, fn)` with a synchronous body,
 * `fc.assert(fc.property(...arbs, pred), { numRuns }?)` as the whole body of an `it` (→ a property; several asserts →
 * "name #n"), `test.prop([arbs])(name, pred)` / `it.prop` from @fast-check/vitest, `it.skip`/`it.todo` (listed, not run),
 * the `expect` matchers of expectShim.ts with `.not`, top-level helper declarations, and gap markers as JSDoc tags on
 * an `it`/`test`: `/** @silentOn what the median of nothing is @reasonable Throwing is also defensible. *\/`.
 * Everything else is refused LOUDLY (an IngestIssue: exit 3, never a rejection of the code): async tests, hooks,
 * `vi.*`, snapshots, unsupported matchers, `.each`/`.only`/`.concurrent`, `fc.asyncProperty`, `fc.check`, assert
 * parameters other than numRuns (the gate owns the seed), and any `fc.assert`/`fc.check`/`fc.sample` the rewrite could
 * not turn into a property (it would run under fast-check's random seed instead of the gate's).
 *
 * The gates check one function at a time, with only that function in scope in the test code; a test that refers to
 * two exported functions of the source file is refused (the design hoped to run it for both; the Test API cannot see a
 * second function, see WORKSPACE-DESIGN.md §11).
 */
import type * as TS from 'typescript';
import { loadTs } from '../gates/compile';
import { EXPECT_SHIM, SUPPORTED_MATCHERS } from './expectShim';
import type { IngestIssue } from './source';

type TsModule = typeof TS;

export interface VitestSpec {
  /** Test API source for the Tests gate ('' when the function has no unit tests). */
  tests: string;
  /** Test API source for the Properties gate ('' when none). */
  properties: string;
  /** Test names the file skips (`it.skip`, `it.todo`): never run, counted nowhere. */
  skipped: string[];
}

export interface VitestIngest {
  /** Per exported function name. Functions no test refers to are absent. */
  byFunction: Record<string, VitestSpec>;
  issues: IngestIssue[];
  /** Tests that refer to no function of the source file (not run). */
  unattributed: string[];
}

const VITEST = new Set(['vitest', '@fast-check/vitest']);
const FAST_CHECK = 'fast-check';
const VITEST_OK = new Set(['describe', 'it', 'test', 'expect', 'fc']);
const API_NAMES = new Set(['test', 'eq', 'throws', 'property', 'matchesReference', 'fc']);

/**
 * `functions`: the exported function names of the source file; `isSourceModule(spec)` says whether an import
 * specifier refers to the source file (e.g. './stats' or './stats.ts' next to it).
 */
export async function ingestVitest(text: string, fileName: string, functions: readonly string[], isSourceModule: (specifier: string) => boolean): Promise<VitestIngest> {
  return ingestVitestWith(await loadTs(), text, fileName, functions, isSourceModule);
}

interface Case {
  kind: 'test' | 'property';
  /** Test API call text. */
  text: string;
  name: string;
  refs: Set<string>;
  line: number;
}

interface Helper {
  node: TS.Statement;
  text: string;
  /** Names it declares. */
  declares: string[];
  refs: Set<string>;
}

export function ingestVitestWith(ts: TsModule, text: string, fileName: string, functions: readonly string[], isSourceModule: (specifier: string) => boolean): VitestIngest {
  const sf = ts.createSourceFile('/test.ts', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const issues: IngestIssue[] = [];
  const lineOf = (n: TS.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const issue = (n: TS.Node | null, message: string): void => {
    issues.push({ file: fileName, ...(n ? { line: lineOf(n) } : {}), message });
  };
  const src = (n: TS.Node): string => n.getText(sf);

  // ── imports: which local names are vitest's, fast-check's, and the functions under test ──
  const local = { describe: new Set<string>(), it: new Set<string>(), expect: new Set<string>(), fc: new Set<string>() };
  const fnAlias = new Map<string, string>(); // local name → exported function
  const fcPreamble: string[] = []; // `const f = fc;`, `const { integer } = fc;`
  const fns = new Set(functions);
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    const mod = ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : '';
    const clause = s.importClause;
    if (!clause) {
      issue(s, `a side-effect import of '${mod}' is not supported`);
      continue;
    }
    const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
    const ns = clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : null;
    if (VITEST.has(mod)) {
      if (clause.name || ns) issue(s, `import vitest's functions by name (import { describe, it, expect } from '${mod}')`);
      for (const e of named) {
        const orig = (e.propertyName ?? e.name).text;
        if (clause.isTypeOnly || e.isTypeOnly) continue;
        if (!VITEST_OK.has(orig)) {
          issue(e, `${orig} from '${mod}' is not supported (only describe, it, test, expect${mod === '@fast-check/vitest' ? ', fc' : ''})`);
          continue;
        }
        const as = e.name.text;
        if (orig === 'test' || orig === 'it') local.it.add(as);
        else if (orig === 'describe') local.describe.add(as);
        else if (orig === 'expect') local.expect.add(as);
        else if (orig === 'fc') local.fc.add(as);
      }
    } else if (mod === FAST_CHECK) {
      if (clause.name) local.fc.add(clause.name.text);
      if (ns) local.fc.add(ns);
      for (const e of named) {
        if (clause.isTypeOnly || e.isTypeOnly) continue;
        fcPreamble.push(`const { ${e.propertyName ? `${e.propertyName.text}: ` : ''}${e.name.text} } = fc;`);
      }
    } else if (isSourceModule(mod)) {
      if (clause.name || ns) issue(s, `import the functions under test by name (import { f } from '${mod}')`);
      for (const e of named) {
        if (clause.isTypeOnly || e.isTypeOnly) continue;
        const orig = (e.propertyName ?? e.name).text;
        if (!fns.has(orig)) {
          issue(e, `${orig} is not an exported function the gates can certify in the source file`);
          continue;
        }
        fnAlias.set(e.name.text, orig);
      }
    } else {
      issue(s, `import from '${mod}' is not supported: test files may import vitest, fast-check, @fast-check/vitest and the source file`);
    }
  }
  // vitest globals mode: describe/it/test/expect without an import
  if (local.it.size === 0) ['it', 'test'].forEach((n) => local.it.add(n));
  if (local.describe.size === 0) local.describe.add('describe');
  if (local.expect.size === 0) local.expect.add('expect');
  if (local.fc.size === 0) local.fc.add('fc'); // the Test API's own fc is in scope either way
  for (const f of local.fc) if (f !== 'fc') fcPreamble.unshift(`const ${f} = fc;`);
  for (const [as] of fnAlias) if (API_NAMES.has(as)) issue(null, `the function name ${as} collides with the gates' Test API; rename it in the test file`);

  /** Exported functions a node refers to (through the import aliases). */
  const refsIn = (n: TS.Node): Set<string> => {
    const out = new Set<string>();
    const visit = (x: TS.Node): void => {
      if (ts.isIdentifier(x) && fnAlias.has(x.text)) {
        const p = x.parent;
        const isKey = (ts.isPropertyAccessExpression(p) && p.name === x) || (ts.isPropertyAssignment(p) && p.name === x);
        if (!isKey) out.add(fnAlias.get(x.text)!);
      }
      ts.forEachChild(x, visit);
    };
    visit(n);
    return out;
  };

  // ── static checks over the whole file ──
  const checkStatic = (root: TS.Node): void => {
    const visit = (x: TS.Node): void => {
      if (ts.isCallExpression(x)) {
        const callee = x.expression;
        if (ts.isIdentifier(callee) && local.expect.has(callee.text)) checkMatcherChain(x);
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
          const obj = callee.expression.text;
          const prop = callee.name.text;
          if (local.expect.has(obj)) issue(x, `expect.${prop}(…) is not supported (asymmetric matchers, expect.assertions, expect.extend, expect.soft)`);
          if (obj === 'vi') issue(x, `vi.${prop}(…) is not supported: the gates run without mocks, timers or spies`);
          if (local.fc.has(obj) && (prop === 'asyncProperty' || prop === 'check' || prop === 'sample' || prop === 'statistics')) {
            issue(x, `fc.${prop} is not supported: the gates own the seed and run synchronous properties`);
          }
        }
        if (ts.isIdentifier(callee) && /^(beforeEach|afterEach|beforeAll|afterAll)$/.test(callee.text)) issue(x, `${callee.text} is not supported: every check must stand on its own`);
      }
      if (ts.isAwaitExpression(x)) issue(x, 'await is not supported: the gates run synchronous checks');
      ts.forEachChild(x, visit);
    };
    visit(root);
  };
  const checkMatcherChain = (call: TS.CallExpression): void => {
    let p: TS.Node = call;
    let parent = p.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === p && parent.name.text === 'not') {
      p = parent;
      parent = p.parent;
    }
    if (!ts.isPropertyAccessExpression(parent) || parent.expression !== p) {
      issue(call, 'expect(...) must be followed by a matcher call, e.g. expect(x).toBe(y)');
      return;
    }
    const m = parent.name.text;
    if (m === 'resolves' || m === 'rejects') return issue(parent, `expect(...).${m} is not supported: the gates run synchronous checks`);
    if (!SUPPORTED_MATCHERS.includes(m)) return issue(parent, `matcher ${m} is not supported (supported: ${SUPPORTED_MATCHERS.join(', ')})`);
    if (!ts.isCallExpression(parent.parent) || parent.parent.expression !== parent) issue(parent, `matcher ${m} must be called`);
  };
  checkStatic(sf);

  // ── cases and helpers ──
  const cases: Case[] = [];
  const helpers: Helper[] = [];
  const skipped: Array<{ name: string; refs: Set<string> }> = [];

  const markers = (stmt: TS.Node): string => {
    const ranges = ts.getLeadingCommentRanges(text, stmt.pos) ?? [];
    const docs = ranges.map((r) => text.slice(r.pos, r.end)).filter((c) => c.startsWith('/**'));
    const doc = docs[docs.length - 1];
    if (!doc) return '';
    const body = doc
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\* ?/, ''))
      .join(' ');
    const tag = (t: string): string | undefined => {
      const m = new RegExp(`@${t}\\s+([^@]*)`).exec(body);
      const v = m?.[1]?.replace(/\s+/g, ' ').trim();
      return v ? v : undefined;
    };
    const silentOn = tag('silentOn');
    const reasonable = tag('reasonable');
    const parts = [...(silentOn ? [`silentOn: ${JSON.stringify(silentOn)}`] : []), ...(reasonable ? [`reasonable: ${JSON.stringify(reasonable)}`] : [])];
    return parts.join(', ');
  };
  const nameText = (n: TS.Expression | undefined): string | null => {
    if (!n) return null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    return null;
  };
  const isFn = (n: TS.Node | undefined): n is TS.ArrowFunction | TS.FunctionExpression => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  const isAsync = (f: TS.ArrowFunction | TS.FunctionExpression): boolean => (ts.getModifiers(f) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

  /** `fc.assert(fc.property(a, b, pred), params?)` → property call text, or an error. */
  const fromAssert = (call: TS.CallExpression, name: string, meta: string): string | null => {
    const [prop, params] = call.arguments;
    if (!prop || !ts.isCallExpression(prop) || !ts.isPropertyAccessExpression(prop.expression) || !ts.isIdentifier(prop.expression.expression) || !local.fc.has(prop.expression.expression.text)) {
      issue(call, 'fc.assert(...) must wrap fc.property(...) directly');
      return null;
    }
    if (prop.expression.name.text !== 'property') {
      issue(call, `fc.assert(fc.${prop.expression.name.text}(...)) is not supported: only fc.property`);
      return null;
    }
    const args = prop.arguments;
    if (args.length < 2) {
      issue(call, 'fc.property needs at least one arbitrary and a predicate');
      return null;
    }
    const pred = args[args.length - 1]!;
    const arbs = args.slice(0, -1).map(src);
    const opts: string[] = [];
    if (params) {
      if (!ts.isObjectLiteralExpression(params)) {
        issue(params, 'fc.assert parameters must be an object literal with numRuns only');
        return null;
      }
      for (const p of params.properties) {
        const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '?';
        if (key !== 'numRuns' || !ts.isPropertyAssignment(p)) {
          issue(p, `fc.assert parameter ${key} is not supported: the gate owns the seed and the run (numRuns only)`);
          return null;
        }
        opts.push(`numRuns: ${src(p.initializer)}`);
      }
    }
    if (meta) opts.push(meta);
    return `property(${JSON.stringify(name)}, [${arbs.join(', ')}], ${src(pred)}${opts.length > 0 ? `, { ${opts.join(', ')} }` : ''});`;
  };

  const visitBlock = (stmts: readonly TS.Statement[], prefix: string, top: boolean): void => {
    for (const s of stmts) {
      if (ts.isImportDeclaration(s)) continue;
      if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)) {
        if (handleCall(s, s.expression, prefix)) continue;
      }
      if (!top) {
        issue(s, 'only describe/it/test calls are supported inside describe; move helpers to the top level of the file');
        continue;
      }
      if (ts.isVariableStatement(s) || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) {
        if (ts.isFunctionDeclaration(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) issue(s, 'async helpers are not supported');
        const declares = ts.isVariableStatement(s)
          ? s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
          : s.name
            ? [s.name.text]
            : [];
        helpers.push({ node: s, text: src(s).replace(/^export\s+/, ''), declares, refs: refsIn(s) });
        continue;
      }
      issue(s, 'this statement is not supported in a test file the gates read (only imports, helper declarations and describe/it/test)');
    }
  };

  /** True when `call` was a describe/it/test form (handled or refused with an issue). */
  const handleCall = (stmt: TS.Statement, call: TS.CallExpression, prefix: string): boolean => {
    const callee = call.expression;
    // test.prop([arbs], params?)(name, pred)
    if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && ts.isIdentifier(callee.expression.expression) && local.it.has(callee.expression.expression.text) && callee.expression.name.text === 'prop') {
      const [arbs, params] = callee.arguments;
      const name = nameText(call.arguments[0]);
      const pred = call.arguments[1];
      if (!arbs || !ts.isArrayLiteralExpression(arbs) || name === null || !pred) {
        issue(call, `${callee.expression.expression.text}.prop([arbitraries])(name, predicate) needs an array literal of arbitraries, a string name and a predicate`);
        return true;
      }
      if (params) {
        issue(params, `${callee.expression.expression.text}.prop parameters are not supported: the gate owns the seed and the run`);
        return true;
      }
      if (isFn(pred) && isAsync(pred)) {
        issue(pred, 'async predicates are not supported');
        return true;
      }
      const meta = markers(stmt);
      const full = prefix + name;
      cases.push({ kind: 'property', name: full, text: `property(${JSON.stringify(full)}, ${src(arbs)}, ${src(pred)}${meta ? `, { ${meta} }` : ''});`, refs: refsIn(call), line: lineOf(call) });
      return true;
    }
    let base: string | null = null;
    let modifier: string | null = null;
    if (ts.isIdentifier(callee)) base = callee.text;
    else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      base = callee.expression.text;
      modifier = callee.name.text;
    } else if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && ts.isIdentifier(callee.expression.expression)) {
      // describe.each([...])(…), it.each`…`(…)
      const b = callee.expression.expression.text;
      if (local.it.has(b) || local.describe.has(b)) {
        issue(call, `${b}.${callee.expression.name.text}(…)(…) is not supported`);
        return true;
      }
      return false;
    } else if (ts.isTaggedTemplateExpression(callee)) {
      issue(call, 'tagged-template test tables (it.each`…`) are not supported');
      return true;
    }
    if (base === null) return false;
    const isDescribe = local.describe.has(base);
    const isIt = local.it.has(base);
    if (!isDescribe && !isIt) return false;
    if (modifier === 'skip' || modifier === 'todo') {
      const name = nameText(call.arguments[0]) ?? '(unnamed)';
      skipped.push({ name: prefix + name, refs: refsIn(call) });
      return true;
    }
    if (modifier !== null) {
      issue(call, `${base}.${modifier} is not supported (each, only, concurrent, fails, runIf, skipIf…)`);
      return true;
    }
    const name = nameText(call.arguments[0]);
    const fn = call.arguments[1];
    if (name === null) {
      issue(call, `${base}(name, fn) needs a string literal name`);
      return true;
    }
    if (call.arguments.length > 2) {
      issue(call.arguments[2]!, `${base}(name, fn, options) options and timeouts are not supported`);
      return true;
    }
    if (!isFn(fn)) {
      issue(call, `${base}(${JSON.stringify(name)}, …) needs an inline function`);
      return true;
    }
    if (isAsync(fn)) {
      issue(fn, `${base}(${JSON.stringify(name)}) is async: the gates run synchronous checks`);
      return true;
    }
    if (isDescribe) {
      if (!ts.isBlock(fn.body)) {
        issue(fn, 'describe needs a block body');
        return true;
      }
      visitBlock(fn.body.statements, `${prefix}${name} > `, false);
      return true;
    }
    if (fn.parameters.length > 0) {
      issue(fn, `${base}(${JSON.stringify(name)}) takes a test context parameter; the gates do not provide one`);
      return true;
    }
    const full = prefix + name;
    const meta = markers(stmt);
    // fc.assert as the whole body → properties; anywhere else in the body → refused
    const body = fn.body;
    const asserts = ts.isBlock(body) ? body.statements.map(assertCallOf) : [assertCallOf(body)];
    const assertCount = asserts.filter((a) => a !== null).length;
    if (assertCount > 0) {
      if (assertCount !== asserts.length) {
        issue(fn, `${base}(${JSON.stringify(full)}) mixes fc.assert with other statements; put each fc.assert in its own ${base}`);
        return true;
      }
      asserts.forEach((a, k) => {
        const n = assertCount === 1 ? full : `${full} #${k + 1}`;
        const t = fromAssert(a!, n, meta);
        if (t) cases.push({ kind: 'property', name: n, text: t, refs: refsIn(a!), line: lineOf(a!) });
      });
      return true;
    }
    if (containsFcAssert(fn)) {
      issue(fn, `${base}(${JSON.stringify(full)}) calls fc.assert inside other code; it would run under fast-check's own seed`);
      return true;
    }
    cases.push({ kind: 'test', name: full, text: `test(${JSON.stringify(full)}, ${src(fn)}${meta ? `, { ${meta} }` : ''});`, refs: refsIn(fn), line: lineOf(call) });
    return true;
  };
  const assertCallOf = (n: TS.Node): TS.CallExpression | null => {
    let e: TS.Node = n;
    if (ts.isExpressionStatement(e)) e = e.expression;
    else if (ts.isReturnStatement(e) && e.expression) e = e.expression;
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) && local.fc.has(e.expression.expression.text) && e.expression.name.text === 'assert') return e;
    return null;
  };
  const containsFcAssert = (n: TS.Node): boolean => {
    let hit = false;
    const visit = (x: TS.Node): void => {
      if (hit) return;
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && ts.isIdentifier(x.expression.expression) && local.fc.has(x.expression.expression.text) && x.expression.name.text === 'assert') hit = true;
      else ts.forEachChild(x, visit);
    };
    visit(n);
    return hit;
  };

  visitBlock(sf.statements, '', true);
  for (const h of helpers) if (containsFcAssert(h.node)) issue(h.node, `a helper calls fc.assert; it would run under fast-check's own seed`);

  // ── attribution: each case to the one function it refers to (directly or through helpers it uses) ──
  const helperRefs = (n: Case): Set<string> => {
    const out = new Set(n.refs);
    const used = new Set<Helper>();
    const queue: string[] = [n.text];
    while (queue.length > 0) {
      const t = queue.pop()!;
      for (const h of helpers) {
        if (used.has(h)) continue;
        if (h.declares.some((d) => new RegExp(`\\b${d.replace(/\$/g, '\\$')}\\b`).test(t))) {
          used.add(h);
          h.refs.forEach((r) => out.add(r));
          queue.push(h.text);
        }
      }
    }
    return out;
  };
  const byFunction: Record<string, VitestSpec> = {};
  const unattributed: string[] = [];
  const perFn = new Map<string, Case[]>();
  for (const c of cases) {
    const refs = helperRefs(c);
    if (refs.size === 0) {
      unattributed.push(c.name);
      continue;
    }
    if (refs.size > 1) {
      issues.push({ file: fileName, line: c.line, message: `"${c.name}" refers to ${[...refs].sort().join(' and ')}; the gates check one function at a time (split the test)` });
      continue;
    }
    const f = [...refs][0]!;
    perFn.set(f, [...(perFn.get(f) ?? []), c]);
  }
  const header = (f: string): string => {
    // helpers that refer to another function under test would not load for this one
    const mine = helpers.filter((h) => [...h.refs].every((r) => r === f));
    const aliases = [...fnAlias].filter(([as, orig]) => orig === f && as !== orig).map(([as, orig]) => `const ${as} = ${orig};`);
    return [EXPECT_SHIM, ...fcPreamble, ...aliases, ...mine.map((h) => h.text)].join('\n');
  };
  for (const f of functions) {
    const list = perFn.get(f) ?? [];
    const skips = skipped.filter((s) => s.refs.has(f) || s.refs.size === 0).map((s) => s.name);
    if (list.length === 0 && skips.length === 0) continue;
    const tests = list.filter((c) => c.kind === 'test');
    const props = list.filter((c) => c.kind === 'property');
    const head = header(f);
    byFunction[f] = {
      tests: tests.length > 0 ? `${head}\n\n${tests.map((c) => c.text).join('\n\n')}\n` : '',
      properties: props.length > 0 ? `${head}\n\n${props.map((c) => c.text).join('\n\n')}\n` : '',
      skipped: skips,
    };
  }
  return { byFunction, issues, unattributed };
}

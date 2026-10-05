/**
 * Splitting a REPL line into statement units (docs/COMPOSE-DESIGN.md §B2). Pure: no evaluation, no `new Function`
 * (this runs on the main thread, under the page's CSP).
 *
 * - `needsSplit(line)`: a cheap scan. False means the line goes to the runtime whole, exactly as before Phase 3 (one
 *   expression or one `x = …` / `const x = …` binding): the opener never waits for the parser.
 * - `splitStatements(ts, line)`: parse with the TypeScript parser (parse only, as JavaScript) and turn each top-level
 *   statement into units: an expression statement is an `expr` unit; a declaration is one `expr` unit per declarator,
 *   rewritten as an assignment (`x = (init)`, `({a, b} = (init))`; `let x;` is `x = void 0`), so it binds a REPL
 *   variable exactly as `x = …` does (`const` is not enforced); `if`/`for`/`while`/`do`/blocks/`try`/`switch`/`throw`/
 *   labels are `stmt` units, run for their effect. Function and class declarations, import/export, `return` outside a function,
 *   `await` and type annotations are refused with a plain message.
 */
import type * as TS from 'typescript';

export interface ReplUnit {
  kind: 'expr' | 'stmt';
  text: string;
}

export type SplitResult = { ok: true; units: ReplUnit[] } | { ok: false; message: string };

/** The message the runtime gives a line that parses only as statements (the engine then splits it). */
export const STATEMENTS_MESSAGE = 'a REPL line must be one expression or one binding (x = …); this parses only as statements';

const DECL_START = /^(?:const|let|var)(?![\w$])/;
const SINGLE_DECL = /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=(?![=>])\s*([\s\S]+)$/;
const STATEMENT_START = /^(?:if|for|while|do|try|switch|function|class|import|export|return|throw|break|continue)(?![\w$])/;

/**
 * Top-level positions of `;` and `,` in `src` (outside strings, template literals, comments and brackets). A simple
 * scan: a regex literal or a template's `${…}` can fool it, which only costs a parse (or, for a missed `;`, the
 * runtime's "parses only as statements" SyntaxError, which the engine also sends to the parser).
 */
export function topLevel(src: string): { semis: number[]; commas: number[] } {
  const semis: number[] = [];
  const commas: number[] = [];
  let depth = 0;
  for (let k = 0; k < src.length; k++) {
    const c = src[k]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = k + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      k = j;
    } else if (c === '/' && src[k + 1] === '/') {
      const nl = src.indexOf('\n', k);
      if (nl < 0) break;
      k = nl;
    } else if (c === '/' && src[k + 1] === '*') {
      const end = src.indexOf('*/', k + 2);
      if (end < 0) break;
      k = end + 1;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && c === ';') {
      semis.push(k);
    } else if (depth === 0 && c === ',') {
      commas.push(k);
    }
  }
  return { semis, commas };
}

/** The line as the runtime has always seen it: trimmed, trailing `;` removed. */
function stripped(line: string): string {
  return line.trim().replace(/;+\s*$/, '');
}

/** True when the line must go through the parser (see the header); false keeps the pre-Phase-3 path. */
export function needsSplit(line: string): boolean {
  const src = stripped(line);
  if (src === '') return false;
  const { semis, commas } = topLevel(src);
  if (semis.length > 0) return true;
  if (DECL_START.test(src)) {
    // exactly one identifier declarator with an initializer and no top-level comma: the old binding path
    const m = SINGLE_DECL.exec(src);
    return !m || commas.length > 0;
  }
  return STATEMENT_START.test(src);
}

/**
 * The innermost bracket or quote left open at the end of `src` (simple scan: strings, templates, comments), as the
 * REPL's "unexpected end of input" text says it; null when everything is closed (or a stray closer is found).
 */
export function unclosed(src: string): string | null {
  const stack: string[] = [];
  const close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let k = 0; k < src.length; k++) {
    const c = src[k]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = k + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return `the string starting with ${c} is not closed`;
      k = j;
    } else if (c === '/' && src[k + 1] === '/') {
      const nl = src.indexOf('\n', k);
      if (nl < 0) break;
      k = nl;
    } else if (c === '/' && src[k + 1] === '*') {
      const end = src.indexOf('*/', k + 2);
      if (end < 0) return 'a /* comment is not closed';
      k = end + 1;
    } else if (c in close) {
      stack.push(c);
    } else if (c === ')' || c === ']' || c === '}') {
      if (!stack.length || close[stack[stack.length - 1]!] !== c) return null; // a stray closer: the parser says it best
      stack.pop();
    }
  }
  const top = stack[stack.length - 1];
  return top ? `a \`${top}\` is never closed (missing \`${close[top]}\`)` : null;
}

export const REFUSE = {
  function: 'function declarations are not supported here: functions are grown by calling them (write the call, e.g. double(21))',
  class: 'class declarations are not supported in the REPL',
  module: 'import and export are not supported in the REPL',
  return: 'return is only allowed inside a function',
  await: 'await is not supported in the REPL: lines run synchronously',
  types: 'type annotations are not supported in the REPL (it runs JavaScript)',
  pattern: 'a destructuring declaration needs a value (= …)',
} as const;

/** Split `line` into units with the TypeScript parser `ts` (parse only). */
export function splitStatements(ts: typeof TS, line: string): SplitResult {
  const src = line.trim();
  const sf = ts.createSourceFile('repl.js', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const diags = (sf as unknown as { parseDiagnostics?: TS.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  if (diags.length > 0) {
    const open = unclosed(src);
    if (open) return { ok: false, message: `unexpected end of input: ${open}` };
    const d = diags[0]!;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n').replace(/\.$/, '');
    return { ok: false, message: `${msg.replace(/^./, (c) => c.toLowerCase())} (column ${d.start + 1})` };
  }
  const units: ReplUnit[] = [];
  for (const st of sf.statements) {
    if (ts.isEmptyStatement(st)) continue;
    if (ts.isFunctionDeclaration(st)) return { ok: false, message: REFUSE.function };
    if (ts.isClassDeclaration(st)) return { ok: false, message: REFUSE.class };
    if (
      ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isExportDeclaration(st) || ts.isExportAssignment(st) ||
      (ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    ) {
      return { ok: false, message: REFUSE.module };
    }
    if (outsideFunctions(ts, st, ts.isReturnStatement)) return { ok: false, message: REFUSE.return };
    if (outsideFunctions(ts, st, (n) => ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && !!n.awaitModifier))) return { ok: false, message: REFUSE.await };
    if (ts.isExpressionStatement(st)) {
      units.push({ kind: 'expr', text: st.expression.getText(sf) });
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (d.type || d.exclamationToken) return { ok: false, message: REFUSE.types };
        const init = d.initializer ? d.initializer.getText(sf) : null;
        if (ts.isIdentifier(d.name)) {
          units.push({ kind: 'expr', text: init === null ? `${d.name.text} = void 0` : `${d.name.text} = (${init}\n)` });
        } else {
          if (init === null) return { ok: false, message: REFUSE.pattern };
          units.push({ kind: 'expr', text: `(${d.name.getText(sf)} = (${init}\n))` });
        }
      }
      continue;
    }
    units.push({ kind: 'stmt', text: st.getText(sf) });
  }
  return { ok: true, units };
}

/**
 * Whether `node` holds, outside any function or class, a node `match` accepts: a `return` (the parser accepts
 * `if (c) return 1` at the top level; run as a statement unit it would silently end that statement) or an `await`.
 */
function outsideFunctions(ts: typeof TS, node: TS.Node, match: (n: TS.Node) => boolean): boolean {
  let found = false;
  const visit = (n: TS.Node): void => {
    if (found) return;
    if (match(n)) {
      found = true;
      return;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Line ranges of a source file's exported functions and of its type declarations, from the TypeScript AST (the same
 * parser the engine's ingestion uses, ingest/source.ts). A function's range runs from its JSDoc (or `export`) to its
 * closing brace, so a change to the doc comment touches the function too.
 */
import type * as TS from 'typescript';
import { loadTs } from '@scasella/undefined-engine/gates/compile';

export interface Range {
  name: string;
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

export interface FileRanges {
  /** Exported functions the engine may certify (overloads included, so the engine can say why it refuses them). */
  functions: Range[];
  /** Top-level `type` and `interface` declarations. */
  types: Range[];
}

export async function fileRanges(text: string): Promise<FileRanges> {
  const ts = await loadTs();
  return rangesWith(ts, text);
}

export function rangesWith(ts: typeof TS, text: string): FileRanges {
  const sf = ts.createSourceFile('/source.ts', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const range = (name: string, n: TS.Node): Range => ({ name, from: lineOf(n.getStart(sf, true)), to: lineOf(n.getEnd()) });
  const exported = (s: TS.Statement): boolean => (ts.canHaveModifiers(s) ? (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) : false);
  const functions: Range[] = [];
  const types: Range[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && exported(s)) {
      const prev = functions.find((f) => f.name === s.name!.text);
      // overload signatures and the implementation are one function
      if (prev) prev.to = Math.max(prev.to, lineOf(s.getEnd()));
      else functions.push(range(s.name.text, s));
    } else if (ts.isVariableStatement(s) && exported(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        let init: TS.Expression = d.initializer;
        while (ts.isParenthesizedExpression(init)) init = init.expression;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          // one declarator of several: its own text, but the JSDoc sits on the statement
          const r = s.declarationList.declarations.length === 1 ? range(d.name.text, s) : range(d.name.text, d);
          functions.push(r);
        }
      }
    } else if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) {
      types.push(range(s.name.text, s));
    }
  }
  return { functions, types };
}

/** Whether the type declarations text (an extracted function's `typeDecls`) declares `name`. */
export function declaresType(typeDecls: string, name: string): boolean {
  const esc = name.replace(/[$]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w$])(?:type|interface)\\s+${esc}(?![\\w$])`).test(typeDecls);
}

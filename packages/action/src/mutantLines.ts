/**
 * Surviving mutants with file:line. `MutantInfo.line` is a line of the COMPILED JavaScript body (mutation/mutate.ts:
 * 1-based from the line after the function's opening `{`), not of the TypeScript. Mapped back with a side-channel
 * source map (docs/WORKSPACE-DESIGN.md §4.2): `ts.transpileModule(compile.source, { sourceMap: true })` with the
 * compile gate's emit options, trusted only when its output equals `CompileOutput.js` byte for byte (minus the map
 * comment). On any mismatch, or for an expression-bodied arrow (whose body is synthesized, not file text), the line is
 * null and the comment says "compiled line N". Nothing here touches what the gates compiled, hashed or mutated.
 */
import type * as TS from 'typescript';
import type { FunctionSpec } from '@scasella/undefined-engine';
import type { CompileOutput } from '@scasella/undefined-engine/gates/compile';
import { loadTs } from '@scasella/undefined-engine/gates/compile';
import { buildSource } from '@scasella/undefined-engine/gates/source';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a source map's `mappings`: per generated line, the original (0-based) line of each segment that has one. */
export function decodeMappings(mappings: string): number[][] {
  const lines: number[][] = [];
  let origLine = 0;
  for (const lineText of mappings.split(';')) {
    const segs: number[] = [];
    for (const seg of lineText.split(',')) {
      if (seg === '') continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        if (d < 0) throw new Error(`bad source map character ${ch}`);
        value += (d & 31) << shift;
        if (d & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      if (fields.length >= 4) {
        origLine += fields[2]!;
        segs.push(origLine);
      }
    }
    lines.push(segs);
  }
  return lines;
}

export interface LineMapper {
  /** File line (1-based) of a compiled-body line, or null when it cannot be mapped exactly. */
  (compiledLine: number): number | null;
}

/**
 * A mapper for one certified function. `bodyLine` is the file line of the body's first line (FunctionResult.bodyLine);
 * `expressionBody` true for `const f = (…) => expr` (mapped to `declLine`, the declaration).
 */
export async function lineMapper(a: { spec: FunctionSpec; body: string; compile: CompileOutput; bodyLine: number; declLine: number; expressionBody: boolean }): Promise<LineMapper> {
  const none: LineMapper = () => null;
  if (a.compile.js === null) return none;
  if (a.expressionBody) return () => a.declLine;
  const ts = await loadTs();
  return mapperWith(ts, a);
}

export function mapperWith(ts: typeof TS, a: { spec: FunctionSpec; body: string; compile: CompileOutput; bodyLine: number }): LineMapper {
  const none: LineMapper = () => null;
  const js = a.compile.js;
  if (js === null) return none;
  const { source, bodyStartLine } = buildSource(a.spec, a.body);
  if (source !== a.compile.source) return none;
  const out = ts.transpileModule(source, {
    fileName: 'candidate.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      alwaysStrict: true,
      strict: true,
      sourceMap: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  if (out.outputText.replace(/\/\/# sourceMappingURL=\S*\s*$/, '') !== js || !out.sourceMapText) return none;
  let mappings: number[][];
  try {
    mappings = decodeMappings((JSON.parse(out.sourceMapText) as { mappings: string }).mappings);
  } catch {
    return none;
  }
  // the line holding the function's opening `{` in the emitted JS (mutate.ts counts body lines from the next one)
  const sf = ts.createSourceFile('/candidate.js', js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const fn = sf.statements.find((s): s is TS.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === a.spec.name);
  if (!fn?.body) return none;
  const braceLine = sf.getLineAndCharacterOfPosition(fn.body.getStart(sf)).line; // 0-based
  const bodyLines = a.body.replace(/\r\n?/g, '\n').split('\n').length;
  return (compiledLine) => {
    const segs = mappings[braceLine + compiledLine];
    if (!segs || segs.length === 0) return null;
    const sourceLine = segs[0]! + 1; // 1-based line of candidate.ts
    const rel = sourceLine - bodyStartLine; // 0-based line within the body
    if (rel < 0 || rel >= bodyLines) return null;
    return a.bodyLine + rel;
  };
}

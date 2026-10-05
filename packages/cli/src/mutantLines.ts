/**
 * Where a mutant is in the user's file (docs/WORKSPACE-DESIGN.md §4.2).
 *
 * `MutantInfo.line` is a line of the COMPILED JavaScript body (engine mutation/mutate.ts), not of the TypeScript. This
 * maps it back with a side-channel source map: the gate's compile source (`buildSource(spec, body)`) is transpiled once
 * more with `sourceMap: true` and the same emit options, and the emitted text is compared with the gate's own
 * `CompileOutput.js`. Only when they are identical is the map used; otherwise (and for expression-bodied arrows, whose
 * body is synthesised) only the compiled line is reported. The gate's JavaScript, the mutants and the hashes are never
 * touched.
 */
import type * as TS from 'typescript';
import type { FunctionSpec, MutantInfo } from '@scasella/undefined-engine/types';
import { buildSource } from '@scasella/undefined-engine/gates/source';
import { loadTs } from '@scasella/undefined-engine/gates/compile';

export interface MutantLine {
  id: string;
  /** Line in the compiled body (what the site shows). */
  compiledLine: number;
  /** Line in the function body as written (1-based), or null when it could not be mapped. */
  bodyLine: number | null;
  /** Line in the source file (1-based), or null. */
  fileLine: number | null;
  original: string;
  mutated: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Source-map v3 `mappings` → per generated line, the original (0-based) lines of its segments, in order. */
export function decodeMappings(mappings: string): number[][] {
  const lines: number[][] = [];
  let srcLine = 0;
  for (const lineText of mappings.split(';')) {
    const out: number[] = [];
    for (const seg of lineText.split(',')) {
      if (seg === '') continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        if (digit < 0) throw new Error(`bad source map character ${ch}`);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      if (fields.length >= 4) {
        srcLine += fields[2]!;
        out.push(srcLine);
      }
    }
    lines.push(out);
  }
  return lines;
}

function emitOptions(ts: typeof TS): TS.CompilerOptions {
  // the compile gate's emit-relevant options (engine gates/compile.ts loadToolchain), plus the map
  return {
    strict: true,
    alwaysStrict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    newLine: ts.NewLineKind.LineFeed,
    sourceMap: true,
    inlineSources: false,
  };
}

/** 0-based line of the function body's opening brace in the compiled JS (as mutation/mutate.ts counts). */
function braceLineOf(ts: typeof TS, js: string, name: string): number | null {
  const sf = ts.createSourceFile('/candidate.js', js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return sf.getLineAndCharacterOfPosition(st.body.getStart(sf)).line;
  }
  return null;
}

/**
 * Map each mutant's compiled line to the body and file lines. `bodyFileLine` is the 1-based file line of the body's
 * first line (FunctionResult.bodyLine); `synthesised` is true for expression-bodied arrows.
 */
export async function mapMutantLines(a: {
  spec: FunctionSpec;
  body: string;
  js: string | null;
  mutants: readonly MutantInfo[];
  bodyFileLine: number;
  synthesised: boolean;
}): Promise<MutantLine[]> {
  const plain = (m: MutantInfo): MutantLine => ({ id: m.id, compiledLine: m.line, bodyLine: null, fileLine: null, original: m.original, mutated: m.mutated });
  if (a.mutants.length === 0) return [];
  if (a.js === null || a.synthesised) return a.mutants.map(plain);
  try {
    const ts = await loadTs();
    const { source, bodyStartLine } = buildSource(a.spec, a.body);
    const out = ts.transpileModule(source, { compilerOptions: emitOptions(ts), fileName: 'candidate.ts', reportDiagnostics: false });
    const emitted = out.outputText.replace(/\/\/# sourceMappingURL=[^\n]*\n?$/, '');
    if (emitted !== a.js || !out.sourceMapText) return a.mutants.map(plain);
    const lines = decodeMappings((JSON.parse(out.sourceMapText) as { mappings: string }).mappings);
    const brace = braceLineOf(ts, a.js, a.spec.name);
    if (brace === null) return a.mutants.map(plain);
    const bodyLines = a.body.replace(/\r\n?/g, '\n').split('\n').length;
    return a.mutants.map((m) => {
      const src = lines[brace + m.line]?.[0];
      if (src === undefined) return plain(m);
      const rel = src + 1 - (bodyStartLine - 1);
      if (rel < 1 || rel > bodyLines) return plain(m);
      return { ...plain(m), bodyLine: rel, fileLine: a.bodyFileLine + rel - 1 };
    });
  } catch {
    return a.mutants.map(plain);
  }
}

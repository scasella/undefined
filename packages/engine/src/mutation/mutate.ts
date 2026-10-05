/**
 * Mutant generation for a committed artifact: "did the gate actually check anything?".
 *
 * Input is the compiled strict-mode JS of one artifact exactly as src/gates/compile.ts emits it
 * (`"use strict";\nfunction name(…) {\n    …\n}\n`). Every mutation SITE is found by walking the TypeScript AST of
 * that JS and is applied as a text splice on the exact span of the node (or operator token), so nothing else in the
 * text moves. `typescript` is loaded lazily with a dynamic import(), never at module top level (browser bundle).
 *
 * Selection: all distinct candidate mutants are enumerated (deduplicated by resulting text), shuffled per kind with a
 * seeded PRNG, and drawn round-robin across kinds (kind order also seeded) until `max` runnable mutants are chosen.
 * Each drawn candidate is checked with ts.transpileModule(reportDiagnostics); one that does not parse is counted in
 * `stillborn` and replaced by the next candidate of the same kind. So `stillborn` counts candidates that were DRAWN
 * and did not parse; it is never part of the returned mutants and never a kill.
 *
 * Line numbers: 1-based, relative to the first line after the line holding the function's opening `{`, i.e. lines of
 * the COMPILED body. The TypeScript emitter reflows code (drops blank lines, splits `if (c) return x;` over two lines),
 * so for reflowed bodies these can differ from the lines of the TypeScript the model wrote; only JS is given here.
 */
import type * as TS from 'typescript';

type TsModule = typeof TS;

export type MutationKind =
  | 'arithmetic' // + ↔ -, * ↔ /, % → *, and the compound forms += ↔ -=, *= ↔ /=, %= → *=
  | 'comparison' // < → <=, <= → <, > → >=, >= → >
  | 'equality' // === ↔ !==, == ↔ !=
  | 'logical' // && ↔ ||
  | 'boundary' // integer literal n → n + 1 and n → n - 1 (number and bigint)
  | 'constant' // 0 ↔ 1 (number and bigint)
  | 'boolean' // true ↔ false
  | 'negate-condition' // if/while/do/for/ternary condition c → !(c)
  | 'return-undefined' // return expr; → return undefined;
  | 'remove-not'; // !x → x

/** Fixed enumeration order of kinds (the seeded shuffle permutes it per seed). */
export const MUTATION_KINDS: readonly MutationKind[] = [
  'arithmetic',
  'comparison',
  'equality',
  'logical',
  'boundary',
  'constant',
  'boolean',
  'negate-condition',
  'return-undefined',
  'remove-not',
];

export interface Mutant {
  /** Stable for a given input: kind, compiled-body line:col of the span, and a variant for ±1. */
  id: string;
  kind: MutationKind;
  /** 1-based line in the compiled function body (see header). */
  line: number;
  /** Exact replaced snippet of the input JS. */
  original: string;
  /** Exact text spliced in its place. */
  mutated: string;
  /** The whole mutated JS (same shape as the input). */
  js: string;
}

export interface GeneratedMutants {
  mutants: Mutant[];
  /** Drawn candidates that did not parse (never returned, never killed). */
  stillborn: number;
  /** Distinct candidate mutants found (after removing duplicates and no-ops). */
  sites: number;
}

let tsModule: TsModule | null = null;
let tsLoading: Promise<TsModule> | null = null;

/** Lazy, cached `typescript` (CommonJS: the namespace lives on `default` under most interop layers). */
export function loadTs(): Promise<TsModule> {
  if (tsModule) return Promise.resolve(tsModule);
  tsLoading ??= import('typescript').then((mod) => {
    tsModule = ((mod as { default?: TsModule }).default ?? mod) as TsModule;
    return tsModule;
  });
  tsLoading.catch(() => {
    tsLoading = null;
  });
  return tsLoading;
}

interface Candidate {
  id: string;
  kind: MutationKind;
  line: number;
  start: number;
  end: number;
  original: string;
  mutated: string;
}

const ARITHMETIC: Partial<Record<string, string>> = {
  '+': '-', '-': '+', '*': '/', '/': '*', '%': '*',
  '+=': '-=', '-=': '+=', '*=': '/=', '/=': '*=', '%=': '*=',
};
const COMPARISON: Partial<Record<string, string>> = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' };
const EQUALITY: Partial<Record<string, string>> = { '===': '!==', '!==': '===', '==': '!=', '!=': '==' };
const LOGICAL: Partial<Record<string, string>> = { '&&': '||', '||': '&&' };

/** Enumerates every candidate mutation in the first function declaration of `js` (document order). */
export function enumerateCandidates(ts: TsModule, js: string): Candidate[] {
  const sf = ts.createSourceFile('artifact.js', js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const fn = sf.statements.find(ts.isFunctionDeclaration);
  if (!fn || !fn.body) return [];
  const braceLine = sf.getLineAndCharacterOfPosition(fn.body.getStart(sf)).line;
  const out: Candidate[] = [];

  const add = (kind: MutationKind, start: number, end: number, mutated: string, variant = ''): void => {
    const original = js.slice(start, end);
    if (original === mutated) return;
    const lc = sf.getLineAndCharacterOfPosition(start);
    const line = Math.max(1, lc.line - braceLine);
    out.push({ id: `${kind}@${line}:${lc.character + 1}${variant}`, kind, line, start, end, original, mutated });
  };
  const addNode = (kind: MutationKind, node: TS.Node, mutated: string, variant = ''): void =>
    add(kind, node.getStart(sf), node.end, mutated, variant);

  const isIntegerLiteral = (text: string): boolean => /^(0|[1-9][0-9]*)n?$/.test(text);

  const negate = (cond: TS.Expression | undefined): void => {
    if (!cond) return;
    // `!x` as a condition is already covered by remove-not; `!(!x)` would be an equivalent duplicate.
    if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) return;
    addNode('negate-condition', cond, `!(${cond.getText(sf)})`);
  };

  const visit = (node: TS.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken;
      const text = op.getText(sf);
      const swap = (kind: MutationKind, table: Partial<Record<string, string>>): void => {
        const to = table[text];
        if (to !== undefined) add(kind, op.getStart(sf), op.end, to);
      };
      swap('arithmetic', ARITHMETIC);
      swap('comparison', COMPARISON);
      swap('equality', EQUALITY);
      swap('logical', LOGICAL);
    } else if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
      const text = node.getText(sf);
      // `void 0` is the emitter's spelling of undefined, not a number the program computes with.
      if (isIntegerLiteral(text) && !ts.isVoidExpression(node.parent)) {
        const big = text.endsWith('n');
        const n = BigInt(big ? text.slice(0, -1) : text);
        const lit = (v: bigint): string => `${v}${big ? 'n' : ''}`;
        // Constant flips first, so a ±1 that produces the same text is the duplicate that gets dropped.
        if (n === 0n) addNode('constant', node, lit(1n));
        if (n === 1n) addNode('constant', node, lit(0n));
        addNode('boundary', node, lit(n + 1n), '+1');
        addNode('boundary', node, lit(n - 1n), '-1');
      }
    } else if (node.kind === ts.SyntaxKind.TrueKeyword) {
      addNode('boolean', node, 'false');
    } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
      addNode('boolean', node, 'true');
    } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      addNode('remove-not', node, node.operand.getText(sf));
    } else if (ts.isReturnStatement(node) && node.expression) {
      const e = node.expression;
      const alreadyUndefined =
        (ts.isIdentifier(e) && e.text === 'undefined') ||
        (ts.isVoidExpression(e) && ts.isNumericLiteral(e.expression));
      if (!alreadyUndefined) {
        const semi = node.getText(sf).trimEnd().endsWith(';') ? ';' : '';
        addNode('return-undefined', node, `return undefined${semi}`);
      }
    }
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) negate(node.expression);
    else if (ts.isForStatement(node)) negate(node.condition);
    else if (ts.isConditionalExpression(node)) negate(node.condition);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);

  // Drop duplicates by resulting text (first in document/kind order wins) and no-ops.
  const seen = new Set<string>([js]);
  return out.filter((c) => {
    const text = splice(js, c);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function splice(js: string, c: { start: number; end: number; mutated: string }): string {
  return js.slice(0, c.start) + c.mutated + js.slice(c.end);
}

/** True when the JS parses (syntactic diagnostics only; no type checking). */
export function parses(ts: TsModule, js: string): boolean {
  const out = ts.transpileModule(js, {
    reportDiagnostics: true,
    fileName: 'mutant.js',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, allowJs: true },
  });
  return !(out.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error);
}

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export async function generateMutants(js: string, opts: { seed: number; max: number }): Promise<GeneratedMutants> {
  const ts = await loadTs();
  const candidates = enumerateCandidates(ts, js);
  const rand = prng(opts.seed);
  const queues = new Map<MutationKind, Candidate[]>();
  for (const kind of shuffle([...MUTATION_KINDS], rand)) {
    const ofKind = candidates.filter((c) => c.kind === kind);
    if (ofKind.length > 0) queues.set(kind, shuffle(ofKind, rand));
  }

  const max = Math.max(0, Math.floor(opts.max));
  const mutants: Mutant[] = [];
  let stillborn = 0;
  while (mutants.length < max && queues.size > 0) {
    for (const [kind, queue] of [...queues]) {
      if (mutants.length >= max) break;
      // Draw from this kind until one parses (or the kind runs out).
      while (queue.length > 0) {
        const c = queue.shift()!;
        const text = splice(js, c);
        if (!parses(ts, text)) {
          stillborn++;
          continue;
        }
        mutants.push({ id: c.id, kind: c.kind, line: c.line, original: c.original, mutated: c.mutated, js: text });
        break;
      }
      if (queue.length === 0) queues.delete(kind);
    }
  }
  return { mutants, stillborn, sites: candidates.length };
}

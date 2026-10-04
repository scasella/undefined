import type { Diagnostic, FunctionSpec, GateId, GateResult } from '../types';
import { testNamesOf } from './specInfo';

/**
 * The prompt the model reads. The model is a Codex *agent*, so the hard rules (no commands, no files, no tools,
 * JSON only) are stated at the top and repeated at the end. It sees the signature, the doc, the NAMES of the
 * checks and the argument TYPES of the triggering call — never test bodies, reference implementations or the
 * call's values. On retries it gets its last body plus structured diagnostics.
 */
export interface PromptInput {
  spec: FunctionSpec;
  /** TS types of the triggering call's args when the spec was inferred from a call (informational). */
  callArgTypes?: string[];
  /** Previous rejected attempts, oldest first. The LAST one is shown in full; earlier ones as one line each. */
  history: Array<{ attempt: number; body: string; gates: GateResult[]; headline?: string }>;
  /** Runtime-fault restart ("retry with the error fed back"): a committed function threw on this call. */
  runtimeFault?: { call: string; errorName: string; message: string; previousBody: string };
}

export function declarationLine(spec: FunctionSpec, opts: { forceInferredReturn?: string } = {}): string {
  const params = spec.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const ret = spec.returns ?? opts.forceInferredReturn;
  return `function ${spec.name}(${params})${ret ? `: ${ret}` : ''}`;
}

const JSON_SHAPE = '{"body": string, "notes": string}';

export function buildPrompt(input: PromptInput): string {
  const { spec } = input;
  const decl = declarationLine(spec);
  const sections: string[] = [];

  sections.push(
    [
      `You write the body of one TypeScript function, ${spec.name}. A strict toolchain decides whether your code is accepted: the TypeScript compiler, hidden unit tests, fast-check property tests, and purity/time-limit checks. Only code that passes all of them is used.`,
      '',
      'HARD RULES',
      '- Do not run any shell command. Do not read, list or inspect any file. Do not use any tool. The working directory is empty on purpose; nothing there will help.',
      '- Answer immediately, from this prompt alone.',
      `- Return ONLY the JSON object ${JSON_SHAPE}. No text before or after it.`,
    ].join('\n'),
  );

  sections.push(
    [
      'OUTPUT',
      `- "body": ONLY the statements that go between the function's braces. No signature, no braces around the whole thing, no markdown fences, nothing declared outside the function. Helper functions, if needed, must be declared inside the body.`,
      '- "notes": one short sentence about the approach.',
    ].join('\n'),
  );

  const fn = ['FUNCTION', decl, '', 'Your body is compiled exactly as:', `${decl} {`, '  <body>', '}'];
  if (spec.returns === null) {
    fn.push('No return type is declared: it is inferred from your body and must be consistent with the contract below.');
  }
  sections.push(fn.join('\n'));

  sections.push(
    [
      'REQUIREMENTS FOR THE BODY',
      `- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).`,
      `- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.`,
      `- Must not mutate its arguments.`,
      `- Each call must return within ${spec.budgetMs} ms.`,
      `- Throw an Error only where the contract says the input is invalid.`,
    ].join('\n'),
  );

  const doc = spec.doc.trim();
  sections.push(['CONTRACT (the doc; follow it exactly)', doc === '' ? '(no doc was written; infer intent from the name and types)' : doc].join('\n'));

  sections.push(checksSection(spec));

  if (input.callArgTypes && input.callArgTypes.length > 0) {
    sections.push(
      [
        'TRIGGERING CALL',
        `The program called ${spec.name} with ${input.callArgTypes.length} argument(s) of these types (values are not shown): (${input.callArgTypes.join(', ')}).`,
        'Handle any value of these types sensibly, not just one case.',
      ].join('\n'),
    );
  } else if (input.callArgTypes) {
    sections.push(['TRIGGERING CALL', `The program called ${spec.name} with no arguments.`].join('\n'));
  }

  if (input.runtimeFault) sections.push(runtimeFaultSection(input.runtimeFault));
  if (input.history.length > 0) sections.push(historySection(input.history));

  sections.push(
    [
      'FINAL REMINDER',
      '- Do not run any shell command, do not read or inspect any file, do not use any tool.',
      `- Reply now with ONLY the JSON object ${JSON_SHAPE}; "body" holds only the statements between the braces.`,
    ].join('\n'),
  );

  return sections.join('\n\n') + '\n';
}

function checksSection(spec: FunctionSpec): string {
  const { tests, properties } = testNamesOf(spec);
  if (tests.length === 0 && properties.length === 0) {
    return [
      'CHECKS',
      'This function has no unit tests and no properties yet. Only the compiler and the purity/time-limit invariants gate it, so nothing will catch a wrong answer: be especially careful to follow the contract exactly, including edge cases (empty input, single element, negative numbers, duplicates).',
    ].join('\n');
  }
  const lines = ['CHECKS', 'These checks will be run against your function (bodies are hidden):'];
  if (tests.length > 0) {
    lines.push('Unit tests:');
    for (const t of tests) lines.push(`- ${quoteName(t)}`);
  } else {
    lines.push('Unit tests: none.');
  }
  if (properties.length > 0) {
    lines.push('Properties (fast-check generates many inputs, including edge cases):');
    for (const p of properties) lines.push(`- ${quoteName(p)}`);
  } else {
    lines.push('Properties: none.');
  }
  return lines.join('\n');
}

function runtimeFaultSection(f: NonNullable<PromptInput['runtimeFault']>): string {
  return [
    'RUNTIME FAULT',
    'A previously accepted version of this function threw at runtime.',
    `call:  ${f.call}`,
    `error: ${f.errorName}: ${oneLine(f.message)}`,
    'The previous body:',
    fenced(f.previousBody),
    'It passed every check, so the checks do not cover this case. Write a corrected body that handles this call correctly per the contract (return the right value, or throw a meaningful Error only if the contract says the input is invalid), and keep the behaviour that already worked.',
  ].join('\n');
}

function historySection(history: PromptInput['history']): string {
  const last = history[history.length - 1]!;
  const lines = [
    'PREVIOUS ATTEMPT (rejected)',
    `Attempt ${last.attempt} was rejected. Its body:`,
    fenced(last.body),
    'What the checks reported:',
    last.gates.some((g) => g.status === 'fail') ? formatDiagnosticsForModel(last.gates) : oneLine(headlineOf(last)),
  ];
  const earlier = history.slice(0, -1);
  if (earlier.length > 0) {
    lines.push('', 'Earlier rejected attempts:');
    for (const h of earlier) lines.push(`- attempt ${h.attempt}: ${oneLine(headlineOf(h))}`);
  }
  lines.push(
    '',
    'Fix exactly what the diagnostics show. Keep what worked. Do not repeat an approach that was already rejected.',
  );
  return lines.join('\n');
}

function headlineOf(h: PromptInput['history'][number]): string {
  if (h.headline) return h.headline;
  const failed = h.gates.find((g) => g.status === 'fail');
  if (!failed) return 'rejected';
  return failed.headline ?? `${failed.gate}: ${failed.summary}`;
}

// ───────────────────────── diagnostics for the model ─────────────────────────

const GATE_TITLES: Record<GateId, string> = {
  compile: 'COMPILE FAILED',
  tests: 'TESTS FAILED',
  properties: 'PROPERTIES FAILED',
  invariants: 'INVARIANTS FAILED',
};

/**
 * Compact, stable plain text: one "passed:" line for gates that passed, then a block per failing gate.
 * Timings are omitted on purpose so the same verdict always renders the same text.
 */
export function formatDiagnosticsForModel(gates: GateResult[]): string {
  const out: string[] = [];
  const passed = gates.filter((g) => g.status === 'pass').map((g) => g.gate);
  if (passed.length > 0) out.push(`passed: ${passed.join(', ')}`);
  const failed = gates.filter((g) => g.status === 'fail');
  if (failed.length === 0) {
    out.push('no gate failed');
    return out.join('\n');
  }
  for (const g of failed) out.push(formatGate(g));
  return out.join('\n');
}

function formatGate(g: GateResult): string {
  const lines: string[] = [];
  const diags = g.diagnostics;
  switch (g.gate) {
    case 'compile': {
      const errors = diags.filter((d) => d.kind === 'compile' && d.category === 'error').length;
      lines.push(`${GATE_TITLES.compile} — ${errors} error${errors === 1 ? '' : 's'}`);
      break;
    }
    case 'tests': {
      const total = g.counts?.total;
      const failing = total !== undefined && g.counts ? total - g.counts.passed : diags.filter((d) => d.kind === 'test').length;
      lines.push(total !== undefined ? `${GATE_TITLES.tests} — ${failing} of ${total}` : `${GATE_TITLES.tests} — ${failing} failing`);
      break;
    }
    default:
      lines.push(GATE_TITLES[g.gate]);
  }
  if (g.note) lines.push(`  note: ${oneLine(g.note)}`);
  if (diags.length === 0 && g.headline) lines.push(`  ${oneLine(g.headline)}`);
  for (const d of diags) lines.push(...formatDiagnostic(d));
  return lines.join('\n');
}

function formatDiagnostic(d: Diagnostic): string[] {
  switch (d.kind) {
    case 'compile': {
      const loc = `candidate.ts:${d.line}:${d.col}-${d.endLine}:${d.endCol}`;
      const [first, ...rest] = d.message.split('\n');
      const lines = [`  ${loc} TS${d.code}${d.category === 'warning' ? ' (warning)' : ''}: ${first}`];
      for (const r of rest) lines.push(`      ${r.trim()}`);
      if (d.snippet !== '') {
        const gutter = `    ${d.line} | `;
        lines.push(`${gutter}${d.snippet}`);
        const width = d.endLine === d.line ? Math.max(1, d.endCol - d.col) : Math.max(1, d.snippet.length - d.col + 1);
        lines.push(`${' '.repeat(gutter.length - 2)}| ${' '.repeat(Math.max(0, d.col - 1))}${'^'.repeat(width)}`);
      }
      return lines;
    }
    case 'test': {
      const lines = [`  - test ${quoteName(d.name)}`];
      if (d.call) lines.push(`    call:     ${d.call}`);
      if (d.expected !== undefined) lines.push(`    expected: ${d.expected}`);
      if (d.actual !== undefined) lines.push(`    actual:   ${d.actual}`);
      if (d.error) lines.push(`    error:    ${oneLine(d.error)}`);
      if (d.expected === undefined && d.actual === undefined && !d.error) lines.push(`    message:  ${oneLine(d.message)}`);
      return lines;
    }
    case 'property': {
      const lines = [`  - property ${quoteName(d.name)}`];
      const call = d.call ?? `arguments ${d.counterexample}`;
      lines.push(`    counterexample (shrunk by fast-check in ${d.shrinks} steps, seed ${d.seed}): ${call}`);
      if (d.expected !== undefined) lines.push(`    expected: ${d.expected}`);
      if (d.actual !== undefined) lines.push(`    actual:   ${d.actual}`);
      if (d.error) lines.push(`    error:    ${oneLine(d.error)}`);
      if (d.expected === undefined && d.actual === undefined && !d.error) lines.push('    the predicate returned false');
      return lines;
    }
    case 'invariant': {
      const lines = [`  - ${d.invariant}: ${oneLine(d.message)}`];
      if (d.call) lines.push(`    call:     ${d.call}`);
      if (d.budgetMs !== undefined || d.elapsedMs !== undefined) {
        const budget = d.budgetMs !== undefined ? `${d.budgetMs} ms` : '?';
        const elapsed = d.elapsedMs !== undefined ? `${Math.round(d.elapsedMs)} ms` : '?';
        lines.push(`    budget:   ${budget}, elapsed: ${elapsed}`);
      }
      if (d.phase) lines.push(`    during:   ${d.phase}`);
      if (d.detail) lines.push(`    detail:   ${oneLine(d.detail)}`);
      lines.push(
        d.invariant === 'bounded'
          ? '    meaning:  the call was too slow; use an asymptotically faster algorithm'
          : '    meaning:  the body touched a global, read the clock/randomness, mutated an argument, or was non-deterministic',
      );
      return lines;
    }
  }
}

// ───────────────────────── helpers ─────────────────────────

function quoteName(name: string): string {
  return JSON.stringify(name);
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

/** Markdown fence that cannot be closed early by backticks inside the body. */
function fenced(body: string): string {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}ts\n${body.replace(/\s+$/, '')}\n${fence}`;
}

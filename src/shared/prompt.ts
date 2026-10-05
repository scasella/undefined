import type { Decision, Declined, Diagnostic, FunctionSpec, GateId, GateResult } from '../types';
import { testNamesOf } from './specInfo';
import { decisionPromptLine, effectiveChecks } from '../decide/decisions';

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
  /**
   * Datasets the triggering call ran over. Only these fields are ever shown: the variable name, the type name, the row
   * count and `sampleText` (exactly what the user agreed to send; omit it to send the type only). Rows never reach the
   * prompt any other way.
   */
  dataSamples?: Array<{ name: string; typeName: string; rowCount: number; sampleText?: string }>;
  /**
   * A re-grow after the user ruled on a spec gap and the previously accepted body failed the re-check: that body and
   * what the re-check reported (shown in a RULING section; not a history entry, since it was not a model candidate).
   */
  ruling?: { body: string; gates: GateResult[]; decision: Decision };
  /**
   * Other certified functions of the program this body may call (compose/graph.ts othersFor): the declaration line,
   * the first sentence of the doc, and the type declarations its signature needs that TYPES does not already show.
   * The OTHER FUNCTIONS section is emitted ONLY when this is non-empty: absent and [] give byte-identical prompts.
   */
  others?: Array<{ decl: string; doc: string; types?: string[] }>;
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

  const typeDecls = (spec.typeDecls ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (typeDecls !== '') {
    sections.push(['TYPES (declared before your function; use them, do not redeclare them)', typeDecls].join('\n'));
  }

  const fn = ['FUNCTION', decl, '', 'Your body is compiled exactly as:', ...(typeDecls !== '' ? [typeDecls] : []), `${decl} {`, '  <body>', '}'];
  if (spec.returns === null) {
    fn.push('No return type is declared: it is inferred from your body and must be consistent with the contract below.');
  }
  sections.push(fn.join('\n'));

  if (input.others && input.others.length > 0) sections.push(othersSection(input.others));

  sections.push(
    [
      'REQUIREMENTS FOR THE BODY',
      `- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).`,
      `- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.`,
      `- Must not mutate its arguments.`,
      `- Each call must return within ${spec.budgetMs} ms.`,
      `- Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).`,
    ].join('\n'),
  );

  const doc = spec.doc.trim();
  sections.push(['CONTRACT (the doc; follow it exactly)', doc === '' ? '(no doc was written; infer intent from the name and types)' : doc].join('\n'));

  const decisions = spec.decisions ?? [];
  if (decisions.length > 0) {
    sections.push(
      ['DECISIONS (cases the doc did not cover; the user ruled on each; follow them exactly)', ...decisions.map((d) => decisionPromptLine(spec.name, d))].join('\n'),
    );
  }

  sections.push(checksSection(spec));

  const samplesShown = (input.dataSamples ?? []).some((d) => d.sampleText !== undefined);
  if (input.callArgTypes && input.callArgTypes.length > 0) {
    sections.push(
      [
        'TRIGGERING CALL',
        `The program called ${spec.name} with ${input.callArgTypes.length} argument(s) of these types (values are not shown${samplesShown ? ', except the sample rows under DATA' : ''}): (${input.callArgTypes.join(', ')}).`,
        'Handle any value of these types sensibly, not just one case.',
      ].join('\n'),
    );
  } else if (input.callArgTypes) {
    sections.push(['TRIGGERING CALL', `The program called ${spec.name} with no arguments.`].join('\n'));
  }

  for (const d of input.dataSamples ?? []) sections.push(dataSection(d));

  sections.push(honestySection(spec));

  if (input.runtimeFault) sections.push(runtimeFaultSection(input.runtimeFault));
  if (input.ruling) sections.push(rulingSection(spec.name, input.ruling));
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

/**
 * OTHER FUNCTIONS: what else the body may call. The last two sentences guard decline calibration: a listed function
 * never gives a meaningless name a meaning, and a self-chosen seed never stands in for randomness. This wording was
 * chosen by measurement (docs/COMPOSE-MEASUREMENTS.md §2): the first draft's broader impurity sentence made the model
 * decline `hello()`. The HONESTY section itself is unchanged.
 */
export function othersSection(others: NonNullable<PromptInput['others']>): string {
  const types: string[] = [];
  for (const o of others) for (const t of o.types ?? []) if (!types.includes(t)) types.push(t);
  return [
    'OTHER FUNCTIONS (already certified in this program; you may call them by name; do not redeclare them)',
    ...(types.length > 0 ? ['Their types (declared for you):', ...types] : []),
    ...others.flatMap((o) => [`- ${o.decl}`, `  ${o.doc.replace(/\s+/g, ' ').trim() || '(no doc)'}`]),
    'Calling one is optional. It runs under the same purity and time limits, and its time counts toward yours.',
    'A listed function does not give a meaningless name a meaning: the NEEDS_SPEC rule still applies. A seed you pick yourself is not fresh randomness: a task that needs randomness is still declined as HONESTY says, even if a listed function takes a seed.',
  ].join('\n');
}

// ───────────────────────── declining honestly ─────────────────────────

/** Sentinel prefixes of a decline body (see honestySection / parseDecline). */
export const CANNOT_BE_PURE = 'CANNOT_BE_PURE';
export const NEEDS_SPEC = 'NEEDS_SPEC';

/**
 * When the model should decline instead of faking (a constant, an echo, a no-op) and the exact body that says so.
 * Content only: the {body, notes} output contract is unchanged; a decline is an ordinary body the engine recognises.
 */
export function honestySection(spec: FunctionSpec): string {
  return [
    'HONESTY (when not to write the function)',
    `- Every generated function is a pure function of its arguments. If ${spec.name} cannot honestly be written that way (its name or contract needs randomness, the current time, the network, files, the console, or state that persists between calls such as counters, caches or ids), do NOT fake it with a constant, an echo of the input or a no-op. The body must be exactly:`,
    `  throw new Error("${CANNOT_BE_PURE}: <one sentence: what it would need>");`,
    `- Decline with NEEDS_SPEC only when the name carries no meaning of its own (process, handle, data, transform, clean, run, doIt: a verb or noun that does not say what comes out) AND the contract above is empty. Then do not invent behaviour; the body must be exactly:`,
    `  throw new Error("${NEEDS_SPEC}: <one sentence: the single question you need answered>");`,
    '- If the name DESCRIBES the result (topCustomersByRevenue, monthlyTotals, dedupeByEmail, truncate, formatCurrency, parseCsvLine, sortDescending, isPalindrome, add), write it: choose the most conventional reading, handle the argument types sensibly, and use the notes field to name the assumptions you made in one sentence (e.g. "Assumes totals are summed per group, ties sorted alphabetically, returns the top 5."). A reasonable default with its assumptions stated is better than a question; the caller can correct you with a spec.',
  ].join('\n');
}

/**
 * A candidate body that is exactly a decline sentinel, else null. The WHOLE body must be the one throw statement
 * (whitespace, '/"/` quotes, a trailing semicolon and one pair of surrounding braces are tolerated); a body that merely
 * mentions a sentinel (a comment, a string elsewhere) is an ordinary candidate.
 */
export function parseDecline(body: string): Declined | null {
  const m = DECLINE_RE.exec(body);
  if (!m) return null;
  const [, open, quote, tag, raw, close] = m;
  if (!!open !== !!close) return null;
  if (quote === '`' && raw!.includes('${')) return null;
  const message = unescapeJs(raw!).replace(/\s+/g, ' ').trim();
  return { reason: tag === CANNOT_BE_PURE ? 'cannot-be-pure' : 'needs-spec', message: message || '(no reason given)' };
}

const DECLINE_RE = new RegExp(
  String.raw`^\s*(\{\s*)?throw\s+(?:new\s+)?Error\s*\(\s*(["'\x60])(${CANNOT_BE_PURE}|${NEEDS_SPEC})\s*:\s*((?:\\[\s\S]|(?!\2)[^\\])*)\2\s*\)\s*;?\s*(\}\s*)?$`,
);

function unescapeJs(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e: string) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: ' ', t: ' ', r: '', '0': '' } as Record<string, string>)[e] ?? e;
  });
}

/** One dataset: its name, size and type, plus exactly the sample text the user agreed to share (or nothing). */
export function dataSection(d: NonNullable<PromptInput['dataSamples']>[number]): string {
  const lines = ['DATA', `\`${d.name}\` is bound to ${d.rowCount} row${d.rowCount === 1 ? '' : 's'} of ${d.typeName}.`];
  if (d.sampleText !== undefined) {
    lines.push('A few rows, spread across the data (exactly what you are being shown; nothing else is shared):', d.sampleText);
  } else {
    lines.push('(The user chose not to share sample rows; only the type is shared.)');
  }
  lines.push(
    `Your function must work for ANY rows of type ${d.typeName}${d.sampleText !== undefined ? ', not just the sample' : ''}: other rows hold other values, the array can be empty or much longer, and no order may be assumed unless the contract says so.`,
  );
  return lines.join('\n');
}

function checksSection(spec: FunctionSpec): string {
  // the effective checks: the spec's own plus the decisions' generated ones; a check a decision replaced is marked
  const eff = effectiveChecks(spec);
  const { tests, properties } = testNamesOf(eff);
  const replaced = (kind: 'test' | 'property', name: string): string =>
    eff.waived.some((w) => w.kind === kind && w.name === name)
      ? kind === 'test'
        ? ' (replaced by a decision above)'
        : ' (replaced by a decision above where the doc was silent)'
      : '';
  if (tests.length === 0 && properties.length === 0) {
    return [
      'CHECKS',
      'This function has no unit tests and no properties yet. Only the compiler and the purity/time-limit invariants gate it, so nothing will catch a wrong answer: be especially careful to follow the contract exactly, including edge cases (empty input, single element, negative numbers, duplicates).',
    ].join('\n');
  }
  const lines = ['CHECKS', 'These checks will be run against your function (bodies are hidden):'];
  if (tests.length > 0) {
    lines.push('Unit tests:');
    for (const t of tests) lines.push(`- ${quoteName(t)}${replaced('test', t)}`);
  } else {
    lines.push('Unit tests: none.');
  }
  if (properties.length > 0) {
    lines.push('Properties (fast-check generates many inputs, including edge cases):');
    for (const p of properties) lines.push(`- ${quoteName(p)}${replaced('property', p)}`);
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

function rulingSection(fn: string, r: NonNullable<PromptInput['ruling']>): string {
  return [
    'RULING',
    `The user ruled on a case the doc did not cover: ${decisionPromptLine(fn, r.decision).replace(/^- /, '')}`,
    'The previously accepted body:',
    fenced(r.body),
    'It fails that ruling. What the checks reported:',
    formatDiagnosticsForModel(r.gates),
    'Write a body that follows the ruling and keeps the behaviour that already passed.',
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

import { describe, expect, it } from 'vitest';
import type { FunctionSpec, GateResult } from '@scasella/undefined-engine/types';
import { buildPrompt, dataSection, declarationLine, formatDiagnosticsForModel, honestySection, parseDecline } from './prompt';

const median: FunctionSpec = {
  name: 'median',
  params: [{ name: 'numbers', type: 'number[]' }],
  returns: 'number',
  doc: 'Returns the median of a non-empty list. For even length, the mean of the two middle values. Throws RangeError on [].',
  tests: `
    test("odd length", () => eq(median([3, 1, 2]), 2));
    // test("disabled", () => eq(median([SECRET_DISABLED]), 0));
    test("even length", () => eq(median([4, 1, 3, 2]), 2.5));
  `,
  properties: `
    matchesReference("agrees with sort-based median", [fc.array(fc.integer(), { minLength: 1 })], (xs) => {
      const s = [...xs].sort((a, b) => a - b); const REFERENCE_SECRET = 1;
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    });
  `,
  budgetMs: 1500,
  maxAttempts: 3,
  origin: 'example',
};

const gate = (g: Partial<GateResult> & Pick<GateResult, 'gate' | 'status'>): GateResult => ({
  ms: 12,
  summary: '',
  diagnostics: [],
  ...g,
});

describe('declarationLine', () => {
  it('renders the signature', () => {
    expect(declarationLine(median)).toBe('function median(numbers: number[]): number');
  });
  it('omits the return type when null, or uses forceInferredReturn', () => {
    const spec = { ...median, name: 'pair', params: [{ name: 'a', type: 'string' }, { name: 'b', type: '{ x: number }' }], returns: null };
    expect(declarationLine(spec)).toBe('function pair(a: string, b: { x: number })');
    expect(declarationLine(spec, { forceInferredReturn: 'string[]' })).toBe('function pair(a: string, b: { x: number }): string[]');
  });
});

describe('buildPrompt', () => {
  const p = buildPrompt({ spec: median, history: [] });

  it('opens with role and hard rules, and repeats them at the end', () => {
    const head = p.slice(0, 900);
    expect(head).toContain('HARD RULES');
    expect(head).toContain('Do not run any shell command');
    expect(head).toContain('Do not read, list or inspect any file');
    expect(head).toContain('Do not use any tool');
    expect(head).toContain('{"body": string, "notes": string}');
    const tail = p.slice(-400).toLowerCase();
    expect(tail).toContain('do not run any shell command');
    expect(tail).toContain('do not use any tool');
    expect(tail).toContain('only the json object {"body": string, "notes": string}');
  });

  it('contains declaration, doc, budget and check names in order', () => {
    const order = [
      'HARD RULES',
      'function median(numbers: number[]): number',
      median.doc,
      'These checks will be run against your function (bodies are hidden):',
      '- "odd length"',
      '- "even length"',
      '- "agrees with sort-based median"',
      'FINAL REMINDER',
    ].map((s) => p.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(p).toContain('within 1500 ms'); // the budget is in the spec the user sees, so the model sees it too
    expect(p).not.toMatch(/prefer iterative|avoid exponential|copy before/i); // the number, never coaching
    expect(p).toContain('lib ES2022 only');
  });

  it('never leaks test bodies, reference implementations or commented-out tests', () => {
    expect(p).not.toContain('eq(median');
    expect(p).not.toContain('REFERENCE_SECRET');
    expect(p).not.toContain('SECRET_DISABLED');
    expect(p).not.toContain('disabled');
    expect(p).not.toContain('fc.array');
  });

  it('says plainly when only compile + invariants gate the function', () => {
    const bare = buildPrompt({ spec: { ...median, tests: '', properties: '' }, history: [] });
    expect(bare).toContain('no unit tests and no properties');
    expect(bare).toContain('Only the compiler and the purity/time-limit invariants gate it');
    expect(bare).not.toContain('These checks will be run');
  });

  it('notes an inferred return type', () => {
    const q = buildPrompt({ spec: { ...median, returns: null }, history: [] });
    expect(q).toContain('function median(numbers: number[]) {');
    expect(q).toContain('inferred from your body and must be consistent with the contract');
  });

  it('gives the triggering call arg types but never values', () => {
    const q = buildPrompt({ spec: { ...median, origin: 'call' }, callArgTypes: ['number[]', '{ id: number }'], history: [] });
    expect(q).toContain('(number[], { id: number })');
    expect(q).toContain('values are not shown');
    expect(q).not.toMatch(/median\(\[/);
  });

  it('on retry shows the last body fenced, its diagnostics, earlier headlines, and the fix instruction', () => {
    const q = buildPrompt({
      spec: median,
      history: [
        { attempt: 1, body: 'return numbers[0]!;', gates: [], headline: 'Rejected: median([1, 2]) returned 1, expected 1.5' },
        {
          attempt: 2,
          body: 'const s = numbers.sort();\nreturn s[0]!;',
          gates: [
            gate({ gate: 'compile', status: 'pass' }),
            gate({ gate: 'tests', status: 'pass', counts: { passed: 2, total: 2 } }),
            gate({ gate: 'properties', status: 'skipped', note: 'interrupted: invariant violated' }),
            gate({
              gate: 'invariants',
              status: 'fail',
              diagnostics: [{ kind: 'invariant', invariant: 'pure', message: 'candidate mutated its argument', call: 'median([2, 1])', phase: 'properties' }],
            }),
          ],
        },
      ],
    });
    const iBody = q.indexOf('```ts\nconst s = numbers.sort();\nreturn s[0]!;\n```');
    const iDiag = q.indexOf('INVARIANTS FAILED');
    const iEarlier = q.indexOf('- attempt 1: Rejected: median([1, 2]) returned 1, expected 1.5');
    const iFix = q.indexOf('Fix exactly what the diagnostics show');
    expect(iBody).toBeGreaterThan(0);
    expect(iDiag).toBeGreaterThan(iBody);
    expect(iEarlier).toBeGreaterThan(iDiag);
    expect(iFix).toBeGreaterThan(iEarlier);
    expect(q).toContain('passed: compile, tests');
    // earlier attempts appear as one line only, not with their bodies
    expect(q).not.toContain('return numbers[0]!;');
    expect(q.indexOf('FINAL REMINDER')).toBeGreaterThan(iFix);
  });

  it('uses a longer fence when the body contains backticks', () => {
    const q = buildPrompt({
      spec: median,
      history: [{ attempt: 1, body: 'const s = `x```;\nreturn 1;', gates: [gate({ gate: 'compile', status: 'fail' })] }],
    });
    expect(q).toContain('````ts\nconst s = `x```;\nreturn 1;\n````');
  });

  it('describes a runtime fault with call, error and previous body', () => {
    const q = buildPrompt({
      spec: median,
      history: [],
      runtimeFault: { call: 'median([])', errorName: 'TypeError', message: 'cannot read\nproperty', previousBody: 'return numbers[0].valueOf();' },
    });
    expect(q).toContain('A previously accepted version of this function threw at runtime');
    expect(q).toContain('call:  median([])');
    expect(q).toContain('error: TypeError: cannot read property');
    expect(q).toContain('```ts\nreturn numbers[0].valueOf();\n```');
    expect(q).toContain('handles this call');
  });
});

describe('buildPrompt: the HONESTY section (declining instead of faking)', () => {
  const callSpec: FunctionSpec = { ...median, name: 'shuffle', returns: null, doc: '', tests: '', properties: '', origin: 'call' };

  it('is present, delimited, after the contract and the triggering call, before the final reminder', () => {
    const q = buildPrompt({ spec: callSpec, callArgTypes: ['number[]'], history: [] });
    const at = q.indexOf('HONESTY (when not to write the function)');
    expect(at).toBeGreaterThan(q.indexOf('CONTRACT'));
    expect(at).toBeGreaterThan(q.indexOf('TRIGGERING CALL'));
    expect(at).toBeLessThan(q.indexOf('FINAL REMINDER'));
    expect(q).toContain(honestySection(callSpec));
    // both sentinels, verbatim, as the whole body
    expect(q).toContain('throw new Error("CANNOT_BE_PURE: <one sentence: what it would need>");');
    expect(q).toContain('throw new Error("NEEDS_SPEC: <one sentence: the single question you need answered>");');
    // what counts as impure, and the guard against over-declining
    for (const w of ['randomness', 'the current time', 'the network', 'files', 'the console', 'counters, caches or ids']) expect(q).toContain(w);
    // the calibrated NEEDS_SPEC rule: decline only meaningless names; a name that describes the result is WRITTEN with
    // its assumptions stated in the notes (measured: 78/78 writes on describing names, 21/21 declines on generic ones)
    expect(q).toContain('only when the name carries no meaning of its own');
    expect(q).toContain('If the name DESCRIBES the result');
    expect(q).toContain('use the notes field to name the assumptions you made');
    for (const w of ['topCustomersByRevenue', 'monthlyTotals', 'dedupeByEmail', 'truncate', 'sortDescending', 'isPalindrome', 'add']) expect(q).toContain(w);
    expect(q).toContain('If shuffle cannot honestly be written');
  });

  it('keeps the existing rules (with the carve-out) and the output contract unchanged', () => {
    const q = buildPrompt({ spec: median, history: [] });
    expect(q).toContain('Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).');
    expect(q).toContain('Pure and deterministic');
    expect(q).toContain('Return ONLY the JSON object {"body": string, "notes": string}');
  });

  it('is in every prompt (retries and runtime faults too) and never leaks test bodies or coaching', () => {
    const prompts = [
      buildPrompt({ spec: median, history: [] }),
      buildPrompt({ spec: median, history: [{ attempt: 1, body: 'return 0;', gates: [], headline: 'Rejected: x' }] }),
      buildPrompt({ spec: median, history: [], runtimeFault: { call: 'median([])', errorName: 'E', message: 'm', previousBody: 'return 1;' } }),
    ];
    for (const q of prompts) {
      expect(q).toContain('HONESTY (when not to write the function)');
      expect(q).not.toContain('eq(median');
      expect(q).not.toContain('REFERENCE_SECRET');
      expect(q).not.toContain('SECRET_DISABLED');
      expect(q).not.toContain('fc.array');
      expect(q).not.toMatch(/prefer iterative|avoid exponential|copy before|algorithm|Fisher|Euclid|sort the/i);
    }
  });
});

describe('parseDecline', () => {
  it('recognises both sentinels in every tolerated spelling', () => {
    const variants = [
      'throw new Error("CANNOT_BE_PURE: it needs a source of randomness, e.g. a seed argument.");',
      "throw new Error('CANNOT_BE_PURE: it needs a source of randomness, e.g. a seed argument.')",
      'throw new Error(`CANNOT_BE_PURE: it needs a source of randomness, e.g. a seed argument.`);',
      '  \n throw   new Error( "CANNOT_BE_PURE:it needs a source of randomness, e.g. a seed argument." ) ;\n',
      '{ throw new Error("CANNOT_BE_PURE: it needs a source of randomness, e.g. a seed argument."); }',
      'throw Error("CANNOT_BE_PURE: it needs a source of randomness, e.g. a seed argument.");',
    ];
    for (const v of variants) {
      expect(parseDecline(v)).toEqual({ reason: 'cannot-be-pure', message: 'it needs a source of randomness, e.g. a seed argument.' });
    }
    expect(parseDecline('throw new Error("NEEDS_SPEC: What should clean remove: whitespace, punctuation, or both?");')).toEqual({
      reason: 'needs-spec',
      message: 'What should clean remove: whitespace, punctuation, or both?',
    });
    expect(parseDecline(`throw new Error('NEEDS_SPEC: Should it keep the user\\'s "quotes"?');`)).toEqual({
      reason: 'needs-spec',
      message: `Should it keep the user's "quotes"?`,
    });
    expect(parseDecline('throw new Error("NEEDS_SPEC: ");')).toEqual({ reason: 'needs-spec', message: '(no reason given)' });
  });

  it('matches the WHOLE body only: a mention of a sentinel elsewhere is an ordinary candidate', () => {
    const notDeclines = [
      '// NEEDS_SPEC: what should this do?\nreturn arg0;',
      'if (arg0 < 0) throw new Error("NEEDS_SPEC: negative?");\nreturn arg0;',
      'throw new Error("NEEDS_SPEC: x");\nreturn 1;',
      'return "CANNOT_BE_PURE: no";',
      'throw new Error("CANNOT_BE_PURE " + arg0);',
      'throw new Error("cannot_be_pure: lower case");',
      'throw new RangeError("NEEDS_SPEC: wrong error class");',
      '{ throw new Error("NEEDS_SPEC: unbalanced brace");',
      'throw new Error(`NEEDS_SPEC: ${arg0}`);',
      'throw new Error("NEEDS_SPEC: a" + "b");',
      '',
    ];
    for (const b of notDeclines) expect(parseDecline(b), b).toBeNull();
  });
});

describe('formatDiagnosticsForModel', () => {
  it('formats compile errors with location, code, snippet and caret line', () => {
    const text = formatDiagnosticsForModel([
      gate({
        gate: 'compile',
        status: 'fail',
        diagnostics: [
          { kind: 'compile', code: 2322, message: "Type 'string' is not assignable to type 'number'.", category: 'error', line: 3, col: 10, endLine: 3, endCol: 13, snippet: '  return "x";' },
          { kind: 'compile', code: 2304, message: "Cannot find name 'window'.", category: 'error', line: 1, col: 1, endLine: 1, endCol: 7, snippet: 'window.foo;' },
        ],
      }),
      gate({ gate: 'tests', status: 'skipped', note: 'not reached' }),
    ]);
    expect(text).toBe(
      [
        'COMPILE FAILED — 2 errors',
        "  candidate.ts:3:10-3:13 TS2322: Type 'string' is not assignable to type 'number'.",
        '    3 |   return "x";',
        '      |          ^^^',
        "  candidate.ts:1:1-1:7 TS2304: Cannot find name 'window'.",
        '    1 | window.foo;',
        '      | ^^^^^^',
      ].join('\n'),
    );
  });

  it('formats failing tests with counts, call, expected, actual and error', () => {
    const text = formatDiagnosticsForModel([
      gate({ gate: 'compile', status: 'pass' }),
      gate({
        gate: 'tests',
        status: 'fail',
        counts: { passed: 4, total: 5 },
        diagnostics: [
          { kind: 'test', name: 'even length', message: 'expected 2.5', call: 'median([4, 1, 3, 2])', expected: '2.5', actual: '3' },
          { kind: 'test', name: 'empty', message: 'threw', call: 'median([])', error: 'TypeError: x is undefined' },
        ],
      }),
    ]);
    expect(text).toBe(
      [
        'passed: compile',
        'TESTS FAILED — 1 of 5',
        '  - test "even length"',
        '    call:     median([4, 1, 3, 2])',
        '    expected: 2.5',
        '    actual:   3',
        '  - test "empty"',
        '    call:     median([])',
        '    error:    TypeError: x is undefined',
      ].join('\n'),
    );
  });

  it('formats property counterexamples with shrink steps and seed', () => {
    const text = formatDiagnosticsForModel([
      gate({ gate: 'compile', status: 'pass' }),
      gate({ gate: 'tests', status: 'pass' }),
      gate({
        gate: 'properties',
        status: 'fail',
        diagnostics: [
          { kind: 'property', name: 'agrees with reference', call: 'median([1, 2])', counterexample: '[[1, 2]]', expected: '1.5', actual: '1', shrinks: 4, runs: 17, seed: 424242 },
          { kind: 'property', name: 'within bounds', counterexample: '[[5, 5]]', shrinks: 0, runs: 3, seed: 424242 },
        ],
      }),
    ]);
    expect(text).toContain('passed: compile, tests\nPROPERTIES FAILED\n  - property "agrees with reference"');
    expect(text).toContain('    counterexample (shrunk by fast-check in 4 steps, seed 424242): median([1, 2])\n    expected: 1.5\n    actual:   1');
    expect(text).toContain('counterexample (shrunk by fast-check in 0 steps, seed 424242): arguments [[5, 5]]\n    the predicate returned false');
  });

  it('formats bounded invariant violations with budget vs elapsed', () => {
    const text = formatDiagnosticsForModel([
      gate({ gate: 'compile', status: 'pass' }),
      gate({ gate: 'tests', status: 'skipped', note: 'interrupted: invariant violated' }),
      gate({
        gate: 'invariants',
        status: 'fail',
        diagnostics: [
          { kind: 'invariant', invariant: 'bounded', message: 'fibonacci(90) did not return within 1500 ms', call: 'fibonacci(90)', phase: 'tests', budgetMs: 1500, elapsedMs: 1503.7 },
        ],
      }),
    ]);
    expect(text).toContain('INVARIANTS FAILED\n  - bounded: fibonacci(90) did not return within 1500 ms\n    call:     fibonacci(90)\n    budget:   1500 ms, elapsed: 1504 ms\n    during:   tests');
    expect(text).not.toContain('TESTS');
  });

  it('is stable: gate timings do not appear', () => {
    const a = formatDiagnosticsForModel([gate({ gate: 'compile', status: 'fail', ms: 5, headline: 'Rejected: x' })]);
    const b = formatDiagnosticsForModel([gate({ gate: 'compile', status: 'fail', ms: 999, headline: 'Rejected: x' })]);
    expect(a).toBe(b);
    expect(a).toBe('COMPILE FAILED — 0 errors\n  Rejected: x');
  });
});

describe('buildPrompt: datasets (TYPES and DATA blocks)', () => {
  const ROW = 'type Row = { customer: string; total: number }';
  const spec: FunctionSpec = {
    ...median,
    name: 'topCustomers',
    params: [{ name: 'arg0', type: 'Row[]' }],
    returns: null,
    doc: '',
    tests: '',
    properties: '',
    origin: 'call',
    typeDecls: ROW,
  };
  const SAMPLE = '[{"customer":"Ada","total":12.5},{"customer":"Lin","total":3}]';

  it('declarationLine keeps working with Row[] params', () => {
    expect(declarationLine(spec)).toBe('function topCustomers(arg0: Row[])');
  });

  it('shows the declarations in a TYPES block and in the compiled-as layout', () => {
    const q = buildPrompt({ spec, callArgTypes: ['Row[]'], history: [] });
    expect(q).toContain(`TYPES (declared before your function; use them, do not redeclare them)\n${ROW}`);
    expect(q).toContain(`Your body is compiled exactly as:\n${ROW}\nfunction topCustomers(arg0: Row[]) {\n  <body>\n}`);
    expect(q.indexOf('TYPES (')).toBeLessThan(q.indexOf('FUNCTION'));
  });

  it('has no TYPES block without typeDecls', () => {
    const { typeDecls: _t, ...plain } = spec;
    expect(buildPrompt({ spec: plain, history: [] })).not.toContain('TYPES (');
  });

  it('DATA with samples: count, type, exactly the sample text, and the ANY-rows rule', () => {
    const q = buildPrompt({
      spec,
      callArgTypes: ['Row[]'],
      history: [],
      dataSamples: [{ name: 'rows', typeName: 'Row', rowCount: 1200, sampleText: SAMPLE }],
    });
    expect(q).toContain(
      `DATA\n\`rows\` is bound to 1200 rows of Row.\nA few rows, spread across the data (exactly what you are being shown; nothing else is shared):\n${SAMPLE}\n`,
    );
    // the sample is evenly spaced across the data, so the prompt must not call it the first rows
    expect(q).not.toContain('First rows');
    expect(q).toContain('Your function must work for ANY rows of type Row, not just the sample');
    expect(q).toContain('values are not shown, except the sample rows under DATA');
    expect(q).not.toContain('chose not to share');
    // DATA sits after the triggering call and before HONESTY
    expect(q.indexOf('DATA\n')).toBeGreaterThan(q.indexOf('TRIGGERING CALL'));
    expect(q.indexOf('DATA\n')).toBeLessThan(q.indexOf('HONESTY (when'));
  });

  it('DATA without samples: the type only, and says so', () => {
    const d = { name: 'rows', typeName: 'Row', rowCount: 1, sampleText: undefined };
    const q = buildPrompt({ spec, callArgTypes: ['Row[]'], history: [], dataSamples: [d] });
    expect(q).toContain('`rows` is bound to 1 row of Row.\n(The user chose not to share sample rows; only the type is shared.)');
    expect(q).toContain('Your function must work for ANY rows of type Row:');
    expect(q).not.toContain('A few rows, spread across the data');
    expect(q).toContain('values are not shown)');
    expect(dataSection(d)).not.toMatch(/customer|Ada/);
  });

  it('leaks nothing but the sample text: extra fields on the input never reach the prompt', () => {
    const sneaky = { name: 'rows', typeName: 'Row', rowCount: 2, sampleText: SAMPLE, rows: [{ customer: 'SECRET_ROW', total: 1 }] };
    const q = buildPrompt({ spec, history: [], dataSamples: [sneaky] });
    expect(q).not.toContain('SECRET_ROW');
    expect(q.split('Ada').length).toBe(2); // the sample appears once, verbatim
  });

  it('one DATA block per dataset', () => {
    const q = buildPrompt({
      spec,
      history: [],
      dataSamples: [
        { name: 'rows', typeName: 'Row', rowCount: 3, sampleText: '[]' },
        { name: 'orders', typeName: 'Order', rowCount: 7 },
      ],
    });
    expect(q.match(/^DATA$/gm)).toHaveLength(2);
    expect(q).toContain('`orders` is bound to 7 rows of Order.');
  });
});

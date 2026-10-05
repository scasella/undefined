/**
 * Every exit code on real files, through main() with the Node gate host and its real watchdog:
 * 0 pass, 1 rejected, 2 spec gaps found (questions printed), 3 could not run. The three example projects are the
 * fixtures for 0/1/2, so the examples the README points to cannot rot.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cli, EXAMPLES, FIXTURES } from './helpers';

describe('exit 0: pass', () => {
  it('examples/passing: clamp, checked by a vitest + fast-check file, accepted with the evidence line', async () => {
    const r = await cli(['certify', 'src/clamp.ts'], join(EXAMPLES, 'passing'));
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).toContain('clamp  src/clamp.ts:5  (spec: src/clamp.test.ts, seed ');
    expect(r.stdout).toContain('  ACCEPTED\n');
    expect(r.stdout).toMatch(/\n {2}Compiled\. 4 unit tests\. 2 properties, 100 runs each\. \d+ calls replayed for purity\. Tests killed \d+ of \d+ mutants/);
    // survivors are reported at their line in the user's file (the compiled line is kept for reference)
    expect(r.stdout).toContain('survived: src/clamp.ts:6 (compiled line 1)  < → <=  (may be an equivalent mutant)');
    expect(r.stdout).toContain('Exit 0 (pass).');
    expect(r.stdout).toContain('Nothing was generated.');
  });

  it('--budget-ms says that it changes the hash and seed of functions without a budget', async () => {
    const r = await cli(['certify', 'untested.ts', '--budget-ms', '250'], FIXTURES);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('note: --budget-ms 250 applies to functions whose spec sets no budgetMs; the budget is part of the spec, so it changes their specHash and seed');
  });

  it('a function with no spec is accepted as unchecked (only Compile ran), still exit 0', async () => {
    const r = await cli(['certify', 'untested.ts'], FIXTURES);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('half  untested.ts:1  (no spec or test file');
    expect(r.stdout).toContain('ACCEPTED (unchecked: no tests, properties or pins; only Compile ran)');
  });
});

describe('exit 1: rejected', () => {
  it('examples/rejected: isLeapYear against an undefined-spec file, with the headline and the failing call', async () => {
    const r = await cli(['certify', 'src/leap.ts'], join(EXAMPLES, 'rejected'));
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toContain('  REJECTED by Tests\n  Rejected: isLeapYear(1900) returned true, expected false\n');
    expect(r.stdout).toContain('      call:     isLeapYear(1900)\n      expected: false\n      actual:   true');
    expect(r.stdout).toContain('Not reached: Properties, Invariants');
    expect(r.stdout).toContain('Exit 1 (rejected).');
  });

  it('the watchdog rejects a function that does not return within its budget (bounded)', async () => {
    const r = await cli(['certify', 'slow.ts', '--quiet'], FIXTURES);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('REJECTED      fib  slow.ts:2  Rejected: fib(40) did not return within 200 ms (bounded)');
  });

  it('a rejection outranks a spec gap in another function of the same file (1 > 2)', async () => {
    const r = await cli(['certify', 'precedence.ts', '--quiet'], FIXTURES);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('SPEC GAP      sign  precedence.ts:2');
    expect(r.stdout).toContain('REJECTED      abs  precedence.ts:5');
  });

  it('--function narrows the run: the gap alone is exit 2', async () => {
    const r = await cli(['certify', 'precedence.ts', '--function', 'sign', '--quiet'], FIXTURES);
    expect(r.code).toBe(2);
    expect(r.stdout).not.toContain('abs');
  });
});

describe('exit 2: spec gaps found', () => {
  it('examples/spec-gap: the questions are printed, with the vitest test to add for each answer', async () => {
    const r = await cli(['certify', 'src/stats.ts'], join(EXAMPLES, 'spec-gap'));
    expect(r.code, r.stdout).toBe(2);
    expect(r.stdout).toContain('  SPEC GAP in Tests\n');
    expect(r.stdout).toContain("? median([]): the spec didn't say what the median of nothing is.");
    expect(r.stdout).toContain('Check "empty list" (tests) expects 0; the code returns NaN.');
    expect(r.stdout).toContain('it("decided: median([]) returns NaN", () => {\n          expect(median([])).toBeNaN();\n        });');
    expect(r.stdout).toContain('it("decided: median([]) throws", () => {\n          expect(() => median([])).toThrow();\n        });');
    expect(r.stdout).toContain('Exit 2 (spec gaps found).');
  });

  it('with an undefined-spec file the tests to add are in the Test API syntax', async () => {
    const r = await cli(['certify', 'gap-only.ts'], FIXTURES);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('test("decided: sign(0) returns 1", () => {\n          eq(sign(0), 1);\n        });');
    expect(r.stdout).toContain('Treating zero as positive is a common convention.');
  });

  it('a gap next to accepted functions is still exit 2', async () => {
    const r = await cli(['certify', 'mixed.ts', '--quiet', '--no-mutation'], FIXTURES);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe(
      [
        'ACCEPTED      abs  mixed.ts:2',
        'SPEC GAP      sign  mixed.ts:7  Rejected: sign(0) returned 1, expected 0',
        'ACCEPTED      max2  mixed.ts:10',
        '3 functions: 2 accepted, 1 with spec gaps. Exit 2 (spec gaps found).',
        '',
      ].join('\n'),
    );
  });
});

describe('exit 3: could not run (never a verdict on the code)', () => {
  it('a file that does not exist', async () => {
    const r = await cli(['certify', 'missing.ts'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('error: missing.ts: cannot read the file');
  });

  it('a file that is not TypeScript', async () => {
    const r = await cli(['certify', 'mixed.undefined.json'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('expected a TypeScript source file (.ts)');
  });

  it('a --spec file that does not exist', async () => {
    const r = await cli(['certify', 'untested.ts', '--spec', 'nope.undefined.json'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('error: nope.undefined.json: cannot read the spec file');
  });

  it('a function that uses module scope', async () => {
    const r = await cli(['certify', 'module-scope.ts'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('could not run: module-scope.ts:5: dropStopWords uses STOP_WORDS from module scope');
  });

  it('a spec file with a typo: path-addressed, and nothing is certified on a partial spec', async () => {
    const r = await cli(['certify', 'bad-spec.ts'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('could not run: bad-spec.undefined.json: functions.double.budgetMS is not a spec field');
    expect(r.stdout).toContain('  COULD NOT RUN\n');
  });

  it('a vitest file with hooks', async () => {
    const r = await cli(['certify', 'hooks.ts'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('could not run: hooks.test.ts:5: beforeEach is not supported: every check must stand on its own');
  });

  it('--function naming no export', async () => {
    const r = await cli(['certify', 'untested.ts', '--function', 'nothere'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('no exported function nothere');
  });
});

describe('output integrity', () => {
  it('control characters from the certified code (ESC, CR, BEL) are printed escaped, never raw', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'undefined-cli-ctl-'));
    writeFileSync(join(dir, 'g.ts'), 'export function g(x: number): number {\n  if (x === 1) throw new Error("a\\u001b[2K\\r\\u001b]52;c;aGk=\\u0007 ACCEPTED");\n  return x;\n}\n');
    writeFileSync(join(dir, 'g.undefined.json'), JSON.stringify({ format: 'undefined-spec', version: 1, functions: { g: { tests: "test('t\\u001b[31m', () => { eq(g(1), 1); });" } } }));
    const r = await cli(['certify', 'g.ts'], dir);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/[\u001b\u0007\r]/);
    expect(r.stdout).toContain('a\\u001b[2K\\u000d\\u001b]52;c;aGk=\\u0007 ACCEPTED');
  });
});

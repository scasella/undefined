import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';
import { cli, FIXTURES } from './helpers';

describe('parseArgs', () => {
  it('reads certify <file> with defaults', () => {
    expect(parseArgs(['certify', 'src/a.ts'])).toEqual({ command: 'certify', file: 'src/a.ts', json: false, functions: [], mutation: true, quiet: false });
  });

  it('reads every supported flag, in either --flag value or --flag=value form', () => {
    expect(
      parseArgs(['certify', '--spec', 's.json', 'a.ts', '--json', '--function', 'f', '--function=g', '--budget-ms=250', '--time-box-ms', '3000', '--heap-mb', '128']),
    ).toEqual({ command: 'certify', file: 'a.ts', spec: 's.json', json: true, functions: ['f', 'g'], budgetMs: 250, mutation: true, timeBoxMs: 3000, heapMb: 128, quiet: false });
    expect(parseArgs(['certify', 'a.ts', '--no-mutation', '--quiet'])).toMatchObject({ mutation: false, quiet: true });
    expect(parseArgs(['certify', '--', '--odd-name.ts'])).toMatchObject({ file: '--odd-name.ts' });
  });

  it('answers help and version', () => {
    expect(parseArgs(['--help'])).toEqual({ command: 'help' });
    expect(parseArgs(['certify', 'a.ts', '-h'])).toEqual({ command: 'help' });
    expect(parseArgs(['help'])).toEqual({ command: 'help' });
    expect(parseArgs(['--version'])).toEqual({ command: 'version' });
    expect(parseArgs(['-v'])).toEqual({ command: 'version' });
  });

  it('refuses what it does not understand, with the reason', () => {
    const err = (argv: string[]): string => {
      const r = parseArgs(argv);
      return r.command === 'error' ? r.message : `not an error: ${JSON.stringify(r)}`;
    };
    expect(err([])).toMatch(/missing command/);
    expect(err(['generate', 'a.ts'])).toMatch(/unknown command "generate"/);
    expect(err(['certify'])).toMatch(/needs a TypeScript file/);
    expect(err(['certify', 'a.ts', 'b.ts'])).toMatch(/takes one file/);
    expect(err(['certify', 'a.ts', '--spec'])).toMatch(/--spec needs a value/);
    expect(err(['certify', 'a.ts', '--spec', '--json'])).toMatch(/--spec needs a value/);
    expect(err(['certify', 'a.ts', '--budget-ms', '0'])).toMatch(/positive whole number/);
    expect(err(['certify', 'a.ts', '--budget-ms', '1.5'])).toMatch(/positive whole number/);
    expect(err(['certify', 'a.ts', '--heap-mb', 'lots'])).toMatch(/positive whole number/);
    expect(err(['certify', 'a.ts', '--json=yes'])).toMatch(/takes no value/);
    expect(err(['certify', 'a.ts', '--json', '--json'])).toMatch(/given twice/);
    expect(err(['certify', 'a.ts', '--function', 'not-a-name'])).toMatch(/expects a function name/);
    expect(err(['certify', 'a.ts', '--frobnicate'])).toMatch(/unknown option --frobnicate/);
    expect(err(['certify', 'a.ts', '--json', '--quiet'])).toMatch(/cannot be combined/);
    expect(err(['certify', 'a.ts', '--no-mutation', '--time-box-ms', '10'])).toMatch(/no effect/);
    // in the design, not in the engine API yet: refused loudly rather than silently ignored
    expect(err(['certify', 'a.ts', '--seed', '1'])).toMatch(/--seed is not supported yet/);
    expect(err(['certify', 'a.ts', '--overall-cap-ms', '1'])).toMatch(/--overall-cap-ms is not supported yet/);
  });
});

describe('main: usage', () => {
  it('a usage error is exit 3 with the usage on stderr and nothing on stdout', async () => {
    const r = await cli(['certify'], FIXTURES);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^undefined-certify: certify needs a TypeScript file/);
    expect(r.stderr).toContain('Exit codes: 0 every function accepted, 1 a function was rejected, 2 spec gaps found');
  });

  it('--help is exit 0 and states the sandbox limit', async () => {
    const r = await cli(['--help'], FIXTURES);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: undefined-certify certify <file.ts> [options]');
    expect(r.stdout).toContain('NOT a secure sandbox');
    expect(r.stdout).toContain('It never generates or changes code.');
  });

  it('--version prints the package version', async () => {
    const r = await cli(['--version'], FIXTURES);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

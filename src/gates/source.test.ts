import { describe, expect, it } from 'vitest';
import { BODY_START_LINE, DEFAULT_BUDGET_MS, DEFAULT_MAX_ATTEMPTS, buildSource, emptySpec, specFromCall } from './source';

describe('buildSource', () => {
  it('wraps the body with the signature line, an opening brace line, and a closing brace', () => {
    const spec = { ...emptySpec('median'), params: [{ name: 'numbers', type: 'number[]' }], returns: 'number' };
    const { source, bodyStartLine } = buildSource(spec, 'return numbers[0]!;');
    expect(source).toBe('function median(numbers: number[]): number\n{\nreturn numbers[0]!;\n}\n');
    expect(bodyStartLine).toBe(BODY_START_LINE);
    expect(source.split('\n')[bodyStartLine - 1]).toBe('return numbers[0]!;');
  });

  it('omits the return annotation when returns is null and joins params', () => {
    const spec = { ...emptySpec('add'), params: [{ name: 'a', type: 'number' }, { name: 'b', type: '{ x: string }' }] };
    expect(buildSource(spec, 'return a;').source.split('\n')[0]).toBe('function add(a: number, b: { x: string })');
  });

  it('keeps body text verbatim (no indentation) and normalises CRLF', () => {
    const { source } = buildSource(emptySpec('f'), '  const x = 1;\r\n  return x;');
    expect(source).toBe('function f()\n{\n  const x = 1;\n  return x;\n}\n');
  });
});

describe('spec constructors', () => {
  it('emptySpec has defaults and call origin', () => {
    expect(emptySpec('g')).toEqual({
      name: 'g', params: [], returns: null, doc: '', tests: '', properties: '',
      budgetMs: 1000, maxAttempts: 3, origin: 'call',
    });
    expect(DEFAULT_BUDGET_MS).toBe(1000);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it('specFromCall names params arg0..argN with the given types', () => {
    const spec = specFromCall('zip', ['number[]', 'string[]']);
    expect(spec.params).toEqual([{ name: 'arg0', type: 'number[]' }, { name: 'arg1', type: 'string[]' }]);
    expect(spec.returns).toBeNull();
    expect(spec.origin).toBe('call');
    expect(buildSource(spec, 'return [];').source.startsWith('function zip(arg0: number[], arg1: string[])\n{')).toBe(true);
  });
});

describe('typeDecls', () => {
  it('prepends the declarations and moves bodyStartLine so lines stay body-relative', () => {
    const spec = specFromCall('top', ['Row[]'], { typeDecls: 'type Row = {\r\n  a: number;\r\n}\n\n' });
    expect(spec.typeDecls).toBe('type Row = {\r\n  a: number;\r\n}\n\n');
    const { source, bodyStartLine } = buildSource(spec, 'return arg0;');
    expect(source).toBe('type Row = {\n  a: number;\n}\nfunction top(arg0: Row[])\n{\nreturn arg0;\n}\n');
    expect(bodyStartLine).toBe(BODY_START_LINE + 3);
    expect(source.split('\n')[bodyStartLine - 1]).toBe('return arg0;');
  });

  it('specFromCall leaves typeDecls unset when absent or blank (hashes stay unchanged)', () => {
    expect('typeDecls' in specFromCall('f', ['number'])).toBe(false);
    expect('typeDecls' in specFromCall('f', ['number'], { typeDecls: '  ' })).toBe(false);
    expect(buildSource({ ...emptySpec('f'), typeDecls: '' }, 'return 1;').bodyStartLine).toBe(BODY_START_LINE);
  });
});

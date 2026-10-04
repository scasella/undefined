import { describe, expect, it } from 'vitest';
import { fmtElapsed, fmtMs, isValidFnName, paramsText, parseParams, relativeTime, repoUrlFromPages, shortHash, stripRejected } from './format';

describe('relativeTime', () => {
  const now = 1_000_000_000;
  it('buckets by magnitude', () => {
    expect(relativeTime(now - 1000, now)).toBe('just now');
    expect(relativeTime(now - 42_000, now)).toBe('42s ago');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(relativeTime(now - 5 * 86_400_000, now)).toBe('5 days ago');
  });
  it('treats future timestamps as just now', () => {
    expect(relativeTime(now + 10_000, now)).toBe('just now');
  });
});

describe('fmtMs / fmtElapsed', () => {
  it('formats durations', () => {
    expect(fmtMs(0.2)).toBe('<1 ms');
    expect(fmtMs(14.4)).toBe('14 ms');
    expect(fmtMs(1500)).toBe('1.50 s');
    expect(fmtMs(15000)).toBe('15.0 s');
    expect(fmtMs(NaN)).toBe('—');
    expect(fmtElapsed(3456)).toBe('3.5s');
    expect(fmtElapsed(-5)).toBe('0.0s');
  });
});

describe('small helpers', () => {
  it('shortHash / stripRejected / isValidFnName', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef01');
    expect(shortHash(undefined)).toBe('—');
    expect(stripRejected('Rejected: median([1, 2]) returned 1, expected 1.5')).toBe('median([1, 2]) returned 1, expected 1.5');
    expect(stripRejected(undefined)).toBe('');
    expect(isValidFnName('slugify')).toBe(true);
    expect(isValidFnName('2fast')).toBe(false);
  });
});

describe('parseParams', () => {
  it('parses simple and empty lists', () => {
    expect(parseParams('')).toEqual({ ok: true, params: [] });
    expect(parseParams('numbers: number[]')).toEqual({ ok: true, params: [{ name: 'numbers', type: 'number[]' }] });
  });

  it('only splits on top-level commas', () => {
    const r = parseParams('m: Map<string, number>, o: { a: number, b: [string, number] }, f: (x: number, y: number) => number');
    expect(r).toEqual({
      ok: true,
      params: [
        { name: 'm', type: 'Map<string, number>' },
        { name: 'o', type: '{ a: number, b: [string, number] }' },
        { name: 'f', type: '(x: number, y: number) => number' },
      ],
    });
  });

  it('round-trips through paramsText', () => {
    const r = parseParams('a: number,  b: string[]');
    expect(r.ok && paramsText(r.params)).toBe('a: number, b: string[]');
  });

  it('reports errors in plain words', () => {
    expect(parseParams('numbers')).toMatchObject({ ok: false, error: expect.stringContaining('needs a type') });
    expect(parseParams('a: number,')).toMatchObject({ ok: false, error: expect.stringContaining('empty parameter') });
    expect(parseParams('1a: number')).toMatchObject({ ok: false, error: expect.stringContaining('not a valid') });
    expect(parseParams('a: number, a: string')).toMatchObject({ ok: false, error: expect.stringContaining('duplicate') });
    expect(parseParams('a: ')).toMatchObject({ ok: false, error: expect.stringContaining('empty type') });
  });
});

describe('repoUrlFromPages', () => {
  it('derives the clone URL on GitHub Pages only', () => {
    expect(repoUrlFromPages('https://ada.github.io/undefined/?x=1')).toBe('https://github.com/ada/undefined.git');
    expect(repoUrlFromPages('https://ada.github.io/')).toBe('https://github.com/ada/ada.github.io.git');
    expect(repoUrlFromPages('http://localhost:5173/')).toBeNull();
    expect(repoUrlFromPages('not a url')).toBeNull();
  });
});

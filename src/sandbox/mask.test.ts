import { describe, expect, it } from 'vitest';
import { evalMasked, isInvariantViolation, takeViolations } from './mask';

describe('evalMasked', () => {
  it('runs pure code and supports recursion', () => {
    const f = evalMasked<(n: number) => number>('function f(n){ return n < 2 ? n : f(n-1) + f(n-2); }', 'f');
    expect(f(10)).toBe(55);
  });

  it('traps Math.random even when the candidate swallows the error', () => {
    takeViolations();
    const f = evalMasked<() => number>('function f(){ try { return Math.random(); } catch { return 0; } }', 'f');
    expect(f()).toBe(0);
    expect(takeViolations()).toEqual(['Math.random']);
  });

  it('traps the clock, fetch, and the global object', () => {
    for (const [body, what] of [
      ['return Date.now();', 'Date.now'],
      ['return new Date().getTime();', 'Date (reads the clock)'],
      ['return fetch("http://x");', 'fetch'],
      ['return globalThis.x;', 'globalThis'],
    ] as const) {
      takeViolations();
      const f = evalMasked<() => unknown>(`function f(){ ${body} }`, 'f');
      let caught: unknown;
      try {
        f();
      } catch (e) {
        caught = e;
      }
      expect(isInvariantViolation(caught)).toBe(true);
      expect(takeViolations()).toEqual([what]);
    }
  });

  it('keeps pure Date and Math usage working', () => {
    const f = evalMasked<() => number>('function f(){ return new Date(0).getTime() + Math.max(1, 2) + Math.floor(2.5); }', 'f');
    expect(f()).toBe(4);
  });

  it('rejects an invalid export name', () => {
    expect(() => evalMasked('', 'a b')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { evalMasked, isInvariantViolation, scrubWorkerGlobals, takeViolations } from './mask';

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

describe('mask — review fixes', () => {
  const call = <T>(js: string, ...args: unknown[]): { value?: T; error?: unknown } => {
    try {
      return { value: evalMasked<(...a: unknown[]) => T>(js, 'f')(...args) };
    } catch (error) {
      return { error };
    }
  };

  it('detects and restores a modified intrinsic (Object.is)', () => {
    takeViolations();
    const real = Object.is;
    call('function f(){ Object.is = () => true; return 0; }');
    expect(takeViolations()).toEqual(['modified Object.is']);
    expect(Object.is).toBe(real);
    expect(Object.is(1, 2)).toBe(false);
    expect(takeViolations()).toEqual([]);
  });

  it('detects and restores Array.prototype.push, and removes added prototype properties', () => {
    takeViolations();
    const real = Array.prototype.push;
    call('function f(){ Array.prototype.push = function () { return 0; }; Array.prototype.extra = 1; return 0; }');
    const v = takeViolations();
    expect(v).toContain('modified Array.prototype.push');
    expect(v).toContain('added property extra to Array.prototype');
    expect(Array.prototype.push).toBe(real);
    expect('extra' in []).toBe(false);
  });

  it('detects deletions, accessor swaps, and changes to the shared masked Math', () => {
    takeViolations();
    call('function f(){ delete String.prototype.trim; Object.defineProperty(JSON, "stringify", { get() { return () => "x"; }, configurable: true }); Math.floor = () => 7; return 0; }');
    expect(takeViolations()).toEqual(expect.arrayContaining(['modified String.prototype.trim', 'modified JSON.stringify', 'modified Math.floor']));
    expect(' a '.trim()).toBe('a');
    expect(JSON.stringify([1])).toBe('[1]');
    expect(evalMasked<() => number>('function f(){ return Math.floor(2.5); }', 'f')()).toBe(2);
  });

  it('records a violation even when the candidate replaced Array.prototype.push before touching a trap', () => {
    takeViolations();
    call('function f(){ Array.prototype.push = function () { return 0; }; try { fetch("x"); } catch {} return 0; }');
    const v = takeViolations();
    expect(v).toContain('fetch');
    expect(v).toContain('modified Array.prototype.push');
  });

  it('lets real Date values pass `instanceof Date` inside a candidate', () => {
    expect(call<boolean>('function f(d){ return d instanceof Date; }', new Date(0)).value).toBe(true);
    expect(call<boolean>('function f(){ return new Date(0) instanceof Date; }').value).toBe(true);
    expect(call<boolean>('function f(d){ return d instanceof Date; }', {}).value).toBe(false);
  });

  it('treats a bare Date() call as a clock read (pure violation), not a TypeError', () => {
    takeViolations();
    const r = call('function f(){ return Date(); }');
    expect(isInvariantViolation(r.error)).toBe(true);
    expect(takeViolations()).toEqual(['Date (reads the clock)']);
    expect(call<number>('function f(){ return Date.UTC(1970, 0, 1); }').value).toBe(0);
  });

  it('shadows Function: new Function(...) in a candidate is a trapped violation', () => {
    takeViolations();
    const r = call('function f(){ return new Function("return 1")(); }');
    expect(isInvariantViolation(r.error)).toBe(true);
    expect(takeViolations()).toEqual(['Function']);
  });

  it('scrubs font, notification and stream APIs from a worker scope', () => {
    const scope: Record<string, unknown> = { FontFace: 1, FontFaceSet: 1, WebSocketStream: 1, Notification: 1, fetch: 1 };
    const removed = scrubWorkerGlobals(scope);
    expect(removed).toEqual(expect.arrayContaining(['FontFace', 'FontFaceSet', 'WebSocketStream', 'Notification', 'fetch']));
    expect(scope.FontFace).toBeUndefined();
  });
});

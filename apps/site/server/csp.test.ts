import { describe, expect, it } from 'vitest';
import { cspMetaHtml, DEV_CSP, PRODUCTION_CSP } from './csp';

const directive = (policy: string, name: string): string[] =>
  policy.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? [];

describe('Content-Security-Policy', () => {
  it('script-src admits only this site (+ eval for the sandbox): no remote hosts, no data:, no blob:', () => {
    for (const policy of [PRODUCTION_CSP, DEV_CSP]) {
      const script = directive(policy, 'script-src');
      expect(script).toContain("'self'");
      expect(script).toContain("'unsafe-eval'");
      expect(script.filter((s) => /:/.test(s) || s === '*')).toEqual([]);
      expect(directive(policy, 'default-src')).toEqual(["'self'"]);
      expect(directive(policy, 'worker-src')).toEqual(["'self'", 'blob:']);
      expect(directive(policy, 'object-src')).toEqual(["'none'"]);
      expect(directive(policy, 'base-uri')).toEqual(["'none'"]);
    }
    expect(directive(PRODUCTION_CSP, 'script-src')).toEqual(["'self'", "'unsafe-eval'"]);
    expect(directive(PRODUCTION_CSP, 'connect-src')).toEqual(["'self'", 'https:']);
    expect(directive(DEV_CSP, 'connect-src').every((s) => s === "'self'" || s === 'https:' || /^(ws|http):\/\/(localhost|127\.0\.0\.1|\[::1\]):\*$/.test(s))).toBe(true);
  });

  it('goes right after <meta charset>, before any script, exactly once', () => {
    const html = '<!doctype html><html><head>\n<meta charset="UTF-8" />\n<script type="module" src="./a.js"></script></head></html>';
    const out = cspMetaHtml(html);
    const at = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(at).toBeGreaterThan(out.indexOf('charset'));
    expect(at).toBeLessThan(out.indexOf('<script'));
    expect(out).toContain(`content="${PRODUCTION_CSP}"`);
    expect(() => cspMetaHtml(out)).toThrow(/already/);
    expect(() => cspMetaHtml('<html></html>')).toThrow(/no <head>/);
  });
});

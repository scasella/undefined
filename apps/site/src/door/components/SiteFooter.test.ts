/** The footer of the landing and the Full view: each page has exactly one contentinfo, and it says only what is true there. */
import { readFileSync } from 'node:fs';
import { Fragment, type VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { LANDING_PRIVACY, SiteFooter, type SiteFooterProps } from './SiteFooter';

interface Flat {
  text: string;
  tags: string[];
  links: Array<{ href: string; text: string }>;
}
function walk(node: unknown, out: Flat): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.text += String(node) + ' ';
    return;
  }
  if (Array.isArray(node)) return node.forEach((n) => walk(n, out));
  const v = node as VNode<Record<string, unknown>>;
  if (typeof v.type === 'function' && v.type !== Fragment) return walk((v.type as (p: unknown) => unknown)(v.props), out);
  if (typeof v.type === 'string') {
    out.tags.push(v.type);
    if (v.type === 'a') {
      const inner: Flat = { text: '', tags: [], links: [] };
      walk(v.props.children, inner);
      out.links.push({ href: String(v.props.href), text: inner.text.trim() });
    }
  }
  walk(v.props.children, out);
}
const render = (p: SiteFooterProps = {}): Flat => {
  const out: Flat = { text: '', tags: [], links: [] };
  walk(SiteFooter(p), out);
  return out;
};

describe('SiteFooter', () => {
  it('is one footer element (the page\'s contentinfo) on the landing and on the Full view', () => {
    expect(render().tags.filter((t) => t === 'footer')).toHaveLength(1);
    expect(render({ page: 'start', privacy: 'x' }).tags.filter((t) => t === 'footer')).toHaveLength(1);
  });

  it('the landing: its own privacy line, the way to the Full view, and the README', () => {
    const r = render();
    expect(r.text).toContain(LANDING_PRIVACY);
    expect(r.links.map((l) => l.href)).toEqual(['#/start', 'https://github.com/scasella/undefined#readme']);
  });

  it('the Full view: the line it is given (where the file is), no link to the page it is on, no second claim, and the README', () => {
    const line = 'Your file stays in this browser. This demo plays back recorded answers and sends nothing.';
    const r = render({ page: 'start', privacy: line });
    expect(r.text).toContain(line);
    expect(r.text).not.toContain(LANDING_PRIVACY);
    expect(r.text).not.toMatch(/Checked, not proven/);
    expect(r.links.map((l) => l.href)).toEqual(['https://github.com/scasella/undefined#readme']);
    expect(r.links.map((l) => l.text)).not.toContain('Full view of the demo');
  });

  it('App renders it for the landing and the Full view, and Step by step keeps its own footer, so no route has two or none', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/page === 'landing' \? <SiteFooter \/> : <SiteFooter page="start" privacy=\{privacyLine\(st\.mode, sendRows\.value\)\} \/>/);
    expect(app).toMatch(/if \(page === 'zen'\) return <Zen /);
    expect(readFileSync(new URL('../zen/Zen.tsx', import.meta.url), 'utf8')).toMatch(/<footer class="zen__foot">/);
  });
});

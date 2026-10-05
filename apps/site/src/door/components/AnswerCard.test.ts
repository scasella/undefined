/** Render smoke test without a DOM: call the components and walk the vnode tree. */
import { describe, expect, it } from 'vitest';
import { Fragment, type VNode } from 'preact';
import { AnswerCard, HELD_CAPTION_START, HELD_CAPTION_WAITING, lockHelpText, type AnswerCardProps } from './AnswerCard';
import { shapeValue } from '../model/answer';
import { assumptionsFromNote } from '../model/assumptions';

interface Flat {
  text: string;
  nodes: Array<{ type: string; props: Record<string, unknown> }>;
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
  if (typeof v.type === 'string') out.nodes.push({ type: v.type, props: v.props });
  walk(v.props.children, out);
}

const render = (p: AnswerCardProps): Flat => {
  const out: Flat = { text: '', nodes: [] };
  walk(AnswerCard(p), out);
  return out;
};

const view = shapeValue(
  [
    { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
    { customer: 'Grommet & Gasket LLC', revenue: 2148.72 },
    { customer: 'Puddlesworth Inc', revenue: 2114.13 },
    { customer: 'Thistlewhump Bakery', revenue: 1909.9 },
    { customer: 'Kettlewhistle Farms', revenue: 1870.33 },
  ],
  { question: 'top customers by revenue', fileName: 'orders.csv', rowCount: 332, revision: 3, callName: 'topCustomersByRevenue' },
);

const base: AnswerCardProps = {
  view, held: false, level: 'full', locked: false, onToggleLock: () => {}, assumptions: assumptionsFromNote('Revenue = quantity × unit price, after discount.'),
  confirmed: new Set(), onConfirm: () => {}, checked: ['your 6 examples'], notChecked: ['whether this was the right question'],
};

describe('AnswerCard', () => {
  it('renders the revealed start card', () => {
    const r = render(base);
    expect(r.text).toContain('PASSED EVERY CHECK');
    expect(r.text).toContain('Chef Ravioli Starbright');
    expect(r.text).toContain('$2,252.07');
    expect(r.text).toContain('Does this look right? Lock this answer');
    expect(r.text).toContain('You checked it; we hold every later version to it.');
    expect(r.nodes.find((n) => n.type === 'ol')!.props['aria-label']).toBe('The rest of the list');
    expect(r.nodes[0]!.props['aria-label']).toBe('Answer: Top 5 customers by revenue');
    expect(r.nodes[0]!.props['aria-busy']).toBe(false);
  });
  it('landing: table caption, calc toggle, locked help', () => {
    const r = render({ ...base, variant: 'landing', locked: true, calc: { open: true, onToggle: () => {}, source: 'function f() {}' } });
    expect(r.text).toContain('Places 2 to 5');
    expect(r.text).toContain('See the calculation');
    expect(r.text).toContain('function f() {}');
    expect(r.text).toContain('Every later version has to give these same 5 rows. Unlock any time.');
  });
  it('basic level and the house rule link', () => {
    const r = render({ ...base, level: 'basic', houseRuleHref: '#asks' });
    expect(r.text).toContain('PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET');
    expect(r.nodes.find((n) => n.type === 'a')!.props.href).toBe('#asks');
  });
  it('held: veil caption, busy, inert content', () => {
    const r = render({ ...base, held: true, heldCaption: HELD_CAPTION_WAITING });
    expect(r.text).toContain(HELD_CAPTION_WAITING);
    expect(r.nodes[0]!.props['aria-busy']).toBe(true);
    expect(r.nodes[0]!.props['aria-label']).toBe('Answer held until every check passes');
    expect(r.nodes.find((n) => n.props.class === 'fd-ac__body')!.props.inert).toBe(true);
  });
  it('null view is held with the start caption', () => {
    const r = render({ ...base, view: null });
    expect(r.text).toContain(HELD_CAPTION_START);
    expect(r.nodes[0]!.props['aria-busy']).toBe(true);
  });
  it('confirmed assumptions and the no-notes line', () => {
    const a = base.assumptions;
    expect(render({ ...base, confirmed: new Set([a.items[0]!.id]) }).text).toContain('Confirmed by you');
    expect(render({ ...base, assumptions: assumptionsFromNote('') }).text).toContain('The AI left no notes about its assumptions.');
  });
  it('lock help variants', () => {
    expect(lockHelpText({ locked: true, variant: 'start', level: 'full', view })).toBe('Every later version has to give this same list.');
    expect(lockHelpText({ locked: true, variant: 'start', level: 'basic', view })).toBe('Locked. The next version runs full checks, starting with this answer.');
  });
});

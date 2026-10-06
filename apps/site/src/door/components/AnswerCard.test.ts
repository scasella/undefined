/** Render smoke test without a DOM: call the components and walk the vnode tree. */
import { describe, expect, it } from 'vitest';
import { Fragment, type VNode } from 'preact';
import { AnswerCard, BASIC_CHECKS, decisiveCaveat, HELD_CAPTION_START, HELD_CAPTION_WAITING, LOCK_HELP_REPLAY, lockHelpText, ringArc, TOTAL_CHECKS, type AnswerCardProps } from './AnswerCard';
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
    // live: the engine holds every later version to the lock, so the sentence is true
    expect(lockHelpText({ locked: true, variant: 'start', level: 'full', view, mode: 'live' })).toBe('Every later version has to give this same list.');
    expect(lockHelpText({ locked: true, variant: 'start', level: 'basic', view, mode: 'live' })).toBe('Locked. The next version runs full checks, starting with this answer.');
    // replay: the demo cannot write a later version, so the promise is about the viewer's computer, not about this page
    const kept = "Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same list.";
    expect(lockHelpText({ locked: true, variant: 'start', level: 'full', view, mode: 'replay' })).toBe(kept);
    expect(lockHelpText({ locked: true, variant: 'start', level: 'basic', view, mode: 'replay' })).toContain("This demo can't re-run with it");
    // not a ranked list: 'answer'
    expect(lockHelpText({ locked: true, variant: 'start', level: 'full', view: null, mode: 'replay' })).toContain('this same answer.');
    expect(lockHelpText({ locked: true, variant: 'start', level: 'full', view: null })).toBe('Every later version has to give this same answer.');
    // the landing's illustration (no mode) is unchanged, and never speaks of a mode
    expect(lockHelpText({ locked: true, variant: 'landing', level: 'full', view })).toBe('Every later version has to give these same 5 rows. Unlock any time.');
  });
  it('the card says the honest lock line in replay and the engine promise live, with or without the lockHelp prop', () => {
    const lockedFull = { ...base, locked: true };
    const kept = "Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same list.";
    expect(render({ ...lockedFull, mode: 'replay' }).text).toContain(kept);
    expect(render({ ...lockedFull, mode: 'replay' }).text).not.toContain('Every later version has to give');
    expect(render({ ...lockedFull, mode: 'replay', lockHelp: kept }).text).toContain(kept);
    expect(render({ ...lockedFull, mode: 'live' }).text).toContain('Every later version has to give this same list.');
    expect(render(lockedFull).text).toContain('Every later version has to give this same list.');
  });
  it('a basic pass is not drawn as the green full pass: a partial ink ring, the words carry the level', () => {
    const eyebrow = (r: Flat) => r.nodes.find((n) => String(n.props.class ?? '').startsWith('fd-ac__eyebrow'))!;
    const full = render(base);
    const basic = render({ ...base, level: 'basic' });
    expect(eyebrow(full).props.class).toBe('fd-ac__eyebrow');
    expect(eyebrow(basic).props.class).toBe('fd-ac__eyebrow fd-ac__eyebrow--basic');
    // full keeps the disc (an svg with a circle) right after the eyebrow, and no ring arcs
    const first = (r: Flat) => r.nodes[r.nodes.indexOf(eyebrow(r)) + 1]!;
    expect(first(full).type).toBe('svg');
    expect(first(full).props.class).not.toBe('fd-ac__ring');
    expect(full.nodes[full.nodes.indexOf(first(full)) + 1]!.type).toBe('circle');
    expect(full.nodes.filter((n) => String(n.props.class ?? '').includes('fd-ac__ring-arc'))).toHaveLength(0);
    // basic: no disc, a ring of TOTAL_CHECKS arcs of which BASIC_CHECKS are solid, hidden from assistive tech
    expect(first(basic).props.class).toBe('fd-ac__ring');
    const arcs = basic.nodes.filter((n) => String(n.props.class ?? '').includes('fd-ac__ring-arc'));
    expect(arcs).toHaveLength(TOTAL_CHECKS);
    expect(arcs.filter((n) => String(n.props.class).includes('--ran'))).toHaveLength(BASIC_CHECKS);
    expect(basic.nodes.find((n) => n.props.class === 'fd-ac__ring')!.props['aria-hidden']).toBe('true');
    expect(basic.text).toContain('PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET');
  });
  it('ringArc draws clockwise from 12 o\'clock, one arc per check', () => {
    expect(ringArc(0, 6, 6.5, 8, 0).startsWith('M 8.00 1.50 A 6.5 6.5 0 0 1 ')).toBe(true);
    const all = [0, 1, 2, 3, 4, 5].map((i) => ringArc(i, 6, 6.5, 8));
    expect(new Set(all).size).toBe(6);
  });
  it('decisiveCaveat is the first not-checked item as given, never invented', () => {
    expect(decisiveCaveat(['whether pending orders should count', 'whether this was the right question'])).toBe('whether pending orders should count');
    expect(decisiveCaveat(['  ', 'whether this was the right question '])).toBe('whether this was the right question');
    expect(decisiveCaveat([])).toBeNull();
  });
  it('shows that one caveat under the lead figure, before the list; nothing when there is none', () => {
    const notChecked = ['whether pending and refunded orders should count (your status column has paid, pending and refunded)', 'whether this was the right question'];
    const r = render({ ...base, notChecked });
    const at = (cls: string) => r.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(at('fd-ac__caveat')).toBeGreaterThan(at('fd-ac__lead-num'));
    expect(at('fd-ac__caveat')).toBeLessThan(r.nodes.findIndex((n) => n.props['aria-label'] === 'The rest of the list'));
    expect(r.text).toContain('Not checked: ');
    expect(r.text).toContain(notChecked[0]!);
    expect(r.nodes.filter((n) => n.props.class === 'fd-ac__caveat fd-ac__ri')).toHaveLength(1);
    expect(render({ ...base, notChecked: [] }).nodes.some((n) => String(n.props.class ?? '').includes('fd-ac__caveat'))).toBe(false);
    // landing variant: under the figure as well
    const landing = render({ ...base, notChecked, variant: 'landing' });
    expect(landing.nodes.some((n) => n.props.class === 'fd-ac__caveat fd-ac__ri')).toBe(true);
  });
  it('lock help: the given text wins, replay never promises a re-run, live and the landing keep their words', () => {
    const given = "Locked. This demo can't re-run with it, so asking again shows this same answer; on your computer the next version is checked against it.";
    expect(render({ ...base, level: 'basic', locked: true, lockHelp: given }).text).toContain(given);
    expect(render({ ...base, level: 'basic', locked: true, lockHelp: '' }).text).toContain('Locked. The next version runs full checks, starting with this answer.');
    // unlocked: replay says what really happens; live and the landing (no mode) keep the engine's promise
    const unlocked = (mode?: 'live' | 'replay') => lockHelpText({ locked: false, variant: 'start', level: 'basic', view, ...(mode ? { mode } : {}) });
    expect(unlocked('replay')).toBe(LOCK_HELP_REPLAY);
    expect(LOCK_HELP_REPLAY).toContain("can't re-run");
    expect(LOCK_HELP_REPLAY).not.toContain('hold every later version');
    expect(unlocked('live')).toBe('You checked it; we hold every later version to it.');
    expect(unlocked()).toBe('You checked it; we hold every later version to it.');
    expect(render({ ...base, mode: 'replay' }).text).toContain(LOCK_HELP_REPLAY);
    expect(render({ ...base, mode: 'live' }).text).toContain('You checked it; we hold every later version to it.');
    expect(render({ ...base, variant: 'landing' }).text).toContain('You checked it; we hold every later version to it.');
  });
});

/** Render smoke test without a DOM: call the components and walk the vnode tree. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Fragment, h, type VNode } from 'preact';
import { AnswerCard, BASIC_CHECKS, CONFIRM_NOTE, decisiveCaveat, HELD_CAPTION_START, HELD_CAPTION_WAITING, LOCK_HELP_REPLAY, lockHelpText, ringArc, TOTAL_CHECKS, type AnswerCardProps } from './AnswerCard';
import { shapeValue } from '../model/answer';
import { illustrativeAgreement, SEEDED_LOCK_NOTE } from '../model/agreement';
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
    // the ranked list says which places it shows, once, in the shared label over it, and that is also its name
    expect(r.nodes.find((n) => n.type === 'ol')!.props['aria-label']).toBe('Places 2 to 5');
    const places = r.nodes.find((n) => String(n.props.class ?? '').split(' ').includes('fd-ac__places'))!;
    expect(places.props.class).toBe('fd-label-line fd-ac__places fd-ac__ri');
    expect(places.props.children).toBe('Places 2 to 5');
    expect(r.nodes.indexOf(places)).toBe(r.nodes.findIndex((n) => n.type === 'ol') - 1);
    // said once to a screen reader (the list's name), and it rises in with the rows, just ahead of the first one, not after them
    expect(places.props['aria-hidden']).toBe('true');
    const delay = (n: { props: Record<string, unknown> }): number => Number(/--fd-ri:([\d.]+)s/.exec(String(n.props.style))?.[1]);
    const firstRow = r.nodes.find((n) => String(n.props.class ?? '').split(' ').includes('fd-ac__row'))!;
    expect(delay(places)).toBeLessThan(delay(firstRow));
    expect(delay(places)).toBeGreaterThan(0);
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
  it('landing, held: the card is the compact variant, its body stays in the DOM (inert, aria-hidden) and the veil still carries the caption', () => {
    const r = render({ ...base, variant: 'landing', held: true, heldCaption: HELD_CAPTION_WAITING });
    expect(String(r.nodes[0]!.props.class)).toMatch(/\bfd-ac--landing\b.*\bfd-ac--held\b|\bfd-ac--held\b.*\bfd-ac--landing\b/);
    const body = r.nodes.find((n) => n.props.class === 'fd-ac__body')!;
    expect(body.props.inert).toBe(true);
    expect(body.props['aria-hidden']).toBe(true);
    expect(r.text).toContain('Chef Ravioli Starbright'); // in the DOM, so releasing it needs no new render of its content
    expect(r.text).toContain(HELD_CAPTION_WAITING);
    // released: the same card is not held, and the reveal keys it to the run
    const shown = render({ ...base, variant: 'landing', held: false });
    expect(String(shown.nodes[0]!.props.class)).toContain('fd-ac--shown');
    expect(String(shown.nodes[0]!.props.class)).not.toContain('fd-ac--held');
    expect(shown.nodes.find((n) => n.props.class === 'fd-ac__body')!.props.inert).toBe(false);
  });
  it('landing held CSS: five bars and the caption set the height (the veil in flow), the body is out of layout, the first-run card is not touched', () => {
    const css = readFileSync(new URL('./AnswerCard.css', import.meta.url), 'utf8');
    const rule = (sel: string): string => new RegExp(`${sel.replace(/[.\\[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.fd-ac--landing.fd-ac--held .fd-ac__body')).toMatch(/display:\s*none/); // out of layout and out of the accessibility tree, still in the DOM
    expect(rule('.fd-ac--landing.fd-ac--held .fd-ac__veil')).toMatch(/position:\s*relative/);
    expect(rule('.fd-ac--landing.fd-ac--held')).toMatch(/padding:\s*0/);
    // nothing of this applies to the first-run pages' held card (variant start): every compact rule is scoped to the landing
    const compact = css.split('\n').filter((l) => /fd-ac--held[^{]*\.fd-ac__(body|veil)\s*\{[^}]*(display:\s*none|position:\s*relative)/.test(l));
    expect(compact.length).toBeGreaterThanOrEqual(2);
    for (const l of compact) expect(l).toMatch(/^\.fd-ac--landing\.fd-ac--held /);
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
  it('says the verdict under the lead figure, before the list, in body text with no icon, and the decisive caveat only there (not as a second "Not checked:" line)', () => {
    const notChecked = ['whether pending and refunded orders should count (your status column has paid, pending and refunded)', 'whether this was the right question'];
    const r = render({ ...base, notChecked, stress: { kind: 'done', total: 12, caught: 8, missed: 4 }, seal: { text: 'Passed every check · stress test caught 8 of 12', ran: 5, of: 6, complete: true } });
    const at = (cls: string) => r.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(at('fd-ac__verdict')).toBeGreaterThan(at('fd-ac__lead-num'));
    expect(at('fd-ac__verdict')).toBeLessThan(r.nodes.findIndex((n) => n.props['aria-label'] === 'Places 2 to 5'));
    const verdict = r.nodes.filter((n) => n.props.class === 'fd-ac__verdict fd-ac__ri');
    expect(verdict).toHaveLength(1);
    // plain text, no icon beside it (the seal already has one)
    expect(typeof verdict[0]!.props.children).toBe('string');
    expect(verdict[0]!.props.children).toBe(
      'Passed every check, though the stress test caught 8 of 12 deliberate breaks. Not checked: whether pending and refunded orders should count.',
    );
    // the old standalone line is gone: "Not checked:" with a colon is said once, inside the verdict
    expect(r.nodes.some((n) => String(n.props.class ?? '').includes('fd-ac__caveat'))).toBe(false);
    expect(r.text.match(/Not checked:/g)).toHaveLength(1);
    // the ledger below stays
    expect(r.text).toContain('Not checked');
    expect(r.nodes.some((n) => String(n.props.class ?? '').includes('fd-ac__not-checked'))).toBe(true);
    // landing variant: under the figure as well; no list: the line is just how the checks went
    expect(render({ ...base, notChecked, variant: 'landing' }).nodes.some((n) => n.props.class === 'fd-ac__verdict fd-ac__ri')).toBe(true);
    expect(render({ ...base, notChecked: [] }).nodes.find((n) => n.props.class === 'fd-ac__verdict fd-ac__ri')!.props.children).toBe('Passed every check.');
  });
  it('an answer with no lead figure (a table) still gets the verdict, under the seal', () => {
    const table = shapeValue([{ a: 1, b: 'x', c: true }], { question: 'q', fileName: 'f.csv', rowCount: 1, revision: 2, callName: 'f' });
    const r = render({ ...base, view: table });
    const at = (cls: string) => r.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(at('fd-ac__lead-num')).toBe(-1);
    expect(at('fd-ac__verdict')).toBeGreaterThan(at('fd-ac__eyebrow'));
  });
  it('says each way the checks can end in the verdict, not only the green one', () => {
    const verdictOf = (p: Partial<AnswerCardProps>): string => String(render({ ...base, ...p }).nodes.find((n) => n.props.class === 'fd-ac__verdict fd-ac__ri')!.props.children);
    expect(verdictOf({ level: 'basic' })).toMatch(/^Only the 2 basic checks ran, so nothing has tested the number yet\./);
    expect(verdictOf({ stress: { kind: 'not-run' }, seal: { text: "Passed 5 of 6 checks · stress test didn't run", ran: 5, of: 6, complete: false } })).toMatch(/^Passed 5 of 6 checks, though the stress test didn't run\./);
    expect(verdictOf({ stress: { kind: 'partial', total: 7, caught: 5, missed: 2, planned: 12 }, seal: { text: 'Passed 5 of 6 checks · stress test ran out of time', ran: 5, of: 6, complete: false } })).toMatch(/^Passed 5 of 6 checks, though the stress test ran out of time\./);
  });
  it('names the hand-off as the next step only when the card has it (the landing illustration has none)', () => {
    const verdictOf = (p: Partial<AnswerCardProps>): string => String(render({ ...base, ...p }).nodes.find((n) => n.props.class === 'fd-ac__verdict fd-ac__ri')!.props.children);
    expect(verdictOf({})).not.toMatch(/data team/);
    expect(verdictOf({ primaryAction: h('button', { class: 'fd-btn fd-btn--primary' }, 'Hand this to your data team (download)') })).toContain('hand the calculation to your data team');
  });
  it('the hand-off is the first control of the action row, before the lock; the lock, the calculation and the house rule stay', () => {
    const handoff = h('button', { class: 'fd-btn fd-btn--primary', id: 'handoff' }, 'Hand this to your data team (download)');
    const r = render({ ...base, primaryAction: handoff, houseRuleHref: '#/#asks', calc: { open: false, onToggle: () => {}, source: 'x' } });
    const at = (pred: (n: Flat['nodes'][number]) => boolean) => r.nodes.findIndex(pred);
    const actions = at((n) => n.props.class === 'fd-ac__actions');
    const primary = at((n) => n.props.id === 'handoff');
    const lock = at((n) => String(n.props.class ?? '').split(' ').includes('fd-ac__lock'));
    expect(actions).toBeGreaterThan(-1);
    expect(primary).toBe(actions + 1);
    expect(lock).toBeGreaterThan(primary);
    expect(at((n) => n.props.class === 'fd-ac__calc-toggle')).toBeGreaterThan(lock);
    expect(at((n) => n.props.class === 'fd-ac__rule-link')).toBeGreaterThan(lock);
    expect(r.text).toContain('Hand this to your data team (download)');
    // nothing given: no slot content, and the row starts with the lock as before
    const none = render(base);
    expect(none.nodes.some((n) => n.props.id === 'handoff')).toBe(false);
    expect(none.nodes[none.nodes.findIndex((n) => n.props.class === 'fd-ac__actions') + 1]!.props.class).toContain('fd-ac__lock');
  });
  it('the lock is a quiet ring on a card that has the hand-off and keeps its fill on one that does not, so the card has exactly one filled control', () => {
    const css = readFileSync(new URL('./AnswerCard.css', import.meta.url), 'utf8');
    const rule = (sel: string): string => new RegExp(`(?:^|\\n)${sel.replace(/[.\\[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    // no hand-off (the landing's illustration; a start card whose hand-off is not on offer): the lock is the filled indigo button, as it was
    expect(rule('.fd-ac__lock')).toMatch(/background:\s*var\(--fd-indigo\)/);
    // the hand-off is in the card: same class, no fill, a ring
    const quiet = rule('.fd-ac--handoff .fd-ac__lock');
    expect(quiet).toMatch(/background:\s*var\(--fd-surface\)/);
    expect(quiet).not.toMatch(/background:\s*var\(--fd-indigo\)/);
    expect(quiet).toMatch(/box-shadow:\s*var\(--fd-sh-ring-2\)/);
    expect(rule('.fd-ac--handoff .fd-ac__lock--on, .fd-ac--handoff .fd-ac__lock--on:hover')).not.toMatch(/background:\s*var\(--fd-indigo/);
    // the quiet look follows the slot, not the page's variant: no rule quiets the lock for every start card
    expect(css).not.toMatch(/\.fd-ac--start\s+\.fd-ac__lock/);
  });
  it('the card takes fd-ac--handoff exactly when the hand-off is in its slot, on the start variant and the landing alike', () => {
    const handoff = h('button', { class: 'fd-btn fd-btn--primary' }, 'Hand this to your data team (download)');
    const classOf = (p: Partial<AnswerCardProps>): string => String(render({ ...base, ...p }).nodes[0]!.props.class);
    expect(classOf({ variant: 'start', primaryAction: handoff })).toContain('fd-ac--handoff');
    expect(classOf({ variant: 'start' })).not.toContain('fd-ac--handoff');
    expect(classOf({ variant: 'start', primaryAction: null })).not.toContain('fd-ac--handoff');
    expect(classOf({ variant: 'landing' })).not.toContain('fd-ac--handoff');
    expect(classOf({ variant: 'start', primaryAction: handoff })).toContain('fd-ac--start');
    // the 480px full-width rule for the lock is scoped the same way
    const css = readFileSync(new URL('./AnswerCard.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.fd-ac__actions > \.fd-btn, \.fd-ac--handoff \.fd-ac__lock \{ flex: 1 1 100%/);
  });
  it('the landing rail\'s Confirm says the same thing the card beside it says: on this page only, with no date as if it were recorded', () => {
    const meta = illustrativeAgreement().assumption!.confirmedMeta;
    // was "Confirmed by you · 5 Oct 2026": a typed date for a click made now, next to a card saying nothing is saved
    expect(meta).toBe('Confirmed by you · on this page only');
    expect(meta).not.toMatch(/\d/);
    expect(CONFIRM_NOTE).toContain('on this page');
    expect(meta).toContain(CONFIRM_NOTE.match(/on this page/)![0]);
  });
  it('"Confirm" is explained once, under the heading: it marks a line on this page, nothing is saved, sent or checked', () => {
    expect(CONFIRM_NOTE).toBe('Confirming only marks a line on this page; nothing is saved, sent or checked.');
    const r = render(base);
    const at = (cls: string) => r.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(r.text.split(CONFIRM_NOTE)).toHaveLength(2);
    expect(at('fd-ac__assumed-note')).toBeGreaterThan(at('fd-ac__assumed'));
    expect(at('fd-ac__assumed-note')).toBeLessThan(at('fd-ac__assumed-list'));
    // the line only exists where there is something to confirm
    expect(render({ ...base, assumptions: assumptionsFromNote('') }).text).not.toContain(CONFIRM_NOTE);
    // and it says no more than that: no claim that it is kept, sent, shared or part of the download
    expect(CONFIRM_NOTE).not.toMatch(/\b(shared with|part of the download|recorded for)\b/);
  });
  it('"Version N" is explained in a second caption line only when a note is given', () => {
    const note = "Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.";
    const r = render({ ...base, versionNote: note });
    const at = (cls: string) => r.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(r.text).toContain(note);
    expect(at('fd-ac__version')).toBe(at('fd-ac__fig') + 1);
    expect(at('fd-ac__version')).toBeLessThan(at('fd-ac__eyebrow'));
    expect(render(base).nodes.some((n) => n.props.class === 'fd-ac__version')).toBe(false);
  });
  it('the lock note and the lock help are one note under the row, the note first and only while locked', () => {
    const r = render({ ...base, locked: true, lockNote: SEEDED_LOCK_NOTE });
    const at = (cls: string) => r.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(at('fd-ac__lock-info')).toBeGreaterThan(at('fd-ac__actions'));
    expect(at('fd-ac__lock-note')).toBe(at('fd-ac__lock-info') + 1);
    expect(at('fd-ac__help')).toBe(at('fd-ac__lock-note') + 1);
    // unlocked: just the help
    const open = render({ ...base, locked: false, lockNote: 'x' });
    expect(open.nodes.some((n) => n.props.class === 'fd-ac__lock-note')).toBe(false);
    expect(open.nodes.some((n) => n.props.class === 'fd-ac__help')).toBe(true);
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
  describe('the seal says what the stress test came to', () => {
    const eyebrow = (r: Flat) => r.nodes.find((n) => String(n.props.class ?? '').startsWith('fd-ac__eyebrow'))!;
    const arcs = (r: Flat) => r.nodes.filter((n) => String(n.props.class ?? '').includes('fd-ac__ring-arc'));
    it('finished: the green disc and "Passed every check · stress test caught N of M" in capitals', () => {
      const r = render({ ...base, seal: { text: 'Passed every check · stress test caught 11 of 12', ran: 5, of: 6, complete: true } });
      expect(r.text).toContain('PASSED EVERY CHECK · STRESS TEST CAUGHT 11 OF 12');
      expect(eyebrow(r).props.class).toBe('fd-ac__eyebrow');
      expect(arcs(r)).toHaveLength(0);
    });
    it('not finished: never green, never "every check": a ring of the checks that apply, the ran ones solid', () => {
      const r = render({ ...base, seal: { text: "Passed 5 of 6 checks · stress test didn't run", ran: 5, of: 6, complete: false } });
      expect(r.text).toContain("PASSED 5 OF 6 CHECKS · STRESS TEST DIDN'T RUN");
      expect(r.text).not.toMatch(/EVERY CHECK/);
      expect(eyebrow(r).props.class).toBe('fd-ac__eyebrow fd-ac__eyebrow--basic');
      expect(arcs(r)).toHaveLength(6);
      expect(arcs(r).filter((n) => String(n.props.class).includes('--ran'))).toHaveLength(5);
      // fewer checks apply: the ring follows
      expect(arcs(render({ ...base, seal: { text: 'x', ran: 3, of: 4, complete: false } }))).toHaveLength(4);
    });
    it('no seal given: the level\'s own words, as before; basic ignores a seal', () => {
      expect(render(base).text).toContain('PASSED EVERY CHECK');
      expect(render({ ...base, level: 'basic', seal: null }).text).toContain('PASSED 2 BASIC CHECKS · NOTHING ELSE CHECKED YET');
      expect(render({ ...base, level: 'basic', seal: { text: 'Passed every check', ran: 5, of: 6, complete: true } }).text).toContain('PASSED 2 BASIC CHECKS');
    });
  });

  it('Checked against: the amber diamond (not the green disc) for a line that missed or did not finish', () => {
    const items = ['your 6 examples', 'stress test (caught 8 of 12 deliberate breaks)'];
    const marked = render({ ...base, checked: items, checkedAsk: ['stress test (caught 8 of 12 deliberate breaks)'] });
    const plain = render({ ...base, checked: items, checkedAsk: [] });
    const none = render({ ...base, checked: items });
    // the diamond carries its own "?" (an svg <text>), the disc is a circle: one more of the first, one fewer of the second
    const count = (r: Flat, type: string) => r.nodes.filter((n) => n.type === type).length;
    expect(count(marked, 'text')).toBe(count(plain, 'text') + 1);
    expect(count(marked, 'circle')).toBe(count(plain, 'circle') - 1);
    expect(count(none, 'text')).toBe(count(plain, 'text'));
    expect(marked.text).toContain('stress test (caught 8 of 12 deliberate breaks)');
  });

  it('a lock that came with the demo file says so next to the Locked button, only when locked', () => {
    const note = SEEDED_LOCK_NOTE;
    const r = render({ ...base, locked: true, lockNote: note });
    expect(r.text).toContain(note);
    const at = (flat: Flat, cls: string) => flat.nodes.findIndex((n) => String(n.props.class ?? '').split(' ').includes(cls));
    expect(at(r, 'fd-ac__lock-note')).toBeGreaterThan(at(r, 'fd-ac__lock'));
    expect(at(r, 'fd-ac__lock-note')).toBeLessThan(at(r, 'fd-ac__help'));
    expect(render({ ...base, locked: false, lockNote: note }).text).not.toContain(note);
    expect(render({ ...base, locked: true }).text).not.toContain(note);
    expect(render({ ...base, locked: true, lockNote: '' }).nodes.some((n) => String(n.props.class ?? '').includes('fd-ac__lock-note'))).toBe(false);
  });

  it('"Confirm" says what it confirms to assistive tech, without changing what it shows', () => {
    const r = render(base);
    const btn = r.nodes.find((n) => n.type === 'button' && n.props.class === 'fd-ac__confirm')!;
    expect(btn.props['aria-label']).toBe('Confirm this assumption: Revenue = quantity × unit price, after discount.');
    expect(String(btn.props['aria-label'])).toContain('Confirm');
    expect(btn.props.children).toBe('Confirm');
  });
});

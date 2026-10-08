import { signal } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followRun } from './Start';
import type { Session } from './session';

/** A stand-in for the page: elements with a rect, and the calls the follower makes on them. */
function fakeEl(rect: { top: number; bottom: number }) {
  const attrs = new Map<string, string>();
  return {
    rect,
    scrolled: [] as unknown[],
    focused: [] as unknown[],
    getBoundingClientRect: () => ({ ...rect, height: rect.bottom - rect.top }),
    scrollIntoView(o: unknown) {
      this.scrolled.push(o);
    },
    focus(o: unknown) {
      this.focused.push(o);
    },
    hasAttribute: (k: string) => attrs.has(k),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    attrs,
  };
}

const answer = (shown: boolean) => ({ held: !shown, view: shown ? {} : null });

function setup(opts: { reduced?: boolean; trace?: { top: number; bottom: number }; figure?: { top: number; bottom: number } } = {}) {
  const trace = fakeEl(opts.trace ?? { top: 560, bottom: 1000 });
  const card = fakeEl({ top: 1010, bottom: 1900 });
  const figure = fakeEl(opts.figure ?? { top: 1140, bottom: 1200 });
  const region = {
    querySelector: (sel: string) => (sel === '.fd-trace' ? trace : sel === '.fd-ac' ? card : sel === '.fd-ac__lead-num' ? figure : null),
  };
  const run = signal<{ id: number } | null>(null);
  const ans = signal(answer(false));
  const session = { run, answer: ans } as unknown as Session;
  const frames: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('window', { innerHeight: 900, matchMedia: () => ({ matches: !!opts.reduced }) });
  vi.stubGlobal('document', { querySelector: () => ({ getBoundingClientRect: () => ({ height: 40 }) }) });
  const stop = followRun(session, () => region as unknown as HTMLElement);
  const flush = () => frames.splice(0).forEach((f) => f());
  return { trace, card, figure, run, ans, stop, flush };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('followRun', () => {
  it('scrolls the trace to the top and focuses it when a run begins', () => {
    const t = setup();
    t.run.value = { id: 1 };
    t.flush();
    expect(t.trace.scrolled).toEqual([{ behavior: 'smooth', block: 'start' }]);
    expect(t.trace.focused).toEqual([{ preventScroll: true }]);
    // a place focus can go: a labelled region that takes tabindex -1
    expect(t.trace.attrs.get('tabindex')).toBe('-1');
    expect(t.trace.attrs.get('role')).toBe('region');
    expect(t.trace.attrs.get('aria-label')).toBe('The checks');
    t.stop();
  });

  it('moves instantly when the viewer asks for reduced motion', () => {
    const t = setup({ reduced: true });
    t.run.value = { id: 1 };
    t.flush();
    expect(t.trace.scrolled).toEqual([{ behavior: 'instant', block: 'start' }]);
    t.stop();
  });

  it('does not scroll when the whole trace is already on screen, but still focuses it', () => {
    const t = setup({ trace: { top: 100, bottom: 500 } });
    t.run.value = { id: 1 };
    t.flush();
    expect(t.trace.scrolled).toEqual([]);
    expect(t.trace.focused).toHaveLength(1);
    t.stop();
  });

  it('acts once per run, not once per change to the run (pending flips, same id)', () => {
    const t = setup();
    t.run.value = { id: 1 };
    t.flush();
    t.run.value = { id: 1 };
    t.flush();
    expect(t.trace.focused).toHaveLength(1);
    t.run.value = { id: 2 };
    t.flush();
    expect(t.trace.focused).toHaveLength(2);
    t.stop();
  });

  it('does nothing when a question is selected (the run is cleared)', () => {
    const t = setup();
    t.run.value = { id: 1 };
    t.flush();
    t.run.value = null;
    t.flush();
    expect(t.trace.focused).toHaveLength(1);
    t.stop();
  });

  it('brings the answer into view when it is shown, if its figure is off screen', () => {
    const t = setup();
    t.run.value = { id: 1 };
    t.flush();
    t.ans.value = answer(true);
    t.flush();
    expect(t.card.scrolled).toEqual([{ behavior: 'smooth', block: 'start' }]);
    t.stop();
  });

  it('leaves the page where it is when the figure is already on screen', () => {
    const t = setup({ figure: { top: 600, bottom: 660 } });
    t.run.value = { id: 1 };
    t.flush();
    t.ans.value = answer(true);
    t.flush();
    expect(t.card.scrolled).toEqual([]);
    t.stop();
  });

  it('a cached answer, shown at once, scrolls to the answer only', () => {
    const t = setup();
    t.run.value = { id: 1 };
    t.ans.value = answer(true);
    t.flush();
    expect(t.trace.scrolled).toEqual([]);
    expect(t.card.scrolled).toHaveLength(1);
    t.stop();
  });

  it('never acts on a run or an answer that was there when it started', () => {
    const trace = fakeEl({ top: 560, bottom: 1000 });
    const run = signal<{ id: number } | null>({ id: 3 });
    const ans = signal(answer(true));
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('window', { innerHeight: 900, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('document', { querySelector: () => null });
    const stop = followRun({ run, answer: ans } as unknown as Session, () => ({ querySelector: () => trace }) as unknown as HTMLElement);
    expect(frames).toHaveLength(0);
    // a later run does
    run.value = { id: 4 };
    ans.value = answer(false);
    expect(frames).toHaveLength(1);
    stop();
  });

  it('a second answer on a later run is brought into view again', () => {
    const t = setup();
    t.run.value = { id: 1 };
    t.ans.value = answer(true);
    t.flush();
    t.run.value = { id: 2 };
    t.ans.value = answer(false);
    t.flush();
    t.ans.value = answer(true);
    t.flush();
    expect(t.card.scrolled).toHaveLength(2);
    t.stop();
  });

  it('stops following, and cancels a frame still waiting, when it is stopped', () => {
    const t = setup();
    t.stop();
    t.run.value = { id: 1 };
    t.flush();
    expect(t.trace.focused).toEqual([]);
  });
});

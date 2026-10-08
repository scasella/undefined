import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { draftingView } from '../start/RunPanel';
import { Fragment, type VNode } from 'preact';
import { CellMark, noteValueClass } from './CheckTrace';
import { SCRIPT_GHOST_NOTE } from '../model/traceScript';

const css = readFileSync(new URL('./CheckTrace.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('./CheckTrace.tsx', import.meta.url), 'utf8');

const block = (re: RegExp): string => re.exec(css)?.[1] ?? '';

describe('the drafting mark (CheckTrace.css): indeterminate, compositor-only, calm under reduced motion', () => {
  const frames = block(/@keyframes tpen \{([^@]*?)\}\s*\.fd-trace__pen/s);
  it('animates transform and opacity only, never a layout property', () => {
    expect(frames).not.toBe('');
    const props = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(props)).toEqual(new Set(['opacity', 'transform']));
    // and nothing of the mark's own rules animates anything else
    const rules = css.split('\n').filter((l) => l.includes('.fd-trace__pen') && l.includes('animation'));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/transition/);
  });
  it('loops slowly and eases in and out (1.4 to 2 s)', () => {
    const m = /animation: tpen ([\d.]+)s ease-in-out infinite/.exec(css);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1.4);
    expect(Number(m![1])).toBeLessThanOrEqual(2);
  });
  it('is a static, legible mark when animation is off: every tick has a resting opacity and no resting transform', () => {
    for (const n of [1, 2, 3]) expect(css).toMatch(new RegExp(`\\.fd-trace__pen > span:nth-child\\(${n}\\) \\{ opacity: [\\d.]+; \\}`));
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.fd-trace \*[^}]*animation: none !important/);
  });
  it('uses the trace\'s own tokens only (no literal colour)', () => {
    const pen = css.split('\n').filter((l) => l.includes('.fd-trace__pen')).join('\n');
    expect(pen).toMatch(/var\(--tr-pen\)/);
    expect(pen).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  it('is decoration: hidden from assistive tech, shown only in the live feed while the AI is drafting', () => {
    expect(tsx).toMatch(/<span aria-hidden="true" class="fd-trace__pen">/);
    expect(tsx).toMatch(/const drafting = !script && !!p\.drafting && !!h\.running && !h\.stress;/);
  });
});

describe('the drafting mark sits in the footer: the header is exactly what it was before the mark existed', () => {
  const headerJsx = tsx.slice(tsx.indexOf('<div class="fd-trace__head'), tsx.indexOf('{ghosts.map'));
  const footJsx = tsx.slice(tsx.indexOf('<div class="fd-trace__foot">'), tsx.indexOf('aria-live="polite"'));
  it('the header has no mark, no drafting class and nothing after the counter\'s words (the counter is as it was)', () => {
    expect(headerJsx).not.toBe('');
    expect(headerJsx).toContain('<div class="fd-trace__head fd-trace__mono">');
    expect(headerJsx).not.toMatch(/drafting|fd-trace__pen/);
    expect(headerJsx).toMatch(/\{script \? 'checking…' : h\.stress \? h\.right : \(p\.runningText \?\? 'checking…'\)\}\s*<\/span>/);
  });
  it('the mark is rendered inside the footer\'s meta label ("drafting · checks start next"), after the label\'s words', () => {
    expect(footJsx).not.toBe('');
    expect(footJsx).toMatch(
      /<span class=\{`fd-trace__foot-meta fd-trace__mono\$\{drafting \? ' fd-trace__foot-meta--drafting' : ''\}`\}>\s*\{p\.footer\.meta\}\s*\{drafting && \(\s*<span aria-hidden="true" class="fd-trace__pen">/,
    );
  });
  it('sits under the label, in a column as wide as the label: the footer\'s text keeps all its room and the label stays where it is', () => {
    const rule = /\.fd-trace__foot-meta--drafting \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/display: flex/);
    expect(rule).toMatch(/flex-direction: column/);
    expect(rule).toMatch(/align-items: flex-start/);
    expect(css).toMatch(/\.fd-trace__pen > span \{ width: 6px; height: 12px;/);
    // the mark itself is a plain flex row of ticks: no inline-box tricks (vertical-align) and no margin that would widen the cell
    const pen = /\.fd-trace__pen \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(pen).toMatch(/display: inline-flex/);
    expect(pen).not.toMatch(/vertical-align|margin/);
    // the footer row itself is the one it was
    expect(css).toMatch(/\.fd-trace__foot-text \{[^}]*flex: 1 1 360px/);
  });
  it('goes beside the label instead where the label has dropped under the text, at the width the footer\'s own arithmetic gives (text basis + gap + the label, so the row gains no height)', () => {
    const basis = Number(/\.fd-trace__foot-text \{[^}]*flex: 1 1 (\d+)px/.exec(css)?.[1]);
    const gap = Number(/\.fd-trace__foot \{[^}]*gap: \d+px (\d+)px/.exec(css)?.[1]);
    // the label is the same words in both modes, set in 12px Geist Mono (0.6em advance per character)
    const labels = (['replay', 'live'] as const).map((mode) => draftingView({ phase: 'generating', mode, kind: 'grow', attempt: 1 })!.footer.meta);
    expect(new Set(labels).size).toBe(1);
    const sideBySide = basis + gap + labels[0]!.length * 12 * 0.6;
    const q = /@container fd-trace \(width < ([\d.]+)px\) \{\s*\.fd-trace__foot-meta--drafting \{([^}]*)\}\s*\}/.exec(css);
    expect(q).not.toBeNull();
    // the sum itself (585.6), not rounded up to 586: a trace 585.9px wide (a 689px window) fits the label beside the text and must not be
    // called narrow. It may exceed the arithmetic by a hair of layout rounding (the label measures 201.609px, not 201.6), never by a pixel.
    expect(Number(q![1])).toBeGreaterThanOrEqual(sideBySide);
    expect(Number(q![1])).toBeLessThan(sideBySide + 0.05);
    expect(Number.isInteger(Number(q![1]))).toBe(false);
    expect(q![2]).toMatch(/flex-direction: row/);
    expect(q![2]).toMatch(/align-items: center/);
  });
  it('the mark adds no header-side rule of its own: no drafting head class, no drafting-only container rule, no balanced counter', () => {
    expect(css).not.toMatch(/head--drafting/);
    expect(css).not.toMatch(/@container fd-trace \(max-width: 599px\)/);
    expect(css).not.toMatch(/text-wrap:\s*balance/);
    // the timer is the unshrinkable column it always was, wherever it sits
    expect(css).toMatch(/\.fd-trace__timer \{ display: grid; justify-items: end; flex: none; \}/);
    expect(css).not.toMatch(/\.fd-trace__timer[^{]*\{[^}]*(?:min-width|max-width|flex: 0 1)/);
  });
});

// Rewritten from "the header's only wrap rule is the phones' media query" (and "no flex-wrap on the header"): that pinned the squeeze this
// pins the fix for. The header now wraps for every state of the trace alike, by what fits, not by the viewport.
describe('the header: the counter wraps under the title when they do not fit side by side, so the title is never squeezed', () => {
  const head = /\.fd-trace__head \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const title = /\.fd-trace__hl \{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('is a wrapping flex row with a row gap, for every state of the trace (no media query decides the wrap; the phones\' block only trims tracking)', () => {
    expect(head).toMatch(/display: flex/);
    expect(head).toMatch(/flex-wrap: wrap/);
    expect(head).toMatch(/gap: 4px 16px/);
    const phones = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(/\.fd-trace__head \{([^}]*)\}/.exec(phones)?.[1]?.trim()).toBe('letter-spacing: 0;');
  });

  it('the title keeps 340px beside the counter or takes the line: it may grow and shrink, but it asks for 340px to sit beside it', () => {
    expect(title).toMatch(/flex: 1 1 340px/);
    expect(title).toMatch(/min-width: 0/);
  });

  it('340px holds the longest title of the product\'s own questions on two lines (12px mono, 0.6em + 0.01em tracking per character)', () => {
    // CHECK TRACE · DRAFT 1 · {question} · {file} · {rows} rows: the second line is at most the question's last words, the file and the rows
    const perChar = 12 * 0.61;
    const secondLine = 'customers by revenue? · orders.csv · 332 rows'.length * perChar;
    expect(secondLine).toBeLessThanOrEqual(340);
  });

  it('the counter\'s side is one width for every word it can hold: under the title, at its left, wherever the WIDEST quiet or running counter does not fit beside it', () => {
    // the words come from the source: every `right: '…'` of model/lanes.ts headerFor (the stress test\'s two are one ternary)
    const lanes = readFileSync(new URL('../model/lanes.ts', import.meta.url), 'utf8');
    const words = [...lanes.matchAll(/right: '([^']+)'/g)].map((m) => m[1]!);
    words.push(...(/right: stress\.phase === 'running' \? '([^']+)' : '([^']+)'/.exec(lanes)?.slice(1) ?? []));
    expect(words).toEqual(expect.arrayContaining(['waiting for your question', 'checking…', 'paused · waiting on you', 'nothing checked', 'stress test running…', 'stress test next…']));
    const widest = Math.max(...words.map((w) => [...w].length));
    expect(widest).toBe('waiting for your question'.length);
    // beside the title it needs the title\'s 340px, the 16px gap and the counter (12px mono, 0.6em + 0.01em tracking a character)
    const needs = Math.round((340 + 16 + widest * 12 * 0.61) * 100) / 100;
    const q = /@container fd-trace \(width < ([\d.]+)px\) \{\s*\.fd-trace__timer \{ flex-basis: 100%; justify-items: start; \}\s*\}/.exec(css);
    expect(q).not.toBeNull();
    expect(Number(q![1])).toBe(needs);
    // the old rule moved only the short "checking…" counter, so a run hopped between the two sides (21px of header each time) at 420 to 540px
    expect(css).not.toMatch(/@container fd-trace \(max-width: 421px\)/);
  });
});

describe('phones: the 85-character title of a drafting trace holds two lines at 390px', () => {
  const base = /\.fd-trace \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const phones = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const pad = (body: string): number => Number(/--fd-trace-pad: (\d+)px/.exec(body)?.[1]);

  it('the trace pads from one variable (the seal runs between the same edges), 24px, and 16px on phones', () => {
    expect(base).toMatch(/padding: var\(--fd-trace-pad\)/);
    expect(pad(base)).toBe(24);
    expect(pad(phones)).toBe(16);
    expect(/\.fd-trace__seal \{([^}]*)\}/.exec(css)?.[1]).toMatch(/left: var\(--fd-trace-pad\); right: var\(--fd-trace-pad\)/);
  });

  it('with that padding and no tracking the longer line fits a 390px phone, and neither change alone is enough', () => {
    const line = 'customers by revenue? · orders.csv · 332 rows'.length; // the longer of the two lines the title breaks into
    const gutter = 16; // clamp(16px, 4vw, 48px) at 390px
    const track = /letter-spacing: ([\d.]+)(em)?/.exec(/\.fd-trace__head \{([^}]*)\}/.exec(phones)?.[1] ?? '');
    expect(track).not.toBeNull();
    const perChar = 12 * (0.6 + Number(track![1]) * (track![2] ? 1 : 0));
    const content = (padding: number): number => 390 - 2 * gutter - 2 * padding;
    expect(line * perChar).toBeLessThanOrEqual(content(pad(phones)));
    // 24px of padding left 310px, and 0.01em of tracking makes the line 329.4px: each one alone is three lines
    expect(line * 12 * 0.61).toBeGreaterThan(content(pad(phones)));
    expect(line * perChar).toBeGreaterThan(content(pad(base)));
  });

  it('from 360px down there is no room for it in two lines (296px), so the limit is three, never the five of the squeeze', () => {
    const line = 'customers by revenue? · orders.csv · 332 rows'.length;
    expect(line * 12 * 0.6).toBeGreaterThan(360 - 2 * 16 - 2 * 16);
    expect(85 * 12 * 0.6).toBeLessThanOrEqual(3 * (360 - 2 * 16 - 2 * 16));
  });
});

describe('the drafting mark\'s easing is a decision, not an accident', () => {
  it('says why a loop eases in and out (the one ease-out is for arrivals), next to the keyframes', () => {
    expect(css).toMatch(/\/\* ease-in-out on purpose: this one LOOPS[^*]*\*\/\n@keyframes tpen/);
  });
});


describe('a thrown-out note sets its money in Geist, not in the mono face (no "$2 , 252 . 07")', () => {
  it('a figure with separators is a tabular Geist figure; a call, an error or a text value stays mono', () => {
    for (const t of ['$2,252.07', '$2,260.06', '1,994.23', '2252.07', '-12.5', '12%', '5']) expect(noteValueClass(t), t).toBe('fd-num');
    for (const t of ['topCustomers(rows, 5)', 'TypeError: x is not iterable', '"Chef Ravioli Starbright"', '[1, 2, 3]', '$', '']) expect(noteValueClass(t), t).toBe('fd-trace__mono');
  });
  it('the landing note quotes two amounts, and both take the figure class', () => {
    const quoted = SCRIPT_GHOST_NOTE.filter((s) => s.mono).map((s) => s.text);
    expect(quoted).toEqual(['$2,252.07', '$2,260.06']);
    expect(quoted.map(noteValueClass)).toEqual(['fd-num', 'fd-num']);
  });
  it('the component picks the class by the quoted text, not a fixed mono class', () => {
    expect(tsx).toContain('<span key={i} class={noteValueClass(s.text)}>{s.text}</span>');
    expect(tsx).not.toContain('<span key={i} class="fd-trace__mono">{s.text}</span>');
  });
});

describe('a cell\'s cross and question mark are drawn, not an 8px letter off the type ramp', () => {
  const cell = /\.fd-cell \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const kids = (kind: 'cross' | 'query'): Array<{ type: string; props: Record<string, unknown> }> => {
    const out: Array<{ type: string; props: Record<string, unknown> }> = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const v = n as VNode<Record<string, unknown>>;
      if (typeof v.type === 'function' && v.type !== Fragment) return walk((v.type as (p: unknown) => unknown)(v.props));
      if (typeof v.type === 'string') out.push({ type: v.type, props: v.props });
      walk(v.props.children);
    };
    walk(CellMark({ kind }));
    return out;
  };

  it('.fd-cell sets no font at all (it carries no text)', () => {
    expect(cell).not.toBe('');
    expect(cell).not.toMatch(/font-size|font-weight|line-height/);
    expect(css).not.toMatch(/font-size:\s*8px/);
  });
  it('the lane sets no text in a cell: the mark is a component, the old "×" and "?" are gone from the source', () => {
    expect(tsx).toMatch(/<CellMark kind=\{mark\} \/>/);
    expect(tsx).not.toMatch(/text = '[×?]'/);
  });
  it('each mark is an svg, hidden from assistive tech, smaller than the cell it sits in (10x14, 8x12 compact, 10x10)', () => {
    for (const [kind, w, h] of [['cross', 5, 5], ['query', 5, 7]] as const) {
      const svg = kids(kind)[0]!;
      expect(svg.type, kind).toBe('svg');
      expect(svg.props['aria-hidden'], kind).toBe('true');
      expect([Number(svg.props.width), Number(svg.props.height)], kind).toEqual([w, h]);
      expect(w).toBeLessThan(8);
      expect(h).toBeLessThan(10);
      expect(svg.props.stroke, kind).toBe('currentColor');
    }
  });
});

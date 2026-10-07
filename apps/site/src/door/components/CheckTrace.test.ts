import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { draftingView } from '../start/RunPanel';

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
    const q = /@container fd-trace \(width < (\d+)px\) \{\s*\.fd-trace__foot-meta--drafting \{([^}]*)\}\s*\}/.exec(css);
    expect(q).not.toBeNull();
    expect(Number(q![1])).toBe(Math.ceil(sideBySide));
    expect(q![2]).toMatch(/flex-direction: row/);
    expect(q![2]).toMatch(/align-items: center/);
  });
  it('no header-side rule exists for it: no drafting head class, no narrow-trace container rule, no timer shrink, no balanced counter', () => {
    expect(css).not.toMatch(/head--drafting/);
    expect(css).not.toMatch(/@container fd-trace \(max-width: 599px\)/);
    expect(css).not.toMatch(/text-wrap:\s*balance/);
    // the timer is the unshrinkable column it always was, wherever it sits
    expect(css).toMatch(/\.fd-trace__timer \{ display: grid; justify-items: end; flex: none; \}/);
    expect(css).not.toMatch(/\.fd-trace__timer[^{]*\{[^}]*(?:min-width|max-width|flex: 0 1)/);
    // the header\'s only wrap rule is the phones\' media query, for every state of the trace alike
    expect(/\.fd-trace__head \{([^}]*)\}/.exec(css)?.[1] ?? '').not.toMatch(/flex-wrap/);
  });
});

describe('the drafting mark\'s easing is a decision, not an accident', () => {
  it('says why a loop eases in and out (the one ease-out is for arrivals), next to the keyframes', () => {
    expect(css).toMatch(/\/\* ease-in-out on purpose: this one LOOPS[^*]*\*\/\n@keyframes tpen/);
  });
});


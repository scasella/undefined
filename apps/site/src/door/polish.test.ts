/**
 * The final polish pass, pinned where it is cheap to read: the stylesheets and the sources are read as text, the way typeset.test.ts and
 * copy.test.ts do. Each block names the defect it keeps from coming back; the browser-side checks of the same items are in
 * scripts/replay-check.mjs ("polish" blocks).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('./', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, dir), 'utf8');

/** Every file under the door, relative to it. */
function walk(rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(new URL(rel, dir), { withFileTypes: true })) {
    const p = rel + e.name;
    if (e.isDirectory()) out.push(...walk(p + '/'));
    else out.push(p);
  }
  return out;
}
const files = walk();
const stylesheets = files.filter((f) => f.endsWith('.css'));
const sources = files.filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

/** The rules of a stylesheet as [selector, body], comments removed (at-rule blocks come out as their own inner rules). */
function rules(css: string): Array<[string, string]> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim().replace(/\s+/g, ' '), m[2]!.trim()]);
}
const rule = (css: string, selector: string): string => {
  const hit = rules(css).find(([s]) => s === selector);
  if (!hit) throw new Error(`no rule for ${selector}`);
  return hit[1];
};

// ───────────────────────── colour arithmetic (WCAG 2.x relative luminance) ─────────────────────────

const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** The WCAG contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** A custom property's value in tokens.css (a hex colour). */
function token(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})\\b`).exec(read('./tokens.css'));
  if (!m) throw new Error(`no ${name} token in tokens.css`);
  return m[1]!;
}

describe('contrast helper (so the numbers below are not taken on trust)', () => {
  it('black on white is 21:1 and a colour on itself 1:1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#848EA0', '#848EA0')).toBeCloseTo(1, 5);
  });
  it('is symmetric and agrees with the old edge colour being 1.42:1 on the page ground', () => {
    expect(contrast('#FFFFFF', '#F6F7F9')).toBeCloseTo(contrast('#F6F7F9', '#FFFFFF'), 10);
    expect(contrast('#CDD2DB', '#F6F7F9')).toBeCloseTo(1.416, 2);
  });
});

// ───────────────────────── the edge of a text field ─────────────────────────

describe('the edge of a text field is 3:1 against what it sits on (WCAG 1.4.11)', () => {
  const edge = token('--fd-edge-input');
  // white (a card), the page ground, the faintest paper (the paste area's own fill) and the amber wash the house-rule box sits in
  const SURFACES = { '--fd-surface': '#FFFFFF', '--fd-bg': '#F6F7F9', '--fd-surface-3': '#FBFBFD', '--fd-amber-wash': '#FFF5DE' } as const;

  it('the surfaces named here are the real tokens (so the ratios below are about the colours on the page)', () => {
    for (const [name, hex] of Object.entries(SURFACES)) expect(token(name), name).toBe(hex);
  });

  it.each(Object.entries(SURFACES))('--fd-edge-input is at least 3:1 on %s', (name, hex) => {
    expect(contrast(edge, hex), `${edge} on ${name}`).toBeGreaterThanOrEqual(3);
  });

  it('the old hairline colour for these edges (line-2) was not: that is the defect', () => {
    expect(contrast(token('--fd-line-2'), '#FFFFFF')).toBeLessThan(3);
    expect(contrast(token('--fd-line-2'), '#F6F7F9')).toBeLessThan(3);
  });

  // every text input and text area in the UI, found in the sources, and the class that styles it
  const fields: string[] = [];
  for (const f of sources) {
    const src = read('./' + f);
    for (const m of src.matchAll(/<(textarea|input)\b([^>]*?)(?:\/>|>)/gs)) {
      const attrs = m[2]!;
      if (m[1] === 'input' && !/type="text"/.test(attrs)) continue;
      const cls = /\bclass="([^"]+)"/.exec(attrs)?.[1] ?? '';
      fields.push(`${f}: <${m[1]}> .${cls.split(' ')[0]}`);
    }
  }

  it('finds the four text fields the product has (the question box, two paste areas, the house-rule reason box)', () => {
    expect(fields.sort()).toEqual([
      'start/DataBringer.tsx: <textarea> .fd-bring__textarea',
      'start/RunStates.tsx: <input> .fd-rs__why-box',
      'zen/ZenData.tsx: <textarea> .zd__textarea',
      'zen/ZenPanes.tsx: <input> .zp__box',
    ]);
  });

  it('each of them draws its border with the token, and nothing else uses the token', () => {
    const owners: string[] = [];
    for (const f of stylesheets) {
      for (const [sel, body] of rules(read('./' + f))) if (/var\(--fd-edge-input\)/.test(body)) owners.push(sel);
    }
    expect(owners.sort()).toEqual(['.fd-bring__textarea', '.fd-rs__why-box', '.zd__textarea', '.zp__box']);
    for (const f of fields) {
      const cls = /\.(\S+)$/.exec(f)![1]!;
      const css = stylesheets.map((s) => read('./' + s)).find((c) => rules(c).some(([sel]) => sel === '.' + cls))!;
      expect(rule(css, '.' + cls), cls).toMatch(/border: 1px solid var\(--fd-edge-input\)/);
    }
  });
});

// ───────────────────────── the selected segment ─────────────────────────

describe('the selected segment carries a cue that is not a hairline', () => {
  const css = read('./components/Segmented.css');

  it('the white fill and the hairline ring alone are about 1.1:1 on the track: that is the defect', () => {
    expect(contrast(token('--fd-surface'), token('--fd-surface-2'))).toBeLessThan(1.2);
    expect(contrast(token('--fd-line'), token('--fd-surface-2'))).toBeLessThan(1.2);
  });

  it('a 2px indigo bar under the label, 3:1 or better on the track and on the selected fill', () => {
    const bar = rule(css, ".fd-seg__item.is-on::after");
    expect(bar).toMatch(/content: ''/);
    expect(Number(/border-bottom: (\d+)px solid var\(--fd-indigo\)/.exec(bar)?.[1])).toBeGreaterThanOrEqual(2);
    expect(rule(css, '.fd-seg__item')).toMatch(/position: relative/);
    expect(contrast(token('--fd-indigo'), token('--fd-surface-2'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('--fd-indigo'), token('--fd-surface'))).toBeGreaterThanOrEqual(3);
  });

  it('the bar is a border, not a fill: a forced-colors window repaints backgrounds with the canvas, a border stays (and takes a system colour)', () => {
    const bar = rule(css, ".fd-seg__item.is-on::after");
    expect(bar).not.toMatch(/background/);
    expect(bar).toMatch(/height: 0\b/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.fd-seg__item\.is-on::after \{ border-bottom-color: Highlight; \}\s*\}/);
  });

  it('nothing moves when the choice does: the selected item does not change its weight, size or padding', () => {
    const on = rule(css, '.fd-seg__item.is-on');
    expect(on).not.toMatch(/font-weight|font-size|padding|border:|margin|width/);
  });

  it('every segmented control in the product is this one component, and it keeps the state in aria-selected / aria-pressed', () => {
    const users = sources.filter((f) => /<Segmented\b/.test(read('./' + f)));
    expect(users.sort()).toEqual(['landing/Asks.tsx', 'landing/Stage.tsx', 'start/DataBringer.tsx']);
    expect(sources.filter((f) => /fd-seg__item/.test(read('./' + f)))).toEqual(['components/Segmented.tsx']);
    const tsx = read('./components/Segmented.tsx');
    expect(tsx).toMatch(/aria-selected=\{on \? 'true' : 'false'\}/);
    expect(tsx).toMatch(/aria-pressed=\{on \? 'true' : 'false'\}/);
  });
});

// ───────────────────────── no ids from a document that is not in the repo ─────────────────────────

describe('test names and comments say what they check, not a number from a review document nobody can open', () => {
  const scripts = new URL('../../scripts/replay-check.mjs', import.meta.url);
  const texts: Array<[string, string]> = [...files.filter((f) => /\.(tsx?|css)$/.test(f) && f !== 'polish.test.ts').map((f): [string, string] => [f, read('./' + f)]), ['scripts/replay-check.mjs', readFileSync(scripts, 'utf8')]];

  it('no "P1" to "P19" and no "(A1)", "(C5)", "(D9)" or "(S2)" anywhere in the door or in replay-check', () => {
    const found: string[] = [];
    for (const [f, text] of texts) {
      for (const m of text.matchAll(/\bP(?:[1-9]|1[0-9])\b|\([ACDS][0-9]{1,2}\)/g)) found.push(`${f}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });
});

// ───────────────────────── placeholder text and the bar at the foot of the window ─────────────────────────

describe('placeholder text is 4.5:1 on every surface a field sits on', () => {
  const placeholder = (): string => rule(read('./base.css'), 'input::placeholder, textarea::placeholder');

  it('is Quiet Slate at full strength (Firefox thins the browser\'s own grey again)', () => {
    expect(placeholder()).toMatch(/color: var\(--fd-ink-3\)/);
    expect(placeholder()).toMatch(/opacity: 1/);
  });

  it.each([['--fd-surface'], ['--fd-bg'], ['--fd-surface-3'], ['--fd-amber-wash']])('on %s', (name) => {
    expect(contrast(token('--fd-ink-3'), token(name))).toBeGreaterThanOrEqual(4.5);
  });

  it('the browser\'s default grey (#757575) on the paste area\'s fill was 4.46:1: that is the defect', () => {
    expect(contrast('#757575', token('--fd-surface-3'))).toBeLessThan(4.5);
  });
});

describe('a control focused from the keyboard is never left under the sticky honesty bar', () => {
  const css = read('./components/HonestyBar.css');

  it('the page keeps its scroll padding at least as tall as the tallest bar (three lines of 17px, 9px above and below, a 1px border) and a ring', () => {
    const pad = Number(/html \{ scroll-padding-bottom: (\d+)px; \}/.exec(css)?.[1]);
    const tallest = 3 * 17 + 2 * 9 + 1;
    expect(tallest).toBe(70);
    expect(pad).toBeGreaterThanOrEqual(tallest + 2);
  });

  it('the bar is still the sticky one the padding is for', () => {
    expect(rule(css, '.fd-honesty')).toMatch(/position: sticky; bottom: 0/);
  });
});

// ───────────────────────── the trace takes the project's ring when it is focused by script ─────────────────────────

describe('the check trace, focused after Ask on the Full view, shows the standard ring for keyboard focus', () => {
  it('base.css draws the ring on :focus-visible (2px indigo, 2px offset), so a script focus after a key press shows it and a mouse click does not', () => {
    const ring = rules(read('./base.css')).find(([s]) => s === ':focus-visible')?.[1] ?? '';
    expect(ring).toMatch(/outline: 2px solid var\(--fd-indigo\)/);
    expect(ring).toMatch(/outline-offset: 2px/);
  });

  it('no stylesheet takes the outline off the trace, a region, or anything focusable by script (the trace is focused with tabindex -1)', () => {
    const offenders: string[] = [];
    for (const f of stylesheets) {
      for (const [sel, body] of rules(read('./' + f))) {
        if (!/outline:\s*(none|0)\b/.test(body)) continue;
        offenders.push(`${f}: ${sel}`);
      }
    }
    // other controls take the outline off and draw their own ring on :focus-visible (a text box's box-shadow, a switch's knob); the trace never does
    expect(offenders.filter((o) => /fd-trace|fd-start__run|region/.test(o))).toEqual([]);
  });

  it('followRun focuses the trace without scrolling it twice, and makes it a labelled region first', () => {
    const src = read('./start/Start.tsx');
    expect(src).toMatch(/setAttribute\('tabindex', '-1'\)/);
    expect(src).toMatch(/trace\.focus\(\{ preventScroll: true \}\)/);
  });
});

// ───────────────────────── heading order ─────────────────────────

describe('the cards that follow a page heading say which level that is', () => {
  it('the answer card and the outcome cards have no literal h3: their level is the page\'s to give', () => {
    for (const f of ['components/AnswerCard.tsx', 'start/RunStates.tsx']) expect(read('./' + f), f).not.toMatch(/<h3\b/);
  });

  it('Step by step (RunPanel zen) puts the card straight under its h1, as an h2; the Full view keeps h3 under "Ask a question"', () => {
    const src = read('./start/RunPanel.tsx');
    expect(src).toMatch(/<RunStates engine=\{engine\} session=\{s\} headingLevel=\{zen \? 2 : 3\} \/>/);
    expect(src).toMatch(/headingLevel=\{zen \? 2 : 3\}\s*\/>\}/);
  });

  it('the landing\'s card sits under its section\'s h2 and keeps the default (h3)', () => {
    expect(read('./landing/Stage.tsx')).not.toMatch(/headingLevel/);
    expect(read('./landing/Stage.tsx')).toMatch(/<h2 id="stage-h"/);
  });

  it('the focus rules for the outcome headings cover an h2 as well as an h3 (a card on Step by step is an h2)', () => {
    const css = read('./start/RunStates.css');
    expect(css).toMatch(/\.fd-rs h2:focus, \.fd-rs h3:focus/);
    expect(css).toMatch(/\.fd-rs h2:focus-visible, \.fd-rs h3:focus-visible/);
  });
});

// ───────────────────────── the proof chevron turns with transform only ─────────────────────────

describe('Step by step\'s "See the checks" chevron moves with transform, not with layout', () => {
  const css = read('./zen/ZenProof.css');
  const closed = rule(css, '.zpr__chev');
  const open = rule(css, ".zpr__btn[aria-expanded='true'] .zpr__chev");

  it('transitions transform alone (no margin, no height: nothing the page has to lay out again)', () => {
    expect(closed).toMatch(/transition: transform 160ms var\(--fd-ease\);/);
    expect(closed).not.toMatch(/transition:[^;]*margin/);
    expect(closed).not.toMatch(/margin/);
    expect(open).not.toMatch(/margin/);
  });

  it('keeps the look it had: sits 1.5px high and points down when closed, 1.5px low and points up when open', () => {
    expect(closed).toMatch(/transform: translateY\(-1\.5px\) rotate\(45deg\)/);
    expect(open).toMatch(/transform: translateY\(1\.5px\) rotate\(-135deg\)/);
  });

  it('the reduced-motion path is the one it was: no transition at all', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.zpr__chev \{ transition: none; \} \}/);
  });
});

// ───────────────────────── the "will run" mark on Step by step's third pane ─────────────────────────

describe('the pane-3 "will run" mark is not a radio button or a spinner', () => {
  const src = read('./zen/ZenPanes.tsx');
  const body = /function WillRun\(\) \{([\s\S]*?)\n\}\n/.exec(src)?.[1] ?? '';

  it('is found, 18px, hidden from assistive tech (the words beside it say what it means)', () => {
    expect(body).not.toBe('');
    expect(body).toMatch(/aria-hidden="true"/);
    expect(body).toMatch(/width="18" height="18"/);
  });

  it('is a dashed outline of the trace\'s tick (a rectangle), with no circle: a ring with a dot is what a radio and a loader look like', () => {
    expect(body).toMatch(/<rect\b/);
    expect(body).not.toMatch(/<circle\b/);
    expect(body).toMatch(/stroke-dasharray=/);
    expect(body).toMatch(/fill="none"/);
    // taller than wide, like the tick it stands for (10 by 14); a square would be a checkbox
    const w = Number(/<rect[^>]*\bwidth="([\d.]+)"/.exec(body)?.[1]);
    const h = Number(/<rect[^>]*\bheight="([\d.]+)"/.exec(body)?.[1]);
    expect(h).toBeGreaterThan(w);
  });

  it('is not the green disc (a check that passed) nor the dashed circle of a check that will not run (icons.tsx NotChecked)', () => {
    expect(body).not.toMatch(/--fd-green|#17A36B|#33C793|CheckDisc/);
    const icons = read('./icons.tsx');
    expect(/export function NotChecked[\s\S]*?<circle/.exec(icons)).not.toBeNull();
  });

  it('still shows for the checks that run and only for them; the others keep NotChecked', () => {
    expect(src).toMatch(/c\.state === 'always' \|\| c\.state === 'applies' \? <WillRun \/> : <NotChecked size=\{18\} \/>/);
  });
});

// ───────────────────────── focus after "Paste data" and "Back" on Step by step ─────────────────────────

describe('"Paste data" and "Back" on Step by step leave focus on a control, not on <body>', () => {
  const src = read('./zen/ZenData.tsx');

  it('"Paste data" asks for focus on the textarea, "Back" for focus on the "Paste data" button, before the halves swap', () => {
    expect(src).toMatch(/focusAfterSwap\.current = 'box';\s*setPasting\(true\);/);
    expect(src).toMatch(/focusAfterSwap\.current = 'button';\s*setPasting\(false\);/);
  });

  it('the move happens once the other half is in the page (a layout effect on `pasting`), and reads then clears what was asked', () => {
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\s*const to = focusAfterSwap\.current;\s*focusAfterSwap\.current = null;\s*if \(to === 'box'\) pasteBox\.current\?\.focus\(\);\s*else if \(to === 'button'\) pasteBtn\.current\?\.focus\(\);\s*\}, \[pasting\]\);/);
  });

  it('the two controls carry the refs the effect uses', () => {
    expect(src).toMatch(/<button\s+ref=\{pasteBtn\}/);
    expect(src).toMatch(/<textarea\s+id="zen-paste"\s+ref=\{pasteBox\}/);
  });

  it('the page\'s own swap back (a pasted file read) does not ask for focus here: done() moves it to the forward button', () => {
    const done = /const done = \(\) => \{[\s\S]*?\n  \};/.exec(src)?.[0] ?? '';
    expect(done).toContain('setPasting(false)');
    expect(done).not.toContain('focusAfterSwap');
  });

  it('the Full view\'s "Paste data" is a tab that stays where it is, so focus stays on it (no change needed there)', () => {
    const tsx = read('./start/DataBringer.tsx');
    expect(tsx).toMatch(/\{ id: 'paste', label: 'Paste data' \}/);
    expect(read('./components/Segmented.tsx')).toMatch(/role="tab"/);
  });
});

// ───────────────────────── one easing for arrivals ─────────────────────────

describe('transitions that arrive use the one easing (var(--fd-ease)), not a literal ease', () => {
  it('the run-it-yourself chevron and the answer card\'s quiet lock button, added after the design system was recorded, use it', () => {
    expect(rule(read('./components/DemoNote.css'), '.fd-rl__chev')).toMatch(/transition: transform 120ms var\(--fd-ease\)/);
    expect(rule(read('./components/AnswerCard.css'), '.fd-ac--handoff .fd-ac__lock')).toMatch(
      /transition: background-color 120ms var\(--fd-ease\), box-shadow 120ms var\(--fd-ease\), color 120ms var\(--fd-ease\)/,
    );
  });

  // The literal easings that are left: the loops (the three-tick mark, the mode dot), which ease in and out on purpose, and the 120ms
  // state changes of controls written before this pass. A rule that is not on this list takes var(--fd-ease): add to the list only for
  // a loop.
  const LEFT = [
    'components.css::.fd-btn',
    'components/AgreementRail.css::.fd-agree__chip',
    'components/CheckTrace.css::.fd-trace__pen > span',
    'components/Segmented.css::.fd-seg__item',
    'components/Switch.css::.fd-switch::before',
    'components/Switch.css::.fd-switch__knob',
    'components/TelemetryBar.css::.fd-tele__caret',
    'components/TelemetryBar.css::.fd-tele__dot.is-running',
    'components/TelemetryBar.css::.fd-tele__pill',
    'landing/Asks.css::.fd-asks__opt',
    'landing/Ladder.css::.fd-ld-col',
    'landing/SaysNoAndPrivacy.css::.fd-sn__chip',
    'start/AskCard.css::.fd-ask__chip',
    'start/DataBringer.css::.fd-bring__change',
    'start/DataBringer.css::.fd-bring__sample',
    'start/DataBringer.css::.fd-bring__zone',
    'start/RunStates.css::.fd-rs__opt',
    'zen/ZenData.css::.zd__btn',
    'zen/ZenData.css::.zd__change',
    'zen/ZenData.css::.zd__sample',
    'zen/ZenData.css::.zd__zone',
    'zen/ZenPanes.css::.zp__add',
    'zen/ZenPanes.css::.zp__chip',
    'zen/ZenPanes.css::.zp__remove',
  ];

  it('no other rule has a literal ease in a transition or an animation', () => {
    const found: string[] = [];
    for (const f of stylesheets) {
      for (const [sel, body] of rules(read('./' + f))) {
        for (const d of body.match(/(?:transition|animation)\s*:[^;]*/g) ?? []) {
          if (/\b(ease|ease-in-out|ease-in|ease-out|linear)\b/.test(d) && !d.includes('var(--fd-ease)')) found.push(`${f}::${sel}`);
        }
      }
    }
    expect([...new Set(found)].sort()).toEqual([...LEFT].sort());
  });

  it('the loops that keep ease-in-out say why, next to the keyframes', () => {
    expect(read('./components/CheckTrace.css')).toMatch(/ease-in-out on purpose: this one LOOPS/);
    expect(rule(read('./components/TelemetryBar.css'), '.fd-tele__dot.is-running')).toMatch(/ease-in-out/);
  });
});

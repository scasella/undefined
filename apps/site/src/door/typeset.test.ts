/**
 * Typeset (critique step 5), pinned where it is cheap to read: the shared label classes and figures in base.css, the one place each kind
 * of mono capitals is allowed to live, the words on every `.fd-eyebrow` and `.fd-label-line` in the source, the money that is no longer
 * set in a monospaced face, the text-wrap rules and the reading measure. Reads the source files, as copy.test.ts does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LADDER_DEFS } from './model/figures';
import { gapView } from './start/RunStates';
import { INTRO_LABEL } from './start/startView';
import { MINI_QUESTION } from './landing/stageData';
import { ASK_LABEL, isShortLabel, isTypedCaps, labelClass, labelKind, typedCapsRuns } from './model/labels';

const dir = new URL('./', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, dir), 'utf8');

/** Every non-test source file under the door, with its path relative to it. */
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
const sources = files.filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f));
const stylesheets = files.filter((f) => f.endsWith('.css'));

/** The rules of a stylesheet as [selector, body], nested at-rules flattened (no rule in this code base nests rules in rules). */
function rules(css: string): Array<[string, string]> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim().replace(/\s+/g, ' '), m[2]!.trim()]);
}
const rule = (css: string, selector: string): string => {
  const hit = rules(css).find(([s]) => s === selector);
  if (!hit) throw new Error(`no rule for ${selector}`);
  return hit[1];
};

describe('base.css: the shared label, line and figure classes', () => {
  const base = read('./base.css');

  it('.fd-eyebrow is the short noun label: Geist Mono capitals, tracked, never more than 0.06em', () => {
    const b = rule(base, '.fd-eyebrow');
    expect(b).toContain('font-family: var(--fd-mono)');
    expect(b).toContain('text-transform: uppercase');
    expect(b).toMatch(/letter-spacing: 0\.06em/);
  });

  it('.fd-label-line is the sentence-case line: Geist, no capitals, no tracking, a size from the ramp (Body Small), Quiet Slate', () => {
    const b = rule(base, '.fd-label-line');
    expect(b).toContain('font-family: var(--fd-sans)');
    expect(b).toContain('text-transform: none');
    expect(b).toContain('letter-spacing: normal');
    expect(b).toContain('font-size: 14px; line-height: 20px');
    expect(b).toContain('color: var(--fd-ink-3)');
    expect(b).not.toMatch(/mono|uppercase/);
  });

  it('.fd-num is Geist with tabular figures and no slashed zero (Geist has none to give)', () => {
    const b = rule(base, '.fd-num');
    expect(b).toContain('font-family: var(--fd-sans)');
    expect(b).toContain('font-variant-numeric: tabular-nums');
    expect(b).not.toMatch(/mono|zero/);
  });

  it('no text ends on a lone word (pretty, on the body, inherited by every element whatever its tag), and a heading or a control label breaks into even lines', () => {
    // not keyed to p/li/dd: a sentence in a div or a span (a note, a waiting line, a caption) ended on "AI." and "decide." under the old element list
    expect(rules(base).filter(([sel]) => sel === 'body').map(([, b]) => b)).toContain('text-wrap: pretty;');
    expect(rules(base).filter(([s, b]) => /text-wrap:\s*pretty/.test(b)).map(([s]) => s)).toEqual(['body']);
    expect(rule(base, 'h1, h2, h3, button, .fd-btn, .fd-tf__run, .fd-lane__label, .fd-ac__ledger-list li, .fd-honesty__in')).toBe('text-wrap: balance;');
  });
});

describe('mono capitals live in one place each', () => {
  /**
   * The only rules that may set capitals or a tracking above 0.02em. `.fd-eyebrow` is the label; the rest are not labels: the seal's own words
   * (the Honest Seal Rule: they stay mono capitals), the trace's own "DRAFT N" label, and the column heads of a table the engine returned.
   */
  const ALLOWED = new Set(['base.css .fd-eyebrow', 'components/AnswerCard.css .fd-ac__eyebrow', 'components/AnswerCard.css .fd-ac__fallback-table th', 'components/CheckTrace.css .fd-trace__draft']);

  it('no other rule sets capitals or a tracking above 0.02em: a new one must be a label (the shared class) or be named here', () => {
    const found: string[] = [];
    for (const f of stylesheets) {
      for (const [sel, body] of rules(read(f))) {
        const tracked = [...body.matchAll(/letter-spacing:\s*(-?[0-9.]+)em/g)].some((m) => Number(m[1]) > 0.02);
        if (tracked || /text-transform:\s*uppercase/.test(body)) found.push(`${f.replace(/^\.\//, '')} ${sel}`);
      }
    }
    expect(found.sort()).toEqual([...ALLOWED].sort());
  });

  it('no class named for an eyebrow, a kicker or a tag sets its own mono face: the label is the shared class', () => {
    const own: string[] = [];
    for (const f of stylesheets) {
      for (const [sel, body] of rules(read(f))) {
        if (/eyebrow|kicker/.test(sel) && !f.endsWith('base.css') && !/ac__eyebrow/.test(sel) && /--fd-mono|text-transform|letter-spacing:\s*0\.0[3-9]/.test(body)) own.push(`${f} ${sel}`);
      }
    }
    expect(own).toEqual([]);
  });
});

describe('the words on every label', () => {
  /** What a `{expression}` in a label stands for: the constants the source types once (so the test reads the words the page really shows). */
  const CONSTANTS: Record<string, string> = { ASK_LABEL, INTRO_LABEL, 'MINI_QUESTION.label': MINI_QUESTION.label };

  interface LabelEl { file: string; cls: string; text: string }

  /**
   * Every `<div|span|p>` in the source whose class holds `cls`, with its words: the opening tag is read to its closing `>` (braces and quotes
   * respected, so `class={`${labelClass(X)} …`}` and arrow functions do not end it early), the content up to its closing tag, child
   * components and tags dropped (`<AskDiamond … />`), and `{CONSTANT}` swapped for its words. A `{data}` expression stays as `{data}`.
   * (The first version of this test read only the text before the first child, and so saw nothing at all of the three ask labels.)
   */
  function labelElements(cls: string): LabelEl[] {
    const out: LabelEl[] = [];
    const has = new RegExp(`(^|\\s)${cls}(\\s|$)`);
    for (const f of sources) {
      const src = read(f);
      for (const m of src.matchAll(/<(div|span|p)\b/g)) {
        const tag = m[1]!;
        let i = m.index! + m[0].length;
        let depth = 0;
        let quote = '';
        for (; i < src.length; i++) {
          const c = src[i]!;
          if (quote) { if (c === quote) quote = ''; continue; }
          if (c === '"' || c === "'" || c === '`') quote = c;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) break;
        }
        const open = src.slice(m.index!, i);
        if (open.endsWith('/')) continue;
        const attr = /\bclass=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(open);
        const cl = attr?.[1] ?? attr?.[2] ?? '';
        if (!has.test(cl)) continue;
        let j = i + 1;
        let nest = 1;
        const tagRe = new RegExp(`<(/?)${tag}\\b`, 'g');
        tagRe.lastIndex = j;
        let end = -1;
        for (let t = tagRe.exec(src); t; t = tagRe.exec(src)) {
          nest += t[1] ? -1 : 1;
          if (nest === 0) { end = t.index; break; }
        }
        expect(end, `${f}: unclosed <${tag}>`).toBeGreaterThan(j);
        const text = src
          .slice(j, end)
          .replace(/<[A-Za-z][^<>]*\/>/g, ' ')
          .replace(/<[^<>]+>/g, ' ')
          .replace(/\{([^{}]+)\}/g, (_, e: string) => CONSTANTS[e.trim()] ?? `{${e.trim()}}`)
          .replace(/\s+/g, ' ')
          .trim();
        out.push({ file: f, cls: cl, text });
      }
    }
    return out;
  }

  it('every .fd-eyebrow is a short noun label: at most 3 words and 22 characters, and never one that carries data', () => {
    const found = labelElements('fd-eyebrow');
    // the ones that ship: the labels that stay capitals
    expect(found.map((l) => l.text).sort()).toEqual(['HERE', 'HONEST LIMITS', 'MADE-UP ·', 'THE USUAL ORDER', 'YOUR AGREEMENT', 'YOUR AGREEMENT', 'You asked'].sort());
    for (const l of found) expect(isShortLabel(l.text), `${l.file}: ${l.text}`).toBe(true);
  });

  it('every .fd-label-line is a line: over the limit for capitals (or carrying the viewer\'s words), and none of it typed in capitals', () => {
    const lines = labelElements('fd-label-line');
    expect(lines.length).toBeGreaterThanOrEqual(18); // the ones that ship: 18 static ones (the ladder's columns take their class from the family, below)
    for (const l of lines) {
      // none is empty: a label whose words the reader cannot read out of the source is a label this test would pass vacuously
      expect(l.text, `${l.file}: an empty label`).not.toBe('');
      // a line that holds the viewer's own question or data ("You asked · {label}") is a line however short its own words are
      if (!l.text.includes('{')) expect(isShortLabel(l.text), `${l.file}: ${l.text}`).toBe(false);
      expect(isTypedCaps(l.text), `${l.file}: ${l.text}`).toBe(false);
      expect(typedCapsRuns(l.text), `${l.file}: ${l.text}`).toEqual([]);
    }
    // the ask labels (their text follows a drawn diamond) are read, and are the one constant on both surfaces
    const asks = lines.filter((l) => l.cls.includes('fd-label--ask'));
    expect(asks.map((l) => l.text).sort()).toEqual([ASK_LABEL, ASK_LABEL, MINI_QUESTION.label].sort());
    expect(asks.map((l) => l.file).sort()).toEqual(['landing/Asks.tsx', 'landing/Stage.tsx', 'start/RunStates.tsx']);
    // and the line the viewer's own question sits in, and the board's heading
    expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(['You asked · {d.label}', 'You asked · {label}', '{t.title}', 'Fig. 3 · One agreement, every version']));
  });

  it('no run of capitals is typed into any string in the source, except the seal, the trace head and short labels', () => {
    /** The seal's own words (the Honest Seal Rule keeps them mono capitals) and the trace's own head: not labels, so not held to the label rule. */
    const ALLOWED = new Set(['PASSED EVERY CHECK', 'BASIC CHECKS · NOTHING ELSE CHECKED YET', 'CHECK TRACE']);
    const found: string[] = [];
    for (const f of sources) {
      const code = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
        .replace(/^export\s*\{[\s\S]*?\}\s*from\s+['"][^'"]+['"];?/gm, '');
      for (const run of typedCapsRuns(code)) if (!ALLOWED.has(run) && !isShortLabel(run)) found.push(`${f}: ${run}`);
    }
    expect(found).toEqual([]);
  });

  it('the labels that come from data are lines too, in sentence case, and a family shares one look', () => {
    const ladder = LADDER_DEFS.map((d) => d.tag);
    expect(labelKind(ladder)).toBe('line');
    expect(read('./landing/Ladder.tsx')).toContain('class={`${labelClass(LADDER_TAGS)} fd-ld-col__tag`}');
    expect(labelClass(ladder)).toBe('fd-label-line');
    const gap = { silentOn: 'x', call: 'f()', actualShown: '1', expectedShown: '2', alternatives: [], ruleScope: null, existing: null, onlyAgreeing: null };
    const caseTags = [gapView({ ...gap, check: { kind: 'property' } } as never).caseTag, gapView({ ...gap, check: { kind: 'example' } } as never).caseTag];
    expect(labelKind(caseTags)).toBe('line'); // the short "Your example" takes the look of the long one beside it
    for (const t of [INTRO_LABEL, MINI_QUESTION.label, ASK_LABEL, ...ladder, ...caseTags]) expect(typedCapsRuns(t), t).toEqual([]);
    expect(isShortLabel(INTRO_LABEL) || isShortLabel(MINI_QUESTION.label) || isShortLabel(ASK_LABEL)).toBe(false);
    // the hero line and the viewer's own question are lines in the source, not capitals
    expect(read('./landing/Hero.tsx')).toContain('<div class="fd-label-line">Answers from your spreadsheet exports · checked before you see them</div>');
    expect(read('./start/RunStates.tsx')).toContain('<div class="fd-label-line">You asked · {label}</div>');
  });
});

describe('money and counts are set in Geist, not in a monospaced face', () => {
  const carriers: Array<[string, string]> = [
    ['./components/AnswerCard.tsx', 'fd-ac__lead-num fd-num'],
    ['./components/AnswerCard.tsx', '<td class="fd-ac__td-amt fd-num">'],
    ['./components/AnswerCard.tsx', '<span class="fd-ac__amt fd-num">'],
    ['./landing/Ladder.tsx', '<span class="fd-ld-row__amt fd-num">'],
    ['./landing/Ladder.tsx', '<span class="fd-ld-leader__amt fd-num">'],
    ['./landing/EvidenceStrip.tsx', '<div class="fd-ev-big fd-num">'],
    ['./landing/Asks.tsx', '<span class="fd-num">{f.lockedAmount}</span>'],
    ['./components/AgreementRail.tsx', '<span class="fd-num">{l.value}</span>'],
  ];
  for (const [file, needle] of carriers) {
    it(`${file.replace('./', '')}: ${needle}`, () => {
      const src = read(file);
      expect(src).toContain(needle);
      const line = src.split('\n').find((l) => l.includes(needle.replace(/^</, '').split('>')[0]!))!;
      expect(line).not.toContain('fd-mono');
    });
  }
  it('the answer card sets its lead and its amounts with no mono face of their own', () => {
    const css = read('./components/AnswerCard.css');
    for (const sel of ['.fd-ac__lead-num', '.fd-ac__amt', '.fd-ac__td-amt']) expect(rule(css, sel)).not.toMatch(/mono|slashed|zero/);
  });
});

describe('the reading measure', () => {
  it('no body text is held to 70ch (about 100 characters of Geist): it uses the measure token', () => {
    const wide = stylesheets.filter((f) => f !== 'tokens.css' && /max-width:\s*70ch/.test(read(f)));
    expect(wide).toEqual([]);
    for (const [file, sel] of [
      ['./start/RunStates.css', '.fd-rs__p'], ['./start/RunStates.css', '.fd-rs__ask-body'], ['./start/RunStates.css', '.fd-rs__saved-rule'],
      ['./start/AskCard.css', '.fd-ask__level'], ['./components/DemoNote.css', '.fd-demo__p'], ['./components/AnswerCard.css', '.fd-ac__version'],
      ['./landing/SaysNoAndPrivacy.css', '.fd-sn__lead'],
      // the rails and the assumption rows: a rail goes full width when the page stacks, and their lines ran to 110 characters at 768
      ['./components/AgreementRail.css', '.fd-agree__empty-p'], ['./components/AnswerCard.css', '.fd-ac__assumption-text'], ['./landing/Stage.css', '.fd-stage__q-body'],
    ] as const) expect(rule(read(file), sel), sel).toContain('max-width: var(--fd-measure)');
  });

  it('the rails\' footers hold their words to the measure by padding, so the hairline over them stays the card\'s full width', () => {
    for (const [file, sel] of [['./components/AgreementRail.css', '.fd-agree__foot'], ['./components/PrivacyRail.css', '.fd-priv__foot']] as const) {
      const b = rule(read(file), sel);
      expect(b, sel).toContain('padding-right: max(0px, calc(100% - var(--fd-measure)))');
      expect(b, sel).toContain('border-top: 1px solid var(--fd-line)');
      expect(b, sel).not.toMatch(/max-width/);
    }
  });
});

describe('a column of amounts lines up', () => {
  it('the lit ladder column\'s amounts share one weight, even in the leader\'s bold row (Geist\'s tabular digits widen with weight); the other columns are untouched', () => {
    const css = read('./landing/Ladder.css');
    expect(rule(css, '.fd-ld-col.is-lit .fd-ld-row.is-first .fd-ld-row__amt')).toBe('font-weight: 400;');
    expect(rule(css, '.fd-ld-row').match(/font-weight/)).toBeNull(); // the rows under the leader are the weight the amounts are pinned to: regular
    expect(rule(css, '.fd-ld-col.is-lit .fd-ld-row.is-first')).toBe('font-weight: 600;');
    expect(rule(css, '.fd-ld-row__amt')).not.toMatch(/font-weight/); // no blanket weight: an unlit column\'s amounts are as they were
  });
});

describe('the headline keeps its accent phrase whole', () => {
  it('the indigo phrase does not break across lines where it fits (a lone "it." never starts the second line)', () => {
    const css = read('./landing/Hero.css');
    expect(css).toMatch(/@media \(min-width: 560px\) \{ \.fd-hero__accent \{ display: inline-block; \} \}/);
    // and no phrase's last word is left alone at the start of a line on a phone
    expect(rule(css, '.fd-hero__tail')).toBe('display: inline-block;');
    expect(read('./landing/Hero.tsx')).toContain('<span class="fd-hero__tail">writes it.</span>');
    expect(read('./landing/Hero.tsx')).toContain('<span class="fd-hero__tail">check it.</span>');
    // the words themselves are the copy and nothing else: the spans only keep each phrase's last word with its neighbour (measured: without them
    // "it." starts a line at 390, 640 and 768 and wider, "The AI writes / it." at 320)
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(read('./landing/Hero.tsx'))![1]!;
    expect(h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).toBe('The AI writes it. Your rules check it. You see it only if it passes.');
  });
});

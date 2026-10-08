/**
 * Step by step's own-file path, pinned where it is drawn (source order and gating; the behaviour itself is in the pure
 * functions: start/ownFileCaveat.test.ts, flow.test.ts, model/runLocally.test.ts, and in scripts/replay-check.mjs on the
 * real page). A test that reads the source is the house style for what a pure function cannot see (Zen.test.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
/** Source with comments removed, so a word in a comment does not count as code. */
const code = (name: string): string => src(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('ZenData.tsx: the picker keeps the samples in sight once your own file is bound', () => {
  const t = code('./ZenData.tsx');
  it('folds by the shared rule through zenPickerFold (mode and source go in, so a refusal holds the picker in the demo only), not by "open" alone', () => {
    expect(t).toContain('zenPickerFold({ bound, open, source: s.source.value, mode, problem: !!intake.problem })');
    // a call to pickerFold with the refusal clause ungated is what put live mode's refusal on a different path from the demo's
    expect(t).not.toMatch(/\bpickerFold\(/);
    expect(t).toContain('const showPicker = !fold.folded;');
    expect(t).not.toMatch(/const showPicker = !bound \|\| open;/);
  });
  it('draws the caveat under the drop zone and the own-file note directly above the samples, not after the status and problem lines', () => {
    const zone = t.indexOf('class="zd__zone');
    const caveat = t.indexOf('class="zd__caveat"');
    const note = t.indexOf('class="zd__note"');
    const samples = t.indexOf('class="zd__samples"');
    const status = t.indexOf('class="zd__status"');
    const problem = t.indexOf('class="zd__problem"');
    expect(zone).toBeGreaterThan(-1);
    expect(zone).toBeLessThan(caveat);
    expect(caveat).toBeLessThan(note);
    expect(note).toBeLessThan(samples);
    expect(samples).toBeLessThan(status);
    expect(status).toBeLessThan(problem);
    // exactly one place draws the note
    expect([...t.matchAll(/class="zd__note"/g)]).toHaveLength(1);
  });
  it('the note sits in a status region that exists before it has words, and only in the demo (live draws no new element)', () => {
    expect(t).toMatch(/\{ownFileRegion\(mode\) && \(\s*<div class="zd__own" role="status">\s*\{ownNote && <p class="zd__note">\{ownFileNote\(s\.fileName\.value\)\}<\/p>\}/);
    expect(t).not.toMatch(/mode === 'replay' &&/);
    expect(t).toContain('{caveat && <p class="zd__caveat">{caveat}</p>}');
    expect(t).toContain('const caveat = ownFileCaveat(mode);');
  });
  it('after a bind, focus still goes to the forward button, and what is announced follows boundAnnouncement', () => {
    expect(t).toContain('document.getElementById(ZEN_CONTINUE_ID)?.focus()');
    expect(t).toContain('boundAnnouncement(');
    expect(t).not.toMatch(/is ready/);
  });
  it('"Change" while the picker cannot fold moves focus into it and never closes it', () => {
    expect(t).toMatch(/if \(fold\.forced\) picker\.current\?\.querySelector<HTMLElement>\('\.zd__zone button, \.zd__zone textarea'\)\?\.focus\(\);\s*else setOpen\(!open\);/);
    expect(t).toContain('aria-expanded={fold.expanded}');
    expect(t).toContain('{fold.button}');
  });
});

describe('DataBringer.tsx (the Full view): the same caveat, the same fold rule, its own-file rule kept', () => {
  const t = code('../start/DataBringer.tsx');
  it('folds by the shared pickerFold, the rule it always had', () => {
    expect(t).toContain('pickerFold({ bound, open, ownNote, problem: !!intake.problem })');
    expect(t).toContain('{fold.button}');
    expect(t).toContain("aria-expanded={fold.expanded ? 'true' : 'false'}");
    expect(t).not.toMatch(/const forced = ownNote \|\|/);
  });
  it('draws the one caveat under both tab panels (so it shows on either tab) and before the status line, in the demo only', () => {
    expect(t).toContain('const caveat = ownFileCaveat(mode);');
    const paste = t.indexOf('id={panelId(\'paste\')}');
    const caveat = t.indexOf('{caveat && <p class="fd-bring__caveat">{caveat}</p>}');
    const status = t.indexOf('class="fd-bring__status"');
    expect(paste).toBeGreaterThan(-1);
    expect(paste).toBeLessThan(caveat);
    expect(caveat).toBeLessThan(status);
    expect([...t.matchAll(/fd-bring__caveat/g)]).toHaveLength(1);
  });
  it('"Change" while the picker cannot be closed (the note or a refusal) moves in, also when it was opened by hand; it never calls setOpen(false) then', () => {
    expect(t).toMatch(/else if \(forced\) \{\s*picker\.current\?\.querySelector<HTMLElement>\('\[role="tab"\]\[aria-selected="true"\]'\)\?\.focus\(\);\s*\} else \{\s*setOpen\(false\);/);
  });
  // Rewritten from "keeps its own-file note in both panels": the note sat inside the drop zone, above the caveat, so the reader met what to do
  // before why. It is now one note after the caveat, as on Step by step, still from the shared (trimmed) strings, one per tab.
  it('draws its own-file note once, after the caveat (the reason first, then what to do), from the shared (trimmed) strings, one per tab', () => {
    expect(t).toContain('{ownNote && <p class="fd-bring__note">{tab === \'drop\' ? DROP_NOTE : PASTE_NOTE}</p>}');
    expect([...t.matchAll(/fd-bring__note/g)]).toHaveLength(1);
    const caveat = t.indexOf('{caveat && <p class="fd-bring__caveat">{caveat}</p>}');
    const note = t.indexOf('{ownNote && <p class="fd-bring__note">');
    const status = t.indexOf('class="fd-bring__status"');
    expect(caveat).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(caveat);
    expect(note).toBeLessThan(status);
    // and neither tab panel holds a note any more
    const paste = t.indexOf("id={panelId('paste')}");
    expect(t.slice(0, paste)).not.toContain('fd-bring__note');
  });
});

describe('Zen.tsx: the forward button takes its words and look from flow.ts forwardLabel', () => {
  const t = code('./Zen.tsx');
  it('Continue, Run the checks, See the answer and Ask another question are not typed here', () => {
    expect(t).toContain("forwardLabel(step, { ownData, replay: st.mode === 'replay' })");
    for (const label of ['Continue', 'Run the checks', 'See the answer', 'Ask another question']) expect(t).not.toMatch(new RegExp(`>\\s*${label}\\s*<`));
    expect([...t.matchAll(/variant=\{fwd\.variant\}/g)]).toHaveLength(4);
  });
  it('the button keeps its id (focus, "try it" and the bind all find it), and its reason', () => {
    expect(t).toMatch(/<Button id=\{ZEN_CONTINUE_ID\} variant=\{fwd\.variant\} icon="arrow" aria-disabled=\{can \? undefined : 'true'\} \{\.\.\.describedBy\}/);
  });
});

describe('ZenPanes.tsx: the column note is said once, above the suggestions; the dead end carries the steps inline', () => {
  const t = code('./ZenPanes.tsx');
  it('the question pane draws the column note after the lede and before the chips and the legend', () => {
    const lede = t.indexOf('class="zp__lede">Pick a suggestion');
    const note = t.indexOf('class="zp__colnote"');
    const chips = t.indexOf('aria-label="Suggested questions"');
    const legend = t.indexOf('<NeedsLiveLegend');
    expect(lede).toBeGreaterThan(-1);
    expect(lede).toBeLessThan(note);
    expect(note).toBeLessThan(chips);
    expect(chips).toBeLessThan(legend);
    expect([...t.matchAll(/class="zp__colnote"/g)]).toHaveLength(1);
  });
  it('the table under the buttons no longer repeats it', () => {
    const table = code('./ZenTable.tsx');
    expect(table).not.toMatch(/columnNote|zt__note|\bnote\b/);
    expect(src('./ZenTable.css')).not.toMatch(/zt__note/);
    // ZenYourData is still after the nav (Zen.tsx), where it was
    const zen = code('./Zen.tsx');
    expect(zen.indexOf('</nav>')).toBeLessThan(zen.indexOf('<ZenYourData'));
  });
  it('the dead end: the sentence alone is the status region (what the button is described by); the steps follow it, only in the demo', () => {
    expect(t).toMatch(/<p id=\{CONTINUE_WHY_ID\} class="zp__why" role="status">\s*\{view \? <NoRecordingSentence view=\{view\} onTry=\{onTry\} onUse=\{onUse\} \/> : text\}\s*<\/p>/);
    expect(t).toContain("const steps = view ? runLocallyView(replay ? 'replay' : 'live') : null;");
    expect(t).toContain('{steps && <RunLocally view={steps} disclosure link />}');
    // the README link is the component's now (last line of the steps), not a second copy inside the sentence
    expect(t).not.toContain('RUN_LOCALLY_URL');
    expect(t).not.toContain('fd-ask__run');
  });
});

describe('the dead end is not dead: panes 2 and 3 can switch to the recorded sample, in the Full view and on Step by step alike', () => {
  const zen = code('./Zen.tsx');
  const panes = code('./ZenPanes.tsx');
  it('Zen.tsx gives the plain reason and the pieces the same offer, binds the sample, and sends focus to the forward button', () => {
    expect(zen).toContain('const offer = s ? sampleOffer(s.sampleId.value) : null;');
    expect(zen).toContain('noRecordingText(ownData, other, offer)');
    expect(zen).toContain('noRecordingView(ownData, other, offer)');
    expect(zen).toMatch(/const useSample = \(sample: SampleId\) => \{\s*if \(!s\) return;\s*setDraft\(''\);\s*void s\.useSample\(sample\)\.then\(\(\) => requestAnimationFrame\(\(\) => document\.getElementById\(ZEN_CONTINUE_ID\)\?\.focus\(\)\)\);/);
    // both panes that say it get the button
    expect(zen).toContain('onTry={tryOther} onUse={useSample} />}');
    expect([...zen.matchAll(/onUse=\{useSample\}/g)]).toHaveLength(2);
    expect(panes).toContain('onUse={onUse}');
  });
  it('the Full view says the same sentence from the same function (the card, and the card that follows a press of Ask)', () => {
    const ask = code('../start/AskCard.tsx');
    const states = code('../start/RunStates.tsx');
    expect(ask).toContain('offer: sampleOffer(s.sampleId.value)');
    expect(states).toContain("noRecordingView(s.source.value === 'own', other, offer)");
    expect(states).toContain('const offer = sampleOffer(s.sampleId.value);');
    // the way out is said once, as the button inside the sentence: the card's action row has no second control for it
    // (it had a "Switch to orders.csv" button there, and a "Try “…”" button for the other question, beside the same words)
    expect(states).toContain('<NoRecordingSentence view={noRecordingView(s.source.value === \'own\', other, offer)} onTry={tryOther} onUse={useSample} busy={busy} />');
    expect(states).not.toContain('switchToSampleButton');
    expect(states).not.toMatch(/\{!other && offer && \(/);
    expect(states).not.toMatch(/Try “\{other\.label\}”/);
    const card = states.slice(states.indexOf("o.kind === 'no-recording'"), states.indexOf("o.kind === 'thrown-out'"));
    expect(card.match(/<Button\b/g) ?? []).toHaveLength(0);
    // the session's plain sentence (the held answer's caption) names it as well
    expect(code('../start/session.ts')).toContain('noRecordingText(source.value === \'own\', recordedOther.value, sampleOffer(sampleId.value))');
  });
});

describe('components/DemoNote.tsx: the steps start open and keep the viewer’s choice when the dead end is redrawn', () => {
  const t = code('../components/DemoNote.tsx');
  it('the disclosure’s state is a module-level signal, open until the viewer folds it, written back by the real <details>', () => {
    expect(t).toContain('export const runLocallyOpen = signal(true);');
    expect(t).toContain('<details class="fd-rl__d" open={runLocallyOpen.value} onToggle={(e) => (runLocallyOpen.value = e.currentTarget.open)}>');
    // the fold is flipped by the click itself: the browser's "toggle" event arrives after the fact, and a message redrawn in between
    // (a typed question is looked up) would come back at the old value
    expect(t).toMatch(/<summary\s+class="fd-rl__sum"\s+onClick=\{\(e\) => \{\s*e\.preventDefault\(\);\s*runLocallyOpen\.value = !runLocallyOpen\.value;\s*\}\}/);
    // component state (useState) would be lost with the unmount the dead end goes through while a typed question is looked up
    expect(t).not.toMatch(/useState/);
  });
  it('starts open', async () => {
    const { runLocallyOpen } = await import('../components/DemoNote');
    expect(runLocallyOpen.value).toBe(true);
  });
});

describe('TeamFile.tsx: the landing’s limits card lists the same steps, in the demo only, and keeps its README link and the buttons', () => {
  const t = code('../landing/TeamFile.tsx');
  it('the steps change the grid only when they are drawn: the modifier class is on only with steps, and every rule for it is scoped to it', () => {
    expect(t).toContain("'fd-wrap fd-tf__grid' + (steps ? ' fd-tf__grid--steps' : '')");
    const css = src('../landing/TeamFile.css');
    const tail = css.slice(css.indexOf('@media (min-width: 809px)'));
    expect(tail.startsWith('@media (min-width: 809px)')).toBe(true);
    const rules = [...tail.matchAll(/^\s{2}(\.[^{]+)\{/gm)].map((m) => m[1]!.trim());
    expect(rules.length).toBeGreaterThan(3);
    for (const sel of rules) expect(sel.startsWith('.fd-tf__grid--steps')).toBe(true);
  });
  it('draws RunLocally from the same view as Step by step, between the limits and the README link', () => {
    expect(t).toContain('const steps = runLocallyView(mode);');
    const list = t.indexOf('fd-tf__limit-list');
    const steps = t.indexOf('<RunLocally view={steps} />');
    const link = t.indexOf('Setup steps for running it on your computer');
    expect(list).toBeLessThan(steps);
    expect(steps).toBeLessThan(link);
    expect(t).toContain('{steps && (');
    expect(t).toContain('href={RUN_LOCALLY_URL}');
  });
  it('the eyebrow and the closing buttons are as they were (a later step owns the eyebrows; the buttons are the owner’s decision)', () => {
    expect(t).toContain('<div class="fd-eyebrow">HONEST LIMITS</div>');
    expect(t).toContain('Try the demo');
    expect(t).toContain("const own = ownFileCta(mode, 'closing');");
    expect(t).toContain('{own.label}');
  });
});

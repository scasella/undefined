/**
 * The demo's one caveat about a file of your own (startView.ts DEMO_OWN_FILE_CAVEAT), tied to what the replay site really
 * answers: the REAL bundled recordings, the same availability the question pane's "needs your computer" legend counts. Plus the
 * picker's fold rule and the trimmed notes that come after the caveat.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Recording } from '@scasella/undefined-engine/types';
import { buildDataset } from '../../data/dataset';
import { seedAgreement } from '../model/agreements';
import { DEFAULT_QUESTION_ID, suggestedQuestions } from '../model/questions';
import { sampleFile, SAMPLE_IDS, type SampleId } from '../model/samples';
import { needsLiveLegend, NEEDS_YOUR_COMPUTER } from './AskCard';
import { sampleOffer } from './derive';
import { availabilityOf, seedUsable } from './recorded';
import { boundAnnouncement, DEMO_OWN_FILE_CAVEAT, DROP_NOTE, ownFileCaveat, ownFileNote, ownFileRegion, PASTE_NOTE, PASTED_NAME, pickerFold, showOwnFileNote, zenPickerFold } from './startView';

const dir = new URL('../../../public/recordings/', import.meta.url);
const recordings = (): Recording[] => (JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as string[]).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Recording);

/** Per suggested question of a sample file: can the replay site answer it? (the session's own steps: seed decided, then availability) */
async function answerableIn(sample: SampleId): Promise<Record<string, boolean>> {
  const f = sampleFile(sample);
  const rows = f.rows();
  const built = await buildDataset(f.datasetName, rows, { source: 'bundled', filename: f.filename, ...(sample === 'orders' ? { typeName: 'Row' } : {}) });
  if ('error' in built) throw new Error(built.message);
  const d = built.ref;
  const recs = recordings();
  const qs = suggestedQuestions(d, rows, sample);
  const seeds = new Map<string, ReturnType<typeof seedAgreement>>();
  for (const q of qs) {
    const raw = seedAgreement(sample, q.id, d);
    seeds.set(q.id, raw && (await seedUsable({ mode: 'replay', seed: raw.spec, program: { functions: {} }, recordings: recs })) ? raw : null);
  }
  const a = await availabilityOf({ mode: 'replay', questions: qs, program: { functions: {} }, dataset: d, recordings: recs, seedFor: (q) => seeds.get(q.id)?.spec ?? null });
  return Object.fromEntries(qs.map((q) => [q.id, a[q.id] === 'recorded' || a[q.id] === 'certified']));
}

describe('the caveat says only what the demo can do', () => {
  it('in the demo: shown; on a copy that runs on your computer: nothing (live renders as before)', () => {
    expect(ownFileCaveat('replay')).toBe(DEMO_OWN_FILE_CAVEAT);
    expect(ownFileCaveat('live')).toBeNull();
  });

  it('agrees with the recordings: some questions about orders.csv have an answer, none about sales-q3.csv does', async () => {
    const orders = Object.values(await answerableIn('orders'));
    const sales = Object.values(await answerableIn('sales'));
    expect(orders.some(Boolean)).toBe(true);
    expect(orders.every(Boolean)).toBe(false); // "only some questions"
    expect(sales.some(Boolean)).toBe(false); // so the caveat must not promise answers for "the sample files"
  });

  it('names the sample that has answers by its own file name, and not the one that has none', () => {
    expect(DEMO_OWN_FILE_CAVEAT).toContain(sampleFile('orders').filename);
    expect(DEMO_OWN_FILE_CAVEAT).not.toContain(sampleFile('sales').filename);
    expect(DEMO_OWN_FILE_CAVEAT).not.toMatch(/sample files\b/);
    expect(DEMO_OWN_FILE_CAVEAT).toMatch(/\bonly some questions\b/);
  });

  it('says what the question pane’s legend says, in the same words: recorded answers, and the version on your computer', async () => {
    const legendFor = async (sample: SampleId) => {
      const a = await answerableIn(sample);
      return needsLiveLegend(Object.values(a).map((ok) => ({ needsLive: !ok })), 'replay') ?? '';
    };
    for (const sample of SAMPLE_IDS) {
      const legend = await legendFor(sample);
      expect(legend).toContain('recorded answers');
      expect(legend).toContain('the version on your computer');
    }
    expect(await legendFor('orders')).toContain('recorded answers for one question');
    expect(await legendFor('sales')).toContain('no recorded answers');
    expect(DEMO_OWN_FILE_CAVEAT).toContain('recorded answers');
    expect(DEMO_OWN_FILE_CAVEAT).toContain('needs the version on your computer');
    expect(DEMO_OWN_FILE_CAVEAT).toMatch(/loads and previews here/); // what the demo does do with your file
  });

  it('the way out it offers is real: the no-recording sentence names the sample that has a recording, and the very question it says has one', async () => {
    const offer = sampleOffer(null)!;
    expect(offer.file).toBe(sampleFile('orders').filename);
    expect(offer.sample).toBe('orders');
    const orders = await answerableIn('orders');
    // "has a recorded answer": the question the binding selects is one the real recordings answer here...
    expect(orders[DEFAULT_QUESTION_ID[offer.sample]]).toBe(true);
    // ...while "only some" is still true of the file (so the sentence names the question, not the file's every question)
    expect(Object.values(orders).every(Boolean)).toBe(false);
    // and the file it sends the viewer to is never the one that has none
    expect(offer.file).not.toBe(sampleFile('sales').filename);
    expect(Object.values(await answerableIn('sales')).some(Boolean)).toBe(false);
  });

  it('the chip tag and the legend say the same thing as this caveat, in the words of the sentences, not "live"', async () => {
    const a = await answerableIn('orders');
    const legend = needsLiveLegend(Object.values(a).map((ok) => ({ needsLive: !ok })), 'replay')!;
    expect(legend).toBe('This demo has recorded answers for one question; the others need the version on your computer.');
    expect(NEEDS_YOUR_COMPUTER).toBe('needs your computer');
    expect(`${legend} ${DEMO_OWN_FILE_CAVEAT} ${NEEDS_YOUR_COMPUTER}`).not.toMatch(/\blive\b/i);
  });

  it('is plain words, short, and never says the engine’s vocabulary', () => {
    expect(DEMO_OWN_FILE_CAVEAT).not.toMatch(/\b(gate|spec|property|fuzz|mutant|revision|pin|repo|workspace|backend|live mode)\b/i);
    expect(DEMO_OWN_FILE_CAVEAT.split('. ')).toHaveLength(2);
    expect(DEMO_OWN_FILE_CAVEAT.length).toBeLessThan(200);
  });
});

describe('what is said once your own data is bound', () => {
  it('does not repeat the caveat: it says where the file stays and what to do next', () => {
    for (const note of [DROP_NOTE, PASTE_NOTE]) {
      expect(note).not.toMatch(/recorded|version on your computer|demo|answers/i);
      expect(note.length).toBeLessThan(DEMO_OWN_FILE_CAVEAT.length / 2);
    }
    expect(DROP_NOTE).toContain('stays in this browser');
    expect(PASTE_NOTE).toContain('Read in this browser');
  });

  it('sends the viewer to the sample that can run checks, by name: the note sits right above sales-q3.csv, which has no recorded answer', async () => {
    // the sample buttons are under the note; "try a sample file" would send a click to sales-q3.csv, a dead end (every chip "needs your computer")
    const orders = sampleFile('orders').filename;
    const sales = sampleFile('sales').filename;
    for (const note of [DROP_NOTE, PASTE_NOTE]) {
      expect(note).toContain(`try ${orders}.`);
      expect(note).not.toContain(sales);
      expect(note).not.toMatch(/\bsample file\b/);
    }
    // and the sample it names really has answers, while the other has none (the same recordings the caveat is tied to above)
    expect(Object.values(await answerableIn('orders')).some(Boolean)).toBe(true);
    expect(Object.values(await answerableIn('sales')).some(Boolean)).toBe(false);
  });

  it('is drawn only for your own data, in the demo', () => {
    expect(showOwnFileNote('own', 'replay')).toBe(true);
    expect(showOwnFileNote('own', 'live')).toBe(false);
  });

  it('Step by step says "read" for pasted rows and "stays" for a dropped file, from the name the session gave the data', () => {
    expect(ownFileNote(PASTED_NAME)).toBe(PASTE_NOTE);
    expect(ownFileNote('mine.csv')).toBe(DROP_NOTE);
    expect(ownFileNote('')).toBe(DROP_NOTE);
    // the name is the session's own (it is not exported there): a change on either side fails here
    expect(readFileSync(new URL('./session.ts', import.meta.url), 'utf8')).toContain(`const PASTED = '${PASTED_NAME}';`);
  });

  it('Step by step’s note region (a status region that exists before it has words) is the demo’s alone', () => {
    expect(ownFileRegion('replay')).toBe(true);
    expect(ownFileRegion('live')).toBe(false);
  });

  it('the screen reader hears “loaded” for your own file in the demo (it is not “ready” to be asked about), “ready” otherwise', () => {
    expect(boundAnnouncement('mine.csv · 5 rows · 3 columns', true)).toBe('mine.csv · 5 rows · 3 columns is loaded.');
    expect(boundAnnouncement('orders.csv · 332 rows · 10 columns', false)).toBe('orders.csv · 332 rows · 10 columns is ready.');
    expect(boundAnnouncement(null, false)).toBe('Your data is ready.');
  });
});

describe('pickerFold: the picker stays open while the own-file note or a refusal is what the viewer needs', () => {
  const base = { bound: true, open: false, ownNote: false, problem: false };

  it('nothing bound: open, whatever else is true', () => {
    expect(pickerFold({ ...base, bound: false })).toEqual({ folded: false, forced: false, button: 'Close', expanded: true });
  });

  it('a sample bound (or any file on a copy that runs on your computer): folded behind its chip until "Change" opens it', () => {
    expect(pickerFold(base)).toEqual({ folded: true, forced: false, button: 'Change', expanded: false });
    expect(pickerFold({ ...base, open: true })).toEqual({ folded: false, forced: false, button: 'Close', expanded: true });
  });

  it('your own file in the demo: the picker stays open (the samples stay in sight), and "Change" moves in rather than closes', () => {
    for (const open of [false, true]) expect(pickerFold({ ...base, ownNote: true, open })).toEqual({ folded: false, forced: true, button: 'Change', expanded: true });
  });

  it('a refusal keeps it open too', () => {
    expect(pickerFold({ ...base, problem: true })).toEqual({ folded: false, forced: true, button: 'Change', expanded: true });
  });

  it('only the demo draws the own-file note, so only the demo’s own file keeps the picker open (live folds as it always did)', () => {
    const forced = (source: 'sample' | 'own' | 'none', mode: 'live' | 'replay') => pickerFold({ ...base, ownNote: showOwnFileNote(source, mode) }).forced;
    expect(forced('own', 'replay')).toBe(true);
    expect(forced('own', 'live')).toBe(false);
    expect(forced('sample', 'replay')).toBe(false);
    expect(pickerFold({ ...base, ownNote: showOwnFileNote('own', 'live') }).folded).toBe(true);
  });
});

describe('zenPickerFold: Step by step keeps the refusal rule to the demo (a copy that runs on your computer folds as it always did)', () => {
  const base = { bound: true, open: false, source: 'sample' as 'sample' | 'own' | 'none', mode: 'live' as 'live' | 'replay', problem: false };
  const FOLDED = { folded: true, forced: false, button: 'Change', expanded: false };
  const OPEN_BY_CHOICE = { folded: false, forced: false, button: 'Close', expanded: true };
  const HELD = { folded: false, forced: true, button: 'Change', expanded: true };

  it('live: a refusal never holds the picker: it folds behind the chip, and "Close" shuts it, with or without the refusal', () => {
    for (const source of ['sample', 'own'] as const) {
      for (const problem of [false, true]) {
        expect(zenPickerFold({ ...base, source, problem })).toEqual(FOLDED);
        expect(zenPickerFold({ ...base, source, problem, open: true })).toEqual(OPEN_BY_CHOICE);
      }
    }
  });

  it('live: nothing bound is open as ever, and your own file never holds it (the note is the demo’s)', () => {
    expect(zenPickerFold({ ...base, bound: false, source: 'none', problem: true })).toEqual(OPEN_BY_CHOICE);
    expect(zenPickerFold({ ...base, source: 'own' })).toEqual(FOLDED);
  });

  it('live is HEAD’s rule exactly: folded = bound and not opened; the button says "Close" only while it is open', () => {
    for (const bound of [false, true]) {
      for (const open of [false, true]) {
        for (const source of ['sample', 'own'] as const) {
          for (const problem of [false, true]) {
            const f = zenPickerFold({ bound, open, source, mode: 'live', problem });
            expect(f.folded).toBe(bound && !open);
            expect(f.expanded).toBe(!bound || open);
            expect(f.button).toBe(bound && !open ? 'Change' : 'Close');
            expect(f.forced).toBe(false);
          }
        }
      }
    }
  });

  it('the demo: your own file holds the picker open (the samples stay in sight), and so does a refusal', () => {
    for (const open of [false, true]) {
      expect(zenPickerFold({ ...base, mode: 'replay', source: 'own', open })).toEqual(HELD);
      expect(zenPickerFold({ ...base, mode: 'replay', source: 'sample', problem: true, open })).toEqual(HELD);
    }
  });

  it('the demo, a sample bound with no refusal: folded behind its chip until "Change" opens it (nothing new on the pane)', () => {
    expect(zenPickerFold({ ...base, mode: 'replay' })).toEqual(FOLDED);
    expect(zenPickerFold({ ...base, mode: 'replay', open: true })).toEqual(OPEN_BY_CHOICE);
  });
});

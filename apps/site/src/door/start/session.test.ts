/**
 * The session controller's pure parts (intake.ts, recorded.ts) and its engine glue against a small fake engine (the
 * real engine needs workers; the browser run in the report covers that). The recording tests read the REAL bundled
 * recording: they pin down what the public replay site can and cannot answer.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { effect, signal } from '@preact/signals';
import type { DatasetRef, Engine, EngineState, FunctionSpec, Recording } from '@scasella/undefined-engine/types';
import { hashesFor } from '@scasella/undefined-engine/shared/hash';
import { buildDataset } from '../../data/dataset';
import { bundledOrders } from '../../data/orders';
import { seedAgreement, SEEDED_PIN_ID } from '../model/agreements';
import { suggestedQuestions } from '../model/questions';
import { sampleFile } from '../model/samples';
import { session as telemetry, shellFileChip } from '../state';
import { delimiterProblem, fileChipFor, fileProblem, jsonFileKind, ownDatasetName, parseRows, textProblem } from './intake';
import { ReplayGenerator } from '../../core/generator';
import { agreementRecording, answerableOther, availabilityOf, callSpecFor, fetchRecordings, levelFor, recordedKeys, seedUsable, specHasAgreement, specKey } from './recorded';
import { createSession, sessionFor, type Session } from './session';

const recordingsDir = new URL('../../../public/recordings/', import.meta.url);
const ordersRecording = (): Recording => JSON.parse(readFileSync(new URL('orders.json', recordingsDir), 'utf8')) as Recording;

/** A recording of `spec` (one accepted-looking attempt), as `npm run record:door` would write for the seeded agreement. */
async function recordingOf(spec: FunctionSpec, id = 'orders-agreement'): Promise<Recording> {
  const h = await hashesFor(spec);
  return {
    format: 'undefined-recording',
    version: 3,
    id,
    title: id,
    recordedAt: '2026-10-05T00:00:00.000Z',
    model: 'test',
    sessions: [{ fn: spec.name, specHash: h.specHash, testsHash: h.testsHash, label: id, spec, calls: [`${spec.name}(rows)`], attempts: [{ prompt: 'p', body: 'return [];', notes: '', durationMs: 1, progress: [] }] }],
  } as unknown as Recording;
}

async function bind(name: string, typeName: string): Promise<DatasetRef> {
  const built = await buildDataset(name, bundledOrders(), { source: 'bundled', filename: 'orders.csv', typeName });
  if ('error' in built) throw new Error(built.message);
  return built.ref;
}

describe('intake', () => {
  it('parses exactly the rows the engine binds (CSV coerced, JSON kept)', () => {
    const f = sampleFile('orders');
    const p = parseRows(f.text(), f.filename);
    expect(p.ok && p.rows).toEqual(f.rows());
    const j = parseRows('[{"a":1},{"a":2}]');
    expect(j.ok && j.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseRows('a,b\n')).toEqual({ ok: false, error: 'No rows: the text has a header line but no data lines.' });
    expect(parseRows('  ')).toEqual({ ok: false, error: 'Nothing to load: paste CSV or JSON, or drop a file.' });
  });
  it('refuses spreadsheets, binaries, empties, recordings; asks about the delimiter of a one-column CSV', () => {
    expect(fileProblem({ name: 'q3.xlsx', size: 10 })).toBe('q3.xlsx is a spreadsheet file; export it as CSV.');
    expect(fileProblem({ name: 'q3.csv', size: 10 })).toBeNull();
    expect(textProblem('', 'q3.csv')).toBe('q3.csv is empty. Nothing to load.');
    expect(textProblem('PK\u0000\u0003', 'q3.csv')).toBe('q3.csv looks binary; export it as CSV.');
    expect(jsonFileKind('{"format":"undefined-recording","sessions":[]}')).toBe('recording');
    expect(textProblem('{"format":"undefined-image"}', 'x.json')).toBe('x.json is a program image, not data. This page reads data only: a CSV or JSON table.');
    expect(delimiterProblem('a;b;c\n1;2;3', 1)).toBe('Only 1 column found. Is the delimiter ";"?');
    expect(delimiterProblem('name\nAda', 1)).toBeNull();
    expect(delimiterProblem('a;b\n1;2', 2)).toBeNull();
  });
  it('names the variable from the file, replacing the page’s previous own file instead of numbering', () => {
    expect(ownDatasetName('Sales Q3.csv', ['orders'])).toBe('salesQ3');
    expect(ownDatasetName('Sales Q3.csv', ['salesQ3'])).toBe('salesQ32');
    expect(ownDatasetName('Sales Q3.csv', ['salesQ3'], 'salesQ3')).toBe('salesQ3');
    expect(ownDatasetName(undefined, [])).toBe('data');
    expect(ownDatasetName('rows.csv', [])).toBe('rows2');
  });
  it('orders.csv is bound as `rows` (type Row): the name the bundled recording needs', () => {
    expect(sampleFile('orders').datasetName).toBe('rows');
  });
  it('the file chip', async () => {
    expect(fileChipFor(await bind('orders', 'OrdersRow'))).toBe('orders.csv · 332 rows · 10 columns');
  });
});

describe('what the replay site can answer (the real bundled recording)', () => {
  it('the recording holds two sessions, both for topCustomersByRevenue(rows) on the orders sample bound as `rows`', () => {
    const rec = ordersRecording();
    expect(rec.sessions.map((s) => [s.fn, s.calls, s.spec?.params, s.spec?.tests, s.spec?.properties])).toEqual([
      ['topCustomersByRevenue', ['topCustomersByRevenue(rows)'], [{ name: 'arg0', type: 'Row[]' }], '', ''],
      ['topCustomersByRevenue', ['topCustomersByRevenue(rows)'], [{ name: 'arg0', type: 'Row[]' }], '', ''],
    ]);
  });

  it('the spec-less call replays only when the sample is bound as `rows` (type Row); the seeded agreement never does', async () => {
    const keys = recordedKeys([ordersRecording()]);
    const asRows = await bind('rows', 'Row');
    const asOrders = await bind('orders', 'OrdersRow');
    const key = async (s: FunctionSpec) => {
      const h = await hashesFor(s);
      return `${s.name} ${h.specHash} ${h.testsHash}`;
    };
    expect(keys.has(await key(callSpecFor('topCustomersByRevenue', asRows)))).toBe(true);
    expect(keys.has(await key(callSpecFor('topCustomersByRevenue', asOrders)))).toBe(false);
    expect(keys.has(await key(seedAgreement('orders', 'top', asOrders)!.spec))).toBe(false);
    expect(keys.has(await key(seedAgreement('orders', 'top', asRows)!.spec))).toBe(false);
  });

  it('availability per question: with the seed nothing is recorded; spec-less on `rows`, the top-customers question is', async () => {
    const rows = sampleFile('orders').rows();
    const recordings = [ordersRecording()];
    for (const [name, typeName, seed, top] of [
      ['orders', 'OrdersRow', true, 'none'],
      ['orders', 'OrdersRow', false, 'none'],
      ['rows', 'Row', true, 'none'],
      ['rows', 'Row', false, 'recorded'],
    ] as const) {
      const d = await bind(name, typeName);
      const qs = suggestedQuestions(d, rows, 'orders');
      const a = await availabilityOf({ mode: 'replay', questions: qs, program: { functions: {} }, dataset: d, recordings, seedFor: (q) => (seed ? (seedAgreement('orders', q.id, d)?.spec ?? null) : null) });
      expect([name, seed, a]).toEqual([name, seed, { status: 'none', top, country: 'none' }]);
      expect(answerableOther(qs, a, 'status')?.id ?? null).toBe(top === 'recorded' ? 'top' : null);
    }
  });

  it('the seed is installed only when it will run: live, or a recording made against exactly it, or certified for it', async () => {
    const d = await bind('rows', 'Row');
    const seed = seedAgreement('orders', 'top', d)!.spec;
    expect(await seedUsable({ mode: 'live', seed, program: { functions: {} }, recordings: [] })).toBe(true);
    expect(await seedUsable({ mode: 'replay', seed, program: { functions: {} }, recordings: [ordersRecording()] })).toBe(false);
    expect(await seedUsable({ mode: 'replay', seed, program: { functions: {} }, recordings: [ordersRecording(), await recordingOf(seed)] })).toBe(true);
    // a recording of the seed bound under another name (another row type) is not this seed
    const other = seedAgreement('orders', 'top', await bind('orders', 'OrdersRow'))!.spec;
    expect(await seedUsable({ mode: 'replay', seed, program: { functions: {} }, recordings: [await recordingOf(other)] })).toBe(false);
    const h = await hashesFor(seed);
    const certified = { functions: { [seed.name]: { spec: seed, ...h, artifact: { specHash: h.specHash, testsHash: h.testsHash } as never } } };
    expect(await seedUsable({ mode: 'replay', seed, program: certified, recordings: [] })).toBe(true);
    expect(await seedUsable({ mode: 'live', seed: null, program: { functions: {} }, recordings: [] })).toBe(false);
  });

  it('two recordings of one function with different specs both replay (keys are fn + specHash + testsHash)', async () => {
    const d = await bind('rows', 'Row');
    const seed = seedAgreement('orders', 'top', d)!.spec;
    const both = [ordersRecording(), await recordingOf(seed)];
    const keys = recordedKeys(both);
    expect(keys.has(await specKey(callSpecFor('topCustomersByRevenue', d)))).toBe(true);
    expect(keys.has(await specKey(seed))).toBe(true);
    // the engine's own replay generator agrees
    const gen = new ReplayGenerator(both, { maxMs: 0 });
    for (const spec of [callSpecFor('topCustomersByRevenue', d), seed]) {
      const h = await hashesFor(spec);
      expect(gen.has(spec.name, h.specHash, h.testsHash)).toBe(true);
    }
  });

  it('agreementRecording keeps only the installed spec\'s sessions and states the curation in the title', async () => {
    const d = await bind('rows', 'Row');
    const seed = seedAgreement('orders', 'top', d)!.spec;
    const mine = await recordingOf(seed, 'Live session');
    const exported = { ...mine, sessions: [...ordersRecording().sessions, ...mine.sessions] } as Recording;
    const h = await hashesFor(seed);
    const rec = agreementRecording(exported, { fn: seed.name, ...h }, { id: 'orders-agreement', tries: 2, drafts: 2, firstThrownOut: true })!;
    expect(rec.id).toBe('orders-agreement');
    expect(rec.sessions).toHaveLength(1);
    expect(rec.sessions[0]!.specHash).toBe(h.specHash);
    expect(rec.title).toBe('orders-agreement: orders.csv, top 5 customers by revenue, with the seeded agreement; recorded live (2 tries; 2 drafts; first draft thrown out)');
    expect(await seedUsable({ mode: 'replay', seed, program: { functions: {} }, recordings: [rec] })).toBe(true);
    expect(agreementRecording(ordersRecording(), { fn: seed.name, ...h }, { id: 'x', tries: 1, drafts: 1, firstThrownOut: false })).toBeNull();
  });

  it('the level shown is what will run: full only for a spec (or a certified artifact) with examples, locks or rules', async () => {
    const d = await bind('rows', 'Row');
    const seed = seedAgreement('orders', 'top', d)!.spec;
    const call = callSpecFor('topCustomersByRevenue', d);
    const q = { fn: 'topCustomersByRevenue', text: 'Who are our top customers by revenue?' };
    expect(specHasAgreement(seed)).toBe(true);
    expect(specHasAgreement(call)).toBe(false);
    expect(specHasAgreement({ ...call, pins: seed.pins! })).toBe(true);
    expect(levelFor({ question: q, availability: 'recorded', program: { functions: {} }, seed })).toBe('full');
    expect(levelFor({ question: q, availability: 'recorded', program: { functions: {} }, seed: null })).toBe('basic');
    expect(levelFor({ question: q, availability: 'none', program: { functions: {} }, seed: null })).toBe('basic');
    // certified spec-less, then locked: the cached answer was checked with basic checks only
    const h = await hashesFor(call);
    const art = { specHash: h.specHash, testsHash: h.testsHash, candidates: [], evidence: undefined } as never;
    const locked = { functions: { [call.name]: { spec: { ...call, pins: seed.pins! }, ...h, artifact: art } } };
    expect(levelFor({ question: q, availability: 'certified', program: locked, seed: null })).toBe('basic');
    // not certified, with a lock: the next version is checked against it
    expect(levelFor({ question: q, availability: 'none', program: { functions: { [call.name]: { spec: { ...call, pins: seed.pins! }, ...h, artifact: null } } }, seed: null })).toBe('full');
  });

  it('fetchRecordings (injected fetch): the index, safe names only, malformed files skipped', async () => {
    const files: Record<string, unknown> = { './recordings/index.json': ['orders.json', '../x.json', 'bad.json'], './recordings/orders.json': ordersRecording(), './recordings/bad.json': { format: 'nope' } };
    const got = await fetchRecordings(async (u) => ({ ok: u in files, json: async () => files[u] }));
    expect(got.map((r) => r.id)).toEqual([ordersRecording().id]);
    expect(await fetchRecordings(async () => ({ ok: false, json: async () => null }))).toEqual([]);
  });

  it('live mode answers everything; a certified function answers without a recording', async () => {
    const d = await bind('orders', 'OrdersRow');
    const qs = suggestedQuestions(d, [], 'orders');
    const live = await availabilityOf({ mode: 'live', questions: qs, program: { functions: {} }, dataset: d, recordings: [], seedFor: () => null });
    expect(Object.values(live)).toEqual(['live', 'live', 'live']);
    const spec = callSpecFor('countByStatus', d);
    const h = await hashesFor(spec);
    const art = { specHash: h.specHash, testsHash: h.testsHash } as never;
    const cert = await availabilityOf({ mode: 'replay', questions: qs, program: { functions: { countByStatus: { spec, ...h, artifact: art } } }, dataset: d, recordings: [], seedFor: () => null });
    expect(cert.status).toBe('certified');
  });

  it('live mode too: a certified function answers from its artifact (asking again re-runs nothing), so the level is what it was certified with', async () => {
    const d = await bind('rows', 'Row');
    const qs = suggestedQuestions(d, [], 'orders');
    const seed = seedAgreement('orders', 'top', d)!.spec;
    const call = callSpecFor('topCustomersByRevenue', d);
    const h = await hashesFor(call);
    const art = { specHash: h.specHash, testsHash: h.testsHash, candidates: [], evidence: undefined } as never;
    // certified spec-less, then locked (pins are outside the hashes: still live)
    const locked = { functions: { topCustomersByRevenue: { spec: { ...call, pins: seed.pins! }, ...h, artifact: art } } };
    const a = await availabilityOf({ mode: 'live', questions: qs, program: locked, dataset: d, recordings: [], seedFor: () => null });
    expect(a).toEqual({ status: 'live', top: 'certified', country: 'live' });
    const q = { fn: 'topCustomersByRevenue', text: 'Who are our top customers by revenue?' };
    // without this, live mode would claim Full checks for an ask that shows the basic-checked answer on file
    expect(levelFor({ question: q, availability: a.top, program: locked, seed: null })).toBe('basic');
    expect(levelFor({ question: q, availability: 'live', program: locked, seed: null })).toBe('full');
    // a seed that is not what is installed will be installed and the function written again: not certified for it
    const seeded = await availabilityOf({ mode: 'live', questions: qs, program: locked, dataset: d, recordings: [], seedFor: (x) => (x.id === 'top' ? seed : null) });
    expect(seeded.top).toBe('live');
  });
});

// ───────────────────────── the controller against a fake engine ─────────────────────────

function fakeEngine(mode: 'live' | 'replay' = 'replay') {
  const state = signal<EngineState>({
    ready: true,
    mode,
    service: { state: 'down' },
    program: { functions: {} },
    headRevision: 1,
    revisions: [{ id: 1, at: 0, kind: 'init', title: 'r1', fns: 0, artifacts: 0 }],
    repl: [],
    replInput: '',
    generation: null,
    env: {},
    hints: { opener: false, takeaway: false },
    start: 'examples',
    datasets: [],
    send: { samples: true, sampleRows: 3 },
    busy: false,
    examples: [],
    pacing: { typeCharMs: 0, gateDwellMs: 0, replayMaxMs: 0 },
  });
  const calls: string[] = [];
  const revision = (kind: EngineState['revisions'][number]['kind'], patch: Partial<EngineState>) => {
    const s = state.value;
    const id = s.headRevision + 1;
    state.value = { ...s, ...patch, headRevision: id, revisions: [...s.revisions, { id, at: 0, kind, title: kind, fns: 0, artifacts: 0 }] };
  };
  const engine = {
    state,
    async loadDataset(input: { text: string; filename?: string; name?: string; source?: DatasetRef['source'] }) {
      calls.push(`loadDataset ${input.name}`);
      const p = parseRows(input.text, input.filename);
      if (!p.ok) return;
      const name = input.name ?? 'rows';
      const built = await buildDataset(name, p.rows, { source: input.source ?? 'paste', ...(input.filename ? { filename: input.filename } : {}), typeName: name === 'rows' ? 'Row' : `${name[0]!.toUpperCase()}${name.slice(1)}Row` });
      if ('error' in built) return;
      revision('dataset', { datasets: [...state.value.datasets.filter((d) => d.name !== name), built.ref] });
    },
    async previewDataset(input: { text: string; filename?: string; name?: string }) {
      const p = parseRows(input.text, input.filename);
      if (!p.ok) return { ok: false as const, error: p.error };
      const built = await buildDataset(input.name ?? 'rows', p.rows, { source: 'paste' });
      if ('error' in built) return { ok: false as const, error: built.message };
      const r = built.ref;
      return { ok: true as const, name: r.name, rowCount: r.rowCount, columns: r.columns, typeName: r.typeName, typeDecl: r.typeDecl, bytes: r.bytes, warnings: [], sampleText: '', sendDescription: '', table: { columns: [], rows: [], total: 0 } };
    },
    async upsertSpec(spec: FunctionSpec) {
      calls.push(`upsertSpec ${spec.name}`);
      const h = await hashesFor(spec);
      revision('spec-edit', { program: { ...state.value.program, functions: { ...state.value.program.functions, [spec.name]: { spec, ...h, artifact: null } } } });
    },
    setInput(text: string) {
      state.value = { ...state.value, replInput: text };
    },
    async submit() {
      calls.push(`submit ${state.value.replInput}`);
      const text = state.value.replInput;
      state.value = { ...state.value, replInput: '', busy: true, repl: [...state.value.repl, { kind: 'input', id: `in${state.value.repl.length}`, text }] };
      await Promise.resolve();
      // replay with no recording for this spec: the engine's own failure, no attempt
      state.value = {
        ...state.value,
        busy: false,
        generation: { id: `g${calls.length}`, fn: text.slice(0, text.indexOf('(')), signature: '', call: text, phase: 'failed', attempt: 0, maxAttempts: 3, progress: [], attempts: [], ungated: false, mode: 'replay', error: { code: 'no_recording', message: 'none' } },
      };
    },
    gapQuestion: () => null,
    async resetImage() {
      calls.push('resetImage');
      state.value = { ...state.value, datasets: [], program: { functions: {} }, repl: [], generation: null };
    },
  } as unknown as Engine;
  return { engine, state, calls };
}

describe('session controller (fake engine)', () => {
  it('replay with today\'s recordings: no seed, the top question goes out spec-less (basic), the others point at it', async () => {
    const { engine, calls } = fakeEngine('replay');
    const s = createSession(engine, { recordings: async () => [ordersRecording()] });
    expect(await s.useSample('orders')).toBe(true);
    expect(s.source.value).toBe('sample');
    expect(s.fileChip.value).toBe('orders.csv · 332 rows · 10 columns');
    expect(shellFileChip.value).toBe('orders.csv · 332 rows · 10 columns');
    expect(s.questionId.value).toBe('top');
    expect(s.seed.value).toBeNull();
    expect(s.seedState.value).toBe('none');
    expect(s.agreement.value.empty).toBe(true);
    await vi.waitFor(() => expect(s.availability.value).toEqual({ status: 'none', top: 'recorded', country: 'none' }));
    expect(s.questions.value.map((q) => [q.id, q.call, q.level])).toEqual([
      ['status', 'countByStatus(rows)', 'basic'],
      ['top', 'topCustomersByRevenue(rows)', 'basic'],
      ['country', 'revenueByCountry(rows)', 'basic'],
    ]);
    expect(await s.ask()).toBe(true);
    expect(calls).toEqual(['loadDataset rows', 'submit topCustomersByRevenue(rows)']);

    // another question: no recording; the honest sentence names the one that has an answer here
    const before = telemetry.value.checks;
    expect(await s.selectQuestion('status')).toBe(true);
    expect(s.run.value).toBeNull();
    expect(await s.ask()).toBe(true);
    expect(calls[calls.length - 1]).toBe('submit countByStatus(rows)');
    expect(s.outcome.value).toEqual({ kind: 'no-recording', onData: false, message: 'none' });
    expect(s.noRecording.value).toBe(
      'In this demo, answers are recorded, and this question has no recorded answer with these checks, so it needs the version on your computer. “Top 5 customers by revenue” has one: try it.',
    );
    expect(s.answer.value.held).toBe(true);
    expect(s.trace.value.header.verdict).toBe('Not run · no draft to check');
    expect(s.askLabel.value).toBe('Ask again');
    expect(telemetry.value.checks).toBe(before); // nothing ran
    expect(calls.filter((c) => c.startsWith('upsertSpec'))).toEqual([]);
    s.dispose();
    expect(shellFileChip.value).toBeNull();
  });

  it('replay with a recording of the seeded agreement: installed once (shown at once), full checks', async () => {
    const { engine, calls } = fakeEngine('replay');
    const seedSpec = seedAgreement('orders', 'top', await bind('rows', 'Row'))!.spec;
    const s = createSession(engine, { recordings: async () => [ordersRecording(), await recordingOf(seedSpec)] });
    expect(await s.useSample('orders')).toBe(true);
    expect(s.seedState.value).toBe('installed');
    expect(s.agreement.value.counts).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(engine.state.value.program.functions.topCustomersByRevenue!.spec.pins![0]!.id).toBe(SEEDED_PIN_ID);
    expect(s.questions.value.find((q) => q.id === 'top')?.level).toBe('full');
    await vi.waitFor(() => expect(s.availability.value.top).toBe('recorded'));
    // same sample again, same question again: no new binding, no new revision
    expect(await s.useSample('orders')).toBe(true);
    expect(await s.selectQuestion('top')).toBe(true);
    expect(calls.filter((c) => c.startsWith('loadDataset'))).toEqual(['loadDataset rows']);
    expect(calls.filter((c) => c.startsWith('upsertSpec'))).toEqual(['upsertSpec topCustomersByRevenue']);
    expect(await s.ask()).toBe(true);
    expect(calls[calls.length - 1]).toBe('submit topCustomersByRevenue(rows)');
    // a question without a seed: spec-less, empty agreement, no upsert
    expect(await s.selectQuestion('status')).toBe(true);
    expect(s.seed.value).toBeNull();
    expect(s.agreement.value.empty).toBe(true);
    expect(calls.filter((c) => c.startsWith('upsertSpec'))).toHaveLength(1);
    s.dispose();
  });

  it('live mode: the seeded agreement is always installed (full checks)', async () => {
    const { engine, calls } = fakeEngine('live');
    let fetched = 0;
    const s = createSession(engine, { recordings: async () => (fetched++, []) });
    expect(await s.useSample('orders')).toBe(true);
    expect(s.seedState.value).toBe('installed');
    expect(s.questions.value.map((q) => q.level)).toEqual(['basic', 'full', 'basic']);
    await vi.waitFor(() => expect(s.availability.value).toEqual({ status: 'live', top: 'live', country: 'live' }));
    expect(calls).toEqual(['loadDataset rows', 'upsertSpec topCustomersByRevenue']);
    expect(fetched).toBe(0); // live mode never needs the recordings
    s.dispose();
  });

  it('a typed question: added, selected, its words installed as the contract, then asked (basic checks)', async () => {
    const { engine, calls, state } = fakeEngine('live');
    const s = createSession(engine);
    await s.useSample('orders');
    expect(await s.addQuestion('How many orders were refunded?')).toBe(true);
    expect(s.questionId.value).toBe('own:howManyOrdersWereRefunded');
    expect(s.question.value).toMatchObject({ call: 'howManyOrdersWereRefunded(rows)', level: 'basic', text: 'How many orders were refunded?' });
    expect(s.questions.value).toHaveLength(4);
    expect(s.agreement.value.empty).toBe(true);
    // the same words again select the same chip, not a second one
    expect(await s.addQuestion('how many orders were refunded?')).toBe(true);
    expect(s.questions.value).toHaveLength(4);
    expect(await s.ask()).toBe(true);
    expect(calls.slice(-2)).toEqual(['upsertSpec howManyOrdersWereRefunded', 'submit howManyOrdersWereRefunded(rows)']);
    const spec = state.value.program.functions.howManyOrdersWereRefunded!.spec;
    expect(spec.doc).toContain('How many orders were refunded?');
    expect(spec.tests).toBe('');
    // asking again does not install it twice
    await s.ask();
    expect(calls.filter((c) => c === 'upsertSpec howManyOrdersWereRefunded')).toHaveLength(1);
    // other data: typed questions belong to the table they were typed for
    await s.useSample('sales');
    expect(s.questions.value.some((q) => q.id.startsWith('own:'))).toBe(false);
    s.dispose();
  });

  it('removing a typed question: only the viewer\'s own go; the selection moves to the first one left', async () => {
    const { engine } = fakeEngine('live');
    const s = createSession(engine);
    await s.useSample('orders');
    await s.addQuestion('How many orders were refunded?');
    await s.addQuestion('Which country has the most orders?');
    expect(s.questions.value).toHaveLength(5);
    // a suggestion cannot be removed
    expect(await s.removeQuestion('status')).toBe(false);
    expect(s.questions.value).toHaveLength(5);
    // an unselected typed question goes; the selection stays
    expect(s.questionId.value).toBe('own:whichCountryHasTheMostOrders');
    expect(await s.removeQuestion('own:howManyOrdersWereRefunded')).toBe(true);
    expect(s.questions.value.map((q) => q.id)).toEqual(['status', 'top', 'country', 'own:whichCountryHasTheMostOrders']);
    expect(s.questionId.value).toBe('own:whichCountryHasTheMostOrders');
    // the selected one goes: the first suggestion is selected (its agreement installed as for any selection)
    expect(await s.removeQuestion('own:whichCountryHasTheMostOrders')).toBe(true);
    expect(s.questions.value.map((q) => q.id)).toEqual(['status', 'top', 'country']);
    expect(s.questionId.value).toBe('status');
    expect(s.run.value).toBeNull();
    // gone is gone
    expect(await s.removeQuestion('own:whichCountryHasTheMostOrders')).toBe(false);
    s.dispose();
  });

  it('removing a typed question is refused while the engine is busy', async () => {
    const { engine, state } = fakeEngine('live');
    const s = createSession(engine);
    await s.useSample('orders');
    await s.addQuestion('How many orders were refunded?');
    state.value = { ...state.value, busy: true };
    expect(await s.removeQuestion('own:howManyOrdersWereRefunded')).toBe(false);
    expect(s.questions.value).toHaveLength(4);
    s.dispose();
  });

  it('seed off: no agreement is installed; the call goes out spec-less', async () => {
    const { engine, calls } = fakeEngine('live');
    const s = createSession(engine, { seed: false, sampleNames: { orders: 'data' } });
    await s.useSample('orders');
    expect(s.question.value?.call).toBe('topCustomersByRevenue(data)');
    expect(s.seed.value).toBeNull();
    expect(s.question.value?.level).toBe('basic');
    await s.ask();
    expect(calls).toEqual(['loadDataset data', 'submit topCustomersByRevenue(data)']);
    s.dispose();
  });

  it('own file: refusals in plain words; a good file binds under its own name with its rows', async () => {
    const { engine } = fakeEngine();
    const s = createSession(engine);
    expect(await s.intakeText({ text: 'a:b:c\n1:2:3', filename: 'q3.csv' })).toBe(false);
    expect(s.intake.value.problem).toBe('Only 1 column found. Is the delimiter ":"?');
    expect(await s.intakeText({ text: '', filename: 'q3.csv' })).toBe(false);
    expect(s.intake.value.problem).toBe('q3.csv is empty. Nothing to load.');
    expect(s.source.value).toBe('none');
    expect(await s.intakeText({ text: 'region,amount\nwest,10\neast,5', filename: 'Sales Q3.csv' })).toBe(true);
    expect(s.source.value).toBe('own');
    expect(s.dataset.value?.name).toBe('salesQ3');
    expect(s.rows.value).toEqual([{ region: 'west', amount: 10 }, { region: 'east', amount: 5 }]);
    expect(s.intake.value.problem).toBeNull();
    expect(s.questions.value.length).toBeGreaterThan(0);
    expect(s.questionId.value).toBe(s.questions.value[0]!.id);
    // reset: nothing bound, the dataset lookup is live
    await s.reset();
    expect(s.source.value).toBe('none');
    expect(s.dataset.value).toBeNull();
    s.dispose();
  });

  it('refuses to change file or question while the engine is busy', async () => {
    const { engine, state } = fakeEngine();
    const s = createSession(engine);
    await s.useSample('sales');
    state.value = { ...state.value, busy: true };
    expect(s.canChange.value).toBe(false);
    expect(await s.useSample('orders')).toBe(false);
    expect(await s.selectQuestion('status')).toBe(false);
    expect(await s.ask()).toBe(false);
    expect(s.sampleId.value).toBe('sales');
    expect(s.questionId.value).toBe('region');
    s.dispose();
  });
});

// ───────────────────────── the shared session across a route change (#/start <-> #/zen) ─────────────────────────

describe('the shared session across a route change', () => {
  it('a session made after the last was disposed takes up what was bound and picked (the engine still holds the file)', async () => {
    const { engine, calls } = fakeEngine('live');
    const a = sessionFor(engine);
    expect(sessionFor(engine)).toBe(a);
    await a.useSample('orders');
    await a.addQuestion('How many orders were refunded?');
    await a.selectQuestion('top');
    expect(a.questions.value).toHaveLength(4);
    a.dispose();

    // the other page: same file, same suggestions + the typed one, same selection, the table's rows, the chip text
    const b = sessionFor(engine);
    expect(b).not.toBe(a);
    expect(b.source.value).toBe('sample');
    expect(b.fileChip.value).toBe('orders.csv · 332 rows · 10 columns');
    expect(b.rows.value).toHaveLength(332);
    expect(b.questions.value.map((q) => q.id)).toEqual(['status', 'top', 'country', 'own:howManyOrdersWereRefunded']);
    expect(b.questionId.value).toBe('top');
    expect(b.question.value?.text).toBe('Who are our top customers by revenue?');
    // its agreement is put back as it was (installed once: not written again)
    await vi.waitFor(() => expect(b.seedState.value).toBe('installed'));
    expect(calls.filter((c) => c.startsWith('upsertSpec topCustomersByRevenue'))).toHaveLength(1);
    expect(await b.ask()).toBe(true);

    // and back again
    b.dispose();
    const c = sessionFor(engine);
    expect(c.questionId.value).toBe('top');
    expect(c.questions.value).toHaveLength(4);
    c.dispose();
  });

  it('own file: the rows travel too (zen\'s table and start\'s suggestions come from them)', async () => {
    const { engine } = fakeEngine('live');
    const a = sessionFor(engine);
    expect(await a.intakeText({ text: 'region,amount\nwest,10\neast,5', filename: 'Sales Q3.csv' })).toBe(true);
    const first = a.questionId.value;
    a.dispose();
    const b = sessionFor(engine);
    expect(b.source.value).toBe('own');
    expect(b.rows.value).toEqual([{ region: 'west', amount: 10 }, { region: 'east', amount: 5 }]);
    expect(b.questionId.value).toBe(first);
    expect(b.questions.value.length).toBeGreaterThan(0);
    b.dispose();
  });

  it('nothing bound stays nothing bound; a reset is not undone by the next page', async () => {
    const { engine } = fakeEngine('live');
    const a = sessionFor(engine);
    a.dispose();
    expect(sessionFor(engine).source.value).toBe('none');
    const b = sessionFor(engine);
    await b.useSample('sales');
    await b.reset();
    b.dispose();
    const c = sessionFor(engine);
    expect(c.source.value).toBe('none');
    expect(c.questions.value).toEqual([]);
    c.dispose();
  });

  it('what rendered with the old session renders again with the new one (the new page renders before the old one unmounts)', async () => {
    const { engine } = fakeEngine('live');
    const old = sessionFor(engine);
    const seen: Session[] = [];
    const stop = effect(() => {
      seen.push(sessionFor(engine));
    });
    expect(seen).toEqual([old]);
    old.dispose();
    const next = sessionFor(engine);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.at(-1)).toBe(next);
    stop();
    next.dispose();
  });
});

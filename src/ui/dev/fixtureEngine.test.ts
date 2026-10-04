import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATE_ORDER, type EngineState } from '../../types';
import { createFixtureEngine } from './fixtureEngine';
import { MEDIAN_PROPS_SUMMARY, SCENARIO_NAMES, SCENARIOS } from './fixtures';
import { dataDrawerOpen, lowerTab, pendingRecording, sessionLogOpen, shareOpen } from '../uiState';

const REQUIRED = [
  'opening', 'generating', 'rejected-properties', 'committed', 'cached', 'compile-rejected', 'invariant-timeout',
  'no-tests', 'budget-exhausted', 'rejected-silent', 'service-error', 'fault-restart', 'replay-banner', 'repo-stale', 'many-revisions',
  'declined-pure', 'declined-spec', 'spec-less-accept', 'table-result', 'pinned', 'data-drawer-open',
  'share-dialog', 'load-recording', 'session-log', 'recording-loaded',
];

function checkInvariants(s: EngineState): void {
  for (const a of s.generation?.attempts ?? []) {
    if (a.gates.length) expect(a.gates.map((g) => g.gate)).toEqual(GATE_ORDER);
    if (a.candidate) expect(a.candidate.gates.map((g) => g.gate)).toEqual(GATE_ORDER);
    // "What the model saw" must be visible with ?fixture=: every candidate carries the real prompt
    if (a.candidate) expect(a.candidate.prompt).toContain('HARD RULES');
    if (a.candidate) expect(a.candidate.prompt!.includes('PREVIOUS ATTEMPT')).toBe(a.attempt > 1);
    if (a.status === 'rejected') expect(a.gates.some((g) => g.status === 'fail')).toBe(true);
  }
  const ids = s.repl.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(s.revisions.some((r) => r.id === s.headRevision)).toBe(true);
}

describe('fixture scenarios', () => {
  it('provides every required scenario with contract-consistent state', () => {
    for (const name of REQUIRED) expect(SCENARIO_NAMES).toContain(name);
    for (const name of SCENARIO_NAMES) checkInvariants(SCENARIOS[name]());
  });

  it('rejected-properties carries the headline and a shrunk diagnostic', () => {
    const g = SCENARIOS['rejected-properties']().generation!;
    expect(g.attempts[0].candidate?.headline).toBe('Rejected: median([1, 2]) returned 1, expected 1.5');
    const props = g.attempts[0].gates.find((x) => x.gate === 'properties')!;
    expect(props.diagnostics[0]).toMatchObject({ kind: 'property', shrinks: 14 });
    expect(g.attempts[1].status).toBe('generating');
  });

  it('declined-pure / declined-spec: one aborted candidate carrying the decline, no gate run, program unchanged', () => {
    for (const [name, fn, reason] of [
      ['declined-pure', 'now', 'cannot-be-pure'],
      ['declined-spec', 'clean', 'needs-spec'],
    ] as const) {
      const s = SCENARIOS[name]();
      const g = s.generation!;
      expect(g).toMatchObject({ fn, phase: 'failed', ungated: true });
      expect(g.declined!.reason).toBe(reason);
      expect(g.attempts).toHaveLength(1);
      expect(g.attempts[0]).toMatchObject({ status: 'aborted' });
      expect(g.attempts[0]!.candidate!.declined).toEqual(g.declined);
      expect(g.attempts[0]!.candidate!.prompt).toContain('HONESTY (when not to write the function)');
      expect(g.attempts[0]!.gates.every((x) => x.status === 'skipped' && x.summary === 'not run')).toBe(true);
      expect(s.program.functions[fn]).toBeUndefined();
      const err = s.repl[s.repl.length - 1]!;
      expect(err).toMatchObject({ kind: 'error', name: 'Declined' });
    }
  });

  it('table-result / pinned: a table under a pinnable spec-less result over the bound orders; pinned adds the pin', () => {
    const t = SCENARIOS['table-result']();
    const out = t.repl.find((e) => e.kind === 'output' && e.pinnable)!;
    expect(out).toMatchObject({ kind: 'output', label: 'generated', pinnable: { fn: 'topCustomersByRevenue', call: 'topCustomersByRevenue(rows)' } });
    expect(out.kind === 'output' && out.table?.columns).toEqual(['customer', 'revenue']);
    const all = t.repl.filter((e) => e.kind === 'output' && e.table && e.table.rows.length < e.table.total);
    expect(all.length).toBeGreaterThan(0); // "showing 100 of 332 rows"
    expect(t.datasets.map((d) => d.name)).toEqual(['rows']);
    expect(t.generation!.attempts[0]!.candidate!.prompt).toContain('A few rows, spread across the data');
    const p = SCENARIOS.pinned();
    expect(p.program.functions.topCustomersByRevenue!.spec.pins).toHaveLength(1);
    expect(p.repl.some((e) => e.kind === 'output' && e.pinned)).toBe(true);
  });

  it('property summaries use the executor format (total runs, then runs per named property)', () => {
    expect(MEDIAN_PROPS_SUMMARY).toMatch(/^2\/2 properties held \(200 runs: "[^"]+" 100, "[^"]+" 100\)$/);
  });

  it('returns fresh state objects per call', () => {
    expect(SCENARIOS.committed()).not.toBe(SCENARIOS.committed());
  });
});

describe('fixture engine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('setInput replaces the state object (signal subscribers re-render)', () => {
    const e = createFixtureEngine('opening');
    const before = e.state.value;
    e.setInput('median([5])');
    expect(e.state.value).not.toBe(before);
    expect(e.state.value.replInput).toBe('median([5])');
    expect(before.replInput).toBe('median([3, 1, 4, 2])');
  });

  it('plays opening → rejected by properties → committed, then answers from the cache', async () => {
    const e = createFixtureEngine('opening');
    const seen = new Set<string>();
    const stop = e.state.subscribe((s) => {
      const g = s.generation;
      if (g) seen.add(`${g.phase}:${g.attempts.map((a) => a.status).join(',')}`);
    });
    const done = e.submit();
    await vi.runAllTimersAsync();
    await done;
    stop();

    const s = e.state.value;
    expect(seen).toContain('generating:generating');
    expect(seen).toContain('generating:typing');
    expect(seen).toContain('gating:gating');
    expect(seen).toContain('gating:rejected');
    expect(seen).toContain('generating:rejected,generating');
    expect(s.generation?.phase).toBe('committed');
    expect(s.generation?.attempts.map((a) => a.status)).toEqual(['rejected', 'accepted']);
    expect(s.generation?.attempts[0].candidate?.rejectedBy).toBe('properties');
    expect(s.repl.map((r) => r.kind)).toEqual(['input', 'error', 'info', 'output']);
    expect(s.repl[3]).toMatchObject({ value: '2.5', label: 'generated' });
    expect(s.busy).toBe(false);
    expect(s.program.functions.median.artifact?.candidates).toHaveLength(2);

    e.setInput('median([1, 2])');
    await e.submit();
    const tail = e.state.value.repl.slice(-3);
    expect(tail[1]).toMatchObject({ kind: 'output', value: '1.5', label: 'cached artifact' });
    expect(tail[2].kind).toBe('takeaway');
  });

  it('typewriter reveals the body progressively', async () => {
    const e = createFixtureEngine('opening');
    const lengths: number[] = [];
    const stop = e.state.subscribe((s) => {
      const a = s.generation?.attempts[0];
      if (a?.status === 'typing') lengths.push(a.shown.length);
    });
    const done = e.submit();
    await vi.runAllTimersAsync();
    await done;
    stop();
    expect(lengths.length).toBeGreaterThan(10);
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
  });

  it('editSpec makes an artifact stale and records a revision', async () => {
    const e = createFixtureEngine('committed');
    await e.editSpec('median', { doc: 'changed' });
    const rec = e.state.value.program.functions.median;
    expect(rec.spec.doc).toBe('changed');
    expect(rec.specHash).not.toBe(rec.artifact!.specHash);
    expect(e.state.value.revisions.at(-1)).toMatchObject({ kind: 'spec-edit', id: 3 });
    expect(e.state.value.headRevision).toBe(3);
  });

  it('data-drawer-open opens the drawer; pinned opens the Repo tab', () => {
    dataDrawerOpen.value = false;
    lowerTab.value = 'revisions';
    createFixtureEngine('data-drawer-open');
    expect(dataDrawerOpen.value).toBe(true);
    createFixtureEngine('pinned');
    expect(lowerTab.value).toBe('repo');
    dataDrawerOpen.value = false;
    lowerTab.value = 'revisions';
  });

  it('previews and loads pasted data with the real parser, pins and unpins a result', async () => {
    vi.useRealTimers();
    const e = createFixtureEngine('table-result');
    const p = await e.previewDataset({ text: 'a,b\n1,x\n2,y\n' });
    expect(p).toMatchObject({ ok: true, rowCount: 2, typeDecl: 'type Row = { a: number; b: string }' });
    await e.loadDataset({ text: 'a,b\n1,x\n', name: 'small' });
    expect(e.state.value.datasets.map((d) => d.name)).toEqual(['rows', 'small']);
    await e.removeDataset('small');
    expect(e.state.value.datasets.map((d) => d.name)).toEqual(['rows']);
    const out = e.state.value.repl.find((x) => x.kind === 'output' && x.pinnable)!;
    await e.pinResult(out.id);
    const fn = e.state.value.program.functions.topCustomersByRevenue!;
    expect(fn.spec.pins).toHaveLength(1);
    await e.removePin('topCustomersByRevenue', fn.spec.pins![0]!.id);
    expect(e.state.value.program.functions.topCustomersByRevenue!.spec.pins).toBeUndefined();
    e.setSendSamples(false);
    expect(e.state.value.send.samples).toBe(false);
  });

  it('invokeRestart resolves the entry', async () => {
    const e = createFixtureEngine('fault-restart');
    const open = e.state.value.repl.find((r) => r.kind === 'error' && !r.resolved)!;
    await e.invokeRestart(open.id, 'retry');
    const after = e.state.value.repl.find((r) => r.id === open.id);
    expect(after).toMatchObject({ resolved: true });
  });

  it("'edit-spec' points the UI at a function with a fresh nonce, like the engine", async () => {
    const e = createFixtureEngine('fault-restart');
    const open = e.state.value.repl.find((r) => r.kind === 'error' && !r.resolved)!;
    await e.invokeRestart(open.id, 'edit-spec');
    const first = e.state.value.focusSpec;
    expect(first).toMatchObject({ fn: 'median' });
    expect(typeof first?.nonce).toBe('number');
  });

  it('sharing scenarios open their dialog; the fixture loads a recording and keeps the log count', async () => {
    createFixtureEngine('share-dialog');
    expect(shareOpen.value).toBe(true);
    createFixtureEngine('session-log');
    expect(sessionLogOpen.value).toBe(true);
    const e = createFixtureEngine('load-recording');
    expect(pendingRecording.value?.preview.ok).toBe(true);
    await e.loadRecording(pendingRecording.value!.input);
    expect(e.state.value.loadedRecording).toMatchObject({ dismissed: false });
    expect(e.state.value.replInput).toBe(e.state.value.loadedRecording!.calls[0]);
    e.dismissRecordingBanner();
    expect(e.state.value.loadedRecording!.dismissed).toBe(true);
    expect((await e.previewRecording({ text: 'nope' })).ok).toBe(false);
    shareOpen.value = false;
    sessionLogOpen.value = false;
    pendingRecording.value = null;
  });
});

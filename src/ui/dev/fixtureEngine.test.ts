import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATE_ORDER, type EngineState } from '../../types';
import { createFixtureEngine } from './fixtureEngine';
import { SCENARIO_NAMES, SCENARIOS } from './fixtures';

const REQUIRED = [
  'opening', 'generating', 'rejected-properties', 'committed', 'cached', 'compile-rejected', 'invariant-timeout',
  'no-tests', 'budget-exhausted', 'service-error', 'fault-restart', 'replay-banner', 'repo-stale', 'many-revisions',
];

function checkInvariants(s: EngineState): void {
  for (const a of s.generation?.attempts ?? []) {
    if (a.gates.length) expect(a.gates.map((g) => g.gate)).toEqual(GATE_ORDER);
    if (a.candidate) expect(a.candidate.gates.map((g) => g.gate)).toEqual(GATE_ORDER);
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
});

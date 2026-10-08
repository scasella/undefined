import { describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import ts from 'typescript';
import type { FunctionSpec, GenerateResult } from '@scasella/undefined-engine/types';
import { createDraft, type DraftDeps } from './draft';
import type { Session } from './session';
import type { Transpiler } from '../model/specDraft';

const FN = 'howManyOrdersWereRefunded';
const Q = { id: 'own:x', label: 'How many orders were refunded?', text: 'How many orders were refunded?', call: `${FN}(rows)`, fn: FN, level: 'basic' as const, doc: 'How many orders were refunded?' };

function fakeSession(mode: 'live' | 'replay' = 'live') {
  const program = signal<{ functions: Record<string, { spec: FunctionSpec }> }>({ functions: {} });
  const applied: FunctionSpec[] = [];
  const engineState = signal({ mode, program: program.value, send: { samples: false, sampleRows: 3 } });
  const s = {
    engine: { state: engineState },
    sampleId: signal<string | null>(null),
    availability: signal<Record<string, string>>({}),
    questionId: signal<string | null>(Q.id),
    question: signal<typeof Q | null>(Q),
    dataset: signal({ name: 'rows', typeName: 'Row', typeDecl: 'type Row = { id: number; status: string };', rowCount: 3 }),
    rows: signal([{ id: 1, status: 'refunded' }]),
    seed: signal(null),
    applySpec: vi.fn(async (spec: FunctionSpec) => {
      applied.push(spec);
      engineState.value = { ...engineState.value, program: { functions: { [FN]: { spec } } } };
      return true;
    }),
  };
  return { session: s as unknown as Session, applied, s };
}

const reply = (body: unknown): GenerateResult => ({ body: JSON.stringify(body), notes: '', model: 't', codexVersion: 't', durationMs: 1, source: 'live', progress: [] });
const ASKS = { questions: [{ ask: 'Do partial refunds count?', why: 'It changes the count.', options: ['Yes', 'No'] }] };
const DRAFT = {
  questions: [],
  contract: 'Counts rows whose status is "refunded".',
  returns: 'number',
  examples: [{ name: 'one refund', plain: 'One refunded row gives 1.', assumption: '', source: `test("one refund", () => { eq(${FN}([{ id: 1, status: "refunded" }]), 1); });` }],
  rules: [],
  shows: 's',
  limits: 'l',
};

function deps(replies: unknown[]): DraftDeps & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    generate: async (req) => {
      prompts.push(req.prompt);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return reply(next);
    },
    loadTs: async () => ts as unknown as Transpiler,
  };
}

describe('drafting stricter checks', () => {
  it('is offered in live mode for a question with no checks of its own; in the demo only where a draft was recorded', () => {
    expect(createDraft(fakeSession('live').session, deps([])).offered.value).toBe(true);
    expect(createDraft(fakeSession('replay').session, deps([])).offered.value).toBe(false);
  });

  it('asks first, sends the answers back, and installs only after approval', async () => {
    const { session, applied } = fakeSession();
    const d = deps([ASKS, DRAFT]);
    const draft = createDraft(session, d);
    await draft.start();
    expect(draft.state.value.phase).toBe('asking');
    expect(draft.pending.value).toBe(true);
    await draft.answer([{ ask: 'Do partial refunds count?', answer: 'No' }]);
    expect(d.prompts[1]).toContain('- Do partial refunds count? → No');
    expect(draft.state.value.phase).toBe('review');
    expect(applied).toHaveLength(0);
    expect(await draft.approve()).toBe(true);
    expect(applied[0]!.doc).toContain('- Do partial refunds count? No');
    expect(applied[0]!.tests).toContain('one refund');
    expect(draft.state.value.phase).toBe('approved');
    expect(draft.pending.value).toBe(false);
    expect(draft.offered.value).toBe(false);
  });

  it('nothing kept, nothing approved; putting it away installs nothing', async () => {
    const { session, applied } = fakeSession();
    const draft = createDraft(session, deps([DRAFT]));
    await draft.start();
    draft.toggle('e1');
    expect(await draft.approve()).toBe(false);
    draft.discard();
    expect(draft.state.value.phase).toBe('idle');
    expect(applied).toHaveLength(0);
  });

  it('a check that does not parse goes back to the model once with the reason, then says what went wrong', async () => {
    const broken = { ...DRAFT, examples: [{ ...DRAFT.examples[0], source: `test("one refund", () => { eq(${FN}([]), 0 });` }] };
    const d = deps([broken, DRAFT]);
    const draft = createDraft(fakeSession().session, d);
    await draft.start();
    expect(d.prompts[1]).toMatch(/could not be used: check "one refund" has a syntax error/);
    expect(draft.state.value.phase).toBe('review');
    const d2 = deps([broken, broken]);
    const draft2 = createDraft(fakeSession().session, d2);
    await draft2.start();
    expect(draft2.state.value.phase).toBe('error');
  });

  it('stops asking after two rounds', async () => {
    const d = deps([ASKS, ASKS, DRAFT]);
    const draft = createDraft(fakeSession().session, d);
    await draft.start();
    await draft.answer([{ ask: 'a', answer: 'b' }]);
    await draft.answer([{ ask: 'c', answer: 'd' }]);
    expect(d.prompts[2]).toContain('Do NOT ask anything more');
  });

  it('questions after the last round are not shown: they go back once, then the draft is an error', async () => {
    const d = deps([ASKS, ASKS, ASKS, ASKS]);
    const draft = createDraft(fakeSession().session, d);
    await draft.start();
    await draft.answer([{ ask: 'a', answer: 'b' }]);
    await draft.answer([{ ask: 'c', answer: 'd' }]);
    expect(d.prompts[3]).toContain('you were told not to ask more questions');
    expect(draft.state.value.phase).toBe('error');
  });

  it('TypeScript that will not load is an error, not a draft stuck drafting', async () => {
    const d = deps([DRAFT]);
    d.loadTs = () => Promise.reject(new Error('chunk failed'));
    const draft = createDraft(fakeSession().session, d);
    await draft.start();
    expect(draft.state.value).toMatchObject({ phase: 'error' });
    expect(draft.state.value.error).toContain('chunk failed');
  });

  it('belongs to one question: selecting another puts it away', async () => {
    const { session, s } = fakeSession();
    const draft = createDraft(session, deps([DRAFT]));
    await draft.start();
    expect(draft.pending.value).toBe(true);
    s.questionId.value = 'other';
    expect(draft.state.value.phase).toBe('idle');
    expect(draft.pending.value).toBe(false);
  });

  it('a model that cannot be reached is said, and can be tried again', async () => {
    const draft = createDraft(fakeSession().session, deps([new Error('Could not reach the local generation service'), DRAFT]));
    await draft.start();
    expect(draft.state.value).toMatchObject({ phase: 'error', error: 'Could not reach the local generation service' });
    await draft.start();
    expect(draft.state.value.phase).toBe('review');
  });
});

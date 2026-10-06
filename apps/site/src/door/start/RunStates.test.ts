import { describe, expect, it } from 'vitest';
import type { GapQuestion, GenerationView } from '@scasella/undefined-engine/types';
import { routeAnchor, parseHash } from '../router';
import { confirmKey, draftingView, HOUSE_RULE_HREF } from './RunPanel';
import { declinedView, DECLINE_WHY, gapPreview, gapView, OWN_FILE_HREF, savedRuleText, serviceView, thrownOutView } from './RunStates';

const gap: GapQuestion = {
  fn: 'median',
  kind: 'empty',
  call: 'median([])',
  args: [[]],
  silentOn: 'what the median of nothing is',
  check: { name: 'empty list', kind: 'property', gate: 'properties' },
  expectedShown: 'NaN',
  actualShown: '0',
  alternatives: [
    { id: 'tests', label: 'NaN', source: 'tests', outcome: { returns: { $nan: true } as never }, agrees: true },
    { id: 'candidate', label: '0', source: 'candidate', outcome: { returns: 0 }, agrees: false, disabled: 'only the `check` answer can be taken' },
    { id: 'throws', label: 'throws', source: 'common', outcome: { throws: true }, agrees: false },
    { id: 'rel', label: 'same as median([2])', source: 'declared', relational: { args: [[2]], label: 'same as median([2])' }, agrees: false },
  ],
  ruleScope: { label: 'for every empty list' },
};

describe('gapView', () => {
  it('words the engine question plainly, never in engine vocabulary', () => {
    const v = gapView(gap);
    expect(v.head).toBe('What should happen in this case?');
    expect(v.body).toContain('“what the median of nothing is”');
    expect(v.caseLine).toBe('draft gave 0 · your house rule expects NaN');
    expect(v.options.map((o) => o.label)).toEqual(['Gives NaN', 'Gives 0', 'Stops and shows an error', 'Gives the same as median([2])']);
    expect(v.options.map((o) => o.tag)).toEqual(['what your check expects', 'what the draft did', 'a common choice', 'listed by your rule']);
    expect(v.options[1]!.disabled).toBe('only the check answer can be taken');
    expect(v.scope).toBe('for every empty list');
    const all = JSON.stringify(v);
    for (const w of ['spec', 'gate', 'property', 'mutant', 'revision', 'fuzz']) expect(all.toLowerCase()).not.toContain(w);
  });
  it('previews the rule live, and the saved sentence drops the lead-in', () => {
    const v = gapView(gap);
    expect(gapPreview(v, null, 'call', v.scope)).toBe('Pick what should happen. Nothing is saved until you do.');
    expect(gapPreview(v, 'candidate', 'call', v.scope)).toBe('Pick what should happen. Nothing is saved until you do.');
    const p = gapPreview(v, 'tests', 'call', v.scope);
    expect(p).toBe('This adds a house rule: median([]) gives NaN.');
    expect(gapPreview(v, 'throws', 'rule', v.scope)).toBe('This adds a house rule: for every empty list, it stops and shows an error.');
    expect(savedRuleText(p)).toBe('Median([]) gives NaN.');
  });
});

describe('declinedView', () => {
  it('uses the reason for Why and the model sentence for What would help', () => {
    const v = declinedView('needs-spec', 'Say which status counts as revenue.', 'Top 5 customers by revenue');
    expect(v).toEqual({ asked: 'YOU ASKED · Top 5 customers by revenue', why: DECLINE_WHY['needs-spec'], help: 'Say which status counts as revenue.' });
    expect(declinedView('cannot-be-pure', '  ', 'x').help.length).toBeGreaterThan(0);
  });
});

describe('thrownOutView', () => {
  const rejected = (attempt: number) => ({
    attempt,
    status: 'rejected' as const,
    shown: '',
    gates: [{ gate: 'compile' as const, status: 'fail' as const, ms: 1, headline: 'Rejected: does not compile', diagnostics: [] }],
  });
  it('gives the last rejection and the drafts tried', () => {
    const gen = { id: 'g', fn: 'f', signature: '', call: 'f(x)', phase: 'failed', attempt: 2, maxAttempts: 2, progress: [], attempts: [rejected(1), rejected(2)], ungated: true, mode: 'replay' } as unknown as GenerationView;
    const v = thrownOutView(gen, { examples: 0, pins: 0, houseRules: 0 } as never, true);
    expect(v.tried).toBe('2 drafts tried');
    expect(v.last.startsWith('Second draft thrown out')).toBe(true);
    expect(v.recorded).toContain('recorded drafts ran out');
    expect(thrownOutView(null, {} as never, false)).toEqual({ last: 'No draft passed every check.', tried: '0 drafts tried', recorded: null });
  });
});

describe('serviceView', () => {
  it('keeps the exact fix commands', () => {
    const v = serviceView({ kind: 'service', error: { code: 'not_logged_in', message: 'Codex is not logged in.', fix: ['codex login'] } });
    expect(v.fix).toEqual(['codex login']);
    expect(serviceView({ kind: 'error', name: 'TypeError', message: 'x is undefined' }).text).toBe('TypeError: x is undefined');
  });
});

describe('cross-route links', () => {
  it('route to the landing and carry the anchor', () => {
    for (const href of [HOUSE_RULE_HREF, OWN_FILE_HREF]) expect(parseHash(href)).toBe('landing');
    expect(routeAnchor(HOUSE_RULE_HREF)).toBe('asks');
    expect(routeAnchor(OWN_FILE_HREF)).toBe('own-file');
    expect(routeAnchor('#/')).toBeNull();
    expect(routeAnchor('#asks')).toBeNull();
    expect(routeAnchor('#/start')).toBeNull();
  });
  it('confirmations reset per run', () => {
    expect(confirmKey(null)).toBe('');
    expect(confirmKey({ id: 3, questionId: 'top' })).not.toBe(confirmKey({ id: 4, questionId: 'top' }));
  });
});

describe('draftingView', () => {
  const gen = (o: Partial<Pick<GenerationView, 'phase' | 'mode' | 'kind' | 'attempt'>>) => ({ phase: 'generating' as const, mode: 'live' as const, attempt: 1, ...o });
  it('says the AI is writing, not that the checks run, while the draft is being written', () => {
    const v = draftingView(gen({}))!;
    expect(v.runningText).toBe('drafting…');
    expect(v.footer.text).toContain('The AI is writing draft 1.');
    expect(v.footer.text).toContain('trusted until it passes the checks');
    expect(v.liveText).toContain('writing draft 1');
    expect(draftingView(gen({ attempt: 2 }))!.footer.text).toContain('draft 2');
  });
  it('labels the demo wait as a recording, without claiming its pace', () => {
    const v = draftingView(gen({ mode: 'replay' }))!;
    expect(v.runningText).toBe('drafting · from the recording');
    expect(v.footer.text).toContain("Replaying the AI's recorded draft 1.");
    expect(JSON.stringify(v)).not.toMatch(/pace/i);
    expect(v.liveText).toContain('recorded draft 1');
  });
  it('is null once the checks run, once it is over, or when no model was asked', () => {
    expect(draftingView(null)).toBeNull();
    for (const phase of ['gating', 'committed', 'failed'] as const) expect(draftingView(gen({ phase }))).toBeNull();
    expect(draftingView(gen({ kind: 'recheck' }))).toBeNull();
  });
  it('never uses engine words and claims no duration', () => {
    for (const mode of ['live', 'replay'] as const) {
      const all = JSON.stringify(draftingView(gen({ mode })));
      expect(all).not.toMatch(/\b(gate|spec|property|fuzz|mutant|revision|pin)\b/i);
      expect(all).not.toMatch(/\d+(\.\d+)? ?(s|ms|sec|seconds)\b/);
    }
  });
});

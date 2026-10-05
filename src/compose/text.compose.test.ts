import { describe, expect, it } from 'vitest';
import type { Evidence, GateResult } from '../types';
import { describeEvidence } from '../shared/evidence';
import { plainEvidence } from '../ui/evidence';
import { modelSawSummary, promptFeatures, promptOthers, whoDecided } from '../ui/explain';
import { buildPrompt } from '../shared/prompt';

const EV: Evidence = { compiled: true, unitTests: 2, pinnedTests: 0, properties: [{ name: 'p', runs: 100 }], sampledCalls: 3 };
const SPEC = { name: 'slugifyAll', params: [{ name: 'titles', type: 'string[]' }], returns: 'string[]', doc: 'd', tests: '', properties: '', budgetMs: 1000, maxAttempts: 3, origin: 'user' as const };

describe('words where a dependency matters', () => {
  it('the evidence line is unchanged without callees and says so with them', () => {
    expect(describeEvidence(EV, [])).toBe(describeEvidence(EV));
    // before the broken-copy check has run nothing was mutated: the line must not say what was
    expect(describeEvidence(EV, ['slugify'])).toBe(`${describeEvidence(EV).replace(' Mutation check: not run yet.', '')} Checked together with slugify, which it calls. Mutation check: not run yet.`);
    expect(plainEvidence(EV, [])).toBe(plainEvidence(EV));
    expect(plainEvidence(EV, ['slugify', 'trim'])).toContain('It calls slugify, trim: every check ran with those functions as certified. The broken-copy check has not run yet.');
    expect(plainEvidence(EV, ['slugify'])).not.toContain('broken on purpose');
  });

  it('says only its own code was mutated once broken copies actually ran, and not when the check was skipped', () => {
    const ran: Evidence = { ...EV, mutation: { total: 10, killed: 9, killedByBound: 0, survived: 1, stillborn: 0, survivors: [], ms: 5, at: 1 } };
    expect(describeEvidence(ran, ['slugify'])).toContain('Checked together with slugify, which it calls; only its own code was mutated.');
    expect(plainEvidence(ran, ['slugify'])).toContain('It calls slugify: every check ran with that function as certified, and only its own code was broken on purpose. Your checks caught 9 of 10');
    const skipped: Evidence = { ...EV, mutation: { total: 0, killed: 0, killedByBound: 0, survived: 0, stillborn: 0, survivors: [], ms: 0, at: 1, skipped: 'no tests yet' } };
    expect(describeEvidence(skipped, ['slugify'])).not.toContain('mutated');
    expect(plainEvidence(skipped, ['slugify'])).not.toContain('broken on purpose');
  });

  it('"what the model saw" names the functions it was offered, and only when it was', () => {
    const plain = buildPrompt({ spec: SPEC, history: [] });
    const offered = buildPrompt({ spec: SPEC, history: [], others: [{ decl: 'function slugify(title: string): string', doc: 'Slugs.' }] });
    expect(promptOthers(plain)).toEqual([]);
    expect(promptFeatures(offered).others).toEqual(['slugify']);
    expect(modelSawSummary(SPEC, plain).sent).not.toContain('may call');
    expect(modelSawSummary(SPEC, offered).sent).toContain('the signatures and one-line docs of the functions it may call (slugify), not their code');
  });

  it('a purity rejection inside a callee says where it happened', () => {
    const fail: GateResult = {
      gate: 'invariants',
      status: 'fail',
      ms: 1,
      summary: 'pure violated',
      diagnostics: [{ kind: 'invariant', invariant: 'pure', message: "candidate read global 'Math.random'", detail: 'inside rng, called by shuffleWith' }],
    };
    expect(whoDecided(fail, 1)).toEqual(["The model was told to be side-effect free. The candidate wasn't: the side effect happened inside rng, which it calls."]);
  });
});

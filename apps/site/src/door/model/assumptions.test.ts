import { describe, expect, it } from 'vitest';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import type { Artifact, Candidate, Decision, FunctionSpec, GateResult } from '@scasella/undefined-engine/types';
import { bundledOrders, DUPLICATE_COUNT } from '../../data/orders';
import {
  assumptionsFromNote, checkedAsk, checkedList, checkFactsFrom, dataFacts, EMPTY_FACTS, hasAgreement, NO_NOTES, noteFor, notCheckedList,
  ruleTexts, splitSentences, type CheckFacts,
} from './assumptions';

const gate = (g: GateResult['gate'], status: GateResult['status'] = 'pass'): GateResult => ({ gate: g, status, ms: 1, summary: '', diagnostics: [] });

function candidate(notes: string, gates: GateResult[] = [gate('compile'), gate('tests'), gate('properties'), gate('invariants')]): Candidate {
  return { id: 'c1', attempt: 1, body: '', notes, source: 'replay', generationMs: 1, gates, verdict: 'accepted' };
}

function artifact(over: Partial<Artifact> = {}, cand = candidate('Revenue = quantity × unit price, after discount. Top 5 by revenue.')): Artifact {
  return {
    body: '', source: '', js: '', returnType: 'unknown', specHash: 'a', testsHash: 'b', model: 'm', codexVersion: 'v', committedAt: 0,
    candidates: [{ ...cand, id: 'c0', verdict: 'rejected' }, cand], revision: 3,
    evidence: {
      compiled: true, unitTests: 8, pinnedTests: 1, properties: [{ name: 'p1', runs: 100 }, { name: 'd1', runs: 100 }], sampledCalls: 1,
      decisions: 2, decisionProperties: 1,
      // the engine's own convention: copies that did not compile (stillborn) are NOT in `total`
      mutation: { total: 12, killed: 10, killedByBound: 1, survived: 1, stillborn: 1, survivors: [], ms: 1, at: 1 },
    },
    ...over,
  };
}

const decision = (kind: Decision['kind'], label: string, placement: Decision['placement'] = 'tests'): Decision => ({
  id: label, kind, call: 'f(rows)', args: [], ruling: { kind: 'expr', expr: '', label }, placement,
  answers: { check: 'c', checkKind: 'test', silentOn: '', gate: 'tests' }, waives: false, test: '', decidedAt: 0,
});

const TOP = [{ customer: 'Chef Ravioli Starbright', revenue: 2252.07 }, { customer: 'B', revenue: 1 }];

function spec(over: Partial<FunctionSpec> = {}): FunctionSpec {
  return {
    name: 'topCustomersByRevenue', params: [], returns: null, doc: '', tests: '', properties: '', budgetMs: 100, maxAttempts: 3, origin: 'call',
    pins: [{ id: 'p', label: 'topCustomersByRevenue(rows)', args: [], expected: encodeValue(TOP), pinnedAt: 0 }],
    decisions: [decision('other', 'Revenue counts paid orders only'), decision('duplicates', 'Each order number is counted once', 'properties')],
    ...over,
  };
}

describe('what the AI assumed', () => {
  it('splits the note into sentences', () => {
    expect(splitSentences('Revenue = quantity × unit price, after discount. Top 5 by revenue. Ties are listed in alphabetical order.')).toEqual([
      'Revenue = quantity × unit price, after discount.', 'Top 5 by revenue.', 'Ties are listed in alphabetical order.',
    ]);
    expect(splitSentences('f: counts rows · g: sums $2.50 amounts')).toEqual(['Counts rows.', 'Sums $2.50 amounts.']);
    expect(splitSentences('Uses money fields, e.g. Revenue. Done')).toEqual(['Uses money fields, e.g. Revenue.', 'Done.']);
  });
  it('gives stable ids and says so when there are no notes', () => {
    const a = assumptionsFromNote('One thing. One thing.');
    expect(a.items).toHaveLength(2);
    expect(a.items[0]!.id).not.toBe(a.items[1]!.id);
    expect(assumptionsFromNote('One thing.').items[0]!.id).toBe(a.items[0]!.id);
    expect(assumptionsFromNote('')).toEqual({ items: [], empty: NO_NOTES });
    expect(assumptionsFromNote(undefined).empty).toBe('The AI left no notes about its assumptions.');
  });
  it('reads the entry note first, else the accepted draft', () => {
    expect(noteFor('entry note', artifact())).toBe('entry note');
    expect(noteFor(undefined, artifact())).toMatch(/^Revenue/);
    expect(noteFor(undefined, null)).toBe('');
  });
});

describe('checked against', () => {
  it('builds the full list from real evidence', () => {
    const f = checkFactsFrom({ artifact: artifact(), spec: spec(), question: 'top customers by revenue' });
    expect(f).toEqual<CheckFacts>({
      compiled: true, examples: 6, locked: 1, lockedLabel: 'Chef Ravioli Starbright = $2,252.07', houseRules: 3, madeUpTables: 100, invariants: true,
      stress: { kind: 'done', total: 12, caught: 11, missed: 1 },
    });
    expect(checkedList({ ...f, houseRules: 2 })).toEqual([
      'your 6 examples', 'your locked answer (Chef Ravioli Starbright = $2,252.07)', 'your 2 house rules on 100 made-up tables',
      '12-way stress test (11 caught)', 'never changes your data', 'finishes fast',
    ]);
  });
  it('never claims a check that did not run', () => {
    const cand = candidate('', [gate('compile'), gate('tests', 'skipped'), gate('properties', 'skipped'), gate('invariants', 'skipped')]);
    const f = checkFactsFrom({ artifact: artifact({}, cand), spec: spec({ decisions: [] }), mutationDone: false });
    expect(f.examples).toBe(0);
    expect(f.madeUpTables).toBe(0);
    expect(f.invariants).toBe(false);
    // still waiting for the stress test of this run (and nothing ran it could be held against): never listed
    expect(f.stress.kind).toBe('pending');
    expect(checkedList(f)).not.toContain('never changes your data');
    expect(checkedList(f).some((t) => /stress/.test(t))).toBe(false);
  });
  it('basic checks: runs without errors, never changes your data, finishes fast', () => {
    const f: CheckFacts = { ...EMPTY_FACTS, compiled: true, invariants: true };
    expect(hasAgreement(f)).toBe(false);
    expect(checkedList(f)).toEqual(['runs without errors', 'never changes your data', 'finishes fast']);
  });
  it('house rules without properties do not mention made-up tables', () => {
    expect(checkedList({ ...EMPTY_FACTS, houseRules: 1 })).toEqual(['your house rule']);
  });
  it('the stress test is the same count as lane 06: total is the copies that ran, caught = killed + stopped by the time limit', () => {
    const mutation = (m: Partial<NonNullable<Artifact['evidence']>['mutation'] & object>) => ({ total: 12, killed: 8, killedByBound: 1, survived: 3, stillborn: 2, survivors: [], ms: 1, at: 1, ...m });
    const ev = (m: ReturnType<typeof mutation>) => artifact({ evidence: { ...artifact().evidence!, mutation: m } });
    // stillborn copies never ran: they are not taken off the total a second time
    expect(checkFactsFrom({ artifact: ev(mutation({})), spec: spec() }).stress).toEqual({ kind: 'done', total: 12, caught: 9, missed: 3 });
    // time box: some copies were never tried
    expect(checkFactsFrom({ artifact: ev(mutation({ total: 5, killed: 4, killedByBound: 0, survived: 1, skipped: 'time box reached after 5 of 12 mutants' })), spec: spec() }).stress)
      .toEqual({ kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 });
    // nothing came of it (it failed, had nothing to break): not run, on an answer that was checked against something
    expect(checkFactsFrom({ artifact: ev(mutation({ total: 0, killed: 0, killedByBound: 0, survived: 0, skipped: 'mutation check failed: boom' })), spec: spec() }).stress).toEqual({ kind: 'not-run' });
    expect(checkFactsFrom({ artifact: ev({ ...mutation({}), total: 0 } as never), spec: spec() }).stress).toEqual({ kind: 'not-run' });
  });
  it('a stale report is never this run\'s while the engine is still on the stress test for this function', () => {
    const waiting = { fn: 'topCustomersByRevenue', phase: 'waiting' as const, done: 0, total: 0 };
    expect(checkFactsFrom({ artifact: artifact(), spec: spec(), mutation: waiting }).stress.kind).toBe('pending');
    expect(checkFactsFrom({ artifact: artifact(), spec: spec(), mutation: { ...waiting, phase: 'running', done: 4, total: 12 } }).stress).toEqual({ kind: 'pending', phase: 'running', done: 4, total: 12 });
    // done (or about another function): the report is the result
    expect(checkFactsFrom({ artifact: artifact(), spec: spec(), mutation: { ...waiting, phase: 'done' } }).stress.kind).toBe('done');
    expect(checkFactsFrom({ artifact: artifact(), spec: spec(), mutation: { ...waiting, fn: 'other' } }).stress.kind).toBe('done');
    // the page stopped waiting: not run, whatever arrives later
    expect(checkFactsFrom({ artifact: artifact(), spec: spec(), mutation: waiting, gaveUp: true }).stress).toEqual({ kind: 'not-run' });
    expect(checkFactsFrom({ artifact: artifact(), spec: spec(), gaveUp: true }).stress).toEqual({ kind: 'not-run' });
  });
  it('the stress test line takes the green disc only when nothing was missed (checkedAsk), amber otherwise', () => {
    const f = checkFactsFrom({ artifact: artifact(), spec: spec(), question: 'top customers by revenue' });
    expect(checkedList(f)).toContain('12-way stress test (11 caught)');
    expect(checkedAsk(f)).toEqual(['12-way stress test (11 caught)']);
    const clean: CheckFacts = { ...f, stress: { kind: 'done', total: 12, caught: 12, missed: 0 } };
    expect(checkedList(clean)).toContain('12-way stress test (12 caught)');
    expect(checkedAsk(clean)).toEqual([]);
    const partial: CheckFacts = { ...f, stress: { kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 } };
    expect(checkedList(partial)).toContain('stress test (4 of 5 caught, ran out of time)');
    expect(checkedAsk(partial)).toEqual(['stress test (4 of 5 caught, ran out of time)']);
    // not run: not listed as checked, and no glyph to give
    const none: CheckFacts = { ...f, stress: { kind: 'not-run' } };
    expect(checkedList(none).some((t) => /stress/.test(t))).toBe(false);
    expect(checkedAsk(none)).toEqual([]);
  });
});

describe('data facts', () => {
  it('finds the 12 repeated order numbers and the status values in the bundled orders', () => {
    const d = dataFacts(bundledOrders());
    expect(d.idColumn).toBe('id');
    expect(d.repeatedIds).toBe(DUPLICATE_COUNT);
    expect(d.statusColumn).toBe('status');
    expect([...d.statusValues].sort()).toEqual(['paid', 'pending', 'refunded']);
  });
  it('is empty for no rows', () => {
    expect(dataFacts([])).toEqual({ idColumn: null, repeatedIds: 0, statusColumn: null, statusValues: [] });
  });
});

describe('not checked', () => {
  const data = { idColumn: 'id', repeatedIds: 12, statusColumn: 'status', statusValues: ['paid', 'pending', 'refunded'] };
  it('basic revenue question: status + repeats + always-lines + nothing set yet', () => {
    expect(notCheckedList({ fileName: 'orders.csv', question: 'What is our revenue by country?', facts: EMPTY_FACTS, data })).toEqual([
      'whether pending and refunded orders should count (your status column has paid, pending and refunded)',
      'whether the 12 repeated order numbers should count twice',
      'whether orders.csv is the complete export',
      'whether this was the right question',
      "your examples, locked answers and house rules: you haven't set any yet",
    ]);
  });
  it('names the rows from the file, not always orders', () => {
    expect(notCheckedList({ fileName: 'tickets.csv', question: 'Total revenue by agent?', facts: EMPTY_FACTS, data })[0]).toBe(
      'whether pending and refunded rows should count (your status column has paid, pending and refunded)',
    );
  });
  it('a count question gets no status warning', () => {
    expect(notCheckedList({ fileName: 'orders.csv', question: 'How many orders are there by status?', facts: EMPTY_FACTS, data })[0]).toBe(
      'whether the 12 repeated order numbers should count twice',
    );
  });
  it('house rules that cover status and repeats silence those warnings', () => {
    const s = spec();
    const out = notCheckedList({
      fileName: 'orders.csv', question: 'Who are our top customers by revenue?', facts: { ...EMPTY_FACTS, examples: 6 }, data,
      decisions: s.decisions, rules: ruleTexts(s),
    });
    expect(out).toEqual(['whether orders.csv is the complete export', 'whether this was the right question']);
  });
  it('one repeated id reads singular, many plural, for order numbers and other id columns', () => {
    const q = { fileName: 'orders.csv', question: 'How many orders are there by status?', facts: EMPTY_FACTS };
    expect(notCheckedList({ ...q, data: { ...data, repeatedIds: 1 } })[0]).toBe('whether the 1 repeated order number should count twice');
    expect(notCheckedList({ ...q, data: { ...data, repeatedIds: 12 } })[0]).toBe('whether the 12 repeated order numbers should count twice');
    const other = { fileName: 'tickets.csv', question: 'How many tickets per agent?', facts: EMPTY_FACTS };
    expect(notCheckedList({ ...other, data: { ...data, idColumn: 'ticket_id', repeatedIds: 1 } })[0]).toBe('whether the 1 repeated ticket_id value should count twice');
    expect(notCheckedList({ ...other, data: { ...data, idColumn: 'ticket_id', repeatedIds: 3 } })[0]).toBe('whether the 3 repeated ticket_id values should count twice');
  });
  describe('what you set versus what ran', () => {
    const q = { fileName: 'orders.csv', question: 'Who are our top customers by revenue?', data: null };
    it('a lock set after the answer was checked is not "you haven\'t set any yet"', () => {
      const out = notCheckedList({ ...q, facts: EMPTY_FACTS, set: { examples: 0, locks: 1, rules: 0 } });
      expect(out).toEqual(['whether orders.csv is the complete export', 'whether this was the right question', 'your locked answer: added after this answer was checked']);
      expect(out.join('\n')).not.toContain("haven't set any");
    });
    it('several late kinds read in the plural', () => {
      const out = notCheckedList({ ...q, facts: EMPTY_FACTS, set: { examples: 6, locks: 1, rules: 2 } });
      expect(out[out.length - 1]).toBe('your 6 examples, your locked answer and your 2 house rules: added after this answer was checked');
    });
    it('only the kinds nothing ran for are late; kinds that ran are left alone', () => {
      const out = notCheckedList({ ...q, facts: { ...EMPTY_FACTS, examples: 6, houseRules: 2 }, set: { examples: 6, locks: 1, rules: 2 } });
      expect(out[out.length - 1]).toBe('your locked answer: added after this answer was checked');
    });
    it('everything set was run: no such line; nothing set and nothing run: the old line', () => {
      const ran = { ...EMPTY_FACTS, examples: 6, locked: 1, houseRules: 2 };
      const out = notCheckedList({ ...q, facts: ran, set: { examples: 6, locks: 1, rules: 2 } });
      expect(out).toEqual(['whether orders.csv is the complete export', 'whether this was the right question']);
      expect(notCheckedList({ ...q, facts: EMPTY_FACTS, set: { examples: 0, locks: 0, rules: 0 } }).pop()).toBe("your examples, locked answers and house rules: you haven't set any yet");
    });
  });
  describe('what the stress test left unsaid', () => {
    const ran = { ...EMPTY_FACTS, examples: 6, locked: 1, houseRules: 2 };
    const q = { fileName: 'orders.csv', question: 'Who are our top customers by revenue?', data: null };
    const tail = (stress: CheckFacts['stress']) => notCheckedList({ ...q, facts: { ...ran, stress } });
    it('breaks that went unnoticed are named in plain words, after the file and the question, never as "mutants"', () => {
      const out = tail({ kind: 'done', total: 12, caught: 8, missed: 4 });
      expect(out).toEqual(['whether orders.csv is the complete export', 'whether this was the right question', '4 of 12 deliberate breaks went unnoticed by your checks']);
      expect(out.join(' ')).not.toMatch(/mutant|mutation/i);
      expect(tail({ kind: 'done', total: 12, caught: 11, missed: 1 })[2]).toBe('1 of 12 deliberate breaks went unnoticed by your checks');
      expect(tail({ kind: 'done', total: 1, caught: 0, missed: 1 })[2]).toBe('1 of 1 deliberate break went unnoticed by your checks');
    });
    it('nothing missed, or no stress test to speak of: nothing added', () => {
      for (const st of [{ kind: 'done', total: 12, caught: 12, missed: 0 }, { kind: 'none' }, { kind: 'pending', phase: 'waiting', done: 0, total: 0 }] as const) {
        expect(tail(st)).toEqual(['whether orders.csv is the complete export', 'whether this was the right question']);
      }
    });
    it('a stress test that gave no result is said so, and never read as a pass', () => {
      expect(tail({ kind: 'not-run' })[2]).toBe("whether your checks would notice a broken calculation: the stress test didn't run");
    });
    it('a stress test that ran out of time says how far it got', () => {
      expect(tail({ kind: 'partial', total: 5, caught: 4, missed: 1, planned: 12 })[2]).toBe('the stress test ran out of time: it tried 5 of 12 small breaks, and 1 of those went unnoticed by your checks');
      expect(tail({ kind: 'partial', total: 5, caught: 5, missed: 0, planned: null })[2]).toBe('the stress test ran out of time: it tried 5 small breaks');
    });
    it('comes before the "added after this answer was checked" line, so the first line (shown under the figure) is unchanged', () => {
      const out = notCheckedList({ ...q, facts: { ...EMPTY_FACTS, examples: 6, stress: { kind: 'done', total: 12, caught: 10, missed: 2 } }, set: { examples: 6, locks: 1, rules: 0 } });
      expect(out).toEqual(['whether orders.csv is the complete export', 'whether this was the right question', '2 of 12 deliberate breaks went unnoticed by your checks', 'your locked answer: added after this answer was checked']);
    });
  });
  it('a duplicates decision alone covers repeats', () => {
    const out = notCheckedList({ fileName: 'x.csv', question: 'count', facts: EMPTY_FACTS, data, decisions: [decision('duplicates', 'keep')] });
    expect(out.some((t) => t.includes('repeated'))).toBe(false);
  });
});

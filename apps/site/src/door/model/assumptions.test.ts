import { describe, expect, it } from 'vitest';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import type { Artifact, Candidate, Decision, FunctionSpec, GateResult } from '@scasella/undefined-engine/types';
import { bundledOrders, DUPLICATE_COUNT } from '../../data/orders';
import {
  assumptionsFromNote, checkedList, checkFactsFrom, dataFacts, EMPTY_FACTS, hasAgreement, NO_NOTES, noteFor, notCheckedList,
  ruleTexts, splitSentences, stressFacts, type CheckFacts,
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
      mutation: { total: 13, killed: 10, killedByBound: 1, survived: 1, stillborn: 1, survivors: [], ms: 1, at: 1 },
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
      stress: { total: 12, caught: 11 },
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
    expect(f.stress).toBeNull();
    expect(checkedList(f)).not.toContain('never changes your data');
  });
  it('basic checks: runs without errors, never changes your data, finishes fast', () => {
    const f: CheckFacts = { ...EMPTY_FACTS, compiled: true, invariants: true };
    expect(hasAgreement(f)).toBe(false);
    expect(checkedList(f)).toEqual(['runs without errors', 'never changes your data', 'finishes fast']);
  });
  it('house rules without properties do not mention made-up tables', () => {
    expect(checkedList({ ...EMPTY_FACTS, houseRules: 1 })).toEqual(['your house rule']);
  });
  it('stress facts skip skipped/empty reports', () => {
    expect(stressFacts(undefined)).toBeNull();
    expect(stressFacts({ total: 3, killed: 0, killedByBound: 0, survived: 3, stillborn: 0, survivors: [], ms: 0, at: 0, skipped: 'no tests' })).toBeNull();
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
  it('a duplicates decision alone covers repeats', () => {
    const out = notCheckedList({ fileName: 'x.csv', question: 'count', facts: EMPTY_FACTS, data, decisions: [decision('duplicates', 'keep')] });
    expect(out.some((t) => t.includes('repeated'))).toBe(false);
  });
});

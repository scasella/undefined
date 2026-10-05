import { describe, expect, it } from 'vitest';
import type { Decision, FunctionSpec, Program } from '@scasella/undefined-engine/types';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import { agreementOf, compactChips, countsText, dayText, emptyAgreement, illustrativeAgreement } from './agreement';

const OCT4 = new Date(2026, 9, 4, 12).getTime();
const OCT5 = new Date(2026, 9, 5, 12).getTime();

function spec(over: Partial<FunctionSpec> = {}): FunctionSpec {
  return {
    name: 'topCustomers',
    params: [{ name: 'rows', type: 'Row[]' }],
    returns: null,
    doc: '',
    tests: '',
    properties: '',
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'user',
    ...over,
  };
}

function program(s: FunctionSpec): Program {
  return {
    functions: { [s.name]: { spec: s, specHash: 'h', testsHash: 't', artifact: null } },
    datasets: {
      rows: { name: 'rows', hash: 'abc', typeName: 'Row', typeDecl: 'type Row = {}', rowCount: 332, columns: [], source: 'bundled', filename: 'orders.csv', bytes: 1 },
    },
  };
}

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    kind: 'empty',
    call: 'topCustomers([])',
    args: [[]],
    ruling: { kind: 'outcome', outcome: { returns: [] }, label: '[]' },
    placement: 'tests',
    answers: { check: 'x', checkKind: 'test', silentOn: 'empty', gate: 'tests' },
    waives: false,
    test: 'test("decided: topCustomers([]) → []", () => {})',
    decidedAt: OCT5,
    reason: 'an empty file has no customers',
    ...over,
  };
}

describe('countsText', () => {
  it('pluralises like the design', () => {
    expect(countsText({ examples: 6, locks: 1, rules: 2 })).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(countsText({ examples: 0, locks: 0, rules: 0 })).toBe('0 examples · 0 locked answers · 0 house rules');
    expect(countsText({ examples: 1, locks: 2, rules: 1 })).toBe('1 example · 2 locked answers · 1 house rule');
  });
});

describe('dayText', () => {
  it('is the local calendar day', () => {
    expect(dayText(OCT5)).toBe('5 Oct 2026');
  });
});

describe('agreementOf', () => {
  it('is empty for a missing function or a spec with nothing in it', () => {
    expect(agreementOf(program(spec()), 'nope')).toEqual(emptyAgreement());
    const v = agreementOf(program(spec()), 'topCustomers');
    expect(v.empty).toBe(true);
    expect(v.seeded).toBe(false);
    expect(v.counts).toBe('0 examples · 0 locked answers · 0 house rules');
  });

  it('reads authored tests as examples, skipping decision tests and commented-out ones', () => {
    const tests = [
      'test("one order of 2 × 10 gives 20", () => {});',
      '// test("old", () => {});',
      "test('empty gives empty', () => {});",
      'test("decided: topCustomers([]) → []", () => {});',
    ].join('\n');
    const v = agreementOf(program(spec({ tests })), 'topCustomers');
    expect(v.examples.map((e) => e.t)).toEqual(['one order of 2 × 10 gives 20', 'empty gives empty']);
    expect(v.n.examples).toBe(2);
    // authored tests have no timestamp in the engine: no date is invented
    expect(v.examples[0]!.p).not.toMatch(/\d{4}/);
  });

  it('renders a ranked pin as its lead (name = figure), dated, on the bound file', () => {
    const s = spec({
      pins: [
        {
          id: 'p1',
          label: 'topCustomers(rows)',
          args: [{ kind: 'dataset', name: 'rows', hash: 'abc' }],
          expected: encodeValue([
            { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
            { customer: 'Bistro Nine', revenue: 1980.5 },
          ]),
          pinnedAt: OCT5,
        },
      ],
    });
    const v = agreementOf(program(s), 'topCustomers');
    expect(v.locks).toHaveLength(1);
    const lock = v.locks[0]!;
    expect(lock.t).toBe('Chef Ravioli Starbright = $2,252.07');
    expect(lock.label).toBe('Chef Ravioli Starbright');
    expect(lock.value).toBe('$2,252.07');
    expect(lock.p).toBe('Locked · you · 5 Oct 2026 · on orders.csv');
    expect(v.counts).toBe('0 examples · 1 locked answer · 0 house rules');
  });

  it('a single-number pin keeps the call as its label; the function name decides money', () => {
    const money = spec({ name: 'totalRevenue', pins: [{ id: 'p', label: 'totalRevenue(rows)', args: [], expected: encodeValue(9876), pinnedAt: OCT5 }] });
    expect(agreementOf(program(money), 'totalRevenue').locks[0]!.t).toBe('totalRevenue(rows) = $9,876.00');
    const count = spec({ name: 'countOrders', pins: [{ id: 'p', label: 'countOrders(rows)', args: [], expected: encodeValue(1234), pinnedAt: OCT5 }] });
    expect(agreementOf(program(count), 'countOrders').locks[0]!.t).toBe('countOrders(rows) = 1,234');
  });

  it('a pin with no lead (text, a table) shows the value as returned', () => {
    const text = spec({ name: 'slugify', pins: [{ id: 'p', label: 'slugify("A B")', args: [], expected: encodeValue('a-b'), pinnedAt: OCT5 }] });
    expect(agreementOf(program(text), 'slugify').locks[0]!.t).toBe('slugify("A B") = "a-b"');
    const table = spec({ pins: [{ id: 'p', label: 'f(rows)', args: [], expected: encodeValue([{ a: 1, b: 2, c: 3 }]), pinnedAt: OCT5 }] });
    expect(agreementOf(program(table), 'topCustomers').locks[0]!.t).toBe('f(rows) = [{ a: 1, b: 2, c: 3 }]');
  });

  it('decodes tagged values before showing them', () => {
    const s = spec({ pins: [{ id: 'p', label: 'f()', args: [], expected: encodeValue(Number.NaN), pinnedAt: OCT5 }] });
    expect(agreementOf(program(s), 'topCustomers').locks[0]!.t).toBe('f() = NaN');
    expect(agreementOf(program(s), 'topCustomers').locks[0]!.p).toBe('Locked · you · 5 Oct 2026');
  });

  it('counts decisions and authored properties as house rules', () => {
    const s = spec({
      properties: 'property("never negative", fc.array(fc.nat()), (xs) => true);',
      decisions: [decision(), decision({ id: 'd2', reason: undefined, decidedAt: OCT4, rule: { phrase: 'every negative n', param: 'n' }, ruling: { kind: 'outcome', outcome: { throws: true }, label: 'throws' } })],
    });
    const v = agreementOf(program(s), 'topCustomers');
    expect(v.rules.map((r) => r.t)).toEqual(['topCustomers([]) → []', 'for every negative n: throws', 'never negative']);
    expect(v.rules[0]!.p).toBe('you · 5 Oct 2026 · Why: an empty file has no customers');
    expect(v.rules[1]!.p).toBe('you · 4 Oct 2026');
    expect(v.counts).toBe('0 examples · 0 locked answers · 3 house rules');
    expect(v.empty).toBe(false);
  });

  it('is seeded by default only for example specs, and the caller can override', () => {
    const tests = 'test("a", () => {});';
    expect(agreementOf(program(spec({ tests })), 'topCustomers').seeded).toBe(false);
    expect(agreementOf(program(spec({ tests, origin: 'example' })), 'topCustomers').seeded).toBe(true);
    expect(agreementOf(program(spec({ tests })), 'topCustomers', { seeded: true }).seeded).toBe(true);
    expect(agreementOf(program(spec({ origin: 'example' })), 'topCustomers').seeded).toBe(false);
  });
});

describe('compactChips', () => {
  it('collapses examples into one chip and marks locks', () => {
    const s = spec({
      tests: 'test("a", () => {}); test("b", () => {});',
      pins: [{ id: 'p', label: 'f()', args: [], expected: 1, pinnedAt: OCT5 }],
      decisions: [decision()],
    });
    const chips = compactChips(agreementOf(program(s), 'topCustomers'));
    expect(chips.map((c) => [c.t, c.lock])).toEqual([
      ['2 examples', false],
      ['f() = 1', true],
      ['topCustomers([]) → []', false],
    ]);
  });
});

describe('illustrativeAgreement', () => {
  it('reproduces the landing rail and is flagged', () => {
    const v = illustrativeAgreement();
    expect(v.illustrative).toBe(true);
    expect(v.counts).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(v.examples[0]).toMatchObject({ t: 'One order of 2 × $10.00 gives $20.00', p: 'made-up · 1 row · you · 4 Oct 2026' });
    expect(v.locks[0]).toMatchObject({ t: 'Chef Ravioli Starbright = $2,252.07', label: 'Chef Ravioli Starbright', value: '$2,252.07', p: 'Locked · you · 5 Oct 2026 · on orders.csv' });
    expect(v.rules.map((r) => r.t)).toEqual(['Revenue counts paid orders only', 'Each order number is counted once']);
    expect(v.assumption?.t).toBe('Revenue is after discounts');
    expect(compactChips(v)).toHaveLength(4);
    expect(compactChips(v)[0]).toMatchObject({ t: '6 examples', p: 'made-up tables with known answers · you · 4 Oct 2026' });
  });
});

import { describe, expect, it } from 'vitest';
import type { Decision, FunctionSpec, Program } from '@scasella/undefined-engine/types';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import {
  agreementOf, agreementPhrase, compactChips, countsText, dayText, fixedDayText, emptyAgreement, heldNote, illustrativeAgreement, isHeldBack, lockedHelp, lockedKeptReplay,
  NEXT_VERSION_LIVE, NEXT_VERSION_REPLAY, nextVersionLine, SEEDED_LOCK_NOTE, SEEDED_NOTE,
} from './agreement';
import { AGREEMENT_FN, SEEDED_PINNED_AT, seedAgreement } from './agreements';
import { buildDataset } from '../../data/dataset';
import { bundledOrders } from '../../data/orders';

// local noon: the viewer's own calendar day in every timezone (dayText is local; see its tests)
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
  // Run this file under TZ=America/New_York and TZ=Pacific/Auckland as well as the default: the answers never change,
  // because every fixture is built from local Date arguments, the way a viewer's own moment is.
  it("is the viewer's own calendar day, so an evening lock does not read as tomorrow", () => {
    expect(dayText(OCT5)).toBe('5 Oct 2026');
    expect(dayText(new Date(2026, 9, 4, 23, 30).getTime())).toBe('4 Oct 2026');
    expect(dayText(new Date(2026, 9, 5, 0, 30).getTime())).toBe('5 Oct 2026');
    expect(dayText(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('31 Dec 2026');
    expect(dayText(new Date(2027, 0, 1, 0, 0, 1).getTime())).toBe('1 Jan 2027');
    expect(dayText(new Date(2024, 1, 29, 6).getTime())).toBe('29 Feb 2024');
  });
  it("fixedDayText is the UTC day in every timezone (the demo's fixed provenance)", () => {
    expect(fixedDayText(Date.UTC(2026, 9, 5))).toBe('5 Oct 2026'); // midnight UTC: the 4th by a New York clock
    expect(fixedDayText(Date.UTC(2026, 9, 5, 23, 59, 59, 999))).toBe('5 Oct 2026'); // the 6th by an Auckland clock
    expect(fixedDayText(Date.UTC(2026, 9, 6))).toBe('6 Oct 2026');
    expect(fixedDayText(Date.UTC(2026, 11, 31, 23, 30))).toBe('31 Dec 2026');
    expect(fixedDayText(Date.UTC(2027, 0, 1))).toBe('1 Jan 2027');
  });
});

describe('the demo\'s seeded rows read one intended day in every timezone', () => {
  async function seeded() {
    const built = await buildDataset('orders', bundledOrders(), { source: 'bundled', filename: 'orders.csv', typeName: 'OrdersRow' });
    if ('error' in built) throw new Error(built.message);
    const seed = seedAgreement('orders', 'top', built.ref)!;
    const prog: Program = {
      functions: { [AGREEMENT_FN]: { spec: seed.spec, specHash: 'h', testsHash: 't', artifact: null } },
      datasets: { [built.ref.name]: built.ref },
    };
    return { seed, view: agreementOf(prog, AGREEMENT_FN, { seeded: true }) };
  }
  it('the seeded lock is stored at UTC midnight and still reads 5 Oct 2026, with no other date in the rail', async () => {
    const { seed, view } = await seeded();
    expect(seed.spec.pins![0]!.pinnedAt).toBe(SEEDED_PINNED_AT);
    expect(view.counts).toBe('6 examples · 1 locked answer · 2 house rules');
    expect(view.locks.map((c) => c.p)).toEqual(['Locked · you · 5 Oct 2026 · on orders.csv']);
    // the rows the design dates by hand say the same days as the rail computes (rules and lock: 5 Oct)
    expect(seed.summary.locked[0]!.note).toBe('Locked · you · 5 Oct 2026');
    for (const h of seed.summary.houseRules) expect(h.note).toContain('5 Oct 2026');
    // the examples and house rules carry no instant of their own, so no timezone can move them
    for (const c of [...view.examples, ...view.rules]) expect(c.p).not.toMatch(/\d{4}/);
    expect(illustrativeAgreement().locks[0]!.p).toBe('Locked · you · 5 Oct 2026 · on orders.csv');
  });
  it("a lock the viewer makes is NOT fixed: it reads the viewer's own day, even on the seeded agreement", async () => {
    const { seed } = await seeded();
    const mine = { ...seed.spec.pins![0]!, id: 'mine', pinnedAt: new Date(2026, 9, 4, 21, 30).getTime() };
    const s = { ...seed.spec, pins: [mine] };
    const v = agreementOf(program(s), AGREEMENT_FN);
    expect(v.locks[0]!.p.startsWith('Locked · you · 4 Oct 2026')).toBe(true);
    const decided = agreementOf(program(spec({ decisions: [decision({ decidedAt: new Date(2026, 9, 4, 22, 15).getTime() })] })), 'topCustomers');
    expect(decided.rules[0]!.p.startsWith('you · 4 Oct 2026')).toBe(true);
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
    expect(v.assumption?.confirmedMeta).toBe('Confirmed by you · on this page only');
    expect(compactChips(v)).toHaveLength(4);
    expect(compactChips(v)[0]).toMatchObject({ t: '6 examples', p: 'made-up tables with known answers · you · 4 Oct 2026' });
  });
});

describe('agreementPhrase', () => {
  it('joins the parts that exist', () => {
    expect(agreementPhrase({ examples: 6, locks: 1, rules: 2 })).toBe('6 examples, 1 locked answer and 2 house rules');
    expect(agreementPhrase({ examples: 0, locks: 1, rules: 0 })).toBe('1 locked answer');
    expect(agreementPhrase({ examples: 0, locks: 0, rules: 0 })).toBe('');
  });
});

describe('set versus what will really run', () => {
  const locked = { empty: false };
  it('held back: something is set but the level that will run is basic', () => {
    expect(isHeldBack('basic', locked)).toBe(true);
    expect(isHeldBack('full', locked)).toBe(false);
    expect(isHeldBack('basic', { empty: true })).toBe(false);
  });
  it('live keeps the engine promise; replay says it cannot re-run, in plain words', () => {
    expect(nextVersionLine('live')).toBe(NEXT_VERSION_LIVE);
    expect(nextVersionLine('replay')).toBe(NEXT_VERSION_REPLAY);
    expect(NEXT_VERSION_REPLAY).toContain("can't re-run");
    expect(NEXT_VERSION_REPLAY).not.toContain('runs full checks');
    expect(heldNote('replay')).toContain("this demo can't re-run");
    expect(heldNote('live')).toContain('the next version has to pass it');
  });
  it('the lock confirmation: only when locked with basic checks; replay is honest, live is the existing promise', () => {
    expect(lockedHelp({ locked: true, level: 'basic', mode: 'live' })).toBe('Locked. The next version runs full checks, starting with this answer.');
    expect(lockedHelp({ locked: true, level: 'basic', mode: 'replay' })).toBe(
      "Locked. This demo can't re-run with it, so asking again shows this same answer; on your computer the next version is checked against it.",
    );
    expect(lockedHelp({ locked: false, level: 'basic', mode: 'replay' })).toBe('');
    // full checks: live keeps the card's own words ('' = "Every later version has to give this same list."); replay does not
    // promise a later version, because this demo cannot write one
    expect(lockedHelp({ locked: true, level: 'full', mode: 'live' })).toBe('');
    expect(lockedHelp({ locked: false, level: 'full', mode: 'replay' })).toBe('');
    expect(lockedHelp({ locked: true, level: 'full', mode: 'replay' })).toBe(
      "Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same answer.",
    );
    expect(lockedHelp({ locked: true, level: 'full', mode: 'replay', noun: 'list' })).toBe(lockedKeptReplay('list'));
    expect(lockedKeptReplay('list')).toBe("Locked, and kept with this answer. This demo can't write a later version; on your computer every later version has to give this same list.");
    expect(lockedKeptReplay('answer')).not.toMatch(/^Every later version/);
    // the lock that came with the demo file: the card's note beside it says it is locked, so the help starts at what the demo cannot do
    expect(lockedHelp({ locked: true, level: 'full', mode: 'replay', noun: 'list', seeded: true })).toBe(
      "This demo can't write a later version; on your computer every later version has to give this same list.",
    );
    expect(lockedKeptReplay('list', true)).not.toMatch(/^Locked, and kept/);
    // and only there: live, basic and a lock the viewer made are as they were
    expect(lockedHelp({ locked: true, level: 'full', mode: 'live', seeded: true })).toBe('');
    expect(lockedHelp({ locked: true, level: 'basic', mode: 'replay', seeded: true })).toBe(lockedHelp({ locked: true, level: 'basic', mode: 'replay' }));
    expect(lockedHelp({ locked: true, level: 'full', mode: 'replay', noun: 'list', seeded: false })).toBe(lockedKeptReplay('list'));
  });
});

describe('where the demo\'s agreement comes from, said in one short sentence each', () => {
  it('the rail\'s note and the card\'s lock note say the demo file brings it, never "saved earlier" (the demo installs it in this visit, as saved steps of its own)', () => {
    expect(SEEDED_NOTE).toBe('This agreement comes with the demo file.');
    expect(SEEDED_LOCK_NOTE).toBe('This lock comes with the demo file.');
    for (const note of [SEEDED_NOTE, SEEDED_LOCK_NOTE]) {
      expect(note.split(/(?<=\.)\s+/)).toHaveLength(1);
      expect(note.split(/\s+/).length).toBeLessThanOrEqual(10);
      expect(note).not.toMatch(/earlier|session|saved|\b(gate|spec|property|fuzz|mutant|revision|pin)\b/i);
    }
  });
});

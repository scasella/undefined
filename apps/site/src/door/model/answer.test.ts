import { describe, expect, it } from 'vitest';
import { encodeValue } from '@scasella/undefined-engine/shared/serialize';
import type { ReplEntry } from '@scasella/undefined-engine/types';
import {
  answerLead, answerTitle, BASIC_CHECKS, caveatClause, decisiveCaveat, figCaption, formatMoney, formatPlain, HANDOFF_NEXT, humanizeName, isMoney, leadSummary,
  lockedRowsPhrase, MAX_REST, placesLabel, shapeAnswer, shapeEncoded, shapeValue, unitFromQuestion, verdictLine, versionNote, versionNoteFor, type AnswerContext,
} from './answer';
import { bundledOrders } from '../../data/orders';
import { dataFacts, EMPTY_FACTS, notCheckedList } from './assumptions';
import { HANDOFF_LABEL } from './handoff';
import { sealHead, stressChecked, stressWords, type StressStatus } from './lanes';

const ctx: AnswerContext = {
  question: 'Who are our top customers by revenue?', fileName: 'orders.csv', rowCount: 332, revision: 3,
  callName: 'topCustomersByRevenue', counted: 'paid orders only, each order number once',
};

const TOP5 = [
  { customer: 'Chef Ravioli Starbright', revenue: 2252.07 },
  { customer: 'Grommet & Gasket LLC', revenue: 2148.72 },
  { customer: 'Puddlesworth Inc', revenue: 2114.13 },
  { customer: 'Thistlewhump Bakery', revenue: 1909.9 },
  { customer: 'Kettlewhistle Farms', revenue: 1870.33 },
];

describe('formatting', () => {
  it('formats money and plain numbers in en-US', () => {
    expect(formatMoney(2252.07)).toBe('$2,252.07');
    expect(formatMoney(1909.9)).toBe('$1,909.90');
    expect(formatMoney(-12.5)).toBe('-$12.50');
    expect(formatPlain(258)).toBe('258');
    expect(formatPlain(12345)).toBe('12,345');
    expect(formatPlain(3.14159265)).toBe('3.1416');
  });
  it('decides money from the field name or the question', () => {
    expect(isMoney('revenue', '')).toBe(true);
    expect(isMoney('amount', '')).toBe(true);
    expect(isMoney('count', 'revenue by status')).toBe(false);
    expect(isMoney(null, 'How many orders are there by status?')).toBe(false);
    expect(isMoney(null, 'What is our revenue by country?')).toBe(true);
    expect(isMoney('n', 'What is our revenue?')).toBe(false);
  });
  it('finds a unit and a title', () => {
    expect(unitFromQuestion('How many orders are there by status?')).toBe('orders');
    expect(unitFromQuestion('anything', 'countOrdersByStatus')).toBe('orders');
    expect(unitFromQuestion('What is our revenue?')).toBe('');
    expect(humanizeName('topCustomersByRevenue')).toBe('Top customers by revenue');
    expect(humanizeName('count_by_status')).toBe('Count by status');
    expect(answerTitle('topCustomersByRevenue', '', 5)).toBe('Top 5 customers by revenue');
    expect(answerTitle(undefined, 'How many orders?', null)).toBe('How many orders');
  });
});

describe('fig caption', () => {
  it('matches the design voice', () => {
    expect(figCaption('Top 5 customers by revenue', ctx)).toBe(
      'Fig. 1 · Top 5 customers by revenue · paid orders only, each order number once · orders.csv · 332 rows · Version 3',
    );
  });
  it('leaves out what it does not know', () => {
    expect(figCaption('Median', { question: '', fileName: '', rowCount: null, revision: null })).toBe('Fig. 1 · Median');
    expect(figCaption('X', { question: '', fileName: 'a.csv', rowCount: 1, revision: 1 })).toBe('Fig. 1 · X · a.csv · 1 row · Version 1');
  });
});

describe('ranked list (array of objects)', () => {
  const v = shapeValue(TOP5, ctx);
  it('leads with rank 1 and money formatting', () => {
    expect(v.kind).toBe('ranked');
    expect(v.title).toBe('Top 5 customers by revenue');
    expect(v.lead).toEqual({ name: 'Chef Ravioli Starbright', num: '$2,252.07', unit: '', long: false });
    expect(v.money).toBe(true);
    expect(v.places).toBe(5);
  });
  it('lists the rest with bars scaled to the leader', () => {
    expect(v.rest.map((r) => [r.rank, r.name, r.amt])).toEqual([
      ['02', 'Grommet & Gasket LLC', '$2,148.72'],
      ['03', 'Puddlesworth Inc', '$2,114.13'],
      ['04', 'Thistlewhump Bakery', '$1,909.90'],
      ['05', 'Kettlewhistle Farms', '$1,870.33'],
    ]);
    // the design's (r / 2252.07 * 100).toFixed(1)
    expect(v.rest.map((r) => r.pct)).toEqual([95.4, 93.9, 84.8, 83]);
  });
  it('keeps the order the function returned', () => {
    const w = shapeValue([{ k: 'b', n: 1 }, { k: 'a', n: 5 }], { ...ctx, question: 'list', callName: 'f' });
    expect(w.lead!.name).toBe('b');
    expect(w.lead!.num).toBe('1');
    expect(w.rest[0]!.pct).toBe(100);
  });
  it('accepts [label, number] tuples', () => {
    const w = shapeValue(TOP5.map((r) => [r.customer, r.revenue]), ctx);
    expect(w.kind).toBe('ranked');
    expect(w.lead!.num).toBe('$2,252.07');
  });
  it('caps a long list and says how many it left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, total: 100 - i }));
    const w = shapeValue(many, { ...ctx, callName: 'totals' });
    expect(w.rest).toHaveLength(MAX_REST);
    expect(w.hiddenRows).toBe(30 - 1 - MAX_REST);
    expect(w.places).toBe(30);
  });
});

describe('placesLabel: the words over the ranked list, from the rows it shows', () => {
  it('says "Places 2 to N" from the places the list really starts and ends at', () => {
    expect(placesLabel(shapeValue(TOP5, ctx).rest)).toBe('Places 2 to 5');
    expect(placesLabel([{ rank: '02' }, { rank: '03' }])).toBe('Places 2 to 3');
    // a long list is capped at MAX_REST rows after the lead: the label follows what is drawn, not the whole list
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, total: 100 - i }));
    expect(placesLabel(shapeValue(many, { ...ctx, callName: 'totals' }).rest)).toBe(`Places 2 to ${MAX_REST + 1}`);
  });
  it('one place left is "Place 2"; no rows, no label', () => {
    expect(placesLabel([{ rank: '02' }])).toBe('Place 2');
    expect(placesLabel([])).toBeNull();
    expect(placesLabel(shapeValue([{ customer: 'A', revenue: 5 }], ctx).rest)).toBeNull();
  });
});

describe('record of counts', () => {
  const sctx: AnswerContext = { question: 'How many orders are there by status?', fileName: 'orders.csv', rowCount: 332, revision: 1, callName: 'countByStatus', counted: 'every row counted' };
  it('sorts desc with a unit and plain integers', () => {
    const v = shapeValue({ refunded: 27, paid: 258, pending: 47 }, sctx);
    expect(v.kind).toBe('ranked');
    expect(v.lead).toEqual({ name: 'paid', num: '258', unit: 'orders', long: false });
    expect(v.rest.map((r) => [r.rank, r.name, r.amt])).toEqual([['02', 'pending', '47'], ['03', 'refunded', '27']]);
    expect(v.fig).toBe('Fig. 1 · Count by status · every row counted · orders.csv · 332 rows · Version 1');
  });
  it('breaks ties alphabetically and accepts a Map', () => {
    const v = shapeValue(new Map([['b', 2], ['a', 2], ['c', 9]]), sctx);
    expect([v.lead!.name, ...v.rest.map((r) => r.name)]).toEqual(['c', 'a', 'b']);
  });
});

describe('scalars and fallbacks', () => {
  it('a single number is a lead value only', () => {
    const v = shapeValue(258, { ...ctx, question: 'How many orders are paid?', callName: 'countPaid' });
    expect(v.kind).toBe('scalar');
    expect(v.lead).toEqual({ name: '', num: '258', unit: 'orders', long: false });
    expect(v.rest).toEqual([]);
  });
  it('a money scalar', () => {
    expect(shapeValue(9987.42, { ...ctx, question: 'Total revenue?' }).lead!.num).toBe('$9,987.42');
  });
  it('a string', () => {
    const v = shapeValue('Chef Ravioli Starbright', { ...ctx, question: 'Best customer?' });
    expect(v.lead!.num).toBe('Chef Ravioli Starbright');
    expect(v.lead!.long).toBe(true);
  });
  it('an empty list says so', () => {
    const v = shapeValue([], ctx);
    expect(v.kind).toBe('empty');
    expect(v.lead).toBeNull();
    expect(v.fallbackNote).toMatch(/empty list/);
  });
  it('wider objects become a labelled table', () => {
    const v = shapeValue([{ a: 1, b: 'x', c: true }], ctx);
    expect(v.kind).toBe('table');
    expect(v.table).toEqual({ columns: ['a', 'b', 'c'], rows: [['1', 'x', 'true']], total: 1 });
    expect(v.fallbackNote).toMatch(/Shown as returned/);
  });
  it('anything else is raw, never a crash', () => {
    expect(shapeValue(null, ctx).kind).toBe('raw');
    expect(shapeValue(NaN, ctx).kind).toBe('raw');
    expect(shapeValue(new Set([1]), ctx, { shown: 'Set(1) { 1 }' }).raw).toBe('Set(1) { 1 }');
    expect(shapeValue({ a: 'x' }, ctx).kind).toBe('raw');
  });
  it('decodes the engine encoding', () => {
    expect(shapeEncoded(encodeValue(TOP5) , ctx).lead!.num).toBe('$2,252.07');
    expect(shapeEncoded(encodeValue(10n), ctx).lead!.num).toBe('10');
    expect(shapeEncoded({ $t: 'unserializable', show: 'fn' }, ctx, { shown: '[Function]' }).raw).toBe('[Function]');
  });
});

describe('shapeAnswer(entry)', () => {
  const entry: Extract<ReplEntry, { kind: 'output' }> = {
    kind: 'output', id: 'out1', value: '[…]', ms: 3, label: 'generated',
    pinnable: { fn: 'topCustomersByRevenue', call: 'topCustomersByRevenue(rows)', args: [], expected: encodeValue(TOP5) },
  };
  it('uses the real encoded result and the pinnable fn name', () => {
    const v = shapeAnswer(entry, { question: ctx.question, fileName: 'orders.csv', rowCount: 332, revision: 3 });
    expect(v.title).toBe('Top 5 customers by revenue');
    expect(v.lead!.name).toBe('Chef Ravioli Starbright');
  });
  it('falls back to the table without parsing numbers', () => {
    const { pinnable: _p, ...noPin } = entry;
    const v = shapeAnswer({ ...noPin, table: { columns: ['customer', 'revenue'], rows: [['A', '1']], total: 1 } }, ctx);
    expect(v.kind).toBe('table');
    expect(v.lead).toBeNull();
  });
  it('falls back to the printed value', () => {
    const { pinnable: _p, ...noPin } = entry;
    const v = shapeAnswer({ ...noPin, value: '42' }, ctx);
    expect(v.kind).toBe('raw');
    expect(v.raw).toBe('42');
  });
});

describe('helpers', () => {
  it('summarises a locked answer', () => {
    expect(leadSummary(encodeValue(TOP5), 'top customers by revenue')).toBe('Chef Ravioli Starbright = $2,252.07');
    expect(leadSummary(encodeValue([{ a: 1, b: 2, c: 3 }]), '')).toBeNull();
  });
  it('names the rows a lock holds', () => {
    expect(lockedRowsPhrase(shapeValue(TOP5, ctx))).toBe('these same 5 rows');
    expect(lockedRowsPhrase(shapeValue(3, ctx))).toBe('this same answer');
    expect(lockedRowsPhrase(null)).toBe('this same answer');
  });
});

describe('decisiveCaveat', () => {
  it('is the first not-checked item as given, never invented', () => {
    expect(decisiveCaveat(['whether pending orders should count', 'whether this was the right question'])).toBe('whether pending orders should count');
    expect(decisiveCaveat(['  ', 'whether this was the right question '])).toBe('whether this was the right question');
    expect(decisiveCaveat([])).toBeNull();
  });
});

describe('verdictLine: whether the number can be relied on, in plain words', () => {
  const done = (caught: number, total = 12): StressStatus => ({ kind: 'done', total, caught, missed: total - caught });
  const partial: StressStatus = { kind: 'partial', total: 7, caught: 5, missed: 2, planned: 12 };
  const notRun: StressStatus = { kind: 'not-run' };
  // the recorded run's not-checked list, most decisive first (assumptions.ts notCheckedList)
  const NOT_CHECKED = ['whether orders.csv is the complete export', 'whether this was the right question', '4 of 12 deliberate breaks went unnoticed by your checks'];
  const full = (stress: StressStatus, extra: { ran?: number; of?: number; handoff?: boolean; notChecked?: readonly string[] } = {}) =>
    verdictLine({ level: 'full', stress, ran: extra.ran ?? 5, of: extra.of ?? 6, notChecked: extra.notChecked ?? NOT_CHECKED, handoff: extra.handoff ?? true });
  const sentences = (t: string): string[] => t.split(/(?<=\.)\s+/);

  it('full checks with misses (the recorded run, caught 8 of 12): says it passed, what the stress test caught, what was not checked, and the one next step', () => {
    expect(full(done(8))).toBe(
      'Passed every check, though the stress test caught 8 of 12 deliberate breaks. Not checked: whether orders.csv is the complete export, so if the number matters, hand the calculation to your data team.',
    );
  });
  it('full checks with every break caught: "and", not "though"', () => {
    expect(full(done(12))).toBe(
      'Passed every check, and the stress test caught 12 of 12 deliberate breaks. Not checked: whether orders.csv is the complete export, so if the number matters, hand the calculation to your data team.',
    );
  });
  it('full checks where the stress test ran out of time or did not run: how many of the checks passed, never "every check"', () => {
    expect(full(partial)).toBe(
      'Passed 5 of 6 checks, though the stress test ran out of time. Not checked: whether orders.csv is the complete export, so if the number matters, hand the calculation to your data team.',
    );
    expect(full(notRun, { ran: 3, of: 4 })).toBe(
      "Passed 3 of 4 checks, though the stress test didn't run. Not checked: whether orders.csv is the complete export, so if the number matters, hand the calculation to your data team.",
    );
    for (const st of [partial, notRun]) expect(full(st)).not.toMatch(/every check/i);
  });
  it('basic checks only: says nothing has tested the number yet, in the count of basic checks the card uses', () => {
    const v = verdictLine({ level: 'basic', notChecked: NOT_CHECKED, handoff: true });
    expect(v).toBe(
      `Only the ${BASIC_CHECKS} basic checks ran, so nothing has tested the number yet. Not checked: whether orders.csv is the complete export, so if the number matters, hand the calculation to your data team.`,
    );
    expect(v).not.toMatch(/every check|stress/i);
    // a basic answer ignores a stress result it was given
    expect(verdictLine({ level: 'basic', stress: done(12), notChecked: [], handoff: false })).toBe(`Only the ${BASIC_CHECKS} basic checks ran, so nothing has tested the number yet.`);
  });
  it('uses the seal\'s own words and counts, never its own: other numbers come through', () => {
    for (const st of [done(7, 9), done(9, 9), partial, notRun]) {
      const v = full(st, { ran: 4, of: 5 });
      expect(v.startsWith(sealHead({ stress: st, ran: 4, of: 5 }))).toBe(true);
      expect(v).toContain(stressWords(st)!);
    }
    expect(full(done(7, 9))).toContain('caught 7 of 9 deliberate breaks');
  });
  it('says "1 deliberate break" for one, and the verdict, the ledger and the lane agree on the unit', () => {
    // a mutation report with a single break (the count is the run's own): singular everywhere, never "1 of 1 deliberate breaks"
    expect(full(done(1, 1))).toContain('the stress test caught 1 of 1 deliberate break.');
    expect(full(done(1, 1))).not.toMatch(/deliberate breaks/);
    expect(full(done(0, 1))).toMatch(/^Passed every check, though the stress test caught 0 of 1 deliberate break\./);
    // the verdict takes "caught N of M deliberate break(s)" from the same words as the ledger's line, for every total
    for (const st of [done(8), done(12), done(1, 1), done(0, 1), done(2, 3)]) {
      const fromVerdict = /caught \d+ of \d+ deliberate breaks?/.exec(full(st))![0];
      const fromLedger = /caught \d+ of \d+ deliberate breaks?/.exec(stressChecked(st)!.text)![0];
      expect(fromVerdict).toBe(fromLedger);
    }
  });
  it('a stress test that did not finish, with no seal counts to say: "the checks that ran", never "Passed 0 of 0 checks"', () => {
    const v = verdictLine({ level: 'full', stress: { kind: 'partial', total: 3, caught: 3, missed: 0, planned: 12 }, notChecked: [], handoff: false });
    expect(v).toBe('Passed the checks that ran, though the stress test ran out of time.');
    expect(verdictLine({ level: 'full', stress: notRun, notChecked: [], handoff: false })).toBe("Passed the checks that ran, though the stress test didn't run.");
    expect(v).not.toMatch(/every check|0 of 0/);
  });
  it('the next step follows the caveat with "so", never a semicolon a reader could take for a second thing not checked', () => {
    const v = full(done(8));
    expect(v).not.toContain(';');
    expect(v).toMatch(/Not checked: .+, so if the number matters, hand the calculation to your data team\.$/);
  });
  it('the next step the verdict names is the hand-off the card offers: both say "data team"', () => {
    expect(HANDOFF_NEXT).toMatch(/data team/);
    expect(HANDOFF_LABEL).toMatch(/data team/);
  });
  it('names the hand-off as the next step only when the card offers it', () => {
    expect(full(done(8), { handoff: false })).toBe('Passed every check, though the stress test caught 8 of 12 deliberate breaks. Not checked: whether orders.csv is the complete export.');
    expect(full(done(8), { handoff: false })).not.toMatch(/data team/);
    expect(full(done(8))).toContain(HANDOFF_NEXT);
  });
  it('the most decisive thing not checked is the first item as given (trailing full stop dropped); no items, no clause', () => {
    expect(full(done(8), { notChecked: ['  ', 'whether pending orders should count.', 'x'] })).toContain('Not checked: whether pending orders should count, so');
    expect(full(done(8), { notChecked: [], handoff: false })).toBe('Passed every check, though the stress test caught 8 of 12 deliberate breaks.');
    expect(full(done(8), { notChecked: [] })).toBe('Passed every check, though the stress test caught 8 of 12 deliberate breaks. If the number matters, hand the calculation to your data team.');
  });
  it('leaves out the closing explanation the list adds about your data (the ledger below keeps it whole), so the line stays short', () => {
    const v = full(done(8), { notChecked: ['whether refunded and pending orders should count (your status column has paid, refunded and pending)', 'whether this was the right question'] });
    expect(v).toContain('Not checked: whether refunded and pending orders should count, so if the number matters');
    expect(v).not.toContain('(');
    // brackets in the middle of an item are not a closing explanation: kept
    expect(full(done(8), { notChecked: ['whether (some) orders count'], handoff: false })).toContain('Not checked: whether (some) orders count.');
  });
  it('a closing explanation with brackets of its own goes whole, and a pair of brackets that is part of what the item says stays', () => {
    // was cut at the inner bracket and left "(your status column has paid (partial), refunded and pending)" in the line (41 words)
    const nested = full(done(8), { notChecked: ['whether refunded orders should count (your status column has paid (partial), refunded and pending)'] });
    expect(nested).toContain('Not checked: whether refunded orders should count, so if the number matters');
    expect(nested).not.toMatch(/[()]/);
    // was cut to "whether (a) and,": the last pair is not the explanation the list adds, so the item stays whole
    expect(full(done(8), { notChecked: ['whether (a) and (b)'], handoff: false })).toContain('Not checked: whether (a) and (b).');
    expect(full(done(8), { notChecked: ['whether (a) and (b)'] })).toContain('Not checked: whether (a) and (b), so if the number matters');
    // a middle pair and the closing explanation: only the explanation goes
    expect(full(done(8), { notChecked: ['whether (some) orders count (your status column has a and b)'], handoff: false })).toContain('Not checked: whether (some) orders count.');
  });
  it('an item that is only a bracket group is the whole item, shown as given (nothing is trimmed away to nothing)', () => {
    // was "leaves nothing to say" and dropped the clause: a not-checked item that is there is never silently dropped
    expect(full(done(8), { notChecked: ['(nothing)'], handoff: false })).toBe('Passed every check, though the stress test caught 8 of 12 deliberate breaks. Not checked: (nothing).');
    expect(full(done(8), { notChecked: ['(your status column has paid)'], handoff: false })).toContain('Not checked: (your status column has paid).');
  });
  it('caveatClause: cuts only a clean closing "(your …)" group, else the item comes back whole (full stop dropped)', () => {
    const cases: Array<[string, string]> = [
      ['whether refunded and pending orders should count (your status column has paid, refunded and pending)', 'whether refunded and pending orders should count'],
      ['whether refunded and pending orders should count (your status column has paid, refunded and pending).', 'whether refunded and pending orders should count'],
      ['  whether every state should count (your state column has open and closed)  ', 'whether every state should count'],
      ['whether refunded orders should count (your status column has paid (partial), refunded and pending)', 'whether refunded orders should count'],
      ['whether (some) orders count (your status column has a and b)', 'whether (some) orders count'],
      // the group does not start "(your ": not the list's explanation
      ['whether (a) and (b)', 'whether (a) and (b)'],
      ['whether refunded orders should count (for example)', 'whether refunded orders should count (for example)'],
      ['(nothing)', '(nothing)'],
      ['(your status column has paid)', '(your status column has paid)'],
      // glued to a word: a bracket is not a separate remark
      ['whether orders(your status column has paid)', 'whether orders(your status column has paid)'],
      // a bracket left open or closed twice anywhere: unsure, whole
      ['whether orders count (your status column has (paid)', 'whether orders count (your status column has (paid)'],
      ['whether a) orders count (your status column has paid)', 'whether a) orders count (your status column has paid)'],
      ['whether (a orders count (your status column has paid)', 'whether (a orders count (your status column has paid)'],
      // what is left would end on a joining word
      ['whether (a) and (your status column has paid)', 'whether (a) and (your status column has paid)'],
      ['whether pending or (your status column has paid)', 'whether pending or (your status column has paid)'],
      // nothing to cut
      ['whether this was the right question.', 'whether this was the right question'],
      ['4 of 12 deliberate breaks went unnoticed by your checks', '4 of 12 deliberate breaks went unnoticed by your checks'],
      ['', ''],
      ['   ', ''],
    ];
    for (const [item, want] of cases) expect(caveatClause(item), item).toBe(want);
    // never cut inside a word and never leaves a bracket open, for any of them
    for (const [item] of cases) {
      const out = caveatClause(item);
      const whole = item.trim().replace(/[.\s]+$/, '');
      expect(whole.startsWith(out), item).toBe(true);
      expect(out === whole || /\s/.test(whole[out.length]!), item).toBe(true);
      expect(out === whole || (out.split('(').length === out.split(')').length), item).toBe(true);
    }
  });
  it('the longest real case stays near 34 words, worked out from the real facts and not typed in: a Basic pass on orders.csv', () => {
    const data = dataFacts(bundledOrders());
    const question = 'Who are our top customers by revenue?';
    const words = (t: string) => t.split(/\s+/).length;
    // a Basic pass has no agreement: nothing silences the status question or the repeated order numbers, so the status item leads
    const basicList = notCheckedList({ fileName: 'orders.csv', question, facts: EMPTY_FACTS, data });
    expect(basicList[0]).toMatch(/^whether .+ orders should count \(your status column has .+\)$/);
    const basic = verdictLine({ level: 'basic', notChecked: basicList, handoff: true });
    expect(words(basic)).toBeLessThanOrEqual(34);
    expect(sentences(basic).length).toBe(2);
    // the caveat keeps its meaning: the statuses the question is about, in the viewer's file's own words
    for (const status of data.statusValues.filter((v) => v !== 'paid')) expect(basic).toContain(status);
    expect(basic).toContain('should count, so if the number matters, hand the calculation to your data team.');
    // the recorded Full run (house rules cover status and repeats) is the other real first item
    const fullList = notCheckedList({ fileName: 'orders.csv', question, facts: { ...EMPTY_FACTS, examples: 6 }, data, rules: ['status paid refunded pending', 'each order number once duplicates'] });
    expect(fullList[0]).toBe('whether orders.csv is the complete export');
    expect(words(full(done(8), { notChecked: fullList }))).toBeLessThanOrEqual(34);
    // the full-checks line with the status item leading is the same length as the basic one
    expect(words(full(done(8), { notChecked: basicList }))).toBeLessThanOrEqual(34);
  });
  it('a status column with many values grows the line only by the values it names: two sentences, the item whole, never cut to fit', () => {
    const data = { idColumn: null, repeatedIds: 0, statusColumn: 'status', statusValues: ['paid', 'refunded', 'pending', 'cancelled', 'disputed', 'chargeback', 'failed', 'expired'] };
    const list = notCheckedList({ fileName: 'orders.csv', question: 'Who are our top customers by revenue?', facts: EMPTY_FACTS, data });
    const v = verdictLine({ level: 'full', stress: done(8), ran: 5, of: 6, notChecked: list, handoff: true });
    expect(v).toContain('Not checked: whether refunded, pending, cancelled, disputed, chargeback, failed and expired orders should count, so if the number matters');
    expect(sentences(v).length).toBe(2);
    expect(v.split(/\s+/).length).toBeLessThanOrEqual(40);
    expect(v).not.toContain('(');
  });
  it('no stress result given (or none to give): "Passed every check." and nothing about the stress test', () => {
    expect(verdictLine({ level: 'full', notChecked: [], handoff: false })).toBe('Passed every check.');
    expect(verdictLine({ level: 'full', stress: { kind: 'none' }, notChecked: [], handoff: false })).toBe('Passed every check.');
  });
  it('is at most two sentences and about thirty words in every case, and uses no engine word', () => {
    for (const st of [done(8), done(12), partial, notRun]) {
      for (const handoff of [true, false]) {
        const v = full(st, { handoff });
        expect(sentences(v).length).toBeLessThanOrEqual(2);
        expect(v.split(/\s+/).length).toBeLessThanOrEqual(38);
        expect(v).not.toMatch(/\b(gate|spec|property|fuzz|mutant|mutation|revision|pin)\b/i);
      }
    }
    expect(sentences(verdictLine({ level: 'basic', notChecked: NOT_CHECKED, handoff: true })).length).toBeLessThanOrEqual(2);
  });
});

describe('answerLead: the answer as it is spoken', () => {
  it('a ranked list: the top name and its figure', () => {
    expect(answerLead(shapeValue(TOP5, ctx))).toBe('Chef Ravioli Starbright, $2,252.07');
    expect(answerLead(shapeValue({ paid: 258, pending: 47 }, { ...ctx, question: 'How many orders are there by status?', callName: 'countByStatus' }))).toBe('paid, 258 orders');
  });
  it('one figure: the figure, with what was counted when the question says', () => {
    expect(answerLead(shapeValue(9876, { ...ctx, question: 'What is the total revenue?', callName: 'totalRevenue' }))).toBe('$9,876.00');
    expect(answerLead(shapeValue(258, { ...ctx, question: 'How many orders are paid?', callName: 'countPaid' }))).toBe('258 orders');
  });
  it('no lead (a table, text, an empty list, nothing): null', () => {
    expect(answerLead(shapeValue([], ctx))).toBeNull();
    expect(answerLead(shapeValue([{ a: 1, b: 'x', c: true }], ctx))).toBeNull();
    expect(answerLead(null)).toBeNull();
  });
});

describe('versionNote: where "Version 4" comes from on the demo\'s first run', () => {
  // the answer's own function; the demo's agreement is a spec saved for it
  const FN = 'topCustomersByRevenue';
  const OTHER = 'howManyOrdersWereRefunded';
  type K = 'init' | 'dataset' | 'spec-edit' | 'commit' | 'pin' | 'decision';
  const rev = (...kinds: K[]) => kinds.map((kind, i) => ({ id: i + 1, kind, ...(kind === 'spec-edit' ? { fn: FN } : {}) }));
  it('names the saves before the first answer, in the order they happened, with the range taken from the version', () => {
    expect(versionNote(rev('init', 'dataset', 'spec-edit', 'commit'), 4, FN)).toBe("Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.");
    // another file loaded first: one more save, one higher version, and it says "files"
    expect(versionNote(rev('init', 'dataset', 'dataset', 'spec-edit', 'commit'), 5, FN)).toBe("Versions 1 to 4 were the starting point, the files and the demo's agreement; this is the first answer.");
    expect(versionNote(rev('init', 'spec-edit', 'commit'), 3, FN)).toBe("Versions 1 and 2 were the starting point and the demo's agreement; this is the first answer.");
    expect(versionNote(rev('init', 'commit'), 2, FN)).toBe('Version 1 was the starting point; this is the first answer.');
  });
  it('the demo\'s basic-checks fallback (no agreement among the saves) is explained too: a first answer is never an unexplained "Version 3"', () => {
    expect(versionNote(rev('init', 'dataset', 'commit'), 3, FN)).toBe('Versions 1 and 2 were the starting point and the file; this is the first answer.');
  });
  it('says nothing when it would claim more than the saves show: a save the viewer made, a gap, or no version', () => {
    expect(versionNote(rev('init', 'dataset', 'spec-edit', 'commit', 'pin', 'commit'), 6, FN)).toBeNull();
    expect(versionNote(rev('init', 'dataset', 'spec-edit', 'decision', 'commit'), 5, FN)).toBeNull();
    expect(versionNote(rev('init', 'dataset', 'commit', 'commit'), 4, FN)).toBeNull();
    expect(versionNote([{ id: 1, kind: 'init' }, { id: 3, kind: 'spec-edit', fn: FN }], 4, FN)).toBeNull();
    expect(versionNote(rev('init', 'commit'), 1, FN)).toBeNull();
    expect(versionNote(rev('init', 'dataset', 'spec-edit', 'commit'), null, FN)).toBeNull();
    expect(versionNote([], 4, FN)).toBeNull();
  });
  it('a spec saved for ANOTHER function is the viewer\'s own (a question they typed), never "the demo\'s agreement"', () => {
    // the recorded repro: the viewer typed a question (its spec is saved at ask time), then asked the recorded one; the answer is
    // Version 5 and the save at 4 is theirs
    const saves = [
      { id: 1, kind: 'init' as const },
      { id: 2, kind: 'dataset' as const },
      { id: 3, kind: 'spec-edit' as const, fn: FN },
      { id: 4, kind: 'spec-edit' as const, fn: OTHER },
      { id: 5, kind: 'commit' as const, fn: FN },
    ];
    expect(versionNote(saves, 5, FN)).toBeNull();
    // the same, with the typed question's spec saved BEFORE the demo's agreement
    const typedFirst = [saves[0]!, saves[1]!, { id: 3, kind: 'spec-edit' as const, fn: OTHER }, { id: 4, kind: 'spec-edit' as const, fn: FN }, { id: 5, kind: 'commit' as const, fn: FN }];
    expect(versionNote(typedFirst, 5, FN)).toBeNull();
    // and with no agreement of the demo's among them at all (the basic fallback after a typed question)
    expect(versionNote([saves[0]!, saves[1]!, { id: 3, kind: 'spec-edit' as const, fn: OTHER }, { id: 4, kind: 'commit' as const, fn: FN }], 4, FN)).toBeNull();
    // the same saves are the demo's own when the answer is the other function's: only the answer's own function's spec counts
    expect(versionNote([{ id: 1, kind: 'init' }, { id: 2, kind: 'dataset' }, { id: 3, kind: 'spec-edit', fn: OTHER }, { id: 4, kind: 'commit', fn: OTHER }], 4, OTHER)).toBe(
      "Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.",
    );
    // a spec save that names no function cannot be shown to be the demo's: nothing is claimed
    expect(versionNote([{ id: 1, kind: 'init' }, { id: 2, kind: 'spec-edit' }, { id: 3, kind: 'commit', fn: FN }], 3, FN)).toBeNull();
  });
  it('a later save does not change it (only the saves before the answer\'s version count)', () => {
    expect(versionNote(rev('init', 'dataset', 'spec-edit', 'commit', 'pin', 'pin'), 4, FN)).toBe("Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.");
    // ... nor does a typed question saved after the answer
    expect(versionNote([...rev('init', 'dataset', 'spec-edit', 'commit'), { id: 5, kind: 'spec-edit' as const, fn: OTHER }], 4, FN)).toBe(
      "Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.",
    );
  });
  it('uses no engine word', () => {
    expect(versionNote(rev('init', 'dataset', 'spec-edit', 'commit'), 4, FN)).not.toMatch(/\b(gate|spec|property|fuzz|mutant|revision|pin)\b/i);
  });
});

describe('versionNoteFor: the note is the demo\'s alone (a copy that runs on your computer gets nothing new)', () => {
  const FN = 'topCustomersByRevenue';
  // exactly the saves the demo makes; a local copy installs the same agreement, so only the mode keeps the note off it
  const saves = [
    { id: 1, kind: 'init' as const },
    { id: 2, kind: 'dataset' as const },
    { id: 3, kind: 'spec-edit' as const, fn: FN },
    { id: 4, kind: 'commit' as const, fn: FN },
  ];
  const NOTE = "Versions 1 to 3 were the starting point, the file and the demo's agreement; this is the first answer.";
  it('replay: the note', () => {
    expect(versionNoteFor('replay', saves, 4, FN)).toBe(NOTE);
  });
  it('live: nothing, whatever the saves are', () => {
    expect(versionNoteFor('live', saves, 4, FN)).toBeNull();
    expect(versionNoteFor('live', saves.slice(0, 2).concat({ id: 3, kind: 'commit' as const, fn: FN }), 3, FN)).toBeNull();
    // the same saves with the demo's mode are not null, so the mode alone is what decided
    expect(versionNoteFor('replay', saves.slice(0, 2).concat({ id: 3, kind: 'commit' as const, fn: FN }), 3, FN)).not.toBeNull();
  });
  it('passes the saves through to versionNote (a viewer\'s own save is still nothing, in the demo)', () => {
    expect(versionNoteFor('replay', [...saves.slice(0, 3), { id: 4, kind: 'pin' as const, fn: FN }, { id: 5, kind: 'commit' as const, fn: FN }], 5, FN)).toBeNull();
  });
});

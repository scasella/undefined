import type { ExampleDef } from './index';

/*
 * median — the textbook function that models get almost right.
 * Natural first-attempt mistakes and the check that catches each:
 *   - `.sort()` without a comparator sorts as strings     → properties (reference comparison)
 *   - even length returns one middle value, not the mean  → tests
 *   - empty list throws instead of returning NaN          → properties (the reference-comparison property generates [])
 *   - `numbers.sort(...)` sorts the caller's array        → invariants (pure: frozen-argument replay)
 */

const DOC = `Returns the median of a list of numbers.`;

const TESTS = String.raw`test('odd-length list', () => {
  eq(median([5, 1, 3]), 3);
});

test('even-length list', () => {
  eq(median([1, 2]), 1.5);
  eq(median([8, 2, 6, 4]), 5);
});

test('single value', () => {
  eq(median([7]), 7);
});

test('negative and fractional values', () => {
  eq(median([0.5, -1, 2]), 0.5);
});
`;

const PROPERTIES = String.raw`const ints = fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 });

const reference = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

matchesReference('agrees with a sort-based reference', [fc.array(fc.integer({ min: -1000, max: 1000 }))], reference);

property('the order of the input does not matter', [ints], (xs: number[]) => {
  const reversed = median([...xs].reverse());
  eq(median(xs), reversed);
});

property('result lies between the smallest and largest value', [ints], (xs: number[]) => {
  const r = median(xs);
  return r >= Math.min(...xs) && r <= Math.max(...xs);
});
`;

const DOC_AFTER_BREAK = `Returns the low median of a list of numbers: the middle value once the numbers are sorted in ascending numeric order. When the list has an even number of values there are two middle values, and the function returns the lower of the two (no averaging), so the result is always one of the input values. An empty list has no median, so the function throws a RangeError. The input array belongs to the caller and must be left exactly as it was.`;

const TESTS_AFTER_BREAK = String.raw`test('returns the middle value of an odd-length list', () => {
  eq(median([5, 1, 3]), 3);
});

test('returns the lower middle value of an even-length list', () => {
  eq(median([1, 2]), 1);
  eq(median([8, 2, 6, 4]), 4);
});

test('a single value is its own median', () => {
  eq(median([7]), 7);
});

test('works with negative and fractional values', () => {
  eq(median([0.5, -1, 2, -3]), -1);
});

test('throws a RangeError for an empty list', () => {
  let result: unknown;
  try {
    result = median([]);
  } catch (e) {
    if (e instanceof RangeError) return;
    throw e;
  }
  eq(result, 'a thrown RangeError');
});
`;

const PROPERTIES_AFTER_BREAK = String.raw`const ints = fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1 });

const reference = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

matchesReference('agrees with a sort-based reference', [ints], reference);

property('the order of the input does not matter', [ints], (xs: number[]) => {
  const reversed = median([...xs].reverse());
  eq(median(xs), reversed);
});

property('result is one of the input values', [ints], (xs: number[]) => xs.includes(median(xs)));
`;

export const median: ExampleDef = {
  id: 'median',
  title: 'median',
  blurb: 'Even-length lists, empty input and numeric sorting: unit tests and a reference property check each one.',
  call: 'median([3, 1, 4, 2])',
  fn: 'median',
  breakIt: {
    label: 'Break it: low median',
    description: 'The doc and tests now demand the lower middle value for even-length lists. The certified 2.5 for median([3, 1, 4, 2]) becomes wrong (expected 2), so the function must be regenerated.',
  },
  spec: {
    name: 'median',
    params: [{ name: 'numbers', type: 'number[]' }],
    returns: 'number',
    doc: DOC,
    tests: TESTS,
    properties: PROPERTIES,
    budgetMs: 1000,
    maxAttempts: 3,
    origin: 'example',
    exampleId: 'median',
  },
  breakPatch: { doc: DOC_AFTER_BREAK, tests: TESTS_AFTER_BREAK, properties: PROPERTIES_AFTER_BREAK },
  goodBodies: [
    String.raw`if (numbers.length === 0) return NaN;
const sorted = [...numbers].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;`,
    String.raw`if (numbers.length === 0) return NaN;
const sorted = numbers.slice().sort((a, b) => a - b);
const n = sorted.length;
return (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2;`,
  ],
  badBodies: [
    {
      body: String.raw`if (numbers.length === 0) return NaN;
const sorted = [...numbers].sort();
const mid = Math.floor(sorted.length / 2);
return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;`,
      rejectedBy: 'properties',
      why: 'Array.prototype.sort() without a comparator sorts numbers as strings; small hand-picked tests pass, the reference property finds an input where the order differs.',
    },
    {
      body: String.raw`if (numbers.length === 0) return NaN;
const sorted = [...numbers].sort((a, b) => a - b);
return sorted[Math.floor(sorted.length / 2)];`,
      rejectedBy: 'tests',
      why: 'Returns the upper middle value for an even-length list instead of averaging the two middle values.',
    },
    {
      body: String.raw`if (numbers.length === 0) throw new Error('empty list');
const sorted = [...numbers].sort((a, b) => a - b);
const mid = Math.floor(sorted.length / 2);
return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;`,
      rejectedBy: 'properties',
      why: 'Mishandles the empty list: throws an Error where the reference returns NaN (fast-check generates [] and shrinks to it).',
    },
    {
      body: String.raw`if (numbers.length === 0) return NaN;
numbers.sort((a, b) => a - b);
const mid = Math.floor(numbers.length / 2);
return numbers.length % 2 === 1 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;`,
      rejectedBy: 'invariants',
      why: "Sorts the caller's array in place: every answer is right, but the frozen-argument replay catches the mutation (pure).",
    },
  ],
  goodBodiesAfterBreak: [
    String.raw`if (numbers.length === 0) throw new RangeError('median of an empty list is undefined');
const sorted = [...numbers].sort((a, b) => a - b);
return sorted[Math.floor((sorted.length - 1) / 2)];`,
  ],
};

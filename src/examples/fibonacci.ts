import type { ExampleDef } from './index';

/*
 * fibonacci — correct, but too slow where it counts.
 * The obvious O(n) bigint loop is right for every small n and takes ~4 s at n = 1,000,000; the per-call wall-clock
 * budget (bounded invariant) terminates it and the diagnostic names the call and the budget, which is what steers the
 * model to fast doubling (~4 ms). Measured with gpt-6-luna: it never writes the naive double recursion on its own, so
 * the demo's bounded-runtime rejection is the loop at n = 1,000,000, not the recursion at n = 90.
 * The return type is bigint because fibonacci(90) = 2880067194370816120 exceeds Number.MAX_SAFE_INTEGER.
 * The doc states everything the checks hold (exactness, the range up to 1,000,000, the recurrence); the time budget is
 * stated in the prompt. Nothing here is a convention the doc is silent on, so no check carries a silentOn marker.
 * Measured with the stated doc: the model still writes the O(n) loop first (8/8) and the bounded diagnostic still
 * steers it to fast doubling (8/8).
 */

const DOC = `Returns the nth Fibonacci number, exactly, for any n from 0 to 1,000,000: F(0) = 0, F(1) = 1, and F(n) = F(n - 1) + F(n - 2).`;

const TESTS = String.raw`test('first values', () => {
  const expected = [0n, 1n, 1n, 2n, 3n, 5n, 8n];
  for (let n = 0; n < expected.length; n++) eq(fibonacci(n), expected[n]);
});

test('small n', () => {
  eq(fibonacci(10), 55n);
  eq(fibonacci(20), 6765n);
});

test('a late value', () => {
  eq(fibonacci(90), 2880067194370816120n);
});

test('a very late value', () => {
  const f = fibonacci(1000000);
  eq(f % 1000000007n, 918091266n);
  eq(f.toString().length, 208988);
});
`;

const PROPERTIES = String.raw`property('recurrence', [fc.integer({ min: 0, max: 88 })], (n: number) => {
  const sum = fibonacci(n) + fibonacci(n + 1);
  eq(fibonacci(n + 2), sum);
});

property('monotonic', [fc.integer({ min: 0, max: 89 })], (n: number) => fibonacci(n) <= fibonacci(n + 1));
`;

const DOC_AFTER_BREAK = `Returns the nth Fibonacci number, exactly, for any n from -1,000,000 to 1,000,000: F(0) = 0, F(1) = 1, and F(n) = F(n - 1) + F(n - 2). For negative n the same rule runs backwards (the negafibonacci numbers): F(-n) = (-1)^(n+1) · F(n), so F(-1) = 1, F(-2) = -1 and F(-1,000,000) = -F(1,000,000).`;

const TESTS_AFTER_BREAK = String.raw`test('starts 0, 1, 1, 2, 3, 5, 8', () => {
  const expected = [0n, 1n, 1n, 2n, 3n, 5n, 8n];
  for (let n = 0; n < expected.length; n++) eq(fibonacci(n), expected[n]);
});

test('extends to negative n with alternating signs', () => {
  eq(fibonacci(-1), 1n);
  eq(fibonacci(-2), -1n);
  eq(fibonacci(-3), 2n);
  eq(fibonacci(-10), -55n);
});

test('is exact past 2^53 in both directions', () => {
  eq(fibonacci(90), 2880067194370816120n);
  eq(fibonacci(-90), -2880067194370816120n);
});

test('a very late value', () => {
  const f = fibonacci(1000000);
  eq(f % 1000000007n, 918091266n);
  eq(f.toString().length, 208988);
});

test('a very early value', () => {
  eq(fibonacci(-1000000), -fibonacci(1000000));
});
`;

const PROPERTIES_AFTER_BREAK = String.raw`const ns = fc.integer({ min: -90, max: 88 });

property('each value is the sum of the two before it', [ns], (n: number) => {
  const sum = fibonacci(n) + fibonacci(n + 1);
  eq(fibonacci(n + 2), sum);
});

property('negative n mirrors positive n up to sign', [fc.integer({ min: 1, max: 90 })], (n: number) => {
  const sign = n % 2 === 1 ? 1n : -1n;
  const mirrored = sign * fibonacci(n);
  eq(fibonacci(-n), mirrored);
});
`;

export const fibonacci: ExampleDef = {
  id: 'fibonacci',
  title: 'fibonacci',
  blurb: 'Here the doc states everything the tests check, n up to 1,000,000 included. The obvious loop is correct but takes seconds at that n: the bounded invariant (a per-call time limit) stops it, and the diagnostic steers the model to fast doubling.',
  call: 'fibonacci(90)',
  fn: 'fibonacci',
  breakIt: {
    label: 'Break it: negative n',
    description: 'The doc now states the range -1,000,000 to 1,000,000 and the negafibonacci rule, and the tests check both. An artifact written for n ≥ 0 gets negative n wrong (the example\'s fast-doubling body returns 1n for fibonacci(-2), expected -1n), so it must be regenerated.',
  },
  spec: {
    name: 'fibonacci',
    params: [{ name: 'n', type: 'number' }],
    returns: 'bigint',
    doc: DOC,
    tests: TESTS,
    properties: PROPERTIES,
    budgetMs: 1500,
    maxAttempts: 3,
    origin: 'example',
    exampleId: 'fibonacci',
  },
  breakPatch: { doc: DOC_AFTER_BREAK, tests: TESTS_AFTER_BREAK, properties: PROPERTIES_AFTER_BREAK },
  goodBodies: [
    String.raw`let a = 0n;
let b = 1n;
for (const bit of n.toString(2)) {
  const c = a * (2n * b - a);
  const d = a * a + b * b;
  if (bit === '1') {
    a = d;
    b = c + d;
  } else {
    a = c;
    b = d;
  }
}
return a;`,
  ],
  badBodies: [
    {
      body: String.raw`let a = 0n;
let b = 1n;
for (let i = 0; i < n; i++) {
  const next = a + b;
  a = b;
  b = next;
}
return a;`,
      rejectedBy: 'invariants',
      why: 'The O(n) bigint loop is correct but needs ~4 s for fibonacci(1000000): the watchdog terminates it at the 1500 ms budget (bounded).',
      browserOnly: true,
    },
    {
      body: String.raw`if (n < 2) return BigInt(n);
return fibonacci(n - 1) + fibonacci(n - 2);`,
      rejectedBy: 'invariants',
      why: 'Naive double recursion is exponential: even fibonacci(90) needs ~10^19 calls, so the watchdog terminates it (bounded).',
      browserOnly: true,
    },
    {
      body: String.raw`let a = 0;
let b = 1;
for (let i = 0; i < n; i++) {
  [a, b] = [b, a + b];
}
return BigInt(a);`,
      rejectedBy: 'tests',
      why: 'Adds plain numbers and converts at the end: above 2^53 the doubles have already lost the low digits, so fibonacci(90) is off by 120.',
    },
    {
      body: String.raw`let a = 0;
let b = 1;
for (let i = 0; i < n; i++) {
  [a, b] = [b, a + b];
}
return a;`,
      rejectedBy: 'compile',
      why: 'Ignores the declared bigint return type and returns a number; the strict compiler rejects it before anything runs.',
    },
    {
      body: String.raw`let a = 1n;
let b = 1n;
for (let i = 1; i < n; i++) {
  [a, b] = [b, a + b];
}
return a;`,
      rejectedBy: 'tests',
      why: 'Off by one at the start of the sequence: treats fibonacci(0) as 1.',
    },
  ],
  goodBodiesAfterBreak: [
    String.raw`const k = Math.abs(n);
let a = 0n;
let b = 1n;
for (const bit of k.toString(2)) {
  const c = a * (2n * b - a);
  const d = a * a + b * b;
  if (bit === '1') {
    a = d;
    b = c + d;
  } else {
    a = c;
    b = d;
  }
}
return n < 0 && k % 2 === 0 ? -a : a;`,
  ],
};

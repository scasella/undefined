import type { ExampleDef } from './index';

/*
 * fibonacci — the classic exponential trap.
 * The two-line recursive definition is correct and compiles, but fibonacci(90) makes ~10^19 calls: the per-call
 * wall-clock budget (bounded invariant) is the only thing that stops it, and the diagnostic says so. The return type
 * is bigint because fibonacci(90) = 2880067194370816120 is far above Number.MAX_SAFE_INTEGER; a body that adds
 * plain numbers and converts at the end is caught by the unit test at n = 90, one that returns number by the compiler.
 */

const DOC = `Returns the nth Fibonacci number as an exact bigint, where fibonacci(0) = 0n, fibonacci(1) = 1n and every later value is the sum of the two before it. n is an integer from 0 to 90; the larger values are far beyond Number.MAX_SAFE_INTEGER, which is why the result is a bigint. Callers use it interactively, so every call must return quickly.`;

const TESTS = String.raw`test('starts 0, 1, 1, 2, 3, 5, 8', () => {
  const expected = [0n, 1n, 1n, 2n, 3n, 5n, 8n];
  for (let n = 0; n < expected.length; n++) eq(fibonacci(n), expected[n]);
});

test('small values', () => {
  eq(fibonacci(10), 55n);
  eq(fibonacci(20), 6765n);
});

test('is exact at the top of the range', () => {
  eq(fibonacci(90), 2880067194370816120n);
});
`;

const PROPERTIES = String.raw`const ns = fc.integer({ min: 0, max: 88 });

property('each value is the sum of the two before it', [ns], (n: number) => {
  const sum = fibonacci(n) + fibonacci(n + 1);
  eq(fibonacci(n + 2), sum);
});

property('never decreases', [fc.integer({ min: 0, max: 89 })], (n: number) => fibonacci(n) <= fibonacci(n + 1));
`;

const DOC_AFTER_BREAK = `Returns the nth Fibonacci number as an exact bigint, where fibonacci(0) = 0n, fibonacci(1) = 1n and fibonacci(n + 2) = fibonacci(n + 1) + fibonacci(n) for every integer n. n is an integer from -90 to 90. Negative n follows the same recurrence run backwards (the "negafibonacci" numbers): fibonacci(-n) = (-1)^(n+1) · fibonacci(n), so fibonacci(-1) = 1n and fibonacci(-2) = -1n. Callers use it interactively, so every call must return quickly.`;

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

test('is exact at both ends of the range', () => {
  eq(fibonacci(90), 2880067194370816120n);
  eq(fibonacci(-90), -2880067194370816120n);
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
  blurb: 'The textbook recursion is correct but exponential: fibonacci(90) never returns, and the bounded invariant (a per-call time limit) stops it.',
  call: 'fibonacci(90)',
  fn: 'fibonacci',
  breakIt: {
    label: 'Break it: negative n',
    description: 'The doc and tests now extend the range to n = -90 using the negafibonacci rule. The certified artifact returns 0n for every negative n, so it must be regenerated.',
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
for (let i = 0; i < n; i++) {
  const next = a + b;
  a = b;
  b = next;
}
return a;`,
    String.raw`const memo = new Map<number, bigint>();
const fib = (k: number): bigint => {
  if (k < 2) return BigInt(k);
  const hit = memo.get(k);
  if (hit !== undefined) return hit;
  const value = fib(k - 1) + fib(k - 2);
  memo.set(k, value);
  return value;
};
return fib(n);`,
  ],
  badBodies: [
    {
      body: String.raw`if (n < 2) return BigInt(n);
return fibonacci(n - 1) + fibonacci(n - 2);`,
      rejectedBy: 'invariants',
      why: 'Naive double recursion is correct but exponential: fibonacci(90) needs ~10^19 calls, so the watchdog terminates it at the 1500 ms budget (bounded).',
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
for (let i = 0; i < k; i++) {
  const next = a + b;
  a = b;
  b = next;
}
return n < 0 && k % 2 === 0 ? -a : a;`,
  ],
};

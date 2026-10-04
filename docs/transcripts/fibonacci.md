# Transcript: fibonacci

A real session recorded live on 2026-10-04 with `gpt-6-luna` (effort `low`) via Codex CLI 0.159.2.
Everything below is verbatim from `public/recordings/fibonacci.json`. The first call that triggered it: `fibonacci(90)`.

Spec the user had: `fibonacci(n: number): bigint`; doc: "Returns the nth Fibonacci number, exactly, for any n from 0 to 1,000,000: F(0) = 0, F(1) = 1, and F(n) = F(n - 1) + F(n - 2).".

## Attempt 1

### What the model was sent (exact prompt)

```
You write the body of one TypeScript function, fibonacci. A strict toolchain decides whether your code is accepted: the TypeScript compiler, hidden unit tests, fast-check property tests, and purity/time-limit checks. Only code that passes all of them is used.

HARD RULES
- Do not run any shell command. Do not read, list or inspect any file. Do not use any tool. The working directory is empty on purpose; nothing there will help.
- Answer immediately, from this prompt alone.
- Return ONLY the JSON object {"body": string, "notes": string}. No text before or after it.

OUTPUT
- "body": ONLY the statements that go between the function's braces. No signature, no braces around the whole thing, no markdown fences, nothing declared outside the function. Helper functions, if needed, must be declared inside the body.
- "notes": one short sentence about the approach.

FUNCTION
function fibonacci(n: number): bigint

Your body is compiled exactly as:
function fibonacci(n: number): bigint {
  <body>
}

REQUIREMENTS FOR THE BODY
- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).
- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.
- Must not mutate its arguments.
- Each call must return within 1500 ms.
- Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).

CONTRACT (the doc; follow it exactly)
Returns the nth Fibonacci number, exactly, for any n from 0 to 1,000,000: F(0) = 0, F(1) = 1, and F(n) = F(n - 1) + F(n - 2).

CHECKS
These checks will be run against your function (bodies are hidden):
Unit tests:
- "first values"
- "small n"
- "a late value"
- "a very late value"
Properties (fast-check generates many inputs, including edge cases):
- "recurrence"
- "monotonic"

HONESTY (when not to write the function)
- Every generated function is a pure function of its arguments. If fibonacci cannot honestly be written that way (its name or contract needs randomness, the current time, the network, files, the console, or state that persists between calls such as counters, caches or ids), do NOT fake it with a constant, an echo of the input or a no-op. The body must be exactly:
  throw new Error("CANNOT_BE_PURE: <one sentence: what it would need>");
- Decline with NEEDS_SPEC only when the name carries no meaning of its own (process, handle, data, transform, clean, run, doIt: a verb or noun that does not say what comes out) AND the contract above is empty. Then do not invent behaviour; the body must be exactly:
  throw new Error("NEEDS_SPEC: <one sentence: the single question you need answered>");
- If the name DESCRIBES the result (topCustomersByRevenue, monthlyTotals, dedupeByEmail, truncate, formatCurrency, parseCsvLine, sortDescending, isPalindrome, add), write it: choose the most conventional reading, handle the argument types sensibly, and use the notes field to name the assumptions you made in one sentence (e.g. "Assumes totals are summed per group, ties sorted alphabetically, returns the top 5."). A reasonable default with its assumptions stated is better than a question; the caller can correct you with a spec.

FINAL REMINDER
- Do not run any shell command, do not read or inspect any file, do not use any tool.
- Reply now with ONLY the JSON object {"body": string, "notes": string}; "body" holds only the statements between the braces.
```

### What the model returned (6.4 s)

Note: Uses an iterative exact BigInt calculation and rejects inputs outside the documented integer range.

```ts
if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
  throw new Error("n must be an integer from 0 to 1,000,000");
}
let a = 0n;
let b = 1n;
for (let i = 0; i < n; i++) {
  const next = a + b;
  a = b;
  b = next;
}
return a;
```

*The gates ran live in the browser and rejected this candidate; the diagnostics they produced are the `PREVIOUS ATTEMPT` section of the next prompt.*

## Attempt 2

### What the model was sent (exact prompt)

```
You write the body of one TypeScript function, fibonacci. A strict toolchain decides whether your code is accepted: the TypeScript compiler, hidden unit tests, fast-check property tests, and purity/time-limit checks. Only code that passes all of them is used.

HARD RULES
- Do not run any shell command. Do not read, list or inspect any file. Do not use any tool. The working directory is empty on purpose; nothing there will help.
- Answer immediately, from this prompt alone.
- Return ONLY the JSON object {"body": string, "notes": string}. No text before or after it.

OUTPUT
- "body": ONLY the statements that go between the function's braces. No signature, no braces around the whole thing, no markdown fences, nothing declared outside the function. Helper functions, if needed, must be declared inside the body.
- "notes": one short sentence about the approach.

FUNCTION
function fibonacci(n: number): bigint

Your body is compiled exactly as:
function fibonacci(n: number): bigint {
  <body>
}

REQUIREMENTS FOR THE BODY
- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).
- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.
- Must not mutate its arguments.
- Each call must return within 1500 ms.
- Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).

CONTRACT (the doc; follow it exactly)
Returns the nth Fibonacci number, exactly, for any n from 0 to 1,000,000: F(0) = 0, F(1) = 1, and F(n) = F(n - 1) + F(n - 2).

CHECKS
These checks will be run against your function (bodies are hidden):
Unit tests:
- "first values"
- "small n"
- "a late value"
- "a very late value"
Properties (fast-check generates many inputs, including edge cases):
- "recurrence"
- "monotonic"

HONESTY (when not to write the function)
- Every generated function is a pure function of its arguments. If fibonacci cannot honestly be written that way (its name or contract needs randomness, the current time, the network, files, the console, or state that persists between calls such as counters, caches or ids), do NOT fake it with a constant, an echo of the input or a no-op. The body must be exactly:
  throw new Error("CANNOT_BE_PURE: <one sentence: what it would need>");
- Decline with NEEDS_SPEC only when the name carries no meaning of its own (process, handle, data, transform, clean, run, doIt: a verb or noun that does not say what comes out) AND the contract above is empty. Then do not invent behaviour; the body must be exactly:
  throw new Error("NEEDS_SPEC: <one sentence: the single question you need answered>");
- If the name DESCRIBES the result (topCustomersByRevenue, monthlyTotals, dedupeByEmail, truncate, formatCurrency, parseCsvLine, sortDescending, isPalindrome, add), write it: choose the most conventional reading, handle the argument types sensibly, and use the notes field to name the assumptions you made in one sentence (e.g. "Assumes totals are summed per group, ties sorted alphabetically, returns the top 5."). A reasonable default with its assumptions stated is better than a question; the caller can correct you with a spec.

PREVIOUS ATTEMPT (rejected)
Attempt 1 was rejected. Its body:
```ts
if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
  throw new Error("n must be an integer from 0 to 1,000,000");
}
let a = 0n;
let b = 1n;
for (let i = 0; i < n; i++) {
  const next = a + b;
  a = b;
  b = next;
}
return a;
```
What the checks reported:
passed: compile
INVARIANTS FAILED
  - bounded: fibonacci(1000000) did not return within 1500 ms
    call:     fibonacci(1000000)
    budget:   1500 ms, elapsed: 1518 ms
    during:   tests
    detail:   worker terminated by the watchdog
    meaning:  the call was too slow; use an asymptotically faster algorithm

Fix exactly what the diagnostics show. Keep what worked. Do not repeat an approach that was already rejected.

FINAL REMINDER
- Do not run any shell command, do not read or inspect any file, do not use any tool.
- Reply now with ONLY the JSON object {"body": string, "notes": string}; "body" holds only the statements between the braces.
```

### What the model returned (6.9 s)

Note: Uses fast doubling to compute the exact Fibonacci value in logarithmic steps and rejects inputs outside the documented integer range.

```ts
if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
  throw new Error("n must be an integer from 0 to 1,000,000");
}
let a = 0n;
let b = 1n;
for (let bit = 31; bit >= 0; bit--) {
  const c = a * (2n * b - a);
  const d = a * a + b * b;
  if ((n & (1 << bit)) === 0) {
    a = c;
    b = d;
  } else {
    a = d;
    b = c + d;
  }
}
return a;
```

*This candidate passed the gates in the browser and was committed.*


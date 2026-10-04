# Transcript: median

A real session recorded live on 2026-10-04 with `gpt-6-luna` (effort `low`) via Codex CLI 0.159.2.
Everything below is verbatim from `public/recordings/median.json`. The first call that triggered it: `median([3, 1, 4, 2])`.

Spec the user had: `median(numbers: number[]): number`; doc: "Returns the median of a list of numbers.".

## Attempt 1

### What the model was sent (exact prompt)

```
You write the body of one TypeScript function, median. A strict toolchain decides whether your code is accepted: the TypeScript compiler, hidden unit tests, fast-check property tests, and purity/time-limit checks. Only code that passes all of them is used.

HARD RULES
- Do not run any shell command. Do not read, list or inspect any file. Do not use any tool. The working directory is empty on purpose; nothing there will help.
- Answer immediately, from this prompt alone.
- Return ONLY the JSON object {"body": string, "notes": string}. No text before or after it.

OUTPUT
- "body": ONLY the statements that go between the function's braces. No signature, no braces around the whole thing, no markdown fences, nothing declared outside the function. Helper functions, if needed, must be declared inside the body.
- "notes": one short sentence about the approach.

FUNCTION
function median(numbers: number[]): number

Your body is compiled exactly as:
function median(numbers: number[]): number {
  <body>
}

REQUIREMENTS FOR THE BODY
- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).
- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.
- Must not mutate its arguments.
- Each call must return within 1000 ms.
- Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).

CONTRACT (the doc; follow it exactly)
Returns the median of a list of numbers.

CHECKS
These checks will be run against your function (bodies are hidden):
Unit tests:
- "odd-length list"
- "even-length list"
- "single value"
- "negative and fractional values"
Properties (fast-check generates many inputs, including edge cases):
- "agrees with a sort-based reference"
- "the order of the input does not matter"
- "result lies between the smallest and largest value"

HONESTY (when not to write the function)
- Every generated function is a pure function of its arguments. If median cannot honestly be written that way (its name or contract needs randomness, the current time, the network, files, the console, or state that persists between calls such as counters, caches or ids), do NOT fake it with a constant, an echo of the input or a no-op. The body must be exactly:
  throw new Error("CANNOT_BE_PURE: <one sentence: what it would need>");
- Decline with NEEDS_SPEC only when the name carries no meaning of its own (process, handle, data, transform, clean, run, doIt: a verb or noun that does not say what comes out) AND the contract above is empty. Then do not invent behaviour; the body must be exactly:
  throw new Error("NEEDS_SPEC: <one sentence: the single question you need answered>");
- If the name DESCRIBES the result (topCustomersByRevenue, monthlyTotals, dedupeByEmail, truncate, formatCurrency, parseCsvLine, sortDescending, isPalindrome, add), write it: choose the most conventional reading, handle the argument types sensibly, and use the notes field to name the assumptions you made in one sentence (e.g. "Assumes totals are summed per group, ties sorted alphabetically, returns the top 5."). A reasonable default with its assumptions stated is better than a question; the caller can correct you with a spec.

FINAL REMINDER
- Do not run any shell command, do not read or inspect any file, do not use any tool.
- Reply now with ONLY the JSON object {"body": string, "notes": string}; "body" holds only the statements between the braces.
```

### What the model returned (6.9 s)

Note: Sorts a copy and returns the middle value or the mean of the two middle values; assumes the list is non-empty.

```ts
if (numbers.length === 0) {
  throw new Error("median requires a non-empty list");
}
const sorted = numbers.slice().sort((a, b) => a - b);
const middle = Math.floor(sorted.length / 2);
if (sorted.length % 2 === 1) {
  return sorted[middle];
}
return (sorted[middle - 1] + sorted[middle]) / 2;
```

*The gates ran live in the browser and rejected this candidate; the diagnostics they produced are the `PREVIOUS ATTEMPT` section of the next prompt.*

## Attempt 2

### What the model was sent (exact prompt)

```
You write the body of one TypeScript function, median. A strict toolchain decides whether your code is accepted: the TypeScript compiler, hidden unit tests, fast-check property tests, and purity/time-limit checks. Only code that passes all of them is used.

HARD RULES
- Do not run any shell command. Do not read, list or inspect any file. Do not use any tool. The working directory is empty on purpose; nothing there will help.
- Answer immediately, from this prompt alone.
- Return ONLY the JSON object {"body": string, "notes": string}. No text before or after it.

OUTPUT
- "body": ONLY the statements that go between the function's braces. No signature, no braces around the whole thing, no markdown fences, nothing declared outside the function. Helper functions, if needed, must be declared inside the body.
- "notes": one short sentence about the approach.

FUNCTION
function median(numbers: number[]): number

Your body is compiled exactly as:
function median(numbers: number[]): number {
  <body>
}

REQUIREMENTS FOR THE BODY
- Must compile under TypeScript 'strict' with lib ES2022 only: no DOM and no Node APIs (no window, document, fetch, process, require, console, setTimeout).
- Pure and deterministic: read only the parameters and standard ES2022 built-ins. No global state, no I/O, no Date or Date.now(), no Math.random(), no performance, no crypto.
- Must not mutate its arguments.
- Each call must return within 1000 ms.
- Throw an Error only where the contract says the input is invalid (or as the whole body, in the two cases under HONESTY below).

CONTRACT (the doc; follow it exactly)
Returns the median of a list of numbers.

CHECKS
These checks will be run against your function (bodies are hidden):
Unit tests:
- "odd-length list"
- "even-length list"
- "single value"
- "negative and fractional values"
Properties (fast-check generates many inputs, including edge cases):
- "agrees with a sort-based reference"
- "the order of the input does not matter"
- "result lies between the smallest and largest value"

HONESTY (when not to write the function)
- Every generated function is a pure function of its arguments. If median cannot honestly be written that way (its name or contract needs randomness, the current time, the network, files, the console, or state that persists between calls such as counters, caches or ids), do NOT fake it with a constant, an echo of the input or a no-op. The body must be exactly:
  throw new Error("CANNOT_BE_PURE: <one sentence: what it would need>");
- Decline with NEEDS_SPEC only when the name carries no meaning of its own (process, handle, data, transform, clean, run, doIt: a verb or noun that does not say what comes out) AND the contract above is empty. Then do not invent behaviour; the body must be exactly:
  throw new Error("NEEDS_SPEC: <one sentence: the single question you need answered>");
- If the name DESCRIBES the result (topCustomersByRevenue, monthlyTotals, dedupeByEmail, truncate, formatCurrency, parseCsvLine, sortDescending, isPalindrome, add), write it: choose the most conventional reading, handle the argument types sensibly, and use the notes field to name the assumptions you made in one sentence (e.g. "Assumes totals are summed per group, ties sorted alphabetically, returns the top 5."). A reasonable default with its assumptions stated is better than a question; the caller can correct you with a spec.

PREVIOUS ATTEMPT (rejected)
Attempt 1 was rejected. Its body:
```ts
if (numbers.length === 0) {
  throw new Error("median requires a non-empty list");
}
const sorted = numbers.slice().sort((a, b) => a - b);
const middle = Math.floor(sorted.length / 2);
if (sorted.length % 2 === 1) {
  return sorted[middle];
}
return (sorted[middle - 1] + sorted[middle]) / 2;
```
What the checks reported:
passed: compile, tests
PROPERTIES FAILED
  - property "agrees with a sort-based reference"
    counterexample (shrunk by fast-check in 0 steps, seed 356460707): median([])
    expected: NaN
    error:    Error: median requires a non-empty list

Fix exactly what the diagnostics show. Keep what worked. Do not repeat an approach that was already rejected.

FINAL REMINDER
- Do not run any shell command, do not read or inspect any file, do not use any tool.
- Reply now with ONLY the JSON object {"body": string, "notes": string}; "body" holds only the statements between the braces.
```

### What the model returned (7.3 s)

Note: Copies and sorts the values, returning the middle value or the average of the two middle values; an empty list yields NaN.

```ts
const sorted = numbers.slice().sort((a, b) => a - b);
const middle = Math.floor(sorted.length / 2);
if (sorted.length % 2 === 1) {
  return sorted[middle];
}
return (sorted[middle - 1] + sorted[middle]) / 2;
```

*This candidate passed the gates in the browser and was committed.*


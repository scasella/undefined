# Hostile calls

Typed with no spec, live, into a fresh image each time, the way strangers will: ambiguous names, state and randomness,
async-looking names, nested objects, functions that tempt an in-place mutation, Unicode, numbers near overflow, I/O names,
odd arguments, typos, reserved names. Measured 2026-10-04 with `gpt-6-luna`, effort `low`, Codex CLI 0.159.2,
through the real app in headless Chrome (`node scripts/hostile.mjs`; the 54 calls are in `scripts/hostile-calls.json`; raw
results are not committed, the script reproduces them). The full list ran **three times**: before the fixes, after the first
version of the decline rule, and with the final prompt. The table is the final run; the notes use all three where they
disagree, because the disagreement is itself a finding.

Key: ✅ a reasonable person would call the outcome correct (or the refusal right). ⚠️ defensible or ambiguous given no
contract, or unstable between runs. ❌ a reasonable person would call the result wrong **and the gates passed it**: with no
spec the only gates are Compile and Invariants, so nothing could have caught it. The remedy for those is a pinned test or a
spec (see the README).

## What this session changed

1. **Faked impurity (the worst finding).** 20 of the 20 impure or ambiguous calls (`clean`, `process`, `handle`, `counter`,
   `shuffle`, `randomInt`, `now`, `uuid`, `fetchUser`, `getWeather`, `readFile`, `httpGet`…) were committed with a green tick
   as stubs: `shuffle` returned its input, `randomInt(1, 10)` returned `1`, `now()` returned `undefined`, `uuid()` all
   zeros, `getWeather("Paris")` echoed `"Paris"`. The model's own notes confessed it ("randomness is prohibited, so this
   preserves element order"); nothing in the UI said so. **Fix:** the prompt now lets the model *decline* instead of faking
   (`CANNOT_BE_PURE`, `NEEDS_SPEC`). A decline is final: no gates run, no revision, nothing committed, and the REPL says why
   and what to do. Now 2 of those 20 are still committed (`clean(x)`, which filters nulls sensibly, and `getCookie`).
2. **The first version of that rule over-declined** (found by trying the data scratchpad's own headline call,
   `topCustomersByRevenue(rows)`, which it refused with "which discount rules count?"). The rule was re-calibrated against
   ~47 spec-less calls, three samples each (`scripts/calibrate.tune.ts`): names that *describe the result* are written, with
   the assumptions stated in the note (**78 of 78** written); meaningless names are declined (**21 of 21**); impure names are
   declined (**41 of 45**, the four exceptions being `getCookie`/`printReport` read as pure parsing/formatting).
3. **`[1, 2, 3].map(double)` returned `[0, 2, 6]`:** the function was grown from `map`'s three callback arguments (value,
   index, array). Callback-shaped calls now use the value only: `[2, 4, 6]`.
4. **Function arguments** (`compose(x => x + 1, x => x * 2)`) used to be refused. They work now; the gates cannot replay a
   function argument and the Invariants gate says exactly that.
5. **Messages:** the `SyntaxError` mentioned a bracket the harness added; the Unicode-name refusal claimed JavaScript
   forbids it (it is our constraint); `process`/`eval`/`constructor`/`toString` refusals now say why and suggest a name.
6. **Spec-less accepts no longer read as endorsements:** the line under the result says it was only compiled and checked
   for purity, and shows the model's own note.

Scorecard (final run): 40 ✅, 12 ⚠️, 2 ❌ of 54.

## Still wrong, and why (the honest part)

- **Run-to-run variance is the biggest remaining problem, and nothing in the gates can see it.** Across the three runs:
  `isPalindrome("A man, a plan, a canal: Panama")` was `true`, `false`, `true`; `countCharacters("👨‍👩‍👧 café")` was 13, 13, 10;
  `capitalizeAll` was "Ann", "ANN", "ANN"; `add("1", "2")` was `"12"`, `"12"`, `"3"`; `groupBy` changed its output shape.
  With no contract the model is free to choose, and chooses differently. A pinned test freezes the behaviour you meant.
- **Overfitting to the example.** `groupBy` hard-codes the keys `k` and `v`; `deepMerge` hard-codes `a`; both are correct for
  the example call. The type the model sees is inferred from one call, so it is a literal object type. The model's notes
  admit it. A dataset schema (typed from many rows) is the structural remedy, and is what the data scratchpad does.
- **Unicode.** `reverseString` splits an emoji, `titleCase` only capitalises ASCII, `countCharacters` counts code units or
  code points. All three are what the model *said* it did. All three pass.
- **Numbers.** `factorial(25)` and `fibonacci(100)` return doubles. Correct to the precision of a number, wrong if you
  wanted every digit.
- **The decline reason is sometimes imprecise** (`loadConfig` is declined as "needs a spec" rather than "needs files"), and
  the model is not consistent about borderline names (`getCookie`, `truncate`, `clean(x)` each flipped between runs).

## All 54 calls (final run)

| # | call | before → after | result now | decided by | verdict |
|---|---|---|---|---|---|
| 0 | `process([1, 2, 3])` | refused → **refused** | `process is not defined. `process` is the name of a host global (networ` | the runtime, before generation | ✅ Refused before any generation (`process` is a host name). The message says why and suggests `processData`. |
| 1 | `clean("  Hello,   World  ")` | accepted → **declined** | `The model couldn't tell what `clean` should do: What cleaning operatio` | the model (no gate ran) | ✅ Declined (needs a spec). Before: an identity function behind a green tick. |
| 2 | `clean(x)` | accepted → **accepted** | `[3, 1, 2]` | Compile + Invariants (no spec, so nothing else could) | ✅ Accepted: with an array of nullable numbers the name has something to go on and the model filters the nulls. (A previous run declined; the calibration pass moved this one to "write".) |
| 3 | `handle({ type: "click", x: 3 })` | accepted → **declined** | `The model couldn't tell what `handle` should do: What should handle do` | the model (no gate ran) | ✅ Declined. Before: copied the two example keys. |
| 4 | `transform({ a: 1, b: 2 })` | accepted → **declined** | `The model couldn't tell what `transform` should do: What output should` | the model (no gate ran) | ✅ Declined. Before: copied the two example keys. |
| 5 | `data([1, 2])` | accepted → **declined** | `The model couldn't tell what `data` should do: What should this functi` | the model (no gate ran) | ✅ Declined. Before: `slice()`. |
| 6 | `counter()` | accepted → **declined** | `The model declined to write `counter`: A counter needs state that pers` | the model (no gate ran) | ✅ Declined: it needs state between calls. Before: `return 0`. |
| 7 | `nextId()` | accepted → **declined** | `The model declined to write `nextId`: generating a new ID requires sta` | the model (no gate ran) | ✅ Declined. Before: `return 1`. |
| 8 | `randomInt(1, 10)` | accepted → **declined** | `The model declined to write `randomInt`: generating a random integer r` | the model (no gate ran) | ✅ Declined: needs randomness. Before: returned the minimum. |
| 9 | `shuffle([1, 2, 3, 4, 5])` | accepted → **declined** | `The model declined to write `shuffle`: Shuffling requires a source of ` | the model (no gate ran) | ✅ Declined: needs randomness. Before: returned the input unchanged. |
| 10 | `now()` | accepted → **declined** | `The model declined to write `now`: returning the current time requires` | the model (no gate ran) | ✅ Declined: needs the clock. Before: `undefined`. |
| 11 | `uuid()` | accepted → **declined** | `The model declined to write `uuid`: UUID generation needs randomness o` | the model (no gate ran) | ✅ Declined. Before: a constant all-zero UUID. |
| 12 | `fetchUser(42)` | accepted → **declined** | `The model declined to write `fetchUser`: Fetching a user requires acce` | the model (no gate ran) | ✅ Declined: needs the network. Before: `undefined`. |
| 13 | `sleep(100)` | accepted → **declined** | `The model declined to write `sleep`: sleeping requires waiting for the` | the model (no gate ran) | ✅ Declined: sleeping needs real time. Before: `undefined`. |
| 14 | `getWeather("Paris")` | accepted → **declined** | `The model declined to write `getWeather`: Weather data requires the cu` | the model (no gate ran) | ✅ Declined: needs the network. Before: echoed "Paris". |
| 15 | `loadConfig("app.json")` | accepted → **declined** | `The model couldn't tell what `loadConfig` should do: What configuratio` | the model (no gate ran) | ⚠️ Declined as "needs a spec" (really: needs files). Honest either way; the reason text could be sharper. |
| 16 | `flatten([[1, [2]], [3, [4, [5]]]])` | accepted → **accepted** | `[1, 2, 3, 4, 5]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct. |
| 17 | `groupBy([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], "k")` | accepted → **accepted** | `{ a: [{ k: "a", v: 1 }, { k: "a", v: 3 }], b: [{ k: "b", v: 2 }] }` | Compile + Invariants (no spec, so nothing else could) | ⚠️ Accepted; the body hard-codes the keys `k` and `v` from the example call, and **the result shape differed between runs** (whole items vs. only the `v` values). Correct for the example, wrong in general; the model's note says so. |
| 18 | `deepMerge({ a: { b: 1 }, c: 1 }, { a: { d: 2 }, c: 2 })` | accepted → **accepted** | `{ a: { b: 1, d: 2 }, c: 2 }` | Compile + Invariants (no spec, so nothing else could) | ⚠️ Accepted; hard-codes keys `a` and `c` ("at its known level", per its own note). Correct for the example, not a deep merge. |
| 19 | `transpose([[1, 2, 3], [4, 5, 6]])` | accepted → **accepted** | `[[1, 4], [2, 5], [3, 6]]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct (shortest-row rule for ragged input is a choice the note states). |
| 20 | `sumBy([{ price: 1.5, qty: 2 }, { price: 3, qty: 1 }], "price")` | accepted → **accepted** | `4.5` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct for the example; sums a numeric column by name. |
| 21 | `sortDescending([3, 1, 2])` | accepted → **accepted** | `[3, 2, 1]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct; copies before sorting (the frozen-argument replay would have rejected an in-place sort). |
| 22 | `removeDuplicates([1, 1, 2, 3, 3])` | accepted → **accepted** | `[1, 2, 3]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct. |
| 23 | `reverseInPlace([1, 2, 3])` | accepted → **accepted** | `[3, 2, 1]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct; copies despite the name "InPlace". |
| 24 | `capitalizeAll(["ann", "bob"])` | accepted → **accepted** | `["ANN", "BOB"]` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `toUpperCase()` ("ANN"); a person would expect "Ann". **Run-to-run variance**: "Ann" in the first run, "ANN" in the next two. |
| 25 | `reverseString("héllo wörld 👍🏽")` | accepted → **accepted** | `"🏽👍 dlröw olléh"` | Compile + Invariants (no spec, so nothing else could) | ❌ Reverses by code point, so the emoji "👍🏽" (thumbs-up + skin tone) is split and reordered. Wrong for text; the note admits "by Unicode code points". Nothing without a test can catch this. |
| 26 | `titleCase("élan vital of the ünderground")` | accepted → **accepted** | `"éLan Vital Of The üNderground"` | Compile + Invariants (no spec, so nothing else could) | ❌ "éLan Vital Of The üNderground": only ASCII letters are capitalised. The note says so. Wrong for any non-English text. |
| 27 | `countCharacters("👨‍👩‍👧 café")` | accepted → **accepted** | `10` | Compile + Invariants (no spec, so nothing else could) | ⚠️ **13, 13, then 10** across three runs for a string a person would count as 6: UTF-16 units vs. code points, per the note. Defensible, unstable, and neither is the answer a person wants. |
| 28 | `isPalindrome("A man, a plan, a canal: Panama")` | accepted → **accepted** | `true` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `true` in this run, **`false` in another** (that run compared the raw string, punctuation and all). Run-to-run variance on the classic palindrome. |
| 29 | `truncate("héllo wörld", 7)` | accepted → **accepted** | `"héllo w"` | Compile + Invariants (no spec, so nothing else could) | ✅ `"héllo w"`: a plain cut at 7 characters. (One run declined it, asking about an ellipsis, so this one is borderline between over-cautious and right.) |
| 30 | `factorial(25)` | accepted → **accepted** | `1.5511210043330986e+25` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `1.5511210043330986e+25`: a double, not 15511210043330985984000000. Correct given no contract; the remedy is a pinned test or a spec saying "exact". |
| 31 | `fibonacci(100)` | accepted → **accepted** | `354224848179262000000` | Compile + Invariants (no spec, so nothing else could) | ⚠️ A double (`354224848179262000000`), exact only to 15-16 digits. Same as above. (One earlier run threw above n = 78, honest but less useful.) |
| 32 | `power(2, 1024)` | accepted → **accepted** | `Infinity` | Compile + Invariants (no spec, so nothing else could) | ✅ `Infinity` is what `2 ** 1024` is in JS. |
| 33 | `isPrime(9007199254740993)` | accepted → **accepted** | `false` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `false`, but the literal 9007199254740993 is already rounded to 9007199254740992 by JavaScript before the call. Not the function's fault. |
| 34 | `gcd(0, 0)` | accepted → **accepted** | `0` | Compile + Invariants (no spec, so nothing else could) | ✅ `0`, a stated convention in the note. |
| 35 | `readFile("notes.txt")` | accepted → **declined** | `The model declined to write `readFile`: Reading a file requires access` | the model (no gate ran) | ✅ Declined: needs the file system. Before: echoed the path. |
| 36 | `httpGet("https://example.com")` | accepted → **declined** | `The model declined to write `httpGet`: An HTTP GET needs network acces` | the model (no gate ran) | ✅ Declined: needs the network. Before: echoed the URL. |
| 37 | `saveToDisk({ a: 1 })` | accepted → **declined** | `The model declined to write `saveToDisk`: Saving to disk requires file` | the model (no gate ran) | ✅ Declined: needs the file system. Before: copied the object. |
| 38 | `printReport([1, 2, 3])` | accepted → **declined** | `The model declined to write `printReport`: A report needs an output de` | the model (no gate ran) | ✅ Declined: needs an output channel. Before: a no-op. |
| 39 | `getCookie("session")` | accepted → **accepted** | `""` | Compile + Invariants (no spec, so nothing else could) | ⚠️ Accepted, returning `""`: it parses a cookie header string for the name "cookie", which is a pure reading of `getCookie(string)` but a stub in effect. One run declined it. The sentence "needs browser state" is the right answer; the model split 2-to-1 on it. |
| 40 | `hello()` | accepted → **accepted** | `"Hello, world!"` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct (a greeting is the one sensible reading). |
| 41 | `add(1)` | accepted → **accepted** | `2` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `add(1)` → `2` ("incremented by one"); the first run gave `1`. A one-argument `add` has no right answer: no spec, no contract. |
| 42 | `add("1", "2")` | accepted → **accepted** | `"3"` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `"3"`: numeric addition returned as a string. Earlier runs concatenated (`"12"`). Both defensible, neither stable. |
| 43 | `[1, 2, 3].map(double)` | accepted → **accepted** | `[2, 4, 6]` | Compile + Invariants (no spec, so nothing else could) | ✅ `[2, 4, 6]`. Before: `[0, 2, 6]` because the spec had three parameters (value, index, array). Fixed. |
| 44 | `compose(x => x + 1, x => x * 2)` | refused → **accepted** | `[Function (anonymous)]` | Compile + Invariants (no spec, so nothing else could) | ✅ Function arguments now work (`compose` returns a function). Before: "function arguments are not supported". The gates cannot replay function arguments, and the Invariants gate says so. |
| 45 | `median([1, 2, oops])` | refused → **refused** | `oops is not defined` | the runtime, before generation | ✅ `oops is not defined` ReferenceError, no generation. |
| 46 | `median([1, 2` | refused → **refused** | `unexpected end of input: a `[` is never closed (missing `]`)` | the runtime, before generation | ✅ Now: "unexpected end of input: a `[` is never closed (missing `]`)". Before it mentioned a `)` we had added. |
| 47 | `größe(3)` | refused → **refused** | `größe is not defined. `größe` cannot be generated: function names here` | the runtime, before generation | ✅ Explained: function names here are ASCII only (a constraint of ours, not JavaScript's). |
| 48 | `constructor(1)` | refused → **refused** | `constructor is not defined. `constructor` is a name every JavaScript o` | the runtime, before generation | ✅ Explained. |
| 49 | `toString()` | refused → **refused** | `toString is not defined. `toString` is a name every JavaScript object ` | the runtime, before generation | ✅ Explained. |
| 50 | `eval("1")` | refused → **refused** | `eval is not defined. `eval` turns strings into code, which generated c` | the runtime, before generation | ✅ Explained. |
| 51 | `collatzSteps(27)` | accepted → **accepted** | `111` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct (111 steps). |
| 52 | `findNextPrime(1000000000000000)` | accepted → **accepted** | `1000000000000037` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct (the next prime after 10^15 is 1000000000000037). |
| 53 | `x = double(21)` | accepted → **accepted** | `42` | Compile + Invariants (no spec, so nothing else could) | ✅ `42`; the variable `x` is live state for the next lines. |

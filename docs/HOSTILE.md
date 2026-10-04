# Hostile calls

Typed with no spec, live, into a fresh image each time, the way strangers will: ambiguous names, state and randomness,
async-looking names, nested objects, functions that tempt an in-place mutation, Unicode, numbers near overflow, I/O names,
odd arguments, typos, reserved names. Measured 2026-10-04 with `gpt-6-luna`, effort `low`, Codex CLI 0.159.2,
through the real app in headless Chrome (`node scripts/hostile.mjs`; raw results are not committed, the script reproduces
them). Each call ran **twice**: before and after the fixes below.

Key: ✅ a reasonable person would call the outcome correct (or the refusal right). ⚠️ defensible or ambiguous given no
contract, or an explanation that could be sharper. ❌ a reasonable person would call the result wrong **and the gates
passed it**: with no spec the only gates are Compile and Invariants, so nothing could have caught it. The remedy for those
is a pinned test or a spec (see the README).

## What this session changed

1. **Faked impurity (the worst finding).** 20 of the 20 impure/ambiguous calls were committed with a green tick
   as stubs: `shuffle` returned its input, `randomInt(1, 10)` returned `1`, `now()` returned `undefined`, `uuid()` all
   zeros, `getWeather("Paris")` echoed `"Paris"`, `readFile` echoed its argument, `clean`/`process`/`handle` were identity
   functions. The model's own notes confessed it ("randomness is prohibited, so this preserves element order"); nothing in
   the UI said so. **Fix:** the prompt now lets the model *decline* instead of faking (`CANNOT_BE_PURE`, `NEEDS_SPEC`).
   A decline is final: no gates run, no revision, nothing committed, and the REPL says why and what to do. After the fix:
   0 of those 20 are still committed as stubs.
2. **`[1, 2, 3].map(double)` returned `[0, 2, 6]`:** the function was grown from `map`'s three callback arguments (value,
   index, array). Callback-shaped calls now use the value only: `[2, 4, 6]`.
3. **Function arguments** (`compose(x => x + 1, x => x * 2)`) used to be refused. They work now; the gates cannot replay a
   function argument and the Invariants gate says exactly that.
4. **Messages:** the `SyntaxError` mentioned a bracket the harness added; the Unicode-name refusal claimed JavaScript
   forbids it (it is our constraint); `process`/`eval`/`constructor`/`toString` refusals now say why and suggest a name.
5. **Spec-less accepts no longer read as endorsements:** the line under the result says it was only compiled and checked
   for purity, and shows the model's own note.

Scorecard after the fixes: 36 ✅, 15 ⚠️, 3 ❌ of 54.

## Still wrong, and why (the honest part)

- **Run-to-run variance.** `isPalindrome("A man, a plan, a canal: Panama")` was `true` in one run and `false` in the next;
  `capitalizeAll` was "Ann" and then "ANN"; `groupBy` changed its output shape. With no contract the model is free to choose,
  and chooses differently. Nothing in the gates can see this. A pinned test freezes the behaviour you meant.
- **Overfitting to the example.** `groupBy` hard-codes the keys `k` and `v`; `deepMerge` hard-codes `a`; both are correct for
  the example call. The type the model sees is inferred from one call, so it is a literal object type. The model's notes
  admit it. A dataset schema (typed from many rows) is the structural remedy.
- **Unicode.** `reverseString` splits an emoji, `titleCase` only capitalises ASCII, `countCharacters` counts UTF-16 units.
  All three are what the model *said* it did. All three pass.
- **Numbers.** `factorial(25)` and `fibonacci(100)` return doubles. Correct to the precision of a number, wrong if you
  wanted every digit.
- **The decline reason is sometimes imprecise.** I/O names (`readFile`, `getCookie`, `fetchUser`, `printReport`) are often
  declined as "I can't tell what this should do" rather than "this needs files/network". Both are honest; the first is less
  helpful.
- **One possible over-decline.** `truncate("héllo wörld", 7)` was declined ("with or without an ellipsis?"). A reasonable
  question; also the only sensible-looking name that got declined (1 of 25).

## All 54 calls

| # | call | before → after | result now | decided by | verdict |
|---|---|---|---|---|---|
| 0 | `process([1, 2, 3])` | refused → **refused** | `process is not defined. `process` is the name of a host global (networ` | the runtime, before generation | ✅ Refused before any generation (`process` is a host name). The message now says why and suggests `processData`. |
| 1 | `clean("  Hello,   World  ")` | accepted → **declined** | `The model couldn't tell what `clean` should do: What should clean do t` | the model (no gate ran) | ✅ Declined (needs a spec). Before: an identity function behind a green tick. |
| 2 | `clean(x)` | accepted → **declined** | `The model couldn't tell what `clean` should do: What should be cleaned` | the model (no gate ran) | ✅ Declined. (Before it wrote a null-filter, which was a guess; the name says nothing.) |
| 3 | `handle({ type: "click", x: 3 })` | accepted → **declined** | `The model couldn't tell what `handle` should do: What should handle do` | the model (no gate ran) | ✅ Declined. Before: copied the two example keys. |
| 4 | `transform({ a: 1, b: 2 })` | accepted → **declined** | `The model couldn't tell what `transform` should do: What transformatio` | the model (no gate ran) | ✅ Declined. Before: copied the two example keys. |
| 5 | `data([1, 2])` | accepted → **declined** | `The model couldn't tell what `data` should do: What should this functi` | the model (no gate ran) | ✅ Declined. Before: `slice()`. |
| 6 | `counter()` | accepted → **declined** | `The model couldn't tell what `counter` should do: What should counter ` | the model (no gate ran) | ✅ Declined: it needs state between calls. Before: `return 0`. |
| 7 | `nextId()` | accepted → **declined** | `The model couldn't tell what `nextId` should do: What inputs should ne` | the model (no gate ran) | ✅ Declined. Before: `return 1`. |
| 8 | `randomInt(1, 10)` | accepted → **declined** | `The model declined to write `randomInt`: Generating a random integer r` | the model (no gate ran) | ✅ Declined: needs randomness. Before: returned the minimum. |
| 9 | `shuffle([1, 2, 3, 4, 5])` | accepted → **declined** | `The model declined to write `shuffle`: shuffling requires randomness, ` | the model (no gate ran) | ✅ Declined: needs randomness. Before: returned the input unchanged. |
| 10 | `now()` | accepted → **declined** | `The model declined to write `now`: it needs the current time. Generate` | the model (no gate ran) | ✅ Declined: needs the clock. Before: `undefined`. |
| 11 | `uuid()` | accepted → **declined** | `The model declined to write `uuid`: UUID generation requires randomnes` | the model (no gate ran) | ✅ Declined. Before: a constant all-zero UUID. |
| 12 | `fetchUser(42)` | accepted → **declined** | `The model couldn't tell what `fetchUser` should do: What user data sho` | the model (no gate ran) | ⚠️ Declined, but as "needs a spec" rather than "needs the network". Honest either way; the reason text could be sharper. |
| 13 | `sleep(100)` | accepted → **declined** | `The model declined to write `sleep`: sleeping requires waiting for the` | the model (no gate ran) | ✅ Declined: sleeping needs real time. Before: `undefined`. |
| 14 | `getWeather("Paris")` | accepted → **declined** | `The model couldn't tell what `getWeather` should do: What weather data` | the model (no gate ran) | ⚠️ Declined as "needs a spec" (really: needs the network). |
| 15 | `loadConfig("app.json")` | accepted → **declined** | `The model couldn't tell what `loadConfig` should do: What configuratio` | the model (no gate ran) | ⚠️ Declined as "needs a spec" (really: needs files). |
| 16 | `flatten([[1, [2]], [3, [4, [5]]]])` | accepted → **accepted** | `[1, 2, 3, 4, 5]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct. |
| 17 | `groupBy([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], "k")` | accepted → **accepted** | `{ a: [1, 3], b: [2] }` | Compile + Invariants (no spec, so nothing else could) | ⚠️ Accepted; **the result shape changed between two live runs** (items grouped vs. only `v` values) and the body hard-codes the keys `k` and `v` from the example. Correct for the example call, wrong in general; the model's note says so. |
| 18 | `deepMerge({ a: { b: 1 }, c: 1 }, { a: { d: 2 }, c: 2 })` | accepted → **accepted** | `{ a: { b: 1, d: 2 }, c: 2 }` | Compile + Invariants (no spec, so nothing else could) | ⚠️ Accepted; hard-codes keys `a` and `c` ("at its known level", per its own note). Correct for the example, not a deep merge. |
| 19 | `transpose([[1, 2, 3], [4, 5, 6]])` | accepted → **accepted** | `[[1, 4], [2, 5], [3, 6]]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct (shortest-row rule for ragged input is a choice the note states). |
| 20 | `sumBy([{ price: 1.5, qty: 2 }, { price: 3, qty: 1 }], "price")` | accepted → **accepted** | `4.5` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct for the example; sums a numeric column by name. |
| 21 | `sortDescending([3, 1, 2])` | accepted → **accepted** | `[3, 2, 1]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct; copies before sorting (the frozen-argument replay would have rejected an in-place sort). |
| 22 | `removeDuplicates([1, 1, 2, 3, 3])` | accepted → **accepted** | `[1, 2, 3]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct. |
| 23 | `reverseInPlace([1, 2, 3])` | accepted → **accepted** | `[3, 2, 1]` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct; copies despite the name "InPlace". |
| 24 | `capitalizeAll(["ann", "bob"])` | accepted → **accepted** | `["ANN", "BOB"]` | Compile + Invariants (no spec, so nothing else could) | ⚠️ Accepted as `toUpperCase()` ("ANN"). "capitalizeAll" is ambiguous; a person would expect "Ann". Before: "Ann". **Run-to-run variance** on a spec-less call. |
| 25 | `reverseString("héllo wörld 👍🏽")` | accepted → **accepted** | `"🏽👍 dlröw olléh"` | Compile + Invariants (no spec, so nothing else could) | ❌ Reverses by code point, so the emoji "👍🏽" (thumbs-up + skin tone) is split and reordered. Wrong for text; the note admits "by Unicode code points". Nothing without a test can catch this. |
| 26 | `titleCase("élan vital of the ünderground")` | accepted → **accepted** | `"éLan Vital Of The üNderground"` | Compile + Invariants (no spec, so nothing else could) | ❌ "éLan Vital Of The üNderground": only ASCII letters are capitalised. The note says so. Wrong for any non-English text. |
| 27 | `countCharacters("👨‍👩‍👧 café")` | accepted → **accepted** | `13` | Compile + Invariants (no spec, so nothing else could) | ⚠️ 13 = UTF-16 code units for a string a person would count as 6 characters. Defensible reading of "count characters" in JS; the note says "UTF-16". |
| 28 | `isPalindrome("A man, a plan, a canal: Panama")` | accepted → **accepted** | `false` | Compile + Invariants (no spec, so nothing else could) | ❌ **`false` for the classic palindrome** (this run compared the raw string; an earlier run ignored punctuation and gave `true`). Run-to-run variance on a spec-less call. |
| 29 | `truncate("héllo wörld", 7)` | accepted → **declined** | `The model couldn't tell what `truncate` should do: Should truncate sho` | the model (no gate ran) | ⚠️ Declined: "shorten to a length, with or without an ellipsis?" A reasonable question, arguably over-cautious. The only sensible name declined. |
| 30 | `factorial(25)` | accepted → **accepted** | `1.5511210043330986e+25` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `1.5511210043330986e+25`: a double, not 15511210043330985984000000. Correct given no contract; the remedy is a pinned test or a spec saying "exact". |
| 31 | `fibonacci(100)` | accepted → **accepted** | `354224848179262000000` | Compile + Invariants (no spec, so nothing else could) | ⚠️ A double (`354224848179262000000`), exact only to 15-16 digits. Same as above. (Before: it threw above n = 78, which was honest but less useful.) |
| 32 | `power(2, 1024)` | accepted → **accepted** | `Infinity` | Compile + Invariants (no spec, so nothing else could) | ✅ `Infinity` is what `2 ** 1024` is in JS. |
| 33 | `isPrime(9007199254740993)` | accepted → **accepted** | `false` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `false`, but the literal 9007199254740993 is already rounded to 9007199254740992 by JavaScript before the call. Not the function's fault. |
| 34 | `gcd(0, 0)` | accepted → **accepted** | `0` | Compile + Invariants (no spec, so nothing else could) | ✅ `0`, a stated convention in the note. |
| 35 | `readFile("notes.txt")` | accepted → **declined** | `The model couldn't tell what `readFile` should do: What file source an` | the model (no gate ran) | ⚠️ Declined as "needs a spec" (really: needs files). |
| 36 | `httpGet("https://example.com")` | accepted → **declined** | `The model declined to write `httpGet`: An HTTP GET requires network ac` | the model (no gate ran) | ✅ Declined: needs the network. Before: echoed the URL. |
| 37 | `saveToDisk({ a: 1 })` | accepted → **declined** | `The model declined to write `saveToDisk`: saving to disk requires file` | the model (no gate ran) | ✅ Declined: needs the file system. Before: copied the object. |
| 38 | `printReport([1, 2, 3])` | accepted → **declined** | `The model couldn't tell what `printReport` should do: What should the ` | the model (no gate ran) | ⚠️ Declined as "needs a spec" (really: console/output). |
| 39 | `getCookie("session")` | accepted → **declined** | `The model couldn't tell what `getCookie` should do: Should this return` | the model (no gate ran) | ⚠️ Declined as "needs a spec" (really: cookies are browser state). |
| 40 | `hello()` | accepted → **accepted** | `"Hello, world!"` | Compile + Invariants (no spec, so nothing else could) | ✅ Correct (a greeting is the one sensible reading). |
| 41 | `add(1)` | accepted → **accepted** | `2` | Compile + Invariants (no spec, so nothing else could) | ⚠️ `add(1)` → `2` ("incremented by one"). Before: `1`. A one-argument `add` has no right answer; no spec, no contract. |
| 42 | `add("1", "2")` | accepted → **accepted** | `"12"` | Compile + Invariants (no spec, so nothing else could) | ✅ String concatenation (`"12"`); a defensible reading of strings. |
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

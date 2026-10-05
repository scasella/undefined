# The examples

How the four shipped examples are built, why each first candidate is rejected, and how often that happened in measured
sessions. Mutation kill rates for the same examples are in [EVIDENCE.md](EVIDENCE.md#measured-kill-rates-of-the-shipped-checks).
Annotated transcripts of the recorded sessions are in [transcripts/](transcripts/).

## The examples: who held the contract (read this)

`gpt-6-luna` is a strong model, and with a fully specified ticket it passes first time: in my first sampling, **18 of 18**
attempts at tightly specified versions of these examples passed every gate on the first try. So a demo of rejection cannot
claim the model "blundered". Each example is built so that the *reason* for the rejection is plain on screen, and the
rejection card says which kind it is:

- **The spec was silent and your tests decided.** The check carries a marker saying what the doc never said, and the card
  reads "The spec didn't say what the median of nothing is. Your tests did." plus a line saying the candidate's choice was
  defensible. The marker can carry a condition on the *shrunk counterexample*, so a real bug elsewhere in the same check
  is never labelled a spec gap.
- **The spec stated it and the candidate broke it** (compile errors, the time limit, a mutation of the arguments).

The model sees the signature, the doc, the *names* of your checks, and the time budget; never the bodies of the tests or
properties (tests are the contract, not a hint sheet). The "What the model saw" panel under every candidate shows the exact
prompt, and what was withheld.

| example | the one sentence a skeptic needs | what rejects it | measured over 8 full sessions: first candidate rejected → committed within 3 attempts |
|---|---|---|---|
| `median` | A median of nothing has no right answer: throwing, `NaN`, `0` and `undefined` are all defensible and the doc ("Returns the median of a list of numbers.") never says which, so when the tests say `NaN` the contract is speaking, not the model failing. | Properties (fast-check generates `[]` and shrinks to it): `median([]) threw Error…, expected NaN` | 8/8 → 8/8 |
| `slugify` | Whether an apostrophe splits a word, what `&` becomes and how `ß` is spelled are conventions the doc ("Turns a title into a URL slug.") never states; our tests state ours, and each of those rejections is labelled "the spec didn't say". | Tests: `slugify("Don't Stop") returned "don-t-stop", expected "dont-stop"` (or `Straße`/`stra-e`) | 6/8 → 7/8 (2 sessions passed first time; 1 ran out of attempts) |
| `fibonacci` | The doc states the range (n up to 1,000,000) and the prompt states the 1.5 s limit; the model wrote an O(n) loop it never timed (about 4 s at that n), so the fault is the candidate's and nothing was withheld. | Invariants (bounded): `fibonacci(1000000) did not return within 1500 ms` | 6/8 → 7/8 (2 sessions passed first time with fast doubling; 1 ran out of attempts) |
| `topCustomersByRevenue(rows)` | There is no spec and no test, so nothing can reject it: the claims are only that it compiles, is pure and replays on the real rows. The model's own note states its assumptions (here: revenue after discount, refunded orders counted) and the result is yours to judge; pin it to make it a test, or use *Break it* to say refunded orders don't count. | none (spec-less: Compile and Invariants only) | 8/8 committed on the first candidate |

Measured 2026-10-04 with `gpt-6-luna`, effort `low`, Codex CLI 0.159.2, as 8 complete sessions per example through the real
app (`node scripts/sessions.mjs`: real Worker watchdog, the real 3-attempt budget). These are one day's rates for one model,
not a guarantee. They are lower than my earlier single-retry sampling (8/8 for all three), which is why I quote
session-level numbers: the model sometimes passes first time (2 of 8 slugify and fibonacci sessions) and sometimes runs out
of attempts (1 of 8 each). The shipped recordings are real sessions captured by `npm run record`, which keeps a session only
if its first candidate was rejected and prints how many tries that took (median 1, slugify 1, fibonacci 2).

Models also fail in ways nobody tuned: in one live `slugify` run the first candidate came back with a literal `\n` in place
of a newline and the compiler rejected it ("Invalid character"), which is exactly the kind of thing the compile gate is for.

Where the idealised story differs: the `median` rejection is the empty list (shrunk by fast-check), not `median([1, 2])`
returning `1`, because this model gets the textbook cases right; and the fibonacci rejection is a slow-but-correct loop, not
naive recursion, because the model never wrote the recursion.

## Re-measuring

`TUNE_N=8 TUNE_EX=median,slugify,fibonacci npx vitest run -c scripts/vitest.tune.config.ts` re-measures the rejection
rates above against your own Codex login (results in `.tmp/tune-out.json`). `scripts/tune.tune.ts` samples the real model
against the real gates.

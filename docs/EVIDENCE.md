# Evidence and measurements

What the app tells you about a committed function, how the mutation check works, and the kill rates measured on the
shipped examples. The session-level rejection rates of the examples are in [EXAMPLES.md](EXAMPLES.md).

## How much to trust a committed function

Under the *Accepted · saved as rN* verdict, in **What was checked** (and in the Repo tab's artifact card), is one muted line of facts
about what actually ran against the function, for example:

> Compiled. 4 tests passed. 3 rules held for 100 random inputs each. 26 calls re-run to look for side effects. Your
> checks caught 11 of 12 deliberately broken copies.

(In the UI the sentence is written in plain words like this; the precise terms, *properties*, *replayed on frozen
arguments*, *mutants*, are in its tooltip. The rest of this section uses the precise terms.)

It always lists the same five facts and says "no …" when one of them is zero: whether it compiled, the unit tests (and
pinned tests), the properties with their fast-check run counts, how many calls the Invariants gate replayed on frozen
arguments, and the mutation check. **It deliberately has no score, grade or percentage.** Counts of checks do not add up
to "how correct", and a single number would claim more than the gates know. The evidence is metadata attached to the
artifact after the fact. It is not part of any hash, so recording it never invalidates anything.

## Mutation testing

**Mutation testing** asks whether the checks actually check anything. Once the program has been idle for a few
seconds after a commit (never sooner than 10 s after you pressed Enter, and any new call or edit cancels it), up to 12
*broken copies* of the committed function are made. Each one changes one small thing in the compiled code, such as `<`
to `<=`, `+` to `-`, a constant `0` to `1`, or a condition negated. Every copy is run against the same tests,
properties and pins, with at most 1 s per call and a 6 s time box for the whole check. Each copy lands in one of four
buckets, which are reported separately and never merged:

- **killed**: a test or property failed.
- **stopped by the time limit**: a call did not return within the bound, as with an infinite loop. This is a kill,
  reported on its own.
- **survived**: every check accepted the broken copy. It *may be an equivalent mutant* (a change that makes no
  observable difference), so a survivor is a lead, not a verdict. "See what slipped through" lists each one as
  `line N of the compiled code: original → mutated`. N is a line of the compiled JavaScript body, not of the TypeScript the model
  wrote.
- **did not compile**: never run and never counted as a kill.

If the check cannot run at all (a broken copy fails to load, or the gate runner fails), it says *Mutation check could
not run: …* and counts nothing as killed. A function with no tests, properties or pins reads *No tests yet: nothing
could kill a mutant. Add one to make the gate stricter.* **Re-run the broken-copy check** in the Repo tab runs it again on
demand.

## More checks you can add

When the function's name, types or doc suggest a property its spec does not state yet
(sorted output, same length, idempotence, round trips…), grey rows offer it with a one-line reason and an **Add**
button. Adding one re-checks the *committed* function against the strengthened spec, using its stored body and the new
seed. If it passes, the function is **re-certified in place**: the hashes are restamped, it stays live, nothing is
regenerated, and the log says *re-certified at rN: Added check "…"*. If it fails, the spec change stands, the function
goes stale (it regenerates on the next call), and **Checks** shows the smallest failing input. "Same input twice gives the
same result" and "The arguments are not modified" are listed as *already checked*: the Invariants gate runs both on
every candidate, so they are never offered. The shipped median, slugify and fibonacci specs already state everything
the suggester knows, so they get no suggestions. That is expected.

## Decisions in the evidence

A ruling made with **Decide** ([FEATURES.md](FEATURES.md#decide-spec-gaps-become-questions)) is a generated unit test
(or, for a rule, a property) in the spec. It is counted with the other tests, and the line says how many came from you:
*Compiled. 5 tests passed, including 1 decision. 3 rules held for 100 random inputs each. …* (one test that is your
decision reads *1 test passed, your decision.*; rule decisions are counted the same way after the rules). With no
decisions the line is unchanged. A ruling that disagrees with the check it answers replaces that check where the spec
was silent; the Tests or Properties gate notes *N checks replaced by your decision*, so the count never hides that a
check was switched off there. Re-certification after a decision is logged like an added check (*re-certified at rN:
Decided: median([]) → NaN*), and the broken-copy check re-runs against the new tests when idle. Eject carries the count
into the README and lists every decision in `provenance.json`.
How often a rejection is a spec gap and how often a ruling reaches a commit was measured live:
see [DECIDE-MEASUREMENTS.md](DECIDE-MEASUREMENTS.md).

## Measured kill rates of the shipped checks

The engine's own path, run on each known-good body in `src/examples`
(seed derived from the spec hashes, default 6 s box; printed by `src/core/engine.evidence.test.ts`, which runs in
Node, where there is no watchdog):

| example | body | result |
|---|---|---|
| median | goodBodies[0] | killed 11 of 12 (1 survived: compiled line 1, `0 → -1`) |
| median | goodBodies[1] | killed 11 of 12 (1 survived: compiled line 1, `0 → -1`) |
| slugify | goodBodies[0] | killed 1 of 1 (the body has a single mutation site) |
| slugify | goodBodies[1] | killed 12 of 12 |
| fibonacci | goodBodies[0] | killed 12 of 12 |
| orders | (spec-less) | no tests yet: nothing could kill a mutant |

In the browser, replaying the shipped recordings from the production build with the real watchdog (`node
scripts/mutation-check.mjs`, measured after the final re-record), the app itself reads: median 12 of 12, slugify 1 of 1,
and fibonacci 11 of 12 (two of them stopped by the time limit; one survived). These belong to the recorded bodies and change
when the recordings are re-made.

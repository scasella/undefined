# A 60-second demo script

A walk-through for presenting Undefined live or in replay. Timings are approximate; replayed sessions follow the
recordings in `apps/site/public/recordings/`.

1. **0:00** Open the page. One line of copy: *"`median` doesn't exist yet. Press Enter and a model will write it — your
   checks decide if it stays."* The console holds `median([3, 1, 4, 2])`.
   Press **Enter**.
2. **0:03** The console prints `ReferenceError: median is not defined`, then *Writing `median`…* with a timer (the live
   Codex progress lines are under **Details**). Point at **Attempts**: 1 of 3.
3. **0:10** Candidate #1 types into **Draft**. **Checks** run top to bottom: **Compile ✓**, **Tests ✓**, then
   **Properties ✗**. The rejection card (*✕ Rejected by Properties — spec was silent*) names the gate and the smallest failing input: `median([]) threw Error: …,
   expected NaN`. *"The model didn't lose an argument with a person; a property check it never saw said no."*
4. **0:18** Candidate #2 appears, passes all four gates, and the verdict reads *Accepted · saved as r2 · returned `2.5`*.
   The console prints `2.5` labelled **Generated · revision 2**. Candidate #1 is still in **Attempts**, in red.
5. **0:25** Press Enter on `median([9, 7, 1])`: `7`, instantly, labelled **cached artifact**, with the one-time line *"You didn't
   write this. The model wrote it. Your compiler and tests decided whether to keep it."*
6. **0:35** Click the **fibonacci** example, press Enter. Watch **Invariants** reject the first candidate for blowing the
   1.5 s bound, with the call and elapsed time on screen; the retry commits a fast-doubling version.
7. **0:50** Open **Repo → median**, press **Break it**. The artifact turns *invalid: spec changed*. Call it again and it
   regenerates.
8. **0:52** Click **orders** and press Enter (it replays from its recording; live mode generates it afresh). The model sees only `type Row` and three sample rows (the
   **Session → Data…** drawer shows exactly which). The result renders as a table; press **Pin result as test**. From now on every
   regeneration of `topCustomersByRevenue` has to reproduce that result, or Tests rejects it.
9. **0:54** Back on the committed median, wait a few seconds: under the Accepted verdict the confidence line fills in
   with the mutation check (the recorded median reads *Your checks caught 12 of 12 deliberately broken copies*). When something survives,
   **See what slipped through** shows the broken copy your checks let through. There is no score, only what ran.
10. **0:55** Open **Revisions** and click **Restore** on r2 (it appears on hover). Then **Session → Export image** to
    download your whole program.
11. **0:58** **Session → Share…**: download `undefined-session.json`, put it in a gist, paste the gist's Raw URL
    and copy the `?recording=` link. Whoever opens it is asked first, then presses Enter to watch your session replay with
    the gates running live in their browser.

To open on a different example, start from `?opener=fibonacci`, `?opener=slugify` or `?opener=orders` (see
[Try a different opener](FEATURES.md#try-a-different-opener-opener)).

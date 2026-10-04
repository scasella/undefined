/**
 * How much to trust a committed function: the confidence line (facts, never a score), the lazy mutation check and
 * its survivors, the checks a user can still add, and the re-certification log. Everything here appears only after
 * a commit, and nothing here animates.
 */
import { useState } from 'preact/hooks';
import type { Artifact, Engine, EngineState, FunctionRecord, GenerationView } from '../../types';
import { describeEvidence, mutationAdvice, mutationFailed, mutationProgress, survivorLine } from '../../shared/evidence';
import { alwaysChecked, suggestProperties } from '../../suggest/suggest';
import { addedOutcome } from '../evidence';
import { addedChecks } from '../uiState';

/** Rows visible before "more". */
const VISIBLE_SUGGESTIONS = 4;

function Survivors({ a, open }: { a: Artifact; open?: boolean }) {
  const m = a.evidence?.mutation;
  if (!m || m.survivors.length === 0) return null;
  const more = m.survived - m.survivors.length;
  return (
    <details class="survivors" open={open}>
      <summary>see survivors ({m.survived})</summary>
      <ul>
        {m.survivors.map((s) => (
          <li key={s.id} class="mono">
            {survivorLine(s)}
          </li>
        ))}
      </ul>
      {more > 0 && <p class="muted small">and {more} more not listed</p>}
      <p class="muted small">
        A survivor is a broken copy every check accepted. Lines are lines of the compiled JavaScript body, not of the
        TypeScript above.
      </p>
    </details>
  );
}

/** The confidence line and the mutation status under the "Accepted — committed as rN" banner. */
export function Confidence({ a, fn, mutation }: { a: Artifact; fn: string; mutation: EngineState['mutation'] }) {
  if (!a.evidence) return null;
  const progress = mutationProgress(mutation, fn);
  const advice = mutationAdvice(a.evidence.mutation);
  const failed = mutationFailed(a.evidence.mutation);
  return (
    <div class="evidence" aria-label="What ran against this function">
      <p class="confidence">{describeEvidence(a.evidence)}</p>
      {progress && !a.evidence.mutation && <p class="mut-progress mono small">{progress}</p>}
      {advice && <p class="mut-advice small">{advice}</p>}
      {failed && <p class="mut-failed small">The mutation check itself failed; no mutant was counted as killed.</p>}
      <Survivors a={a} />
    </div>
  );
}

function AddedRow({ rec, gen, check }: { rec: FunctionRecord | undefined; gen: GenerationView | null; check: { id: string; title: string; why: string } }) {
  const outcome = addedOutcome(rec, gen, check);
  return (
    <li class={`check-row check-${outcome}`}>
      <span class="check-tag mono">{outcome === 'fails' ? 'fails' : outcome === 'pending' ? 'adding' : 'added'}</span>
      <span class="check-text">
        <span class="check-title">{check.title}</span>
        <span class="check-why">
          {outcome === 'recertified'
            ? 'added ✓ — function re-certified'
            : outcome === 'fails'
              ? 'the committed function fails it'
              : outcome === 'added'
                ? 'added ✓'
                : 're-checking the committed function…'}
        </span>
      </span>
    </li>
  );
}

/**
 * "More checks you can add": grey rows from the property-suggestion engine (only when there are some), the checks
 * added this session with how they went, and the two the Invariants gate always runs (so nobody wonders why they
 * are not offered).
 */
export function MoreChecks({ state, engine, fn }: { state: EngineState; engine: Engine; fn: string }) {
  const [more, setMore] = useState(false);
  const rec = state.program.functions[fn];
  const added = addedChecks.value.filter((c) => c.fn === fn);
  const suggestions = rec ? suggestProperties(rec.spec, state.program).filter((s) => !added.some((c) => c.id === s.id)) : [];
  if (suggestions.length === 0 && added.length === 0) return null;
  const visible = more ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTIONS);
  const hidden = suggestions.length - visible.length;
  return (
    <section class="more-checks" aria-labelledby={`more-checks-${fn}`}>
      <h3 id={`more-checks-${fn}`} class="more-checks-title">
        More checks you can add
      </h3>
      <ul class="check-rows">
        {added.map((c) => (
          <AddedRow key={c.id} rec={rec} gen={state.generation} check={c} />
        ))}
        {visible.map((s) => (
          <li key={s.id} class="check-row check-available">
            <span class="check-tag mono">available</span>
            <span class="check-text">
              <span class="check-title">{s.title}</span>
              <span class="check-why">{s.why}</span>
            </span>
            <button
              type="button"
              class="btn btn-xs"
              disabled={state.busy}
              title="Add this property to the spec and re-check the committed function against it"
              onClick={() => {
                addedChecks.value = [...addedChecks.value, { fn, id: s.id, title: s.title, why: s.why }];
                void engine.addSuggestedProperty(fn, s.id);
              }}
            >
              Add
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li class="check-more">
            <button type="button" class="btn btn-ghost btn-xs" onClick={() => setMore(true)}>
              {hidden} more
            </button>
          </li>
        )}
        {more && suggestions.length > VISIBLE_SUGGESTIONS && (
          <li class="check-more">
            <button type="button" class="btn btn-ghost btn-xs" onClick={() => setMore(false)}>
              fewer
            </button>
          </li>
        )}
        {alwaysChecked.map((c) => (
          <li key={c.title} class="check-row check-checked">
            <span class="check-tag mono">already checked</span>
            <span class="check-text">
              <span class="check-title">{c.title}</span>
              <span class="check-why">by the {c.by} gate, on every candidate</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Repo tab: the evidence, the mutation report with survivors, a re-run button and the re-certification log. */
export function ArtifactEvidence({
  a,
  fn,
  stale,
  state,
  engine,
}: {
  a: Artifact;
  fn: string;
  stale: boolean;
  state: EngineState;
  engine: Engine;
}) {
  const progress = mutationProgress(state.mutation, fn);
  const running = state.mutation?.fn === fn && state.mutation.phase === 'running';
  const advice = mutationAdvice(a.evidence?.mutation);
  return (
    <section class="artifact-evidence" aria-label="Evidence">
      <h4>What ran against it</h4>
      {a.evidence ? (
        <p class="confidence">{describeEvidence(a.evidence)}</p>
      ) : (
        <p class="muted small">No evidence was recorded for this artifact (it was committed before evidence was kept).</p>
      )}
      {progress && <p class="mut-progress mono small">{progress}</p>}
      {advice && <p class="mut-advice small">{advice}</p>}
      {mutationFailed(a.evidence?.mutation) && <p class="mut-failed small">The mutation check itself failed; no mutant was counted as killed.</p>}
      <Survivors a={a} open />
      <div class="evidence-actions">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          disabled={stale || state.busy || running}
          title={stale ? 'The artifact is stale: it regrows on the next call' : 'Run the broken copies against the current checks again'}
          onClick={() => void engine.runMutation(fn)}
        >
          Re-run mutation check
        </button>
      </div>
      {a.recertified && a.recertified.length > 0 && (
        <ul class="recert-log small">
          {a.recertified.map((r) => (
            <li key={`${r.revision}:${r.reason}`}>
              re-certified at r{r.revision}: {r.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * How much to trust a committed function: the confidence line (facts, never a score), the lazy mutation check and
 * its survivors, the checks a user can still add, and the re-certification log. Everything here appears only after
 * a commit, and nothing here animates.
 */
import { useState } from 'preact/hooks';
import type { Artifact, Engine, EngineState, FunctionRecord, GenerationView } from '@scasella/undefined-engine/types';
import { describeEvidence, survivorLine } from '@scasella/undefined-engine/shared/evidence';
import { alwaysChecked, suggestProperties } from '@scasella/undefined-engine/suggest/suggest';
import { addedOutcome, plainEvidence, plainMutationProgress, plainSurvivor } from '../evidence';
import { addedChecks } from '../uiState';

/** Rows visible before "more". */
const VISIBLE_SUGGESTIONS = 4;

function Survivors({ a, open }: { a: Artifact; open?: boolean }) {
  const m = a.evidence?.mutation;
  if (!m || m.survivors.length === 0) return null;
  const more = m.survived - m.survivors.length;
  return (
    <details class="survivors" open={open}>
      <summary title="surviving mutants">See what slipped through ({m.survived})</summary>
      <ul>
        {m.survivors.map((s) => (
          <li key={s.id} title={survivorLine(s)}>
            {plainSurvivor(s)}
          </li>
        ))}
      </ul>
      {more > 0 && <p class="muted small">and {more} more not listed</p>}
      <p class="muted small">
        Each is a deliberately broken copy that every check accepted. It may behave exactly like the original. Line
        numbers are of the compiled JavaScript, not the TypeScript above.
      </p>
    </details>
  );
}

/** The confidence line and the broken-copy check's status under the accepted headline. */
export function Confidence({ a, fn, mutation }: { a: Artifact; fn: string; mutation: EngineState['mutation'] }) {
  if (!a.evidence) return null;
  const progress = plainMutationProgress(mutation, fn);
  const done = !!a.evidence.mutation;
  // until the check has run, one muted line says when it will (instead of "has not run yet" plus a "Next:" line)
  const text = done ? plainEvidence(a.evidence, Object.keys(a.deps ?? {}).sort()) : plainEvidence(a.evidence, Object.keys(a.deps ?? {}).sort()).replace(/\s*The broken-copy check has not run yet\.\s*$/, '');
  const pending = mutation?.fn === fn && mutation.phase === 'running' ? progress : 'Broken-copy check runs when idle…';
  return (
    <div class="evidence" aria-label="What was checked" data-mutation={done ? 'done' : 'pending'}>
      <p class="evidence-label">What was checked</p>
      <p class="confidence" title={describeEvidence(a.evidence, Object.keys(a.deps ?? {}).sort())}>
        {text}
      </p>
      {!done && <p class="mut-progress">{pending}</p>}
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
            ? 'added ✓ — the committed function passes it'
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
        More checks you could add
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
              title="Add this check (a property) to the spec and re-check the committed function against it"
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
              <span class="check-why">by the {c.by} gate, on every draft</span>
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
  const progress = plainMutationProgress(state.mutation, fn);
  const running = state.mutation?.fn === fn && state.mutation.phase === 'running';
  return (
    <section class="artifact-evidence" aria-label="Evidence">
      <h4>What was checked</h4>
      {a.evidence ? (
        <p class="confidence" title={describeEvidence(a.evidence, Object.keys(a.deps ?? {}).sort())}>
          {plainEvidence(a.evidence, Object.keys(a.deps ?? {}).sort())}
        </p>
      ) : (
        <p class="muted small">Nothing was recorded for this function (it was committed before this was kept).</p>
      )}
      {progress && <p class="mut-progress">{progress}</p>}
      <Survivors a={a} open />
      <div class="evidence-actions">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          disabled={stale || state.busy || running}
          title={stale ? 'The function is out of date: the next call re-checks it or writes it again first' : 'Mutation testing: run deliberately broken copies against the current checks again'}
          onClick={() => void engine.runMutation(fn)}
        >
          Re-run the broken-copy check
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

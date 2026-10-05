import { useEffect, useRef, useState } from 'preact/hooks';
import type { Artifact, DatasetRef, Engine, EngineState, ExampleInfo, FunctionRecord, FunctionSpec, GenerationView } from '../../types';
import { datasetLine, expectedSummary, formatBytes, pinDatasets } from '../data';
import { isValidFnName, paramsText, parseParams, sentenceCase, shortHash } from '../format';
import { draftOf, functionStatus, functionStatusText, newSpecPrefill, signatureOf, specPatch } from '../select';
import { focusFn } from '../uiState';
import { CodeView } from './CodeView';
import { GeneratedBadge, StatusIcon } from './common';
import { ModelSaw } from './ModelSaw';
import { ArtifactEvidence } from './Evidence';
import { EjectButton } from './Eject';
import { afterRemoval, DecideBlock, focusLater } from './Decide';
import { decisionNote, decisionsOf, decisionSummary, waiverText } from '../../decide/decisions';
import { decisionTestName } from '../decide';

const TEST_API = `// Globals in scope: the function under test by its own name, plus
test(name: string, body: () => void, meta?: { silentOn?: string; reasonable?: string }): void
eq(actual: unknown, expected: unknown, message?: string): void   // deep, Object.is, bigint-safe
throws(fn: () => unknown, match?: RegExp | string): void
property(name, [arb1, arb2, …], (a1, a2, …) => boolean | void,
  opts?: { numRuns?: number; silentOn?: string; reasonable?: string; when?: (…args) => boolean }): void
matchesReference(name, [arbs…], reference: (…args) => R, opts?: same as property): void
fc   // fast-check, e.g. fc.integer(), fc.array(fc.string(), { minLength: 1 })

// silentOn: "The spec didn't say ___." Mark a check that encodes a convention your doc leaves open, so a
// rejection says who decided. For properties, when() is tested on the shrunk counterexample, so a real bug
// elsewhere is never mislabelled.

// example
test("even count", () => eq(median([4, 1, 3, 2]), 2.5));
property("within bounds", [fc.array(fc.integer(), { minLength: 1 })],
  (xs) => median(xs) >= Math.min(...xs) && median(xs) <= Math.max(...xs));`;

/**
 * Run `fn` after the pending re-render (card expansion, scheduled as a microtask) has been committed.
 * A timer rather than requestAnimationFrame so it also runs in a background tab. Deliberately not
 * cancelled from an effect cleanup: consuming the request (focusFn = null) re-runs that effect at once.
 */
function afterLayout(fn: () => void): void {
  setTimeout(fn, 16);
}

function TestApiSheet() {
  return (
    <details class="cheatsheet">
      <summary>Test API cheat sheet: test / eq / throws / property / matchesReference / fc</summary>
      <pre class="code small">
        <code>{TEST_API}</code>
      </pre>
    </details>
  );
}

function SpecEditor({ rec, engine, busy }: { rec: FunctionRecord; engine: Engine; busy: boolean }) {
  const spec = rec.spec;
  const [draft, setDraft] = useState(() => draftOf(spec));
  const [budget, setBudget] = useState(String(spec.budgetMs));
  const [attempts, setAttempts] = useState(String(spec.maxAttempts));
  const docRef = useRef<HTMLTextAreaElement>(null);


  const budgetN = Number(budget);
  const attemptsN = Number(attempts);
  const numbersOk = Number.isInteger(budgetN) && budgetN >= 1 && Number.isInteger(attemptsN) && attemptsN >= 1 && attemptsN <= 10;
  const patch = numbersOk ? specPatch(spec, { ...draft, budgetMs: budgetN, maxAttempts: attemptsN }) : {};
  const dirty = Object.keys(patch).length > 0;
  const id = `spec-${spec.name}`;

  return (
    <form
      class="spec-editor"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (dirty && numbersOk) void engine.editSpec(spec.name, patch);
      }}
    >
      <label for={`${id}-doc`}>doc — what it must do; the model reads this</label>
      <textarea
        id={`${id}-doc`}
        rows={3}
        value={draft.doc}
        onInput={(e) => setDraft({ ...draft, doc: e.currentTarget.value })}
      />
      <label for={`${id}-tests`}>tests — worked examples; the model sees only their names</label>
      <textarea
        id={`${id}-tests`}
        class="mono"
        rows={6}
        spellcheck={false}
        value={draft.tests}
        placeholder={'test("…", () => eq(fn(…), …));'}
        onInput={(e) => setDraft({ ...draft, tests: e.currentTarget.value })}
      />
      <label for={`${id}-props`} title="property-based tests (fast-check), fixed seed">
        properties — rules that must hold for lots of random inputs
      </label>
      <textarea
        id={`${id}-props`}
        class="mono"
        rows={5}
        spellcheck={false}
        value={draft.properties}
        placeholder={'property("…", [fc.integer()], (n) => …);'}
        onInput={(e) => setDraft({ ...draft, properties: e.currentTarget.value })}
      />
      <div class="spec-numbers">
        <label>
          budgetMs <span class="muted small">time limit per call, in ms</span>
          <input type="number" min={1} step={1} value={budget} onInput={(e) => setBudget(e.currentTarget.value)} />
        </label>
        <label>
          maxAttempts <span class="muted small">drafts the model gets</span>
          <input type="number" min={1} max={10} step={1} value={attempts} onInput={(e) => setAttempts(e.currentTarget.value)} />
        </label>
      </div>
      {!numbersOk && <p class="form-error">budgetMs must be a whole number ≥ 1; maxAttempts between 1 and 10.</p>}
      <TestApiSheet />
      <div class="form-actions">
        <button type="submit" class="btn" disabled={!dirty || busy}>
          Save spec{dirty ? ` (${Object.keys(patch).join(', ')})` : ''}
        </button>
        {dirty && (
          <button
            type="button"
            class="btn btn-ghost"
            onClick={() => {
              setDraft(draftOf(spec));
              setBudget(String(spec.budgetMs));
              setAttempts(String(spec.maxAttempts));
            }}
          >
            Discard changes
          </button>
        )}
        {rec.artifact && dirty && (
          <span class="muted small">Saving changes the spec, so the current code no longer counts: it is written again on the next call.</span>
        )}
      </div>
    </form>
  );
}

function ArtifactView({ a, spec, stale, state, engine }: { a: Artifact; spec: FunctionSpec; stale: boolean; state: EngineState; engine: Engine }) {
  const rejected = a.candidates.filter((c) => c.verdict === 'rejected').length;
  return (
    <div class={`artifact${stale ? ' is-stale' : ''}`}>
      <div class="artifact-head">
        <h4>Artifact</h4>
        <GeneratedBadge />
      </div>
      {stale && (
        <p class="stale-note">
          Certified against an older spec, so it no longer counts: the next call regrows it under the current spec.
        </p>
      )}
      <dl class="provenance">
        <dt>spec hash</dt>
        <dd class="mono">{shortHash(a.specHash)}</dd>
        <dt>tests hash</dt>
        <dd class="mono">{shortHash(a.testsHash)}</dd>
        <dt>model</dt>
        <dd>{a.model}</dd>
        <dt>Codex CLI</dt>
        <dd class="mono">{a.codexVersion}</dd>
        <dt>committed</dt>
        <dd>r{a.revision}</dd>
        <dt>returns</dt>
        <dd class="mono">{a.returnType}</dd>
        <dt>candidates</dt>
        <dd>
          {a.candidates.length} ({rejected} rejected)
        </dd>
      </dl>
      <ArtifactEvidence a={a} fn={spec.name} stale={stale} state={state} engine={engine} />
      <p class="eject-row">
        <EjectButton state={state} engine={engine} fn={spec.name} />
      </p>
      <CodeView signature={signatureOf(spec, a.returnType)} body={a.body} />
      <details class="history">
        <summary>Every draft, and which gate turned it away</summary>
        <ol>
          {a.candidates.map((c, i) => (
            <li key={c.id} class={`hist hist-${c.verdict}`}>
              <p>
                <strong>#{c.attempt}</strong> {c.verdict}
                {c.rejectedBy && <> by {c.rejectedBy}</>} <span class="muted small">· {c.source}</span>
              </p>
              {c.headline && <p class="hist-headline">{c.headline}</p>}
              <ul class="mini-gates">
                {c.gates.map((g) => (
                  <li key={g.gate}>
                    <StatusIcon status={g.status} /> {g.gate}
                    {g.summary && <span class="muted"> · {g.summary}</span>}
                  </li>
                ))}
              </ul>
              <details>
                <summary>code</summary>
                <CodeView signature={signatureOf(spec, a.returnType)} body={c.body} />
              </details>
              {c.prompt && <ModelSaw prompt={c.prompt} spec={spec} attempt={c.attempt} />}
              <HistoryDecide a={a} index={i} state={state} engine={engine} />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** Decide on a stored rejected draft whose check said the spec was silent (works after a reload too). */
function HistoryDecide({ a, index, state, engine }: { a: Artifact; index: number; state: EngineState; engine: Engine }) {
  const c = a.candidates[index]!;
  const fn = Object.values(state.program.functions).find((r) => r.artifact === a)?.spec.name;
  if (!fn || c.verdict !== 'rejected' || !c.rejectedBy) return null;
  const g = c.gates.find((x) => x.gate === c.rejectedBy);
  const d = g?.diagnostics[0];
  if (!d || (d.kind !== 'test' && d.kind !== 'property') || !d.silentOn) return null;
  const ref = { fn, revision: a.revision, candidate: index, gate: c.rejectedBy, index: 0 };
  const q = engine.gapQuestion(ref) ?? engine.gapQuestion({ fn, diagnostic: d });
  if (!q) return null;
  return <DecideBlock engine={engine} state={state} gapRef={engine.gapQuestion(ref) ? ref : { fn, diagnostic: d }} q={q} attempt={c.attempt} openKey={`repo:${fn}:${c.id}`} />;
}

/** The results pinned as unit tests on one function: they are part of its checks, but outside both hashes. */
function PinnedTests({ rec, engine, busy }: { rec: FunctionRecord; engine: Engine; busy: boolean }) {
  const pins = rec.spec.pins ?? [];
  if (pins.length === 0) return null;
  return (
    <section class="pinned" aria-labelledby={`pinned-${rec.spec.name}`}>
      <h4 id={`pinned-${rec.spec.name}`}>Pinned tests ({pins.length})</h4>
      <p class="muted small">Results you pinned from real calls. Every regeneration has to reproduce them; pinning changed no hash.</p>
      <ul>
        {pins.map((p) => {
          const data = pinDatasets(p);
          return (
            <li key={p.id}>
              <div class="pin-head">
                <code class="mono">{p.label}</code>
                {data.length > 0 && <span class="muted small">on the stored {data.join(', ')}</span>}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  disabled={busy}
                  aria-label={`Remove the pinned test ${p.label}`}
                  onClick={() => void engine.removePin(rec.spec.name, p.id)}
                >
                  remove
                </button>
              </div>
              <code class="mono pin-expected" title="expected result">
                <span class="muted" aria-label="expected">
                  ={' '}
                </span>
                {expectedSummary(p.expected, 140)}
              </code>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The user's rulings on spec gaps: each a generated test (or rule) in the spec, listed with when and why, the test it
 * added, and Remove (which re-checks the committed function against the spec without it).
 */
function Decisions({ rec, engine, busy }: { rec: FunctionRecord; engine: Engine; busy: boolean }) {
  const ds = decisionsOf(rec.spec);
  const [confirming, setConfirming] = useState<string | null>(null);
  if (ds.length === 0) return null;
  const fn = rec.spec.name;
  return (
    <section class="decisions" aria-labelledby={`decisions-${fn}`}>
      <h4 id={`decisions-${fn}`}>Decisions ({ds.length})</h4>
      <p class="muted small">Where a check said the spec was silent, you ruled. Each ruling is a test in the spec; the model is told to follow it.</p>
      <ul>
        {ds.map((d) => {
          const waiver = waiverText(d);
          return (
            <li key={d.id} class="decision" data-decision={d.id}>
              <p class="decision-head">
                <code class="mono">{decisionSummary(d)}</code>
              </p>
              <p class="decision-note">{decisionNote(d).replace(/^d/, 'D')}</p>
              {waiver && <p class="muted small">It {waiver}.</p>}
              <details class="decision-source">
                <summary>{d.placement === 'properties' ? 'The rule it added' : 'The test it added'}</summary>
                <pre class="code small">
                  <code>{d.test}</code>
                </pre>
              </details>
              {confirming === d.id ? (
                <div class="decision-confirm" role="group" aria-label={`Remove the decision ${decisionSummary(d)}`}>
                  <p class="small">
                    Remove it? The test <code>{decisionTestName(d)}</code> leaves the spec{d.waives ? ' and your original check applies again' : ''}, and{' '}
                    {fn} is re-checked against the spec without it. If it fails, the model writes {fn} again.
                  </p>
                  <div class="form-actions">
                    <button
                      type="button"
                      class="btn btn-xs"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(null);
                        const summary = decisionSummary(d);
                        void engine
                          .removeDecision(fn, d.id)
                          .then(() => afterRemoval(engine, fn, summary, () => document.getElementById(`decisions-${fn}`) ?? document.getElementById(`fn-${fn}`)));
                      }}
                    >
                      Remove and re-check
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs decision-keep"
                      onClick={() => {
                        setConfirming(null);
                        focusLater(() => document.querySelector<HTMLElement>(`[data-decision="${CSS.escape(d.id)}"] .decision-actions button`));
                      }}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <p class="decision-actions">
                  <button type="button" class="btn btn-ghost btn-xs" disabled={busy} aria-label={`Remove the decision ${decisionSummary(d)}`}
                    onClick={() => {
                      setConfirming(d.id);
                      // the button is replaced by the confirmation: keep focus there, on the safe choice
                      focusLater(() => document.querySelector<HTMLElement>(`[data-decision="${CSS.escape(d.id)}"] .decision-keep`));
                    }}
                  >
                    Remove
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Datasets({ datasets, engine, busy }: { datasets: DatasetRef[]; engine: Engine; busy: boolean }) {
  if (datasets.length === 0) return null;
  return (
    <section class="repo-datasets" aria-labelledby="repo-datasets-title">
      <h3 id="repo-datasets-title">Datasets</h3>
      <ul>
        {datasets.map((d) => (
          <li key={d.name} class="dataset-card">
            <p>
              <strong class="mono">{datasetLine(d)}</strong>
              <span class="muted small">
                {' '}
                · {d.source === 'bundled' ? `bundled ${d.filename ?? ''}` : d.filename ? d.filename : 'pasted'} · {formatBytes(d.bytes)} · hash{' '}
                <span class="mono">{shortHash(d.hash)}</span>
              </span>
              <button type="button" class="btn btn-ghost btn-xs" disabled={busy} onClick={() => void engine.removeDataset(d.name)}>
                remove
              </button>
            </p>
            <pre class="code small">
              <code>{d.typeDecl}</code>
            </pre>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FunctionCard({
  rec,
  engine,
  example,
  busy,
  state,
}: {
  rec: FunctionRecord;
  engine: Engine;
  example?: ExampleInfo;
  busy: boolean;
  state: EngineState;
}) {
  const status = functionStatus(rec);
  const spec = rec.spec;
  const [open, setOpen] = useState(true);
  const cardRef = useRef<HTMLElement>(null);
  const focus = focusFn.value;
  // "Edit the spec": expand this card, bring it into view and put the cursor in its doc
  useEffect(() => {
    if (focus?.fn !== spec.name) return;
    focusFn.value = null;
    setOpen(true);
    afterLayout(() => {
      cardRef.current?.scrollIntoView({ block: 'start' });
      document.getElementById(`spec-${spec.name}-doc`)?.focus({ preventScroll: true });
    });
  }, [focus, spec.name]);
  const bodyId = `fn-body-${spec.name}`;
  const g = state.generation;
  const regrowing = status.kind === 'stale' && !!g?.decision && g.fn === spec.name && (g.phase === 'generating' || g.phase === 'gating');
  return (
    <article ref={cardRef} class={`fn-card${open ? '' : ' is-collapsed'}`} aria-labelledby={`fn-${spec.name}`}>
      <header class="fn-head">
        <button
          type="button"
          class="fn-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span class="sr-only">{open ? 'Collapse' : 'Expand'} {spec.name}</span>
        </button>
        <h3 id={`fn-${spec.name}`} class="mono">
          {spec.name}
        </h3>
        <code class="fn-sig">{signatureOf(spec, rec.artifact?.returnType)}</code>
        <span class={`chip fs-${status.kind}`}>{sentenceCase(regrowing ? 'out of date · being written again against your decision' : functionStatusText(status))}</span>
        {example && (
          <span class="breakit">
            <button
              type="button"
              class="btn btn-warn btn-xs"
              title={example.breakIt.description}
              disabled={busy}
              onClick={() => void engine.breakIt(example.id)}
            >
              {example.breakIt.label || 'Break it'}
            </button>
            <span class="muted small">{example.breakIt.description}</span>
          </span>
        )}
      </header>
      <div class="fn-cols" id={bodyId} hidden={!open}>
        <div>
          <h4>Spec</h4>
          <SpecEditor key={JSON.stringify(draftOf(spec))} rec={rec} engine={engine} busy={busy} />
          <Decisions rec={rec} engine={engine} busy={busy} />
          <PinnedTests rec={rec} engine={engine} busy={busy} />
        </div>
        <div>
          {rec.artifact ? (
            <ArtifactView a={rec.artifact} spec={spec} stale={status.kind === 'stale'} state={state} engine={engine} />
          ) : (
            <p class="empty">No code yet: the model writes it on the first call.</p>
          )}
        </div>
      </div>
    </article>
  );
}

const DOC_PLACEHOLDER = 'What it must do. The model reads this.';

function NewSpecForm({ engine, existing, busy, gen }: { engine: Engine; existing: string[]; busy: boolean; gen: GenerationView | null }) {
  const [name, setName] = useState('');
  const [params, setParams] = useState('');
  const [returns, setReturns] = useState('');
  const [doc, setDoc] = useState('');
  const [docPlaceholder, setDocPlaceholder] = useState(DOC_PLACEHOLDER);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const docRef = useRef<HTMLTextAreaElement>(null);
  const focus = focusFn.value;
  // "Edit the spec" / "Write a spec" for a function that has no spec yet (a call-inferred one whose growth failed or
  // was declined): start a new spec under that name, with the parameters inferred from the call and, when the model
  // declined for lack of a spec, its question as the doc placeholder
  useEffect(() => {
    if (!focus || existing.includes(focus.fn)) return;
    focusFn.value = null;
    setName(focus.fn);
    const pre = newSpecPrefill(gen, focus.fn);
    if (pre) setParams(pre.params);
    setDocPlaceholder(pre?.docPlaceholder ?? DOC_PLACEHOLDER);
    afterLayout(() => {
      formRef.current?.scrollIntoView({ block: 'start' });
      docRef.current?.focus({ preventScroll: true });
    });
  }, [focus, existing.join('\n')]);

  const submit = (ev: Event) => {
    ev.preventDefault();
    if (!isValidFnName(name)) return setError('Function names here must be ASCII letters, digits, _ or $ (not starting with a digit), e.g. slugify.');
    const parsed = parseParams(params);
    if (!parsed.ok) return setError(parsed.error);
    if (!doc.trim()) return setError('Describe the contract in the doc: the model reads it.');
    if (existing.includes(name) && !confirm(`Replace the existing spec for ${name}?`)) return;
    setError(null);
    void engine.upsertSpec({
      name,
      params: parsed.params,
      returns: returns.trim() || null,
      doc: doc.trim(),
      tests: '',
      properties: '',
      budgetMs: 1500,
      maxAttempts: 3,
      origin: 'user',
    });
    setName('');
    setParams('');
    setReturns('');
    setDoc('');
    setDocPlaceholder(DOC_PLACEHOLDER);
  };

  const parsed = parseParams(params);
  return (
    <form class="new-spec" ref={formRef} onSubmit={submit}>
      <h3>New function spec</h3>
      <div class="new-spec-grid">
        <label>
          name
          <input class="mono" value={name} placeholder="slugify" spellcheck={false} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>
          params
          <input
            class="mono"
            value={params}
            placeholder="text: string, maxLen: number"
            spellcheck={false}
            onInput={(e) => setParams(e.currentTarget.value)}
          />
        </label>
        <label>
          returns <span class="muted small">optional — inferred if empty</span>
          <input class="mono" value={returns} placeholder="string" spellcheck={false} onInput={(e) => setReturns(e.currentTarget.value)} />
        </label>
      </div>
      <label>
        doc
        <textarea ref={docRef} rows={2} value={doc} placeholder={docPlaceholder} onInput={(e) => setDoc(e.currentTarget.value)} />
      </label>
      {name && isValidFnName(name) && parsed.ok && (
        <p class="muted small mono">
          → function {name}({paramsText(parsed.params)}){returns.trim() ? `: ${returns.trim()}` : ''}
        </p>
      )}
      {error && <p class="form-error">{error}</p>}
      <p class="muted small">It starts with no tests (1500 ms per call, 3 drafts). Add tests above once it exists.</p>
      <button type="submit" class="btn" disabled={busy}>
        Add spec
      </button>
    </form>
  );
}

export function Repo({ state, engine }: { state: EngineState; engine: Engine }) {
  const recs = Object.values(state.program.functions);
  return (
    <div class="repo">
      <Datasets datasets={state.datasets} engine={engine} busy={state.busy} />
      {recs.length === 0 && <p class="empty">No functions yet. Call one in the console, or add a spec below.</p>}
      {recs.map((rec) => (
        <FunctionCard
          key={rec.spec.name}
          rec={rec}
          engine={engine}
          busy={state.busy}
          state={state}
          example={rec.spec.exampleId ? state.examples.find((e) => e.id === rec.spec.exampleId) : undefined}
        />
      ))}
      <NewSpecForm engine={engine} existing={recs.map((r) => r.spec.name)} busy={state.busy} gen={state.generation} />
    </div>
  );
}

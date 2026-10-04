import { useEffect, useRef, useState } from 'preact/hooks';
import type { Artifact, Engine, EngineState, ExampleInfo, FunctionRecord, FunctionSpec } from '../../types';
import { isValidFnName, paramsText, parseParams, shortHash } from '../format';
import { draftOf, functionStatus, functionStatusText, signatureOf, specPatch } from '../select';
import { focusFn } from '../uiState';
import { CodeView } from './CodeView';
import { GeneratedBadge, StatusIcon } from './common';

const TEST_API = `// Globals in scope: the function under test by its own name, plus
test(name: string, body: () => void): void
eq(actual: unknown, expected: unknown, message?: string): void   // deep, Object.is, bigint-safe
throws(fn: () => unknown, match?: RegExp | string): void
property(name, [arb1, arb2, …], (a1, a2, …) => boolean | void, opts?: { numRuns?: number }): void
matchesReference(name, [arbs…], reference: (…args) => R, opts?: { numRuns?: number }): void
fc   // fast-check, e.g. fc.integer(), fc.array(fc.string(), { minLength: 1 })

// example
test("even count", () => eq(median([4, 1, 3, 2]), 2.5));
property("within bounds", [fc.array(fc.integer(), { minLength: 1 })],
  (xs) => median(xs) >= Math.min(...xs) && median(xs) <= Math.max(...xs));`;

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

  useEffect(() => {
    if (focusFn.value === spec.name) {
      docRef.current?.scrollIntoView({ block: 'center' });
      docRef.current?.focus({ preventScroll: true });
      focusFn.value = null;
    }
  }, [focusFn.value, spec.name]);

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
      <label for={`${id}-doc`}>doc — the model reads this</label>
      <textarea
        id={`${id}-doc`}
        ref={docRef}
        rows={3}
        value={draft.doc}
        onInput={(e) => setDraft({ ...draft, doc: e.currentTarget.value })}
      />
      <label for={`${id}-tests`}>tests — the model sees only their names</label>
      <textarea
        id={`${id}-tests`}
        class="mono"
        rows={6}
        spellcheck={false}
        value={draft.tests}
        placeholder={'test("…", () => eq(fn(…), …));'}
        onInput={(e) => setDraft({ ...draft, tests: e.currentTarget.value })}
      />
      <label for={`${id}-props`}>properties — fast-check, fixed seed</label>
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
          budgetMs <span class="muted small">per call (bounded)</span>
          <input type="number" min={1} step={1} value={budget} onInput={(e) => setBudget(e.currentTarget.value)} />
        </label>
        <label>
          maxAttempts <span class="muted small">candidates per growth</span>
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
          <span class="muted small">Saving changes the hashes; the current artifact becomes invalid and regrows on the next call.</span>
        )}
      </div>
    </form>
  );
}

function ArtifactView({ a, spec, stale }: { a: Artifact; spec: FunctionSpec; stale: boolean }) {
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
      <CodeView signature={signatureOf(spec, a.returnType)} body={a.body} />
      <details class="history">
        <summary>Candidate history — every proposal and who rejected it</summary>
        <ol>
          {a.candidates.map((c) => (
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
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function FunctionCard({
  rec,
  engine,
  example,
  busy,
}: {
  rec: FunctionRecord;
  engine: Engine;
  example?: ExampleInfo;
  busy: boolean;
}) {
  const status = functionStatus(rec);
  const spec = rec.spec;
  return (
    <article class="fn-card" aria-labelledby={`fn-${spec.name}`}>
      <header class="fn-head">
        <h3 id={`fn-${spec.name}`} class="mono">
          {spec.name}
        </h3>
        <code class="fn-sig">{signatureOf(spec, rec.artifact?.returnType)}</code>
        <span class={`chip fs-${status.kind}`}>{functionStatusText(status)}</span>
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
      <div class="fn-cols">
        <div>
          <h4>Spec</h4>
          <SpecEditor key={JSON.stringify(draftOf(spec))} rec={rec} engine={engine} busy={busy} />
        </div>
        <div>
          {rec.artifact ? (
            <ArtifactView a={rec.artifact} spec={spec} stale={status.kind === 'stale'} />
          ) : (
            <p class="empty">No artifact yet — it grows on the first call.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function NewSpecForm({ engine, existing, busy }: { engine: Engine; existing: string[]; busy: boolean }) {
  const [name, setName] = useState('');
  const [params, setParams] = useState('');
  const [returns, setReturns] = useState('');
  const [doc, setDoc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (ev: Event) => {
    ev.preventDefault();
    if (!isValidFnName(name)) return setError('Name must be a JavaScript identifier, e.g. slugify.');
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
  };

  const parsed = parseParams(params);
  return (
    <form class="new-spec" onSubmit={submit}>
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
        <textarea rows={2} value={doc} placeholder="What it must do. The model reads this." onInput={(e) => setDoc(e.currentTarget.value)} />
      </label>
      {name && isValidFnName(name) && parsed.ok && (
        <p class="muted small mono">
          → function {name}({paramsText(parsed.params)}){returns.trim() ? `: ${returns.trim()}` : ''}
        </p>
      )}
      {error && <p class="form-error">{error}</p>}
      <p class="muted small">Starts with no tests (budget 1500 ms, 3 attempts); add tests above once it exists.</p>
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
      {recs.length === 0 && <p class="empty">No functions yet. Call one in the REPL, or add a spec below.</p>}
      {recs.map((rec) => (
        <FunctionCard
          key={rec.spec.name}
          rec={rec}
          engine={engine}
          busy={state.busy}
          example={rec.spec.exampleId ? state.examples.find((e) => e.id === rec.spec.exampleId) : undefined}
        />
      ))}
      <NewSpecForm engine={engine} existing={recs.map((r) => r.spec.name)} busy={state.busy} />
    </div>
  );
}

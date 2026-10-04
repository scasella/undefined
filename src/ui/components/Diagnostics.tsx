import type { Diagnostic, GateId } from '../../types';
import { fmtMs } from '../format';
import { markRange, tokenLines } from '../highlight';
import { attribution } from '../select';

function Fact({ k, v, tone }: { k: string; v?: string | number; tone?: 'bad' | 'good' }) {
  if (v === undefined || v === '') return null;
  return (
    <>
      <dt>{k}</dt>
      <dd class={tone ? `fact-${tone}` : undefined}>
        <code>{v}</code>
      </dd>
    </>
  );
}

/** The structured facts behind a verdict: call, expected vs actual, counterexample, budget. */
export function DiagnosticFacts({ d }: { d: Diagnostic }) {
  switch (d.kind) {
    case 'compile':
      return (
        <dl class="facts">
          <Fact k="where" v={`body:${d.line}:${d.col}`} />
          <Fact k="error" v={`TS${d.code}`} />
        </dl>
      );
    case 'test':
      return (
        <dl class="facts">
          <Fact k="call" v={d.call} />
          <Fact k="expected" v={d.expected} tone="good" />
          <Fact k="actual" v={d.actual} tone="bad" />
          <Fact k="threw" v={d.error} tone="bad" />
        </dl>
      );
    case 'property':
      return (
        <dl class="facts">
          <Fact k="call" v={d.call} />
          <Fact k="expected" v={d.expected} tone="good" />
          <Fact k="actual" v={d.actual} tone="bad" />
          <Fact k="threw" v={d.error} tone="bad" />
          <Fact k="counterexample" v={d.counterexample} />
        </dl>
      );
    case 'invariant':
      return (
        <dl class="facts">
          <Fact k="invariant" v={d.invariant} />
          <Fact k="call" v={d.call} />
          <Fact k="budget" v={d.budgetMs !== undefined ? fmtMs(d.budgetMs) : undefined} tone="good" />
          <Fact k="elapsed" v={d.elapsedMs !== undefined ? fmtMs(d.elapsedMs) : undefined} tone="bad" />
        </dl>
      );
  }
}

function Snippet({ d }: { d: Extract<Diagnostic, { kind: 'compile' }> }) {
  const toks = tokenLines(d.snippet)[0];
  const marked = d.endLine === d.line ? markRange(toks, d.col, d.endCol) : markRange(toks, d.col, d.snippet.length + 1);
  return (
    <pre class="snippet">
      <span class="ln">{d.line}</span>
      {marked.map((t, i) =>
        t.marked ? (
          <mark key={i} class={`tk-${t.kind} squiggle`}>
            {t.text}
          </mark>
        ) : (
          <span key={i} class={`tk-${t.kind}`}>
            {t.text}
          </span>
        ),
      )}
    </pre>
  );
}

function title(d: Diagnostic): string {
  switch (d.kind) {
    case 'compile':
      return d.message;
    case 'test':
      return `test "${d.name}": ${d.message}`;
    case 'property':
      return `property "${d.name}"${d.error ? ' threw' : ' failed'}`;
    case 'invariant':
      return `${d.invariant}: ${d.message}`;
  }
}

export function DiagnosticItem({ d, gate }: { d: Diagnostic; gate: GateId }) {
  return (
    <li class={`diag diag-${d.kind}`}>
      <p class="diag-title">
        {d.kind === 'compile' && <span class="mono loc">body:{d.line}:{d.col} </span>}
        {title(d)}
      </p>
      {d.kind === 'compile' && <Snippet d={d} />}
      {d.kind !== 'compile' && <DiagnosticFacts d={d} />}
      {d.kind === 'invariant' && d.detail && <p class="muted small">{d.detail}</p>}
      <p class="attribution">{attribution(d, gate)}</p>
    </li>
  );
}

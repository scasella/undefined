import type { Diagnostic, GateId } from '../../types';
import { fmtMs } from '../format';
import { markRange, tokenLines } from '../highlight';
import { attribution } from '../select';
import { howFound, ruleName } from '../explain';

function Fact({ k, v, tone, title }: { k: string; v?: string | number; tone?: 'bad' | 'good'; title?: string }) {
  if (v === undefined || v === '') return null;
  return (
    <>
      <dt title={title}>{k}</dt>
      <dd class={tone ? `fact-${tone}` : undefined}>
        <code>{v}</code>
      </dd>
    </>
  );
}

/** The arguments of a call (`median([1, 2])` → `[1, 2]`), whitespace-free, for comparing with a failing input. */
function argsOf(call: string): string {
  const i = call.indexOf('(');
  return i < 0 || !call.endsWith(')') ? call : call.slice(i + 1, -1).replace(/\s+/g, '');
}

/**
 * Whether a counterexample (the arguments as a list, `[[1, 2]]`) only repeats the call: then "Smallest failing input"
 * says nothing the call does not.
 */
export function sameInput(call: string | undefined, counterexample: string | undefined): boolean {
  if (!call || !counterexample) return false;
  const ce = counterexample.replace(/\s+/g, '');
  return ce.startsWith('[') && ce.endsWith(']') && ce.slice(1, -1) === argsOf(call);
}

/**
 * The structured facts behind a verdict: the call, what was expected and what came back, the smallest failing input.
 * Under a headline that already shows the call, the call is not repeated (nor a failing input that equals it).
 */
export function DiagnosticFacts({ d, headline }: { d: Diagnostic; headline?: string }) {
  const callShown = (call: string | undefined) => !!headline && !!call && headline.startsWith(call);
  switch (d.kind) {
    case 'compile':
      return (
        <dl class="facts">
          <Fact k="where" v={`line ${d.line}, column ${d.col}`} />
          <Fact k="error" v={`TS${d.code}`} />
        </dl>
      );
    case 'test':
      return (
        <dl class="facts">
          {!callShown(d.call) && <Fact k="call" v={d.call} />}
          <Fact k="expected" v={d.expected} tone="good" />
          <Fact k="got" v={d.actual} tone="bad" />
          <Fact k="threw" v={d.error} tone="bad" />
        </dl>
      );
    case 'property':
      return (
        <dl class="facts">
          {!callShown(d.call) && <Fact k="call" v={d.call} />}
          <Fact k="expected" v={d.expected} tone="good" />
          <Fact k="got" v={d.actual} tone="bad" />
          <Fact k="threw" v={d.error} tone="bad" />
          {!sameInput(d.call, d.counterexample) && <Fact k="smallest failing input" v={d.counterexample} title="the arguments of the smallest failing call, as a list" />}
        </dl>
      );
    case 'invariant':
      return (
        <dl class="facts">
          <Fact k="rule" v={ruleName(d.invariant)} title={`invariant: ${d.invariant}`} />
          {!callShown(d.call) && <Fact k="call" v={d.call} />}
          <Fact k="time limit" v={d.budgetMs !== undefined ? fmtMs(d.budgetMs) : undefined} tone="good" />
          <Fact k="stopped after" v={d.elapsedMs !== undefined ? fmtMs(d.elapsedMs) : undefined} tone="bad" />
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
      return `check "${d.name}"${d.error ? ' threw' : ' failed'}`;
    case 'invariant':
      return `${ruleName(d.invariant)}: ${d.message}`;
  }
}

export function DiagnosticItem({ d, gate }: { d: Diagnostic; gate: GateId }) {
  return (
    <li class={`diag diag-${d.kind}`}>
      <p class="diag-title">
        {d.kind === 'compile' && <span class="loc">line {d.line}:{d.col} </span>}
        {title(d)}
      </p>
      {d.kind === 'compile' && <Snippet d={d} />}
      {d.kind !== 'compile' && <DiagnosticFacts d={d} />}
      {d.kind === 'invariant' && d.detail && <p class="muted small">{d.detail}</p>}
      <details class="how">
        <summary>How it was found</summary>
        {howFound(d) && <p>{howFound(d)}</p>}
        <p class="attribution">{attribution(d, gate)}</p>
      </details>
    </li>
  );
}

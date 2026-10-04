import type { Diagnostic } from '../../types';
import { markRange, tokenLines, type MarkedToken, type Token } from '../highlight';

type CompileDiag = Extract<Diagnostic, { kind: 'compile' }>;

function Tokens({ tokens }: { tokens: MarkedToken[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.marked ? (
          <mark key={i} class={`tk-${t.kind} squiggle`}>
            {t.text}
          </mark>
        ) : t.kind === 'ws' || t.kind === 'ident' ? (
          t.text
        ) : (
          <span key={i} class={`tk-${t.kind}`}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

function lineTokens(tokens: Token[], diags: CompileDiag[] | undefined): MarkedToken[] {
  const d = diags?.find((x) => x.endLine === x.line);
  if (d) return markRange(tokens, d.col, d.endCol);
  // multi-line span: underline from col to end of this line
  const first = diags?.[0];
  if (first) return markRange(tokens, first.col, first.col + tokens.reduce((n, t) => n + t.text.length, 0));
  return tokens;
}

/**
 * A rendered function declaration: unnumbered signature line, body lines numbered from 1 (the numbering
 * compile diagnostics use), closing brace. Read-only display.
 */
export function CodeView({
  signature,
  body,
  caret = false,
  marks,
  placeholder,
}: {
  signature: string;
  body: string;
  caret?: boolean;
  marks?: Map<number, CompileDiag[]>;
  placeholder?: string;
}) {
  const sig = tokenLines(`${signature} {`)[0];
  const lines = body ? tokenLines(body) : [];
  return (
    <pre class="code" aria-label={`${signature} — function body`}>
      <code>
        <span class="cl cl-frame">
          <span class="ln" aria-hidden="true" />
          <span class="lc">
            <Tokens tokens={sig} />
          </span>
        </span>
        {lines.length === 0 && (
          <span class="cl">
            <span class="ln" aria-hidden="true" />
            <span class="lc indent placeholder">
              {placeholder}
              {caret && <span class="caret" aria-hidden="true" />}
            </span>
          </span>
        )}
        {lines.map((toks, i) => {
          const n = i + 1;
          const diags = marks?.get(n);
          const last = i === lines.length - 1;
          return (
            <span key={n} class={`cl${diags ? ' cl-err' : ''}`}>
              <span class="ln" aria-hidden="true">
                {diags ? '✕' : n}
              </span>
              <span class="lc indent">
                <Tokens tokens={lineTokens(toks, diags)} />
                {last && caret && <span class="caret" aria-hidden="true" />}
                {diags?.map((d, k) => (
                  <span key={k} class="inline-diag">
                    <span class="sr-only">Compile error on line {n}: </span>
                    TS{d.code}: {d.message}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
        <span class="cl cl-frame">
          <span class="ln" aria-hidden="true" />
          <span class="lc">
            <span class="tk-punc">{'}'}</span>
          </span>
        </span>
      </code>
    </pre>
  );
}

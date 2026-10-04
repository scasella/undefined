import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { AttemptStatus, EngineState } from '../../types';
import { codeAttempt, compileMarks, latestCommitted, signatureOf } from '../select';
import { selection } from '../uiState';
import { CodeView } from './CodeView';
import { GeneratedBadge, PanelHead } from './common';
import { ModelSaw } from './ModelSaw';

const STATUS_TEXT: Record<AttemptStatus, string> = {
  generating: 'writing',
  typing: 'arriving',
  gating: 'being checked',
  rejected: 'rejected',
  accepted: 'accepted',
  aborted: 'stopped',
};

/**
 * The code panel. On a phone its body can be folded away (the toggle is hidden on wider screens); it opens again
 * whenever a new generation starts, so the draft is on screen while the model writes it.
 */
function CodePanel({ label, genId, head, children, bodyClass, foldable = true }: { label: string; genId: string | null; head: ComponentChildren; children: ComponentChildren; bodyClass?: string; foldable?: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(true), [genId]);
  return (
    <section class={`panel panel-code${open ? '' : ' is-folded'}`} aria-label={label}>
      <PanelHead ch="02" title="Candidate" sub="the model's draft">
        {head}
        {foldable && (
          <button type="button" class="btn btn-ghost btn-xs fold-btn" aria-expanded={open} aria-controls="code-body" onClick={() => setOpen(!open)}>
            {open ? 'Hide code' : 'Show code'}
          </button>
        )}
      </PanelHead>
      <div id="code-body" class={`panel-body code-scroll${bodyClass ? ` ${bodyClass}` : ''}`}>
        {children}
      </div>
    </section>
  );
}

export function CodePane({ state }: { state: EngineState }) {
  const gen = state.generation;
  const shown = codeAttempt(gen, selection.value);

  if (gen && shown) {
    const { attempt, holdover } = shown;
    const latest = gen.attempts[gen.attempts.length - 1];
    const committed = attempt.status === 'accepted' && gen.phase === 'committed';
    return (
      <CodePanel
        label="Candidate code"
        genId={gen.id}
        bodyClass={holdover ? 'is-holdover' : undefined}
        head={
          <>
          <span class="code-what">
            {gen.kind === 'recheck' ? `committed code · ${gen.fn}` : `No. ${attempt.attempt} of ${gen.maxAttempts} · ${gen.fn}`}
          </span>
          {holdover ? (
            <>
              <span class={`chip st-${attempt.status}`}>
                {STATUS_TEXT[attempt.status]} · #{attempt.attempt}
              </span>
              <span class="chip st-generating" title="The next draft replaces this one as soon as its first characters arrive">
                #{latest.attempt} on its way
              </span>
            </>
          ) : (
            <span class={`chip st-${attempt.status}${attempt.candidate?.declined ? ' st-declined' : ''}`}>
              {attempt.candidate?.declined ? 'declined' : gen.kind === 'recheck' ? 'fails the added check' : STATUS_TEXT[attempt.status]}
            </span>
          )}
          {committed && <GeneratedBadge />}
          </>
        }
      >
          <CodeView
            signature={gen.signature}
            body={attempt.shown}
            caret={!holdover && (attempt.status === 'typing' || attempt.status === 'generating')}
            marks={attempt.status === 'rejected' ? compileMarks(attempt.gates) : undefined}
            placeholder={attempt.status === 'generating' || attempt.status === 'typing' ? 'waiting for the model…' : attempt.status === 'aborted' ? 'no draft arrived (the model could not be asked)' : ''}
          />
          {attempt.candidate?.notes && (
            <p class="model-notes">
              <span class="label">model's note</span> <span class="model-notes-text">{attempt.candidate.notes}</span>
            </p>
          )}
          {attempt.candidate?.prompt && (
            <ModelSaw
              key={`${gen.id}:${attempt.attempt}`}
              prompt={attempt.candidate.prompt}
              spec={state.program.functions[gen.fn]?.spec}
              attempt={attempt.attempt}
            />
          )}
      </CodePanel>
    );
  }

  const rec = latestCommitted(state.program);
  return (
    <CodePanel
      label="Code"
      genId={null}
      foldable={!!rec?.artifact}
      head={
        rec?.artifact && (
          <>
            <span class="code-what">{rec.spec.name}</span>
            <span class="chip st-accepted">certified r{rec.artifact.revision}</span>
            <GeneratedBadge />
          </>
        )
      }
    >
        {rec?.artifact ? (
          <CodeView signature={signatureOf(rec.spec, rec.artifact.returnType)} body={rec.artifact.body} />
        ) : (
          <p class="empty">
            No code yet, and you won't write any here. Call a function that doesn't exist: the model's draft appears here line
            by line, before the gates judge it.
          </p>
        )}
    </CodePanel>
  );
}

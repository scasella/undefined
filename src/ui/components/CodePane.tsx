import type { AttemptStatus, EngineState } from '../../types';
import { codeAttempt, compileMarks, latestCommitted, signatureOf } from '../select';
import { selection } from '../uiState';
import { CodeView } from './CodeView';
import { GeneratedBadge, PanelHead } from './common';
import { ModelSaw } from './ModelSaw';

const STATUS_TEXT: Record<AttemptStatus, string> = {
  generating: 'generating',
  typing: 'typing',
  gating: 'gating',
  rejected: 'rejected',
  accepted: 'accepted',
  aborted: 'aborted',
};

export function CodePane({ state }: { state: EngineState }) {
  const gen = state.generation;
  const shown = codeAttempt(gen, selection.value);

  if (gen && shown) {
    const { attempt, holdover } = shown;
    const latest = gen.attempts[gen.attempts.length - 1];
    const committed = attempt.status === 'accepted' && gen.phase === 'committed';
    return (
      <section class="panel panel-code" aria-label="Candidate code">
        <PanelHead ch="02" title="Candidate">
          <span class="muted mono">
            {gen.kind === 'recheck' ? `committed body · ${gen.fn}` : `#${attempt.attempt} of ${gen.maxAttempts} · ${gen.fn}`}
          </span>
          {holdover ? (
            <>
              <span class={`chip st-${attempt.status}`}>
                {STATUS_TEXT[attempt.status]} · #{attempt.attempt}
              </span>
              <span class="chip st-generating" title="The next candidate replaces this one as soon as its first characters arrive">
                #{latest.attempt} on its way
              </span>
            </>
          ) : (
            <span class={`chip st-${attempt.status}${attempt.candidate?.declined ? ' st-declined' : ''}`}>
              {attempt.candidate?.declined ? 'declined' : gen.kind === 'recheck' ? 'fails the added check' : STATUS_TEXT[attempt.status]}
            </span>
          )}
          {committed && <GeneratedBadge />}
        </PanelHead>
        <div class={`panel-body code-scroll${holdover ? ' is-holdover' : ''}`}>
          <CodeView
            signature={gen.signature}
            body={attempt.shown}
            caret={!holdover && (attempt.status === 'typing' || attempt.status === 'generating')}
            marks={attempt.status === 'rejected' ? compileMarks(attempt.gates) : undefined}
            placeholder={attempt.status === 'generating' || attempt.status === 'typing' ? 'waiting for the model…' : attempt.status === 'aborted' ? 'no candidate (generation failed)' : ''}
          />
          {attempt.candidate?.notes && (
            <p class="model-notes">
              <span class="label">model's note</span> {attempt.candidate.notes}
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
        </div>
      </section>
    );
  }

  const rec = latestCommitted(state.program);
  return (
    <section class="panel panel-code" aria-label="Code">
      <PanelHead ch="02" title="Candidate">
        {rec?.artifact && (
          <>
            <span class="muted mono">{rec.spec.name}</span>
            <span class="chip st-accepted">certified r{rec.artifact.revision}</span>
            <GeneratedBadge />
          </>
        )}
      </PanelHead>
      <div class="panel-body code-scroll">
        {rec?.artifact ? (
          <CodeView signature={signatureOf(rec.spec, rec.artifact.returnType)} body={rec.artifact.body} />
        ) : (
          <p class="empty">
            No code yet. Nobody writes it here: call a function that doesn't exist and the model's candidates appear in this
            pane, line by line, before the gates judge them.
          </p>
        )}
      </div>
    </section>
  );
}

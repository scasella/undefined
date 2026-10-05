import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { AttemptStatus, EngineState } from '@scasella/undefined-engine/types';
import { codeAttempt, committedChip, compileMarks, latestCommitted, signatureOf, usesOf } from '../select';
import { selection } from '../uiState';
import { CodeView } from './CodeView';
import { PanelHead } from './common';
import { ModelSaw } from './ModelSaw';

const STATUS_TEXT: Record<AttemptStatus, string> = {
  generating: 'Writing',
  typing: 'Arriving',
  gating: 'Being checked',
  rejected: 'Rejected',
  accepted: 'Accepted',
  aborted: 'Stopped',
};

/** Matches a phone-width viewport, re-rendering when it changes. */
function usePhone(): boolean {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
  const [phone, setPhone] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const on = () => setPhone(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return phone;
}

/**
 * The draft panel. On a phone its body is folded to "Show draft (N lines)" except while a draft is streaming in; the
 * reader's own choice holds until the next generation starts.
 */
function CodePanel({ genId, head, children, bodyClass, streaming = false, lines = 0, foldable = true }: { genId: string | null; head: ComponentChildren; children: ComponentChildren; bodyClass?: string; streaming?: boolean; lines?: number; foldable?: boolean }) {
  const phone = usePhone();
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => setChoice(null), [genId]);
  const open = !foldable || (choice ?? (streaming || !phone));
  return (
    <section class={`panel panel-code${open ? '' : ' is-folded'}`} aria-labelledby="h-draft">
      <PanelHead title="Draft" id="h-draft">
        {head}
      </PanelHead>
      {foldable && phone && (
        <button type="button" class="btn fold-btn" aria-expanded={open} aria-controls="code-body" onClick={() => setChoice(!open)}>
          {open ? 'Hide draft' : `Show draft${lines ? ` (${lines} line${lines === 1 ? '' : 's'})` : ''}`}
        </button>
      )}
      <div id="code-body" class={`panel-body code-scroll${bodyClass ? ` ${bodyClass}` : ''}`}>
        {children}
      </div>
    </section>
  );
}

/**
 * The quiet line under a draft that calls other generated functions ("uses slugify"): the names the compile gate
 * resolved to them, never a guess from the text.
 */
export function UsesLine({ names }: { names?: readonly string[] }) {
  if (!names || names.length === 0) return null;
  return (
    <p class="uses-line" title={`Calls ${names.length === 1 ? 'another function' : 'other functions'} generated in this program. The checks ran through ${names.length === 1 ? 'it' : 'them'} as certified.`}>
      uses{' '}
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <code>{n}</code>
        </span>
      ))}
    </p>
  );
}

const lineCount = (body: string): number => (body ? body.replace(/\n$/, '').split('\n').length + 2 : 0);

export function CodePane({ state }: { state: EngineState }) {
  const gen = state.generation;
  const shown = codeAttempt(gen, selection.value);

  if (gen && shown) {
    const { attempt, holdover } = shown;
    const committed = attempt.status === 'accepted' && gen.phase === 'committed';
    const streaming = !holdover && (attempt.status === 'typing' || attempt.status === 'generating');
    const callees = gen.recheck?.callees;
    const word = attempt.candidate?.declined
      ? 'Declined'
      : gen.kind === 'recheck'
        ? callees
          ? `Fails with the new ${callees.names.join(', ')}`
          : 'Fails the added check'
        : STATUS_TEXT[attempt.status];
    return (
      <CodePanel
        genId={gen.id}
        streaming={streaming}
        lines={lineCount(attempt.shown)}
        bodyClass={holdover ? 'is-holdover' : undefined}
        head={
          <>
            <code class="code-what">{gen.fn}</code>
            <span
              class={`chip st-${attempt.status}${attempt.candidate?.declined ? ' st-declined' : ''}`}
              title={committed ? 'Written by the model, accepted by the checks. Read-only.' : holdover ? 'The next draft replaces this one as soon as its first characters arrive' : undefined}
            >
              {gen.kind === 'recheck' ? word : `#${attempt.attempt} · ${word}`}
            </span>
          </>
        }
      >
        <CodeView
          signature={gen.signature}
          body={attempt.shown}
          caret={streaming}
          marks={attempt.status === 'rejected' ? compileMarks(attempt.gates) : undefined}
          placeholder={attempt.status === 'generating' || attempt.status === 'typing' ? 'waiting for the model…' : attempt.status === 'aborted' ? 'no draft arrived (the model could not be asked)' : ''}
        />
        <UsesLine names={attempt.uses} />
        {attempt.candidate?.notes && (
          <p class="model-notes">
            <span class="label">Model's note</span> <span class="model-notes-text">{attempt.candidate.notes}</span>
          </p>
        )}
        {attempt.candidate?.prompt && (
          <ModelSaw key={`${gen.id}:${attempt.attempt}`} prompt={attempt.candidate.prompt} spec={state.program.functions[gen.fn]?.spec} attempt={attempt.attempt} />
        )}
      </CodePanel>
    );
  }

  const rec = latestCommitted(state.program);
  if (!rec?.artifact) {
    // nothing drafted yet: a faint skeleton where the draft will arrive
    return (
      <section class="panel panel-code is-empty" aria-labelledby="h-draft">
        <PanelHead title="Draft" id="h-draft" />
        <div class="skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p class="sr-only">No draft yet. The model's draft appears here, line by line, before the checks judge it.</p>
      </section>
    );
  }
  const chip = committedChip(rec, state.program)!;
  return (
    <CodePanel
      genId={null}
      lines={lineCount(rec.artifact.body)}
      head={
        <>
          <code class="code-what">{rec.spec.name}</code>
          <span class={`chip ${chip.cls}`} title={chip.title}>
            {chip.label}
          </span>
        </>
      }
    >
      <CodeView signature={signatureOf(rec.spec, rec.artifact.returnType)} body={rec.artifact.body} />
      <UsesLine names={usesOf(rec)} />
    </CodePanel>
  );
}

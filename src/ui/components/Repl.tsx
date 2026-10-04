import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine, EngineState, GenerationView, ReplEntry, RestartId } from '../../types';
import { fmtElapsed, fmtMs } from '../format';
import { inputHistory } from '../select';
import { focusFn, lowerTab, useElapsed } from '../uiState';
import { PanelHead } from './common';

function Entry({ e, engine, fnNames }: { e: ReplEntry; engine: Engine; fnNames: string[] }) {
  switch (e.kind) {
    case 'input':
      return (
        <li class="r-input">
          <span class="prompt" aria-hidden="true">
            ›
          </span>
          <code>{e.text}</code>
        </li>
      );
    case 'output':
      return (
        <li class="r-output">
          <code class="value">{e.value}</code>
          <span class="r-meta">
            {e.label && <span class={`chip ${e.label === 'generated' ? 'chip-gen' : 'chip-cache'}`}>{e.label}</span>}
            {e.detail && <span class="muted">{e.detail}</span>}
            <span class="muted mono">{fmtMs(e.ms)}</span>
          </span>
        </li>
      );
    case 'error': {
      const invoke = (id: RestartId) => {
        void engine.invokeRestart(e.id, id);
        if (id === 'edit-spec') {
          lowerTab.value = 'repo';
          // the tabs sit below the fold; bring them up even when no specific function can be focused
          // the contract's error entry has no fn field; only focus a spec when the message names a known function call
          const fn = /^([A-Za-z_$][\w$]*)\(/.exec(e.message)?.[1];
          if (fn && fnNames.includes(fn)) focusFn.value = fn;
          else requestAnimationFrame(() => document.querySelector('.lower')?.scrollIntoView({ block: 'start' }));
        }
      };
      return (
        <li class={`r-error${e.resolved ? ' is-resolved' : ''}`}>
          <p>
            <span class="err-name">{e.name}</span>: {e.message}
          </p>
          {e.restarts && e.restarts.length > 0 && (
            <div class="restarts" role="group" aria-label="Restarts">
              {e.restarts.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  class="btn btn-restart"
                  title={r.description}
                  disabled={e.resolved}
                  onClick={() => invoke(r.id)}
                >
                  {r.label}
                </button>
              ))}
              {e.resolved && <span class="muted small">resolved</span>}
            </div>
          )}
        </li>
      );
    }
    case 'info':
      return <li class={`r-info tone-${e.tone ?? 'muted'}`}>{e.text}</li>;
    case 'takeaway':
      return <li class="r-takeaway">{e.text}</li>;
  }
}

function LiveGeneration({ gen }: { gen: GenerationView }) {
  const current = gen.attempts[gen.attempts.length - 1];
  const waiting = gen.phase === 'generating' && (!current || current.status === 'generating');
  const elapsed = useElapsed(`${gen.id}:${gen.attempt}`, waiting);
  const lines = gen.progress.slice(-4);
  return (
    <li class="r-live" aria-live="off">
      <p class="live-head">
        <span class="spinner" aria-hidden="true" />
        {waiting
          ? 'model is writing'
          : current?.status === 'typing'
            ? 'candidate arriving'
            : current?.status === 'gating'
              ? 'gates judging'
              : 'preparing the next attempt'}{' '}
        ·{' '}
        <span class="mono">
          {gen.fn} · attempt {gen.attempt} of {gen.maxAttempts}
        </span>
        {waiting && <span class="elapsed mono"> {fmtElapsed(elapsed)}</span>}
      </p>
      {waiting && lines.length > 0 && (
        <ul class="progress">
          {lines.map((p, i) => (
            <li key={`${p.t}-${i}`} class={`pg-${p.channel}`}>
              <span class="mono muted">+{fmtElapsed(p.t)}</span> {p.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Repl({ state, engine }: { state: EngineState; engine: Engine }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const history = inputHistory(state.repl);
  const gen = state.generation;
  const live = state.busy && gen && (gen.phase === 'generating' || gen.phase === 'gating');

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (!state.busy) inputRef.current?.focus({ preventScroll: true });
  }, [state.busy]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.repl.length, gen?.progress.length, gen?.attempt, live]);

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!state.busy) {
        setHistIdx(null);
        void engine.submit();
      }
    } else if (ev.key === 'ArrowUp' && history.length) {
      ev.preventDefault();
      const i = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i);
      engine.setInput(history[i]);
    } else if (ev.key === 'ArrowDown' && histIdx !== null) {
      ev.preventDefault();
      const i = histIdx + 1;
      if (i >= history.length) {
        setHistIdx(null);
        engine.setInput('');
      } else {
        setHistIdx(i);
        engine.setInput(history[i]);
      }
    }
  };

  const envNames = Object.keys(state.env);
  const fnNames = Object.keys(state.program.functions);

  return (
    <section class="panel panel-repl" aria-label="REPL">
      <PanelHead ch="01" title="REPL">
        {state.busy && <span class="chip st-gating">busy</span>}
      </PanelHead>
      <div class="panel-body repl-scroll" ref={scrollRef}>
        {state.hints.opener && <p class="opener">This function doesn't exist. Press Enter.</p>}
        <ol class="transcript" aria-live="polite" aria-relevant="additions">
          {state.repl.map((e) => (
            <Entry key={e.id} e={e} engine={engine} fnNames={fnNames} />
          ))}
          {live && <LiveGeneration gen={gen} />}
        </ol>
      </div>
      <div class={`repl-input${state.busy ? ' is-busy' : ''}`}>
        <label for="repl-input" class="prompt">
          <span aria-hidden="true">›</span>
          <span class="sr-only">Expression</span>
        </label>
        <input
          id="repl-input"
          ref={inputRef}
          value={state.replInput}
          onInput={(ev) => {
            setHistIdx(null);
            engine.setInput((ev.currentTarget as HTMLInputElement).value);
          }}
          onKeyDown={onKeyDown}
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          aria-describedby="repl-hint"
          placeholder={state.busy ? 'waiting for the gates…' : 'call anything, e.g. median([5, 1, 3])'}
        />
        <span id="repl-hint" class="kbd-hint muted small">
          {state.busy ? 'busy' : '⏎ run · ↑↓ history'}
        </span>
      </div>
      {envNames.length > 0 && (
        <div class="env" aria-label="Live state">
          <span class="label">live state</span>
          {envNames.map((k) => (
            <span key={k} class="env-var mono">
              {k} = <span class="muted">{state.env[k]}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

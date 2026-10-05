import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine, EngineState, GenerationView, ReplEntry, RestartId } from '@scasella/undefined-engine/types';
import { fmtElapsed, fmtMs, sentenceCase } from '../format';
import { calledName, inputHistory } from '../select';
import { focusFn, lowerTab, useElapsed } from '../uiState';
import { pinnedText } from '../data';
import { DataTable } from './DataTable';
import { plainErrorName, UNCHECKED_TEXT } from '../explain';
import { PanelHead, Ticks } from './common';

/**
 * The action row under a pinnable result: one compact line. Before pinning, the most prominent button after a result;
 * after, what the pin became and a way to see it in the Repo tab.
 */
function PinRow({ e, engine, state, primary }: { e: Extract<ReplEntry, { kind: 'output' }>; engine: Engine; state: EngineState; primary?: boolean }) {
  const p = e.pinnable!;
  if (e.pinned) {
    const n = state.program.functions[p.fn]?.spec.pins?.length ?? 1;
    return (
      <div class="r-actions is-pinned">
        <span class="pin-done">{pinnedText(p.fn, n)}</span>
        <button
          type="button"
          class="linkish small"
          onClick={() => {
            lowerTab.value = 'repo';
            focusFn.value = { fn: p.fn, nonce: Date.now() };
          }}
        >
          see it in Repo
        </button>
      </div>
    );
  }
  return (
    <div class="r-actions">
      <button
        type="button"
        class={`btn btn-pin${primary ? ' btn-primary' : ''}`}
        disabled={state.busy}
        title={`Turn ${p.call} and this result into a unit test on ${p.fn}: the next regeneration has to reproduce it.`}
        onClick={() => void engine.pinResult(e.id)}
      >
        Pin result as test
      </button>
    </div>
  );
}

function Entry({ e, engine, live, latest, state }: { e: ReplEntry; engine: Engine; live: boolean; latest?: boolean; state: EngineState }) {
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
        <li class={`r-output${latest && !e.table && e.value.length <= 24 ? ' is-result' : ''}`}>
          <code class="value">{e.value}</code>
          <span class="r-meta">
            {e.label && <span class={`chip ${e.label === 'generated' ? 'chip-gen' : 'chip-cache'}`}>{sentenceCase(e.label)}</span>}
            {e.detail && <span class="muted">{e.detail}</span>}
            <span class="muted mono">{fmtMs(e.ms)}</span>
          </span>
          {e.table && (
            <div class="r-table">
              <DataTable table={e.table} label={`Result of the call above: ${e.table.total} rows`} />
            </div>
          )}
          {e.note !== undefined && (
            // set only when this call grew a function with no tests and no properties: an accept, not an endorsement
            <div class="r-unchecked">
              <p class="r-unchecked-line">{UNCHECKED_TEXT}</p>
              {e.note !== '' && (
                <p class="r-model-note">
                  Model's note: <span class="r-model-note-text">{e.note}</span>
                </p>
              )}
              {e.pinnable && <PinRow e={e} engine={engine} state={state} primary={latest} />}
            </div>
          )}
          {e.note === undefined && e.pinnable && <PinRow e={e} engine={engine} state={state} primary={latest} />}
        </li>
      );
    case 'error': {
      // 'edit-spec' needs no UI glue here: the engine sets state.focusSpec and App opens the spec from that
      const invoke = (id: RestartId) => void engine.invokeRestart(e.id, id);
      // a decline is not a failure of the program: the model said it would only be faking it
      return (
        <li class={`r-error${e.name === 'Declined' ? ' is-declined' : ''}${e.resolved ? ' is-resolved' : ''}`}>
          <p>
            <span class="err-name" title={e.name !== plainErrorName(e.name) ? e.name : undefined}>
              {plainErrorName(e.name)}
            </span>
            : <Ticks text={e.message} />
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
    case 'info': {
      // an accent row ending in '…' ("Generating…") describes work in flight; once that work is over it must
      // not keep looking busy, so it disappears
      const inFlight = e.tone === 'accent' && e.text.endsWith('…');
      if (inFlight && !live) return null; // finished work leaves no stale "Generating" line behind
      return (
        <li class={`r-info tone-${e.tone ?? 'muted'}${inFlight ? ' is-live' : ''}`}>
          <Ticks text={e.text} />
        </li>
      );
    }
    case 'takeaway':
      return <li class="r-takeaway">{e.text}</li>;
  }
}

/** The trace of a generation in flight: one line, the raw log behind "Details". */
function LiveGeneration({ gen }: { gen: GenerationView }) {
  const current = gen.attempts[gen.attempts.length - 1];
  const waiting = gen.phase === 'generating' && (!current || current.status === 'generating');
  const elapsed = useElapsed(`${gen.id}:${gen.attempt}`, waiting);
  const lines = gen.progress.slice(-6);
  const verb = waiting ? 'Writing' : current?.status === 'typing' ? 'Receiving' : current?.status === 'gating' ? 'Checking' : 'Preparing another draft of';
  return (
    <li class="r-live" aria-live="off">
      <p class="live-head">
        <span class="spinner" aria-hidden="true" />
        <span>
          {verb} <code class="tick">{gen.fn}</code>…
        </span>
        {waiting && <span class="elapsed mono">{fmtElapsed(elapsed)}</span>}
      </p>
      {waiting && lines.length > 0 && (
        <details class="trace">
          <summary>Details</summary>
          <ul class="progress">
            {lines.map((p, i) => (
              <li key={`${p.t}-${i}`} class={`pg-${p.channel}`}>
                <span class="mono muted">+{fmtElapsed(p.t)}</span> {p.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** The first screen's one sentence, naming the function the console is about to call. */
/** `quiet` on the data-first screen: the drop card above is the focal point, so the console's line steps back. */
function Opener({ input, quiet = false }: { input: string; quiet?: boolean }) {
  const fn = calledName(input);
  return (
    <p class={`opener${quiet ? ' opener-quiet' : ''}`}>
      {fn ? (
        <>
          <code class="opener-fn">{fn}</code> doesn't exist yet.
        </>
      ) : (
        <>Call a function that doesn't exist yet.</>
      )}{' '}
      <em>Press Enter</em> and a model will write it — your checks decide if it stays.
    </p>
  );
}

function Shortcuts() {
  return (
    <details class="keys">
      <summary class="btn btn-ghost btn-xs" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
        ?
      </summary>
      <div class="keys-pop" role="note">
        <dl>
          <dt>
            <kbd>↵</kbd>
          </dt>
          <dd>run</dd>
          <dt>
            <kbd>↑</kbd> <kbd>↓</kbd>
          </dt>
          <dd>history</dd>
          <dt>
            <kbd>;</kbd>
          </dt>
          <dd>several statements on one line; after a function grows, only the statement that called it runs again</dd>
          <dt>
            <kbd>1</kbd>–<kbd>4</kbd>
          </dt>
          <dd>examples</dd>
          <dt>
            <kbd>/</kbd>
          </dt>
          <dd>focus the console</dd>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>close</dd>
        </dl>
      </div>
    </details>
  );
}

export function Repl({ state, engine }: { state: EngineState; engine: Engine }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const history = inputHistory(state.repl);
  const gen = state.generation;
  const live = state.busy && gen && (gen.phase === 'generating' || gen.phase === 'gating');

  // the console takes focus on the example-first screen; on the data-first one the drop card leads (no focus ring here)
  const mounted = useRef(false);
  useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first && state.start === 'data') return;
    if (!state.busy) inputRef.current?.focus({ preventScroll: !first });
  }, [state.busy]);
  // Stick to the newest entry. Anything that changes the transcript's height (new entries, the live
  // generation row growing or shrinking, the env bar appearing and squeezing the scroll box) re-pins it,
  // unless the reader has scrolled up to look at something older. A new input always re-pins.
  const pinned = useRef(true);
  const lastEntry = state.repl[state.repl.length - 1];
  useEffect(() => {
    if (lastEntry?.kind === 'input') pinned.current = true;
  }, [lastEntry?.id]);
  useEffect(() => {
    const el = scrollRef.current;
    const list = listRef.current;
    if (!el || !list) return;
    const stick = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    };
    stick();
    el.addEventListener('scroll', onScroll, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => el.removeEventListener('scroll', onScroll);
    const ro = new ResizeObserver(stick);
    ro.observe(list);
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [state.repl.length, lastEntry?.id, gen?.progress.length, gen?.attempt, live]);

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
  let latestOutputId: string | undefined;
  for (let i = state.repl.length - 1; i >= 0; i--) {
    const e = state.repl[i];
    if (e.kind === 'input') break;
    if (e.kind === 'output') latestOutputId = e.id;
  }
  // only the newest in-flight info row can still be in flight, and only while a generation runs
  let liveInfoId: string | undefined;
  if (live) {
    for (let i = state.repl.length - 1; i >= 0; i--) {
      const e = state.repl[i];
      if (e.kind === 'info' && e.tone === 'accent' && e.text.endsWith('…')) {
        liveInfoId = e.id;
        break;
      }
    }
  }

  return (
    <section class="panel panel-repl" aria-labelledby="h-console">
      <PanelHead title="Console" id="h-console" />
      <div class="panel-body repl-scroll" ref={scrollRef}>
        {state.hints.opener && <Opener input={state.replInput} quiet={state.start === 'data'} />}
        <ol class="transcript" ref={listRef} aria-live="polite" aria-relevant="additions">
          {/* while the trace row runs, the in-flight "Generating…" line would only repeat it */}
          {state.repl.map((e) =>
            live && e.id === liveInfoId ? null : (
              <Entry key={e.id} e={e} engine={engine} live={e.id === liveInfoId} latest={e.id === latestOutputId} state={state} />
            ),
          )}
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
          placeholder={state.busy ? 'waiting for the checks…' : 'call anything, e.g. median([5, 1, 3])'}
          enterKeyHint="go"
        />
        <span id="repl-hint" class="sr-only">
          Enter runs the line. Several statements can be separated with a semicolon; after a function grows, only the statement that called it runs again. The up and down arrows walk the history.
        </span>
        <Shortcuts />
        <button
          type="button"
          class={`btn run-btn${state.hints.opener && !(state.start === 'data' && state.replInput.trim() === '') ? ' btn-primary' : ''}`}
          disabled={state.busy}
          aria-label="Run"
          onClick={() => {
            setHistIdx(null);
            void engine.submit();
          }}
        >
          Run <span aria-hidden="true">↵</span>
        </button>
      </div>
      {envNames.length > 0 && (
        <div class="env" aria-label="Live state">
          <span class="label" title="Console variables: the live state that revisions keep">variables</span>
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

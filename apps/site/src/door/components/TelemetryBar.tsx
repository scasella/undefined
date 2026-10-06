/**
 * The white top bar, kept short on purpose: the wordmark (home), the file chip, the mode pill, the session check
 * counter and the "Step by step" button. The mode pill is a disclosure: it says in a line whether this is the demo
 * (recorded answers) or the live copy, and its note (reachable by mouse, keyboard and touch) says what runs where and
 * what leaves the browser. The example-rows switch lives where its explanation is (the first run's "What the AI will
 * see" card and the landing's privacy card), so no two switches share a name.
 *
 * Narrow screens hide the secondary items with CSS (TelemetryBar.css); the mode pill and the button always stay.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import type { Engine } from '@scasella/undefined-engine/types';
import { Mark } from '../icons';
import { formatSession, rowsShort, sendRows, session } from '../state';
import { LinkButton } from './LinkButton';
import './TelemetryBar.css';

export interface TelemetryBarProps {
  engine: Engine;
  /** e.g. "orders.csv · 332 rows · 10 columns"; omitted = no chip. */
  fileChip?: string | null;
  /** While a run (or the landing's playback) is in progress, the mode pill's dot pulses. */
  running?: boolean;
}

export const REPLAY_PILL = 'Demo · recorded answers, real checks';
export const LIVE_PILL = 'Live · the AI runs on your computer, real checks';
/** The always-visible privacy phrase (wide screens). The pill's note carries the rest. */
export const PRIVACY_SHORT = 'Your file stays in this browser';

const REPLAY_HOW = 'This page plays back answers the AI gave earlier. The checks run again in your browser right now.';
const LIVE_HOW =
  'The AI that writes each calculation runs on your computer (the local Codex service). The checks run in your browser right now.';

/** Pure: the mode pill's note, as two short paragraphs: how answers are made, and what leaves the browser. */
export function modeNote(replay: boolean, rowsOn: boolean): { how: string; privacy: string } {
  return replay
    ? { how: REPLAY_HOW, privacy: `${PRIVACY_SHORT}. This demo sends nothing.` }
    : { how: LIVE_HOW, privacy: `${PRIVACY_SHORT}. The AI sees column names + ${rowsShort(rowsOn)}.` };
}

const NOTE_ID = 'fd-mode-note';

export function TelemetryBar({ engine, fileChip, running = false }: TelemetryBarProps) {
  const st = engine.state.value;
  const replay = st.mode === 'replay';
  const note = modeNote(replay, sendRows.value);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);

  // an open note closes when a pointer lands elsewhere or focus moves on (touch has no hover to rely on)
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    pill.current?.focus();
  };

  return (
    <header class="fd-tele">
      <div class="fd-tele__in">
        <a href="#/" aria-label="Undefined, home" class="fd-tele__home">
          <Mark />
          <span class="fd-tele__word">Undefined</span>
        </a>
        {fileChip && <span class="fd-tele__chip fd-mono">{fileChip}</span>}
        <div class={'fd-tele__mode' + (open ? ' is-open' : '')} ref={wrap} onKeyDown={onKeyDown}>
          <button
            ref={pill}
            type="button"
            class="fd-tele__pillbtn"
            aria-expanded={open ? 'true' : 'false'}
            aria-controls={NOTE_ID}
            onClick={() => setOpen(!open)}
          >
            <span class="fd-tele__pill">
              <span aria-hidden="true" class={'fd-tele__dot' + (running ? ' is-running' : '')} />
              {replay ? REPLAY_PILL : LIVE_PILL}
              <svg class="fd-tele__caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </button>
          <div id={NOTE_ID} class="fd-tele__note" hidden={!open}>
            <p>{note.how}</p>
            <p>{note.privacy}</p>
          </div>
        </div>
        <div class="fd-tele__right">
          <span class="fd-tele__privacy">{PRIVACY_SHORT}</span>
          <span class="fd-tele__count fd-mono">{formatSession(session.value)}</span>
          <LinkButton href="#/zen" variant="secondary" class="fd-tele__step">
            Step by step
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

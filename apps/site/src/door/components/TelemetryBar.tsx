/**
 * The white top bar: wordmark home link, file chip, mode pill (replay or live, honestly worded), the session check
 * counter and the privacy strip with the example-rows switch (wired to Engine.setSendSamples via state.ts).
 */
import type { Engine } from '@scasella/undefined-engine/types';
import { Mark } from '../icons';
import { formatSession, rowsShort, sendRows, session, setSendRows } from '../state';
import { Switch } from './Switch';
import './TelemetryBar.css';

export interface TelemetryBarProps {
  engine: Engine;
  /** e.g. "orders.csv · 332 rows · 10 columns"; omitted = no chip. */
  fileChip?: string | null;
  /** While a run (or the landing's playback) is in progress, the mode pill's dot pulses. */
  running?: boolean;
}

const REPLAY_TITLE = 'This page plays back answers the AI gave earlier. The checks run again in your browser right now.';
const LIVE_TITLE =
  'The AI that writes each calculation runs on your computer (the local Codex service). The checks run in your browser right now.';

export function TelemetryBar({ engine, fileChip, running = false }: TelemetryBarProps) {
  const st = engine.state.value;
  const replay = st.mode === 'replay';
  const on = sendRows.value;
  return (
    <header class="fd-tele">
      <div class="fd-tele__in">
        <a href="#/" aria-label="Undefined, home" class="fd-tele__home">
          <Mark />
          <span class="fd-tele__word">Undefined</span>
        </a>
        {fileChip && <span class="fd-tele__chip fd-mono">{fileChip}</span>}
        <span class="fd-tele__pill" title={replay ? REPLAY_TITLE : LIVE_TITLE}>
          <span aria-hidden="true" class={'fd-tele__dot' + (running ? ' is-running' : '')} />
          {replay ? 'Demo · recorded answers, real checks' : 'Live · the AI runs on your computer, real checks'}
        </span>
        <span class="fd-tele__count fd-mono">{formatSession(session.value)}</span>
        <span class="fd-tele__privacy">
          <span>
            Your file stays in this browser · AI sees column names + {rowsShort(on)}
            {replay && ' · this demo sends nothing'}
          </span>
          <Switch checked={on} onChange={setSendRows} label="Send 3 example rows to the AI" />
        </span>
      </div>
    </header>
  );
}

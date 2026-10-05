import { Component, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { copyText } from '../uiState';
import { splitTicks } from '../format';
import type { GateStatus } from '@scasella/undefined-engine/types';

export function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    setState((await copyText(text)) ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 1600);
  };
  return (
    <div class="copyblock">
      <code>{text}</code>
      <button type="button" class="btn btn-ghost btn-xs" onClick={copy} aria-label={`Copy ${label ?? text}`}>
        {state === 'copied' ? 'copied ✓' : state === 'failed' ? 'select & copy' : 'copy'}
      </button>
    </div>
  );
}

const STATUS_ICON: Record<GateStatus, string> = {
  pending: '○',
  running: '◐',
  pass: '✓',
  fail: '✕',
  skipped: '–',
};
const STATUS_WORD: Record<GateStatus, string> = {
  pending: 'waiting',
  running: 'running',
  pass: 'passed',
  fail: 'failed',
  skipped: 'skipped',
};

export function StatusIcon({ status }: { status: GateStatus }) {
  return (
    <span class={`sicon s-${status}`} aria-hidden="true">
      {STATUS_ICON[status]}
    </span>
  );
}
export const statusWord = (s: GateStatus): string => STATUS_WORD[s];

export function GeneratedBadge() {
  return (
    <span class="badge badge-generated" title="Written by the model, accepted by the gates. Read-only.">
      written by the model · read-only
    </span>
  );
}

/** A sheet's head: a sentence-case title, then (right-aligned) one status word and any controls. */
export function PanelHead({ title, id, status, tone, children }: { title: string; id?: string; status?: string; tone?: string; children?: ComponentChildren }) {
  return (
    <header class="panel-head">
      <h2 class="panel-title" id={id}>
        {title}
      </h2>
      <div class="panel-head-extra">
        {children}
        {status && <span class={`head-status${tone ? ` hs-${tone}` : ''}`}>{status}</span>}
      </div>
    </header>
  );
}

interface BoundaryProps {
  name: string;
  children: ComponentChildren;
}

/** Keeps one broken panel from taking the app down; offers a restart-style recovery. */
export class PanelBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static override getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown) {
    console.error(`[${this.props.name}]`, error);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div class="panel-crash" role="alert">
        <p class="crash-title">
          {this.props.name} crashed: <code>{error.name}: {error.message}</code>
        </p>
        <p class="muted">The program and its revisions are untouched. Restarts:</p>
        <div class="restarts">
          <button type="button" class="btn" onClick={() => this.setState({ error: null })}>
            Redraw this panel
          </button>
          <button type="button" class="btn btn-ghost" onClick={() => location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}

/** Text whose `backticked` names render as inline code (engine messages quote names that way). */
export function Ticks({ text }: { text: string }) {
  return (
    <>
      {splitTicks(text).map((p, i) => (p.code ? <code key={i} class="tick">{p.text}</code> : p.text))}
    </>
  );
}

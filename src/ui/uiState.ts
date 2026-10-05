/** UI-only state (selection, tabs, local notices). Business state lives in Engine.state. */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AttemptSelection } from './select';
import type { ImagePreview, RecordingPreview } from '../types';

export const selection = signal<AttemptSelection | null>(null);
export const lowerTab = signal<'revisions' | 'repo'>('revisions');
/** The data drawer (paste/drop data, bind it to a REPL variable). */
export const dataDrawerOpen = signal(false);
/**
 * Function whose spec card should be expanded, scrolled into view and focused. Mirrors the engine's
 * state.focusSpec (set by the "Edit the spec" restart); cleared by whoever consumed it.
 */
export const focusFn = signal<{ fn: string; nonce: number } | null>(null);

/**
 * Notices the UI raises itself (download/copy results). Engine notices arrive in state.notice;
 * the Engine has no method to clear those, so dismissal is tracked here by tone+text (the engine may
 * rebuild the notice object on every state change, so identity is not stable).
 */
export const localNotice = signal<{ tone: 'info' | 'error'; text: string } | null>(null);
export const dismissedNotice = signal<string | null>(null);
export const noticeKey = (n: { tone: string; text: string }): string => `${n.tone}:${n.text}`;

export function showNotice(tone: 'info' | 'error', text: string): void {
  localNotice.value = { tone, text };
}

/** Current time, re-read every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}

/**
 * Wall-clock ms since `key` was first seen while running; frozen once `running` turns false.
 * The contract carries no start timestamp for an attempt, so the clock starts when the UI first sees it.
 */
export function useElapsed(key: string, running: boolean): number {
  const start = useRef<{ key: string; at: number; frozen?: number }>({ key, at: Date.now() });
  if (start.current.key !== key) start.current = { key, at: Date.now() };
  const now = useNow(running, 100);
  if (!running && start.current.frozen === undefined) start.current.frozen = now - start.current.at;
  if (running) start.current.frozen = undefined;
  return start.current.frozen ?? now - start.current.at;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Suggested checks the user added this session, per function. suggestProperties stops offering a check once its
 * marker is in the spec, so the row that says how it went ("re-certified" / "fails it") is remembered here.
 */
export const addedChecks = signal<Array<{ fn: string; id: string; title: string; why: string }>>([]);

/** The Image menu's dialogs: share this session, load a recording, the local session log. */
export const shareOpen = signal(false);
export const loadRecordingOpen = signal(false);
export const sessionLogOpen = signal(false);
/**
 * A recording the user picked, dropped or fetched, previewed and waiting for Load / Cancel. (The `?recording=` offer
 * lives in the engine's state.recordingOffer; the same confirmation dialog shows it.)
 */
export const pendingRecording = signal<{ input: { text?: string; url?: string; source: string }; preview: RecordingPreview } | null>(null);
/**
 * A program image the user picked (Image → Import) or dropped, checked and waiting for Replace / Cancel: importing
 * replaces the whole program, so it is never done without this confirmation.
 */
export const pendingImport = signal<{ text: string; source: string; preview: Extract<ImagePreview, { ok: true }> } | null>(null);


/** The "Run it live" dialog (opened from the header's mode pill, and from Decide's "needs live mode" message). */
export const runLiveOpen = signal(false);

/**
 * Decide (docs/DECIDE-DESIGN.md §6): which rejection's Decide block should be open (`<genId>:<attempt>`, set by the
 * "Decide" button under an accepted verdict), and a starting choice for it (dev fixtures only).
 */
export const decideOpen = signal<string | null>(null);
export const decidePrefill = signal<{ choice?: string; expr?: string; throws?: boolean; reason?: string } | null>(null);
/**
 * What the gate panel's single status announcer says about a decision in progress (re-checking, re-certified). Read
 * by GatePanel's role="status" line; cleared when the panel moves to another generation.
 */
export const decideAnnouncement = signal<string | null>(null);

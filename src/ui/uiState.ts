/** UI-only state (selection, tabs, local notices). Business state lives in Engine.state. */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AttemptSelection } from './select';

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

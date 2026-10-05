import { readFileSync } from 'node:fs';
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecordingText } from '../share/source';
import type { Engine, Recording } from '@scasella/undefined-engine/types';
import { ShareDialog } from './components/Share';
import { shareOpen } from './uiState';
import { FakeDocument, FakeNode, toHtml } from './fakeDom.testutil';

const parsed = parseRecordingText(readFileSync(new URL('../../public/recordings/fibonacci.json', import.meta.url), 'utf8'));
if (!parsed.ok) throw new Error(parsed.error);
const rec: Recording = parsed.recording;
const engine = { exportRecording: () => rec } as unknown as Engine;

const g = globalThis as Record<string, unknown>;
let saved: Record<string, unknown>;
beforeEach(() => {
  saved = { document: g.document, location: g.location };
  g.document = new FakeDocument();
  g.location = { href: 'https://example.github.io/undefined/?fixture=1' };
  shareOpen.value = true;
});
afterEach(() => {
  g.document = saved.document;
  g.location = saved.location;
  shareOpen.value = false;
});

function mount(props: Record<string, unknown>): FakeNode {
  const root = new FakeDocument().createElement('div');
  render(h(ShareDialog, { engine, ...props } as never), root as unknown as Element);
  return root;
}

/** The dialog's markup before one-click sharing existed (captured from the previous Share.tsx with this harness). */
const MANUAL_FLOW = `<div><dialog class="dialog sheet" aria-labelledby="share-title"><header class="sheet-head"><h2 id="share-title">Share this session</h2><button type="button" class="btn btn-ghost btn-xs sheet-close" aria-label="Close: Share this session">✕</button></header><p class="muted small">Someone who opens your link replays what the model wrote here, and all four gates judge it again, live, in their browser.</p><ol class="share-steps"><li><h3>Download the recording</h3><p class="small mono share-what">fibonacci — recorded live session · 1 function (fibonacci) · 3 candidates · 1 call</p><button type="button" class="btn btn-primary">Download recording</button><span class="muted small share-file"> undefined-session.json</span><p class="small">The recording includes your spec and test code and any dataset rows used in the session, with what the model was asked and what it wrote (prompts and candidates) and the calls you typed; nothing else.</p></li><li><h3>Host it</h3><p class="small">Host it anywhere that serves the raw file with CORS (a GitHub gist's Raw URL or raw.githubusercontent.com both work).</p></li><li><h3>Make the link</h3><label class="field"><span class="small">The raw URL of your hosted file</span><input class="mono" type="url" inputMode="url" autocomplete="off" placeholder="https://gist.githubusercontent.com/you/…/raw" value=""></input></label><p class="muted small">The link appears here. Nothing is fetched until someone opens it, and they are asked before anything loads.</p></li></ol></dialog></div>`;

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ShareDialog', () => {
  it('without an endpoint is byte-for-byte the three-step download-and-host flow', () => {
    expect(toHtml(mount({}))).toBe(MANUAL_FLOW);
    expect(toHtml(mount({ endpoint: null }))).toBe(MANUAL_FLOW);
  });

  it('with an endpoint adds Create link, names the host, and uploads only when pressed', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const copied: string[] = [];
    const hash = 'ab'.repeat(32);
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ hash, url: `https://share.example.workers.dev/${hash}` }), { status: 201 });
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => void copied.push(t) } });
    try {
      const root = mount({ endpoint: 'https://share.example.workers.dev' });
      const html = toHtml(root);
      expect(html).toContain('share.example.workers.dev');
      expect(html).toContain('What leaves your browser');
      // the manual flow is still there, unchanged
      expect(html).toContain('<ol class="share-steps">');
      expect(calls).toHaveLength(0);

      root.find('button', 'Create link')!.fire('click');
      for (let i = 0; i < 5; i++) await tick();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('https://share.example.workers.dev/');
      expect(calls[0]!.init.method).toBe('POST');
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual(JSON.parse(JSON.stringify(rec)));
      const link = `https://example.github.io/undefined/?recording=${encodeURIComponent(`https://share.example.workers.dev/${hash}`)}`;
      expect(copied).toEqual([link]);
      expect(root.find('code')!.textContent).toBe(link);
      // the loader reads the link back as that URL
      const { recordingParamFromLocation } = await import('../share/source');
      expect(recordingParamFromLocation(new URL(link).search, '')).toBe(`https://share.example.workers.dev/${hash}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Message authentication between the main thread and the sandbox workers (gateRunner.ts, runtime.ts, the worker
 * shells' lockWorkerMessaging). Fake workers post forged messages; none of them may be acted on.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GateResult } from '@scasella/undefined-engine/types';
import { runExecutionGates, type ExecGateInput, type GateWorkerPort, type ToWorker } from './gateRunner';
import { authenticatedRuntimePort, Runtime, type RawWorker } from './runtime';
import { createDispatcher, type RuntimeRequest } from './replCore';
import { lockWorkerMessaging } from '@scasella/undefined-engine/sandbox/mask';
import { hasNonce, newNonce, wrapperSource } from './spawn';

const INPUT: ExecGateInput = { name: 'f', js: 'function f(x) { return 0; }', testsJs: '', propertiesJs: '', budgetMs: 500, seed: 1 };
const pass = (gate: GateResult['gate']): GateResult => ({ gate, status: 'pass', ms: 1, summary: 'ok', diagnostics: [] });
const fail = (gate: GateResult['gate']): GateResult => ({ gate, status: 'fail', ms: 1, summary: '0/1 tests passed', headline: 'Rejected: f(1) returned 0, expected 1', diagnostics: [] });
const ALL_PASS = [pass('tests'), pass('properties'), pass('invariants')];

/** A gate worker the test drives by hand: `script(post, run)` runs once the run message arrives. */
function fakeGateWorker(script: (post: (m: unknown) => void, run: ToWorker) => void): { port: GateWorkerPort; terminated: () => boolean } {
  let onMessage: ((d: unknown) => void) | null = null;
  let terminated = false;
  const port: GateWorkerPort = {
    postMessage: (m) => setTimeout(() => script((x) => !terminated && onMessage?.(x), m), 0),
    terminate: () => {
      terminated = true;
    },
    onMessage: (cb) => {
      onMessage = cb;
    },
    onError: () => undefined,
  };
  return { port, terminated: () => terminated };
}

describe('gate runner: only nonce-stamped messages count', () => {
  it('puts a fresh 128-bit nonce in every run message', async () => {
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      const w = fakeGateWorker((post, run) => {
        seen.push(run.nonce);
        post({ type: 'done', results: ALL_PASS, nonce: run.nonce });
      });
      await runExecutionGates(INPUT, undefined, { createWorker: () => w.port });
    }
    expect(seen[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(seen[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('a forged all-pass "done" (no nonce, wrong nonce) never settles the run; the real verdict does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gates: GateResult[] = [];
    const w = fakeGateWorker((post, run) => {
      post({ type: 'done', results: ALL_PASS }); // what test code posting via self.postMessage would send
      post({ type: 'done', results: ALL_PASS, nonce: 'guess' });
      post({ type: 'gate', result: pass('tests'), nonce: newNonce() });
      post({ type: 'enter', label: 'f(1)' }); // a forged enter must not start the watchdog's call budget either
      post({ type: 'gate', result: fail('tests'), nonce: run.nonce });
      post({ type: 'done', results: [fail('tests')], nonce: run.nonce });
    });
    const results = await runExecutionGates(INPUT, (r) => gates.push(r), { createWorker: () => w.port });
    expect(results.map((r) => [r.gate, r.status])).toEqual([['tests', 'fail']]);
    expect(gates.map((r) => r.status)).toEqual(['fail']);
    expect(w.terminated()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1); // logged once per run, not once per forged message
    warn.mockRestore();
  });

  it('a worker that only ever forges is stopped by the watchdog, never accepted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = fakeGateWorker((post) => {
      post({ type: 'done', results: ALL_PASS, nonce: undefined });
      post({ type: 'error', message: 'forged crash' });
    });
    const results = await runExecutionGates({ ...INPUT, overallCapMs: 120 }, undefined, { createWorker: () => w.port });
    expect(results.some((r) => r.status === 'fail')).toBe(true);
    expect(results.find((r) => r.gate === 'invariants')).toMatchObject({ status: 'fail', diagnostics: [{ invariant: 'bounded' }] });
    expect(results.every((r) => r.status !== 'pass' || r.gate !== 'invariants')).toBe(true);
    warn.mockRestore();
  });

  it('a forged message after the real verdict changes nothing', async () => {
    const w = fakeGateWorker((post, run) => {
      post({ type: 'done', results: [fail('tests')], nonce: run.nonce });
      post({ type: 'done', results: ALL_PASS, nonce: run.nonce });
    });
    const results = await runExecutionGates(INPUT, undefined, { createWorker: () => w.port });
    expect(results.map((r) => r.status)).toEqual(['fail']);
  });
});

/** A raw Worker stand-in running the real dispatcher; `inject` lets a test post as if from inside the worker. */
function rawRuntimeWorker(): { raw: RawWorker; sent: unknown[]; inject: (m: unknown) => void } {
  const sent: unknown[] = [];
  let nonce: string | null = null;
  const raw: RawWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(m: unknown) {
      sent.push(m);
      setTimeout(() => {
        const d = m as { type: string; nonce?: string };
        if (d.type === 'init') {
          nonce = d.nonce ?? null;
          return;
        }
        dispatch(m as RuntimeRequest);
      }, 0);
    },
    terminate() {},
  };
  const deliver = (m: unknown) => raw.onmessage?.({ data: m } as MessageEvent);
  const dispatch = createDispatcher((m) => deliver({ ...m, nonce }));
  return { raw, sent, inject: deliver };
}

describe('runtime: replies must carry the worker nonce', () => {
  it('sends init with the nonce first, strips the nonce from genuine replies', async () => {
    const w = rawRuntimeWorker();
    const rt = new Runtime({ workerFactory: () => authenticatedRuntimePort(w.raw, 'n0nce') });
    expect(await rt.evaluate('1 + 1')).toMatchObject({ kind: 'value', shown: '2' });
    expect(w.sent[0]).toEqual({ type: 'init', nonce: 'n0nce' });
    expect((w.sent[1] as { nonce?: unknown }).nonce).toBeUndefined(); // requests do not repeat the nonce
    rt.dispose();
  });

  it('a forged reply (right id, no/wrong nonce) is ignored; the real one wins', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = rawRuntimeWorker();
    const rt = new Runtime({ workerFactory: () => authenticatedRuntimePort(w.raw, 'n0nce') });
    await rt.evaluate('0');
    const pending = rt.evaluate('6 * 7');
    // what candidate code posting from inside the worker could send, for every id it might guess
    for (let id = 0; id < 10; id++) {
      w.inject({ type: 'reply', id, ok: true, result: { kind: 'value', shown: 'PWNED', ms: 0, calls: [] } });
      w.inject({ type: 'reply', id, ok: true, result: { kind: 'value', shown: 'PWNED', ms: 0, calls: [] }, nonce: 'guess' });
    }
    w.inject({ type: 'enter', fn: 'x', call: 'x()' });
    expect(await pending).toMatchObject({ kind: 'value', shown: '42' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    rt.dispose();
  });
});

describe('worker messaging lock', () => {
  it('replaces postMessage/close and pins onmessage at null, non-configurably', () => {
    const real = vi.fn();
    const scope: Record<string, unknown> = { postMessage: real, close: vi.fn(), onmessage: null, onmessageerror: null };
    expect(lockWorkerMessaging(scope).sort()).toEqual(['close', 'onmessage', 'onmessageerror', 'postMessage']);
    expect(() => (scope.postMessage as () => void)()).toThrow(/postMessage is not available/);
    expect(() => (scope.close as () => void)()).toThrow(/close is not available/);
    expect(() => {
      'use strict';
      scope.onmessage = () => undefined;
    }).toThrow(TypeError);
    expect(scope.onmessage).toBeNull();
    expect(() => Object.defineProperty(scope, 'postMessage', { value: real })).toThrow(TypeError);
    expect(real).not.toHaveBeenCalled();
  });
});

describe('spawn helpers', () => {
  it('the blob wrapper is a single static import of the absolute worker URL', () => {
    expect(wrapperSource('http://localhost:5173/src/sandbox/gateWorker.ts?worker_file&type=module')).toBe(
      'import "http://localhost:5173/src/sandbox/gateWorker.ts?worker_file&type=module";\n',
    );
    expect(wrapperSource('https://x.test/a"b.js')).toBe('import "https://x.test/a\\"b.js";\n');
  });

  it('hasNonce is exact', () => {
    expect(hasNonce({ nonce: 'a' }, 'a')).toBe(true);
    expect(hasNonce({ nonce: 'A' }, 'a')).toBe(false);
    expect(hasNonce({}, 'a')).toBe(false);
    expect(hasNonce(null, 'a')).toBe(false);
    expect(hasNonce('a', 'a')).toBe(false);
  });
});

import { spawn as nodeSpawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProgressLine } from '@scasella/undefined-engine/types';
import { routeFor } from './codexPlugin';
import {
  OUTPUT_SCHEMA,
  buildCodexArgs,
  checkRequestOrigin,
  classifyFailure,
  isLoopbackAddress,
  createCodexService,
  createSerialQueue,
  filterStderrLine,
  handleRequest,
  mapCodexEvent,
  parseAnswer,
  parseCodexVersion,
  resolveConfig,
  type RunOutcome,
  type SpawnFn,
} from './codexService';

// ───────────────────────── pure parts ─────────────────────────

describe('config and command line', () => {
  it('reads env overrides with defaults', () => {
    expect(resolveConfig({})).toEqual({ bin: 'codex', model: 'gpt-6-luna', effort: 'low', timeoutMs: 120_000 });
    expect(resolveConfig({ UNDEFINED_CODEX_BIN: '/x/codex', UNDEFINED_MODEL: 'm', UNDEFINED_EFFORT: 'medium', UNDEFINED_TIMEOUT_MS: '500' })).toEqual({
      bin: '/x/codex',
      model: 'm',
      effort: 'medium',
      timeoutMs: 500,
    });
    expect(resolveConfig({ UNDEFINED_TIMEOUT_MS: 'soon' }).timeoutMs).toBe(120_000);
  });

  it('builds the exact codex exec flags', () => {
    const args = buildCodexArgs(resolveConfig({}), { workDir: '/t/work', schemaPath: '/t/schema.json', outPath: '/t/out.json' });
    expect(args.join(' ')).toBe(
      'exec - --model gpt-6-luna --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config -C /t/work --output-schema /t/schema.json -o /t/out.json --json -c model_reasoning_effort=low',
    );
  });

  it('schema permits exactly {body, notes}', () => {
    expect(OUTPUT_SCHEMA).toEqual({
      type: 'object',
      properties: { body: { type: 'string' }, notes: { type: 'string' } },
      required: ['body', 'notes'],
      additionalProperties: false,
    });
  });
});

describe('mapCodexEvent', () => {
  const texts = (e: unknown) => mapCodexEvent(e).map((p) => p.text);

  it('maps lifecycle events and token usage', () => {
    expect(texts({ type: 'thread.started', thread_id: 'x' })).toEqual(['session started']);
    expect(texts({ type: 'turn.started' })).toEqual(['turn started']);
    expect(texts({ type: 'turn.completed', usage: { input_tokens: 19567, output_tokens: 106, reasoning_output_tokens: 0 } })).toEqual([
      'model replied · 106 output tokens · 19567 input tokens',
    ]);
    expect(mapCodexEvent({ type: 'turn.started' })[0]!.channel).toBe('event');
  });

  it('surfaces attempted commands, file changes and tool calls', () => {
    expect(texts({ type: 'item.started', item: { type: 'command_execution', command: '/bin/zsh -lc ls', status: 'in_progress' } })).toEqual([
      'codex attempted a command: /bin/zsh -lc ls',
    ]);
    expect(texts({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed' } })).toEqual([
      'command ended (completed, exit 0)',
    ]);
    expect(texts({ type: 'item.started', item: { type: 'file_change', changes: [{ path: 'a.ts' }] } })).toEqual(['codex attempted to change files: a.ts']);
    expect(texts({ type: 'item.started', item: { type: 'mcp_tool_call', server: 's', tool: 't' } })).toEqual(['codex attempted a tool call: s.t']);
  });

  it('summarises the answer instead of dumping it, and shows other messages', () => {
    expect(texts({ type: 'item.completed', item: { type: 'agent_message', text: '{"body":"return 1;","notes":"n"}' } })).toEqual([
      'model answered · body 9 chars',
    ]);
    expect(texts({ type: 'item.completed', item: { type: 'agent_message', text: 'I will list the files.' } })).toEqual(['model: I will list the files.']);
  });

  it('reports errors and ignores unknown or malformed events', () => {
    expect(texts({ type: 'error', message: 'Reconnecting... 2/5' })).toEqual(['error: Reconnecting... 2/5']);
    expect(texts({ type: 'turn.failed', error: { message: 'boom' } })).toEqual(['turn failed: boom']);
    expect(texts({ type: 'something.new' })).toEqual([]);
    expect(texts(null)).toEqual([]);
    expect(texts('x')).toEqual([]);
  });
});

describe('filterStderrLine', () => {
  it('strips timestamps and ANSI, drops noise', () => {
    expect(filterStderrLine('2026-10-04T12:25:04.007831Z ERROR codex_api: 401 Unauthorized')).toBe('ERROR codex_api: 401 Unauthorized');
    expect(filterStderrLine('\x1b[1mmodel:\x1b[0m gpt-6-luna')).toBe('model: gpt-6-luna');
    expect(filterStderrLine('   ')).toBeNull();
    expect(filterStderrLine('--------')).toBeNull();
    expect(filterStderrLine('Reading prompt from stdin...')).toBeNull();
  });
});

describe('classifyFailure', () => {
  const cfg = { bin: 'codex', timeoutMs: 120_000 };
  const base: RunOutcome = { exitCode: 0, signal: null, timedOut: false, aborted: false, errorTail: [] };

  it('success is not a failure', () => {
    expect(classifyFailure(base, cfg)).toBeNull();
  });
  it('ENOENT → codex_missing with install fix', () => {
    const e = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    expect(classifyFailure({ ...base, exitCode: null, spawnError: e }, cfg)).toMatchObject({
      code: 'codex_missing',
      fix: ['npm i -g @openai/codex', 'codex login'],
    });
  });
  it('timeout and abort win over the exit code', () => {
    expect(classifyFailure({ ...base, exitCode: null, signal: 'SIGKILL', timedOut: true }, cfg)?.code).toBe('timeout');
    expect(classifyFailure({ ...base, exitCode: null, signal: 'SIGKILL', aborted: true }, cfg)?.code).toBe('aborted');
  });
  it('auth patterns → not_logged_in', () => {
    const r = classifyFailure({ ...base, exitCode: 1, errorTail: ['unexpected status 401 Unauthorized: Missing bearer'] }, cfg);
    expect(r).toMatchObject({ code: 'not_logged_in', fix: ['codex login'] });
  });
  it('other nonzero exits → codex_failed with the stderr tail', () => {
    const r = classifyFailure({ ...base, exitCode: 2, errorTail: ['a', 'b', 'model not supported'] }, cfg);
    expect(r?.code).toBe('codex_failed');
    expect(r?.message).toContain('exit code 2');
    expect(r?.message).toContain('model not supported');
  });
});

describe('parseAnswer / parseCodexVersion', () => {
  it('validates the answer shape', () => {
    expect(parseAnswer('{"body":"return 1;","notes":"n"}')).toEqual({ ok: true, value: { body: 'return 1;', notes: 'n' } });
    expect(parseAnswer('nope').ok).toBe(false);
    expect(parseAnswer('[1]').ok).toBe(false);
    expect(parseAnswer('{"body":1,"notes":"n"}').ok).toBe(false);
  });
  it('parses the version', () => {
    expect(parseCodexVersion('codex-cli 0.159.2\n')).toBe('0.159.2');
    expect(parseCodexVersion('garbage')).toBeNull();
  });
});

describe('createSerialQueue', () => {
  it('runs tasks one at a time in order and reports queue depth', async () => {
    const q = createSerialQueue();
    const log: string[] = [];
    const queued: number[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([
      q.run(task('a', 30), (n) => queued.push(n)),
      q.run(task('b', 5), (n) => queued.push(n)),
      q.run(task('c', 1), (n) => queued.push(n)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(queued).toEqual([1, 2]);
    expect(q.size).toBe(0);
  });
  it('keeps going after a task rejects', async () => {
    const q = createSerialQueue();
    const a = q.run(async () => {
      throw new Error('x');
    });
    const b = q.run(async () => 'ok');
    await expect(a).rejects.toThrow('x');
    await expect(b).resolves.toBe('ok');
  });
});

describe('request guards and routing', () => {
  const local = { remoteAddress: '127.0.0.1', requireOrigin: false };
  it('accepts loopback hosts with same or (for health) no origin', () => {
    expect(checkRequestOrigin({ host: 'localhost:5173' }, local)).toBeNull();
    expect(checkRequestOrigin({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' }, local)).toBeNull();
    expect(checkRequestOrigin({ host: '[::1]:5173' }, { ...local, remoteAddress: '::1' })).toBeNull();
    expect(checkRequestOrigin({ host: 'localhost:5173', origin: 'http://localhost:5173' }, { remoteAddress: '::ffff:127.0.0.1', requireOrigin: true })).toBeNull();
  });
  it('rejects other hosts and cross origins', () => {
    expect(checkRequestOrigin({ host: 'evil.example:5173' }, local)).toMatch(/not a loopback/);
    expect(checkRequestOrigin({ host: 'localhost:5173', origin: 'http://evil.example' }, local)).toMatch(/does not match/);
    expect(checkRequestOrigin({ host: 'localhost:5173', origin: 'http://localhost:9999' }, local)).toMatch(/does not match/);
    expect(checkRequestOrigin({}, local)).toMatch(/missing/);
  });
  it('requires an Origin when asked (POST /generate)', () => {
    expect(checkRequestOrigin({ host: 'localhost:5173' }, { ...local, requireOrigin: true })).toBe('missing Origin header');
    expect(checkRequestOrigin({ host: 'localhost:5173', origin: 'null' }, { ...local, requireOrigin: true })).toBe('bad Origin header');
  });
  it('rejects peers that are not loopback addresses, whatever the Host header says', () => {
    expect(checkRequestOrigin({ host: 'localhost:5173', origin: 'http://localhost:5173' }, { remoteAddress: '192.168.1.20', requireOrigin: true })).toMatch(
      /peer 192\.168\.1\.20 is not a loopback address/,
    );
    expect(checkRequestOrigin({ host: 'localhost:5173' }, { remoteAddress: undefined, requireOrigin: false })).toMatch(/not a loopback address/);
  });
  it('isLoopbackAddress', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ['10.0.0.1', '::ffff:10.0.0.1', '128.0.0.1', '127.0.0.256', 'fe80::1', '', undefined]) expect(isLoopbackAddress(a)).toBe(false);
  });
  it('routes /generate and /generate/health, also under a base path', () => {
    expect(routeFor('/generate', '/')).toBe('generate');
    expect(routeFor('/generate/health?x=1', '/')).toBe('health');
    expect(routeFor('/app/generate', '/app/')).toBe('generate');
    expect(routeFor('/app/generate/health', '/app/')).toBe('health');
    expect(routeFor('/generated.js', '/')).toBeNull();
    expect(routeFor('/src/generate', '/')).toBeNull();
  });
});

// ───────────────────────── real subprocesses (a fake codex binary) ─────────────────────────

/** Behaves like the parts of codex the service uses. The prompt selects a scenario. */
const FAKE_CODEX = `#!${process.execPath}
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const log = (o) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\\n');
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
if (args[0] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') {
  if (process.env.FAKE_LOGGED_OUT) { console.error('Not logged in'); process.exit(1); }
  console.log('Logged in using ChatGPT'); process.exit(0);
}
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) prompt += c;
const out = args[args.indexOf('-o') + 1];
const schema = readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8');
const workEntries = readdirSync(args[args.indexOf('-C') + 1]);
log({ ev: 'start', at: Date.now(), args, schema, workEntries, prompt });
say({ type: 'thread.started', thread_id: 't' });
say({ type: 'turn.started' });
const mode = /MODE:(\\w+)/.exec(prompt)?.[1] ?? 'ok';
if (mode === 'hang') {
  const g = spawn('sleep', ['30'], { stdio: 'ignore' });
  log({ ev: 'grandchild', pid: g.pid });
  setInterval(() => {}, 1000);
} else if (mode === 'fail') {
  console.error('2026-10-04T12:00:00.000Z ERROR something broke');
  console.error('model not supported');
  process.exit(2);
} else if (mode === 'auth') {
  say({ type: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer' });
  say({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } });
  process.exit(1);
} else {
  if (mode === 'cmd') {
    say({ type: 'item.started', item: { type: 'command_execution', command: 'cat secrets.txt', status: 'in_progress' } });
  }
  await new Promise((r) => setTimeout(r, mode === 'slow' ? 300 : 20));
  const answer = mode === 'bad' ? 'not json' : mode === 'shape' ? '{"body":1}' : JSON.stringify({ body: 'return 42;', notes: 'constant' });
  say({ type: 'item.completed', item: { type: 'agent_message', text: answer } });
  say({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 7 } });
  writeFileSync(out, answer);
  log({ ev: 'end', at: Date.now() });
}
`;

describe('codex service with a real subprocess', () => {
  let dir: string;
  let bin: string;
  let logPath: string;
  const envFor = (extra: Record<string, string> = {}) => ({ ...process.env, UNDEFINED_CODEX_BIN: bin, FAKE_LOG: logPath, ...extra });
  const readLog = async () =>
    (await readFile(logPath, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'undefined-fake-codex-'));
    bin = join(dir, 'codex.mjs');
    logPath = join(dir, 'log.jsonl');
    await writeFile(bin, FAKE_CODEX);
    await chmod(bin, 0o755);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('health reports version, model, effort', async () => {
    const svc = createCodexService({ env: envFor() });
    expect(await svc.health()).toEqual({ ok: true, codexVersion: '9.9.9', model: 'gpt-6-luna', effort: 'low' });
  });

  it('health reports not_logged_in and codex_missing', async () => {
    const out = await createCodexService({ env: envFor({ FAKE_LOGGED_OUT: '1' }) }).health();
    expect(out).toMatchObject({ ok: false, codexVersion: '9.9.9', problem: { code: 'not_logged_in', fix: ['codex login'] } });
    const missing = await createCodexService({ env: envFor({ UNDEFINED_CODEX_BIN: join(dir, 'nope') }) }).health();
    expect(missing).toMatchObject({ ok: false, problem: { code: 'codex_missing' } });
  });

  it('generates: feeds the prompt on stdin, streams progress, returns the answer, cleans up', async () => {
    await rm(logPath, { force: true });
    const before = new Set((await readdir(tmpdir())).filter((f) => f.startsWith('undefined-codex-')));
    const svc = createCodexService({ env: envFor() });
    const seen: ProgressLine[] = [];
    const r = await svc.generate('please write it', (p) => seen.push(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toMatchObject({ body: 'return 42;', notes: 'constant', model: 'gpt-6-luna', codexVersion: '9.9.9', source: 'live' });
    expect(r.result.progress).toEqual(seen);
    const texts = seen.map((p) => p.text);
    expect(texts).toContain('session started');
    expect(texts).toContain('model replied · 7 output tokens · 10 input tokens');
    expect(seen.every((p, i) => i === 0 || p.t >= seen[i - 1]!.t)).toBe(true);
    const [start] = await readLog();
    expect(start!.prompt).toBe('please write it');
    expect(start!.workEntries).toEqual([]);
    expect(JSON.parse(start!.schema as string)).toEqual(OUTPUT_SCHEMA);
    const after = (await readdir(tmpdir())).filter((f) => f.startsWith('undefined-codex-') && !before.has(f));
    expect(after).toEqual([]);
  });

  it('surfaces attempted commands', async () => {
    const r = await createCodexService({ env: envFor() }).generate('MODE:cmd', () => {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.progress.map((p) => p.text)).toContain('codex attempted a command: cat secrets.txt');
  });

  it('serialises concurrent requests and says so', async () => {
    await rm(logPath, { force: true });
    const svc = createCodexService({ env: envFor() });
    const second: ProgressLine[] = [];
    const [a, b] = await Promise.all([svc.generate('MODE:slow', () => {}), svc.generate('MODE:slow', (p) => second.push(p))]);
    expect(a.ok && b.ok).toBe(true);
    expect(second[0]).toMatchObject({ text: 'queued behind 1 request(s)', channel: 'system' });
    const log = await readLog();
    expect(log.map((e) => e.ev)).toEqual(['start', 'end', 'start', 'end']);
    expect(log[2]!.at as number).toBeGreaterThanOrEqual(log[1]!.at as number);
  });

  it('bad output → bad_output', async () => {
    const svc = createCodexService({ env: envFor() });
    expect(await svc.generate('MODE:bad', () => {})).toMatchObject({ ok: false, error: { code: 'bad_output' } });
    expect(await svc.generate('MODE:shape', () => {})).toMatchObject({ ok: false, error: { code: 'bad_output' } });
  });

  it('nonzero exit → codex_failed with stderr; 401 → not_logged_in', async () => {
    const svc = createCodexService({ env: envFor() });
    const failed = await svc.generate('MODE:fail', () => {});
    expect(failed).toMatchObject({ ok: false, error: { code: 'codex_failed' } });
    if (!failed.ok) expect(failed.error.message).toContain('model not supported');
    expect(await svc.generate('MODE:auth', () => {})).toMatchObject({ ok: false, error: { code: 'not_logged_in', fix: ['codex login'] } });
  });

  it('missing binary and logged-out codex fail fast without running exec', async () => {
    await rm(logPath, { force: true });
    const missing = await createCodexService({ env: envFor({ UNDEFINED_CODEX_BIN: join(dir, 'nope') }) }).generate('x', () => {});
    expect(missing).toMatchObject({ ok: false, error: { code: 'codex_missing', fix: ['npm i -g @openai/codex', 'codex login'] } });
    const out = await createCodexService({ env: envFor({ FAKE_LOGGED_OUT: '1' }) }).generate('x', () => {});
    expect(out).toMatchObject({ ok: false, error: { code: 'not_logged_in' } });
    expect(await readLog()).toEqual([]);
  });

  it('timeout kills the whole process group', async () => {
    await rm(logPath, { force: true });
    const svc = createCodexService({ env: envFor({ UNDEFINED_TIMEOUT_MS: '600' }) });
    const t0 = Date.now();
    const r = await svc.generate('MODE:hang', () => {});
    expect(r).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(Date.now() - t0).toBeLessThan(5000);
    const grand = (await readLog()).find((e) => e.ev === 'grandchild');
    expect(grand).toBeDefined();
    await new Promise((res) => setTimeout(res, 100));
    expect(() => process.kill(grand!.pid as number, 0)).toThrow(); // ESRCH: the grandchild is gone too
  });

  it('abort (client disconnect) kills the process', async () => {
    const svc = createCodexService({ env: envFor() });
    const ac = new AbortController();
    const p = svc.generate('MODE:hang', (line) => {
      if (line.text === 'turn started') ac.abort();
    }, ac.signal);
    expect(await p).toMatchObject({ ok: false, error: { code: 'aborted' } });
  });

  it('a client that disconnects during the health check never gets a codex exec spawned', async () => {
    const ac = new AbortController();
    const spawned: string[][] = [];
    const spawn: SpawnFn = (cmd, args, opts) => {
      spawned.push(args);
      if (args[0] === 'login') ac.abort(); // the client goes away while the health check runs
      return nodeSpawn(cmd, args, opts);
    };
    const r = await createCodexService({ env: envFor(), spawn }).generate('please write it', () => {}, ac.signal);
    expect(r).toMatchObject({ ok: false, error: { code: 'aborted' } });
    expect(spawned.map((a) => a[0])).toEqual(['--version', 'login']);
  });

  it('an abort that lands between the checks and listening still stops codex', async () => {
    const ac = new AbortController();
    const spawn: SpawnFn = (cmd, args, opts) => {
      const child = nodeSpawn(cmd, args, opts);
      if (args[0] === 'exec') ac.abort(); // already aborted when runCodex starts listening
      return child;
    };
    const r = await createCodexService({ env: envFor(), spawn }).generate('MODE:slow', () => {}, ac.signal);
    expect(r).toMatchObject({ ok: false, error: { code: 'aborted' } });
  });

  it('dispose() kills a running codex (dev-server shutdown)', async () => {
    const svc = createCodexService({ env: envFor() });
    const r = await svc.generate('MODE:hang', (line) => {
      if (line.text === 'turn started') svc.dispose();
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'codex_failed' } });
    if (!r.ok) expect(r.error.message).toContain('SIGKILL');
  });

  describe('over HTTP', () => {
    let server: http.Server;
    let port: number;
    beforeAll(async () => {
      const svc = createCodexService({ env: envFor() });
      server = http.createServer((req, res) => {
        const route = routeFor(req.url, '/');
        if (!route) {
          res.statusCode = 404;
          res.end();
          return;
        }
        void handleRequest(svc, route, req, res);
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      await new Promise((r) => server.close(r));
    });

    const same = () => ({ origin: `http://localhost:${port}` });
    const request = (path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
      new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { host: `localhost:${port}`, ...opts.headers } }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), text }));
        });
        req.on('error', reject);
        req.end(opts.body);
      });

    it('GET /generate/health → JSON', async () => {
      const r = await request('/generate/health');
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).toMatchObject({ ok: true, codexVersion: '9.9.9' });
    });

    it('POST /generate → SSE progress then result', async () => {
      const r = await request('/generate', { method: 'POST', headers: { 'content-type': 'application/json', ...same() }, body: JSON.stringify({ prompt: 'go' }) });
      expect(r.status).toBe(200);
      expect(r.type).toContain('text/event-stream');
      const events = r.text
        .trim()
        .split('\n\n')
        .map((block) => {
          const [ev, data] = block.split('\n');
          return { event: ev!.replace('event: ', ''), data: JSON.parse(data!.replace('data: ', '')) as Record<string, unknown> };
        });
      expect(events.filter((e) => e.event === 'progress').length).toBeGreaterThan(2);
      const last = events[events.length - 1]!;
      expect(last.event).toBe('result');
      expect(last.data).toMatchObject({ body: 'return 42;', source: 'live' });
    });

    it('rejects foreign hosts/origins, oversize and malformed bodies', async () => {
      expect((await request('/generate/health', { headers: { host: 'evil.example' } })).status).toBe(403);
      expect((await request('/generate', { method: 'POST', headers: { origin: 'http://evil.example' }, body: '{"prompt":"x"}' })).status).toBe(403);
      expect((await request('/generate', { method: 'POST', headers: same(), body: JSON.stringify({ prompt: 'x'.repeat(210 * 1024) }) })).status).toBe(413);
      expect((await request('/generate', { method: 'POST', headers: same(), body: 'nope' })).status).toBe(400);
      expect((await request('/generate', { method: 'GET', headers: same() })).status).toBe(405);
    });

    it('POST /generate requires an Origin header; GET /generate/health does not', async () => {
      const r = await request('/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"x"}' });
      expect(r.status).toBe(403);
      expect(JSON.parse(r.text)).toMatchObject({ message: 'Forbidden: missing Origin header.' });
      expect((await request('/generate/health')).status).toBe(200);
    });
  });
});

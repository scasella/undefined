/**
 * Local generation service: one `codex exec` subprocess per request, serialised, streamed back as SSE.
 *
 * The service only turns a prompt into {body, notes}. It does no compiling, testing or caching and touches no
 * files beyond its own temp dir. Mounted as Vite dev-server middleware by server/codexPlugin.ts.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateError, GenerateResult, ProgressLine, ServiceHealth } from '../src/types';

// ───────────────────────── configuration ─────────────────────────

export interface ServiceConfig {
  bin: string;
  model: string;
  effort: string;
  timeoutMs: number;
}

export function resolveConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const timeout = Number(env.UNDEFINED_TIMEOUT_MS);
  return {
    bin: env.UNDEFINED_CODEX_BIN || 'codex',
    model: env.UNDEFINED_MODEL || 'gpt-6-luna',
    effort: env.UNDEFINED_EFFORT || 'low',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
  };
}

/** The model may answer with exactly this object and nothing else. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { body: { type: 'string' }, notes: { type: 'string' } },
  required: ['body', 'notes'],
  additionalProperties: false,
} as const;

/**
 * `--ignore-user-config` skips $CODEX_HOME/config.toml (the user's default effort is very slow) while auth
 * still comes from CODEX_HOME; effort is then set explicitly.
 */
export function buildCodexArgs(cfg: ServiceConfig, paths: { workDir: string; schemaPath: string; outPath: string }): string[] {
  return [
    'exec', '-',
    '--model', cfg.model,
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '-C', paths.workDir,
    '--output-schema', paths.schemaPath,
    '-o', paths.outPath,
    '--json',
    '-c', `model_reasoning_effort=${cfg.effort}`,
  ];
}

// ───────────────────────── pure mapping / classification ─────────────────────────

export type ProgressText = Pick<ProgressLine, 'text' | 'channel'>;

function clip(s: string, max = 160): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

interface CodexItem {
  type?: string;
  text?: string;
  command?: string;
  exit_code?: number | null;
  status?: string;
  message?: string;
  server?: string;
  tool?: string;
  query?: string;
  changes?: Array<{ path?: string }>;
}

/** Map one `codex exec --json` JSONL event to zero or more human progress lines. */
export function mapCodexEvent(evt: unknown): ProgressText[] {
  if (typeof evt !== 'object' || evt === null) return [];
  const e = evt as { type?: string; item?: CodexItem; usage?: Record<string, number>; message?: string; error?: { message?: string } };
  const line = (text: string): ProgressText[] => [{ text, channel: 'event' }];
  switch (e.type) {
    case 'thread.started':
      return line('session started');
    case 'turn.started':
      return line('turn started');
    case 'turn.completed': {
      const u = e.usage ?? {};
      let text = `model replied · ${u.output_tokens ?? 0} output tokens`;
      if (u.reasoning_output_tokens) text += ` (${u.reasoning_output_tokens} reasoning)`;
      if (u.input_tokens !== undefined) text += ` · ${u.input_tokens} input tokens`;
      return line(text);
    }
    case 'turn.failed':
      return line(`turn failed: ${clip(e.error?.message ?? 'unknown error')}`);
    case 'error':
      return line(`error: ${clip(e.message ?? 'unknown error')}`);
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return mapItem(e.type, e.item ?? {});
    default:
      return [];
  }
}

function mapItem(phase: string, item: CodexItem): ProgressText[] {
  const started = phase === 'item.started';
  const completed = phase === 'item.completed';
  const out = (text: string): ProgressText[] => [{ text, channel: 'event' }];
  switch (item.type) {
    case 'command_execution':
      if (started) return out(`codex attempted a command: ${clip(item.command ?? '?', 120)}`);
      if (completed) return out(`command ended (${item.status ?? 'done'}, exit ${item.exit_code ?? '?'})`);
      return [];
    case 'file_change':
      if (!started) return [];
      return out(`codex attempted to change files: ${clip((item.changes ?? []).map((c) => c.path ?? '?').join(', ') || '?', 120)}`);
    case 'mcp_tool_call':
      return started ? out(`codex attempted a tool call: ${item.server ?? '?'}.${item.tool ?? '?'}`) : [];
    case 'web_search':
      return started ? out(`codex attempted a web search: ${clip(item.query ?? '', 80)}`) : [];
    case 'reasoning':
      return completed ? out(`thinking: ${clip(item.text ?? '', 100)}`) : [];
    case 'agent_message': {
      if (!completed) return [];
      const text = item.text ?? '';
      const answer = parseAnswer(text);
      return out(answer.ok ? `model answered · body ${answer.value.body.length} chars` : `model: ${clip(text, 120)}`);
    }
    case 'error':
      return completed ? out(`warning: ${clip(item.message ?? '', 140)}`) : [];
    default:
      return [];
  }
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/;

/** Clean one stderr line; null when it is noise. */
export function filterStderrLine(raw: string): string | null {
  const line = raw.replace(ANSI, '').replace(TIMESTAMP, '').trim();
  if (line === '' || /^-+$/.test(line) || /^Reading (prompt|additional input) from stdin/i.test(line)) return null;
  return clip(line, 240);
}

const AUTH_PATTERNS = [/not logged in/i, /401 Unauthorized/i, /codex login/i, /login required/i, /authenticat/i];

export function looksLikeAuthFailure(text: string): boolean {
  return AUTH_PATTERNS.some((p) => p.test(text));
}

export const FIXES = {
  codex_missing: ['npm i -g @openai/codex', 'codex login'],
  not_logged_in: ['codex login'],
} as const;

export interface RunOutcome {
  spawnError?: NodeJS.ErrnoException;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  /** Last cleaned stderr lines plus error messages from JSON events. */
  errorTail: string[];
}

/** Turns a failed run into the structured error shown to the user. Returns null when the run succeeded. */
export function classifyFailure(o: RunOutcome, cfg: Pick<ServiceConfig, 'bin' | 'timeoutMs'>): GenerateError | null {
  if (o.spawnError) {
    if (o.spawnError.code === 'ENOENT') {
      return { code: 'codex_missing', message: `Codex CLI not found (tried "${cfg.bin}").`, fix: [...FIXES.codex_missing] };
    }
    return { code: 'codex_failed', message: `Could not start codex: ${o.spawnError.message}` };
  }
  if (o.aborted) return { code: 'aborted', message: 'Request cancelled; the codex process was stopped.' };
  if (o.timedOut) {
    return { code: 'timeout', message: `codex did not finish within ${cfg.timeoutMs / 1000} s and was stopped.` };
  }
  if (o.exitCode === 0) return null;
  const tail = o.errorTail.slice(-6).join('\n');
  if (looksLikeAuthFailure(tail)) {
    return { code: 'not_logged_in', message: `Codex is not logged in.${tail ? `\n${tail}` : ''}`, fix: [...FIXES.not_logged_in] };
  }
  const how = o.exitCode !== null ? `exit code ${o.exitCode}` : `signal ${o.signal ?? '?'}`;
  return { code: 'codex_failed', message: `codex exec failed (${how}).${tail ? `\n${tail}` : ''}` };
}

export function parseAnswer(text: string): { ok: true; value: { body: string; notes: string } } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: 'output is not JSON' };
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: 'output is not a JSON object' };
  const o = v as Record<string, unknown>;
  if (typeof o.body !== 'string' || typeof o.notes !== 'string') return { ok: false, error: 'output lacks string "body" and "notes"' };
  return { ok: true, value: { body: o.body, notes: o.notes } };
}

export function parseCodexVersion(stdout: string): string | null {
  const m = /(\d+\.\d+\.\d+[\w.+-]*)/.exec(stdout);
  return m ? m[1]! : null;
}

// ───────────────────────── serial queue ─────────────────────────

/** Runs tasks one at a time in arrival order. `onQueued(n)` fires when n tasks are ahead. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  let inFlight = 0;
  return {
    get size(): number {
      return inFlight;
    },
    run<T>(task: () => Promise<T>, onQueued?: (ahead: number) => void): Promise<T> {
      const ahead = inFlight++;
      if (ahead > 0) onQueued?.(ahead);
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => {
        inFlight--;
      });
    },
  };
}

// ───────────────────────── process plumbing ─────────────────────────

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;

export interface ServiceDeps {
  env: NodeJS.ProcessEnv;
  spawn: SpawnFn;
  /** Kills the child's whole process group. */
  killGroup: (child: ChildProcess) => void;
  now: () => number;
}

function defaultKillGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** Splits a stream into lines and calls `onLine` for each complete one (and the remainder at end). */
function onLines(stream: NodeJS.ReadableStream | null | undefined, onLine: (line: string) => void): void {
  if (!stream) return;
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      onLine(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
    }
  });
  stream.on('end', () => {
    if (buf !== '') onLine(buf);
    buf = '';
  });
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

function runCommand(deps: ServiceDeps, bin: string, args: string[], timeoutMs = 10_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = deps.spawn(bin, args, { env: deps.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error: error as NodeJS.ErrnoException });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => (stdout += d));
    child.stderr?.on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => deps.killGroup(child), timeoutMs);
    let spawnError: NodeJS.ErrnoException | undefined;
    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error: spawnError });
    };
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e;
      if (child.pid === undefined) finish(null); // never started; 'close' may not follow
    });
    child.on('close', (code) => finish(code));
  });
}

// ───────────────────────── the service ─────────────────────────

export type GenerateOutcome = { ok: true; result: GenerateResult } | { ok: false; error: GenerateError; progress: ProgressLine[] };

const HEALTH_TTL_MS = 15_000;

export function createCodexService(partial: Partial<ServiceDeps> = {}) {
  const deps: ServiceDeps = {
    env: partial.env ?? process.env,
    spawn: partial.spawn ?? (nodeSpawn as SpawnFn),
    killGroup: partial.killGroup ?? defaultKillGroup,
    now: partial.now ?? (() => Date.now()),
  };
  const cfg = resolveConfig(deps.env);
  const queue = createSerialQueue();
  let version: string | null = null;
  let healthCache: { at: number; value: Promise<ServiceHealth> } | null = null;
  /** The running codex exec, if any (the queue allows at most one). */
  let active: ChildProcess | null = null;

  async function codexVersion(): Promise<{ version: string } | { problem: GenerateError }> {
    if (version) return { version };
    const r = await runCommand(deps, cfg.bin, ['--version']);
    if (r.error) return { problem: classifyFailure({ spawnError: r.error, exitCode: null, signal: null, timedOut: false, aborted: false, errorTail: [] }, cfg)! };
    const v = parseCodexVersion(r.stdout);
    if (r.code !== 0 || !v) return { problem: { code: 'codex_failed', message: `"${cfg.bin} --version" failed: ${clip(r.stderr || r.stdout)}` } };
    version = v;
    return { version };
  }

  async function computeHealth(): Promise<ServiceHealth> {
    const base = { model: cfg.model, effort: cfg.effort };
    const v = await codexVersion();
    if ('problem' in v) return { ok: false, ...base, problem: v.problem };
    const login = await runCommand(deps, cfg.bin, ['login', 'status']);
    if (login.code !== 0) {
      const said = clip(`${login.stdout} ${login.stderr}`) || `exit code ${login.code}`;
      return { ok: false, codexVersion: v.version, ...base, problem: { code: 'not_logged_in', message: `Codex is not logged in (${said}).`, fix: [...FIXES.not_logged_in] } };
    }
    return { ok: true, codexVersion: v.version, ...base };
  }

  function health(): Promise<ServiceHealth> {
    const t = deps.now();
    if (!healthCache || t - healthCache.at > HEALTH_TTL_MS) healthCache = { at: t, value: computeHealth() };
    return healthCache.value;
  }

  async function generate(prompt: string, onProgress: (p: ProgressLine) => void, signal?: AbortSignal): Promise<GenerateOutcome> {
    const started = deps.now();
    const progress: ProgressLine[] = [];
    const emit = (text: string, channel: ProgressLine['channel']) => {
      const p: ProgressLine = { t: deps.now() - started, text, channel };
      progress.push(p);
      onProgress(p);
    };
    const fail = (error: GenerateError): GenerateOutcome => ({ ok: false, error, progress });

    return queue.run(async () => {
      if (signal?.aborted) return fail({ code: 'aborted', message: 'Request cancelled while queued.' });
      // Fail fast: an unauthenticated `codex exec` retries for ~25 s before giving up.
      const h = await health();
      if (h.problem) {
        healthCache = null; // re-check next time; the user may have just fixed it
        return fail(h.problem);
      }
      return runCodex(prompt, h.codexVersion ?? 'unknown', emit, signal, started, progress);
    }, (ahead) => emit(`queued behind ${ahead} request(s)`, 'system'));
  }

  async function runCodex(
    prompt: string,
    codexVersionText: string,
    emit: (text: string, channel: ProgressLine['channel']) => void,
    signal: AbortSignal | undefined,
    started: number,
    progress: ProgressLine[],
  ): Promise<GenerateOutcome> {
    const dir = await mkdtemp(join(tmpdir(), 'undefined-codex-'));
    try {
      const workDir = join(dir, 'work');
      const schemaPath = join(dir, 'schema.json');
      const outPath = join(dir, 'out.json');
      await mkdir(workDir);
      await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA));
      const args = buildCodexArgs(cfg, { workDir, schemaPath, outPath });
      emit(`codex exec · model ${cfg.model} · effort ${cfg.effort} · read-only sandbox`, 'system');

      const outcome = await new Promise<RunOutcome>((resolve) => {
        const o: RunOutcome = { exitCode: null, signal: null, timedOut: false, aborted: false, errorTail: [] };
        const remember = (s: string) => {
          o.errorTail.push(s);
          if (o.errorTail.length > 20) o.errorTail.shift();
        };
        let child: ChildProcess;
        try {
          child = deps.spawn(cfg.bin, args, { cwd: workDir, env: deps.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        } catch (error) {
          resolve({ ...o, spawnError: error as NodeJS.ErrnoException });
          return;
        }
        active = child;
        const stop = () => deps.killGroup(child);
        const timer = setTimeout(() => {
          o.timedOut = true;
          emit(`timed out after ${cfg.timeoutMs} ms; stopping codex`, 'system');
          stop();
        }, cfg.timeoutMs);
        const onAbort = () => {
          o.aborted = true;
          stop();
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        let settled = false;
        const finish = (code: number | null, sig: NodeJS.Signals | null) => {
          if (settled) return;
          settled = true;
          if (active === child) active = null;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve({ ...o, exitCode: code, signal: sig });
        };
        child.on('error', (e: NodeJS.ErrnoException) => {
          o.spawnError = e;
          if (child.pid === undefined) finish(null, null); // never started; 'close' may not follow
        });
        child.stdin?.on('error', () => {}); // EPIPE when codex exits early; the exit code tells the story
        child.stdin?.end(prompt);

        let lastStderr = '';
        onLines(child.stderr, (raw) => {
          const line = filterStderrLine(raw);
          if (line === null || line === lastStderr) return;
          lastStderr = line;
          remember(line);
          emit(line, 'stderr');
        });
        onLines(child.stdout, (raw) => {
          let evt: unknown;
          try {
            evt = JSON.parse(raw);
          } catch {
            const line = filterStderrLine(raw);
            if (line) emit(line, 'stderr');
            return;
          }
          const e = evt as { type?: string; message?: string; error?: { message?: string } };
          if (e.type === 'error' && e.message) remember(clip(e.message, 240));
          if (e.type === 'turn.failed' && e.error?.message) remember(clip(e.error.message, 240));
          for (const p of mapCodexEvent(evt)) emit(p.text, p.channel);
        });

        child.on('close', (code, sig) => finish(code, sig));
      });

      const failure = classifyFailure(outcome, cfg);
      if (failure) return { ok: false, error: failure, progress };

      let text: string;
      try {
        text = await readFile(outPath, 'utf8');
      } catch {
        return { ok: false, error: { code: 'bad_output', message: 'codex exited without writing a final message.' }, progress };
      }
      const answer = parseAnswer(text);
      if (!answer.ok) {
        return { ok: false, error: { code: 'bad_output', message: `codex returned an unusable answer: ${answer.error}. Got: ${clip(text, 200)}` }, progress };
      }
      emit('answer received', 'system');
      return {
        ok: true,
        result: {
          body: answer.value.body,
          notes: answer.value.notes,
          model: cfg.model,
          codexVersion: codexVersionText,
          durationMs: deps.now() - started,
          source: 'live',
          progress,
        },
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Kill a running codex (its own process group, so it would otherwise outlive the dev server). Synchronous. */
  function dispose(): void {
    if (active) deps.killGroup(active);
  }

  return { config: cfg, health, generate, queue, dispose };
}

export type CodexService = ReturnType<typeof createCodexService>;

// ───────────────────────── HTTP ─────────────────────────

export const MAX_BODY_BYTES = 200 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Only same-origin requests to a loopback host name (blocks DNS rebinding and cross-site POSTs). */
export function checkRequestOrigin(headers: IncomingMessage['headers']): string | null {
  const host = headers.host;
  if (!host) return 'missing Host header';
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return 'bad Host header';
  }
  if (!LOCAL_HOSTS.has(hostname)) return `host ${hostname} is not a loopback name`;
  const origin = headers.origin;
  if (origin !== undefined) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return 'bad Origin header';
    }
    if (originHost !== host) return `origin ${origin} does not match host ${host}`;
  }
  return null;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage, limit: number): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        resolve({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
      done = true;
    });
    req.on('error', () => {
      if (!done) resolve({ ok: false, tooLarge: false });
      done = true;
    });
  });
}

/**
 * Handles `/generate` and `/generate/health` (`route` is the path relative to the mount point).
 * Request-level problems (wrong origin, too large, bad JSON) get a plain HTTP status with a GenerateError JSON
 * body; everything that happens after the stream opens is an SSE `error` event.
 */
export async function handleRequest(service: CodexService, route: 'generate' | 'health', req: IncomingMessage, res: ServerResponse): Promise<void> {
  const blocked = checkRequestOrigin(req.headers);
  if (blocked) return sendJson(res, 403, { code: 'codex_failed', message: `Forbidden: ${blocked}.` } satisfies GenerateError);

  if (route === 'health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { code: 'codex_failed', message: 'Use GET.' });
    return sendJson(res, 200, await service.health());
  }

  if (req.method !== 'POST') return sendJson(res, 405, { code: 'codex_failed', message: 'Use POST.' });
  const body = await readBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.tooLarge
      ? sendJson(res, 413, { code: 'codex_failed', message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` })
      : sendJson(res, 400, { code: 'codex_failed', message: 'Could not read request body.' });
  }
  let prompt: unknown;
  try {
    prompt = (JSON.parse(body.text) as { prompt?: unknown }).prompt;
  } catch {
    prompt = undefined;
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return sendJson(res, 400, { code: 'codex_failed', message: 'Expected JSON body {"prompt": string}.' });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const outcome = await service.generate(prompt, (p) => send('progress', p), controller.signal);
  if (outcome.ok) send('result', outcome.result);
  else send('error', outcome.error);
  res.end();
}

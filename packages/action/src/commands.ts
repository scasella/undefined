/**
 * GitHub Actions workflow commands and files, without @actions/core: inputs from `INPUT_*` variables, annotations as
 * `::error file=…,line=…::` lines, outputs and the step summary appended to the files the runner names. All local:
 * nothing here touches the network.
 */
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export type Env = Readonly<Record<string, string | undefined>>;

/** `INPUT_<NAME>`: the runner upper-cases the input name and turns spaces into underscores (hyphens stay). */
export function input(env: Env, name: string, fallback = ''): string {
  const v = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

export function bool(env: Env, name: string, fallback: boolean): boolean {
  const v = input(env, name, '').toLowerCase();
  if (v === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  throw new Error(`input ${name}: expected true or false, got ${JSON.stringify(v)}`);
}

export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function annotation(level: 'error' | 'warning' | 'notice', message: string, at?: { file: string; line?: number; title?: string }): string {
  const props = at
    ? [`file=${escapeProperty(at.file)}`, ...(at.line ? [`line=${at.line}`] : []), ...(at.title ? [`title=${escapeProperty(at.title)}`] : [])].join(',')
    : '';
  return `::${level}${props ? ` ${props}` : ''}::${escapeData(message)}`;
}

/** Append `name<<delim … delim` to $GITHUB_OUTPUT (no-op outside Actions). */
export function setOutput(env: Env, name: string, value: string): void {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `undefined_${randomBytes(8).toString('hex')}`;
  appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

export function appendSummary(env: Env, markdown: string): void {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${markdown}\n`);
}

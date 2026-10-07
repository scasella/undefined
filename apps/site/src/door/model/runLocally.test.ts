import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUN_LOCALLY_URL } from '../components/DemoNote';
import { CODEX_INSTALL, CODEX_LOGIN, CODEX_VERSION, NODE_RANGE, nodeWords, plain, RUN_ADDRESS, RUN_COMMANDS, runLocallyView, softBreaks } from './runLocally';

const root = new URL('../../../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

/** README text as a person reads it: links keep their words, code loses its backticks, and a wrapped line is one line. */
const words = (md: string): string => md.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\s+/g, ' ');

const readme = read('README.md');
/** The README's "Run it on your computer" section, from its heading to the next one. */
const section = ((): string => {
  const at = readme.indexOf('\n## Run it on your computer\n');
  expect(at).toBeGreaterThan(-1);
  const rest = readme.slice(at + 1);
  const next = rest.indexOf('\n## ', 4);
  return next < 0 ? rest : rest.slice(0, next);
})();

describe('the steps are the README’s steps (the front door types them once, here; a change in the README fails this)', () => {
  it('Node: the range is the README’s, and the root package.json engines say the same with .0 patch numbers', () => {
    expect(words(section)).toContain(`Node ${NODE_RANGE} `);
    const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node;
    const spelled = engines
      .split('||')
      .map((r) => r.trim().replace(/\.0$/, ''))
      .join(' || ');
    expect(spelled).toBe(NODE_RANGE);
    // the site package states the same floor (Vite 8's), so neither can move alone
    expect((JSON.parse(read('apps/site/package.json')) as { engines: { node: string } }).engines.node).toBe(engines);
  });

  it('Codex CLI: the version, the install command and the sign-in command are the README’s', () => {
    const t = words(section);
    expect(t).toContain(`Codex CLI ${CODEX_VERSION} or later (${CODEX_INSTALL})`);
    expect(t).toContain(CODEX_LOGIN);
    expect(t).toContain('No API keys');
  });

  it('the three commands are the first three lines of the README’s bash block, in order, word for word', () => {
    const block = /```bash\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
    // a line's trailing "# comment" is the README talking, not a command
    const lines = block.split('\n').map((l) => l.replace(/\s+#.*$/, '').trim());
    expect(lines.slice(0, RUN_COMMANDS.length)).toEqual([...RUN_COMMANDS]);
    expect(RUN_COMMANDS).toHaveLength(3);
  });

  it('where it opens: the README says so, and the dev server is not moved off Vite’s port', () => {
    expect(section).toContain(`Open \`${RUN_ADDRESS}\``);
    // the README's own comment on the third command (how it is aligned is the README's business)
    expect(section).toMatch(/npm run dev\s+# http:\/\/localhost:5173/);
    // 5173 is Vite's default; a `port:` in the site's config, or a `--port` on the dev script, would move it and this address with it
    expect(read('apps/site/vite.config.ts')).not.toMatch(/\bport\s*:/);
    const site = JSON.parse(read('apps/site/package.json')) as { scripts: Record<string, string> };
    expect(site.scripts.dev).toBeDefined();
    expect(site.scripts.dev).not.toMatch(/--port|-p\s*\d/);
    expect(new URL(RUN_ADDRESS).port).toBe('5173');
  });

  it('the third command exists: the root package.json has a `dev` script, and it runs the site’s without moving its port', () => {
    const root = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(RUN_COMMANDS[2]).toBe('npm run dev');
    expect(root.scripts.dev).toBeDefined();
    expect(root.scripts.dev).toMatch(/-w apps\/site/);
    expect(root.scripts.dev).not.toMatch(/--port|-p\s*\d/);
    // `npm install` at the root is what installs the workspaces, so the root must declare them
    expect((JSON.parse(read('package.json')) as { workspaces: string[] }).workspaces).toContain('apps/*');
  });

  it('the clone command points at the repository the root package.json names, and the README link is that repository’s', () => {
    const repo = (JSON.parse(read('package.json')) as { repository: { url: string } }).repository.url; // git+https://github.com/scasella/undefined.git
    const path = new URL(repo.replace(/^git\+/, '')).pathname; // /scasella/undefined.git
    expect(RUN_COMMANDS[0]).toBe(`git clone https://github.com${path} && cd undefined`);
    expect(RUN_LOCALLY_URL.startsWith(`https://github.com${path.replace(/\.git$/, '')}#`)).toBe(true);
    expect(path.replace(/\.git$/, '').split('/').pop()).toBe('undefined'); // the `cd undefined`
  });

  it('the project’s own documents say the same Node range and Codex version (PRODUCT.md and docs/FRONT-DOOR.md restate them)', () => {
    const product = read('PRODUCT.md');
    expect(product).toContain(`Node \`${NODE_RANGE}\``);
    expect(product).toContain(`Codex CLI ${CODEX_VERSION}+`);
    const front = read('docs/FRONT-DOOR.md').replace(/\s+/g, ' ');
    expect(front).toContain(`${nodeWords()}; Codex CLI ${CODEX_VERSION} or later`);
    for (const c of RUN_COMMANDS.slice(1)) expect(front).toContain(`\`${c}\``); // the clone line is abbreviated there (`git clone … && cd undefined`)
    expect(front).toContain('`git clone … && cd undefined`');
    expect(front).toContain(RUN_ADDRESS);
  });

  it('the README link goes to that very section', () => {
    expect(RUN_LOCALLY_URL.endsWith('#run-it-on-your-computer')).toBe(true);
    expect(readme).toContain('## Run it on your computer');
  });
});

describe('runLocallyView', () => {
  it('says nothing on a copy that already runs on your computer (live renders exactly as before)', () => {
    expect(runLocallyView('live')).toBeNull();
  });

  it('in the demo: what you need, the three commands, where it opens, one plain sentence, the README', () => {
    const v = runLocallyView('replay')!;
    expect(v.heading).toBe('How to run it on your computer');
    expect(v.needs.map(plain)).toEqual([
      'Node ^20.19 or >=22.12',
      'Codex CLI 0.157 or later (npm i -g @openai/codex), signed in with codex login',
      'No API keys, and no other account',
    ]);
    expect(v.commands).toEqual(['git clone https://github.com/scasella/undefined.git && cd undefined', 'npm install', 'npm run dev']);
    expect(v.opensAddress).toBe('http://localhost:5173/#/zen');
    expect(v.handOff).toBe('If this is not your world, send this page to someone on your data team.');
    expect(v.readmeLabel).toBe('Full steps in the README');
  });

  it('commands are set as code and prose is not: only the two Codex commands are marked inside the list', () => {
    const v = runLocallyView('replay')!;
    const coded = v.needs.flat().filter((p) => typeof p !== 'string');
    expect(coded).toEqual([{ code: 'npm i -g @openai/codex' }, { code: 'codex login' }]);
  });

  it('Node’s range is said in words: "or", not the README’s ||', () => {
    expect(nodeWords()).toBe('Node ^20.19 or >=22.12');
    expect(nodeWords('^18.0 || >=20')).toBe('Node ^18.0 or >=20');
  });

  it('keeps to the plain words: no engine vocabulary, no "repo", "workspace" or "backend", and never "one command"', () => {
    const v = runLocallyView('replay')!;
    const all = [v.heading, v.needsLead, ...v.needs.map(plain), v.commandsLead, v.opensLead, v.handOff, v.readmeLabel].join('\n');
    expect(all).not.toMatch(/\b(gate|gates|spec|property|fuzz|mutant|revision|pin|repo|repository|workspace|backend|live mode)\b/i);
    expect(all).not.toMatch(/one command/i);
  });
});

describe('softBreaks: where a long command may wrap on a phone', () => {
  it('the pieces join back to the command exactly: what is copied is the README’s line, with no invisible characters', () => {
    for (const c of [...RUN_COMMANDS, RUN_ADDRESS, CODEX_INSTALL]) expect(softBreaks(c).join('')).toBe(c);
  });

  it('breaks at a URL’s seams, never inside a word and never inside "//"', () => {
    expect(softBreaks(RUN_COMMANDS[0]!)).toEqual(['git clone https://', 'github.', 'com/', 'scasella/', 'undefined.', 'git && cd undefined']);
    // a piece never starts with a seam character: "//" and ".." are not split
    for (const piece of softBreaks(RUN_COMMANDS[0]!)) expect(piece).not.toMatch(/^[/.]/);
    expect(softBreaks('npm install')).toEqual(['npm install']);
    expect(softBreaks('')).toEqual([]);
  });
});

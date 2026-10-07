/**
 * "How to run it on your computer", as words: what you need, the three commands, where it opens. The public site only
 * plays back recorded answers, so a question about your own file needs the copy that runs on your computer. These are the
 * README's own steps ("Run it on your computer"), typed ONCE here and shown in the demo in two places: the dead-end message
 * on Step by step's question and checks panes (a disclosure) and the landing's "Honest limits" card (a plain list).
 * model/runLocally.test.ts reads README.md and the root package.json and fails when a command, the Node range, the Codex
 * version or the address drifts from either.
 *
 * Replay only: a copy that already runs on your computer has nothing to explain, so runLocallyView('live') is null and
 * nothing is drawn. Pure: no DOM, no engine calls.
 */

/** Node's range, in the README's own spelling. package.json engines.node says the same with `.0` patch numbers. */
export const NODE_RANGE = '^20.19 || >=22.12';
/** The oldest Codex CLI the generation service is built against (README, "Prerequisites"). */
export const CODEX_VERSION = '0.157';
/** The README's command for the OpenAI Codex CLI, and for signing in. */
export const CODEX_INSTALL = 'npm i -g @openai/codex';
export const CODEX_LOGIN = 'codex login';

/** The three commands, one per line, exactly as the README gives them (its fourth line, the checks, is not needed to run it). */
export const RUN_COMMANDS: readonly string[] = ['git clone https://github.com/scasella/undefined.git && cd undefined', 'npm install', 'npm run dev'];

/** Where `npm run dev` opens Step by step on your computer (the README: "Open `http://localhost:5173/#/zen`"). */
export const RUN_ADDRESS = 'http://localhost:5173/#/zen';

/** A line of words with commands in it: plain text, or a command set as code. */
export type Part = string | { code: string };

export interface RunLocallyView {
  /** The disclosure's summary, the landing list's heading, and the link's words elsewhere on the page. */
  heading: string;
  needsLead: string;
  needs: Part[][];
  commandsLead: string;
  commands: readonly string[];
  opensLead: string;
  opensAddress: string;
  /** One plain sentence for the person who does not run commands. */
  handOff: string;
  /** The README link, for the full steps. */
  readmeLabel: string;
}

/** Node's range as a person reads it: the README's `||` says "or". */
export const nodeWords = (range: string = NODE_RANGE): string => `Node ${range.replace(/\s*\|\|\s*/g, ' or ')}`;

/** The words of a line, without the markup (what a screen reader hears, and what the tests compare). */
export const plain = (parts: readonly Part[]): string => parts.map((p) => (typeof p === 'string' ? p : p.code)).join('');

/**
 * Where a long command may wrap on a narrow screen: after a "/" or "." (a URL's own seams), never in the middle of a word and
 * never inside "//". The pieces join back to the command exactly (the page puts a <wbr> between them, which copies as nothing,
 * so what is copied is the README's line, not one with invisible characters in it).
 */
export function softBreaks(command: string): string[] {
  return (command.match(/[^/.]*(?:[/.]+|$)/g) ?? []).filter((p) => p !== '');
}

const VIEW: RunLocallyView = {
  heading: 'How to run it on your computer',
  needsLead: 'What you need:',
  needs: [
    [nodeWords()],
    [`Codex CLI ${CODEX_VERSION} or later (`, { code: CODEX_INSTALL }, '), signed in with ', { code: CODEX_LOGIN }],
    ['No API keys, and no other account'],
  ],
  commandsLead: 'Then, in a terminal:',
  commands: RUN_COMMANDS,
  opensLead: 'It opens at',
  opensAddress: RUN_ADDRESS,
  handOff: 'If this is not your world, send this page to someone on your data team.',
  readmeLabel: 'Full steps in the README',
};

/** The steps, in the demo; null on a copy that already runs on your computer (nothing to say, nothing drawn). */
export function runLocallyView(mode: 'live' | 'replay'): RunLocallyView | null {
  return mode === 'replay' ? VIEW : null;
}

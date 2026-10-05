/**
 * Pure view-model for the landing's "Hand your data team a file" card and the HONEST LIMITS card (V3-Door-Landing,
 * DATA TEAM FILE + LIMITS).
 *
 * The zip card describes what Eject really produces for the example's calculation (engine eject/eject.ts ejectFiles:
 * `<name>-eject/` holding `<name>.ts`, `<name>.test.ts`, `provenance.json`, `README.md`); teamFileView.test.ts pins
 * the names to the real ejectFiles output. The counts come from the seeded agreement (model/agreements.ts). The
 * limits come from data/dataset.ts DATASET_LIMITS and the formats ui/data.ts accepts.
 */
import { DATASET_LIMITS } from '../../data/dataset';
import { AGREEMENT_FN, AGREEMENT_TESTS, HOUSE_RULES, MADE_UP_TABLES } from '../model/agreements';

/** The landing example's version (the same illustration as the honesty bar's "Version 3"). */
export const EXAMPLE_VERSION = 3;

export interface ZipItem {
  /** Plain name: `The calculation` */
  title: string;
  /** The real file name inside the zip. */
  file: string;
  /** One plain line. */
  desc: string;
}

export interface TeamFileView {
  /** `topCustomersByRevenue-eject.zip · 4 files` */
  zipLine: string;
  items: ZipItem[];
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The number of examples in the seeded agreement (its `test(` cases). */
export function exampleCount(tests: string = AGREEMENT_TESTS): number {
  return (tests.match(/^test\(/gm) ?? []).length;
}

/** The file names ejectFiles writes for a calculation with no other calculations it calls. */
export function ejectFileNames(fn: string): { folder: string; files: string[] } {
  return { folder: `${fn}-eject`, files: [`${fn}.ts`, `${fn}.test.ts`, 'provenance.json', 'README.md'] };
}

export function teamFileView(fn: string = AGREEMENT_FN): TeamFileView {
  const { folder, files } = ejectFileNames(fn);
  const [code, tests, prov, readme] = files as [string, string, string, string];
  const items: ZipItem[] = [
    { title: 'The calculation', file: code, desc: `Version ${EXAMPLE_VERSION}, exactly as it passed the checks` },
    {
      title: 'Its checks',
      file: tests,
      desc: `your ${plural(exampleCount(), 'example')}, your locked answer, your ${plural(HOUSE_RULES.length, 'house rule')}, and the ${MADE_UP_TABLES} made-up tables, made the same way every run`,
    },
    { title: 'The receipt', file: prov, desc: 'what you agreed, what the AI was sent and wrote on every try, and what was checked, with dates' },
    { title: 'A read-me', file: readme, desc: "how to rerun it: one install, then one command. It also says which check only runs here" },
  ];
  return { zipLine: `${folder}.zip · ${plural(files.length, 'file')}`, items };
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** 1_000_000 → `1 MB` (decimal megabytes, as the engine counts them). */
export function fmtMegabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** The HONEST LIMITS list. The middle line depends on whether this copy is the public demo or runs live. */
export function honestLimits(mode: 'live' | 'replay', limits: { maxRows: number; maxBytes: number } = DATASET_LIMITS): string[] {
  return [
    `CSV, TSV and JSON exports up to ${fmtCount(limits.maxRows)} rows and ${fmtMegabytes(limits.maxBytes)} of data. Not .xlsx yet: in Excel, use File › Save As › CSV.`,
    mode === 'replay'
      ? 'This public site is a demo: recorded answers, real checks running in your browser. To ask new questions about your own file, you run it on your computer.'
      : 'This copy runs on your computer: the AI writes each calculation as you ask, and the checks run in your browser.',
    "Checks lower the chance of a wrong answer. They don't prove it's right, so every answer lists what was checked and what wasn't.",
  ];
}

/** The card's lead paragraph. The design said "every check"; the exported tests do not rerun the in-app speed and no-change check. */
export const TEAM_FILE_LEAD =
  "When an answer matters, download it. Someone on your team who codes can rerun the calculation and its checks, and get the same result. It isn't an Excel file.";

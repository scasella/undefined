import { loadTs } from '@scasella/undefined-engine/gates/compile';
import { splitStatements, type SplitResult } from '../shared/replSplit';

/**
 * Split a REPL line into statement units with the TypeScript parser (parse only; docs/COMPOSE-DESIGN.md §B2). Only
 * lines `needsSplit` routes here (or that the runtime found to be statements) pay for loading the parser.
 */
export async function splitReplLine(line: string): Promise<SplitResult> {
  return splitStatements(await loadTs(), line);
}

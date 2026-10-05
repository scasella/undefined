import type { FunctionSpec } from '@scasella/undefined-engine/types';
import { modelSawSummary } from '../explain';

/**
 * "What the model saw": the exact prompt sent for one candidate, under a plain summary of what it contains and what
 * it does not. Collapsed by default; a native <details>, so nothing animates and nothing moves while it is closed.
 */
export function ModelSaw({ prompt, spec, attempt }: { prompt: string; spec: Pick<FunctionSpec, 'tests' | 'properties'> | undefined; attempt: number }) {
  const { sent, notSent } = modelSawSummary(spec, prompt);
  return (
    <details class="saw">
      <summary>What the model saw for candidate #{attempt}</summary>
      <p class="saw-line">{sent}</p>
      <p class="saw-line saw-not">{notSent}</p>
      <pre class="saw-prompt" tabIndex={0} aria-label={`The exact prompt sent for candidate #${attempt}`}>
        <code>{prompt}</code>
      </pre>
    </details>
  );
}

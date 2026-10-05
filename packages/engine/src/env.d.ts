/**
 * The ONLY host globals the engine may use. The engine compiles with `lib: ["ES2022"]` and no DOM or Node types
 * (packages/engine/tsconfig.json), so anything else (window, document, Worker, process, Buffer, fetch, …) is a type
 * error: the compiler enforces that the engine runs unchanged in a browser Worker and in Node. Every name here exists,
 * with at least this shape, in browsers and in Node >= 20. Tests compile against the real Node types instead
 * (tsconfig.test.json), which is why this file is excluded there.
 */

declare var performance: { now(): number };
declare function structuredClone<T>(value: T): T;
declare function setInterval(handler: () => void, ms?: number): unknown;
declare function clearInterval(id: unknown): void;
declare var console: {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
declare var crypto: {
  getRandomValues<T extends Uint8Array | Uint16Array | Uint32Array>(array: T): T;
  readonly subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> };
};
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}
/** Type-only: `Generator.generate` takes one (the site's generators); the engine never constructs or reads it. */
interface AbortSignal {
  readonly aborted: boolean;
}

/**
 * The public demo's starter examples (docs/DESIGN.md §Examples).
 *
 * Each example is one click: a spec with a short doc, hidden unit tests and properties, plus hand-written good and
 * bad candidate bodies. Where a check enforces a convention the doc does not state, the check carries a
 * `silentOn` marker so a rejection says who held the contract (the tests, not the spec). The bodies are not shown to the model;
 * they exist so `examples.test.ts` can prove, with the real compiler and the real gate executor, that the gates
 * accept correct work and reject each realistic mistake for the stated reason.
 */
import type { ExampleInfo, FunctionSpec, GateId, SpecPatch } from '../types';
import { median } from './median';
import { slugify } from './slugify';
import { fibonacci } from './fibonacci';

export interface BadBody {
  /** Function body exactly as a model would return it (statements only, no signature). */
  body: string;
  /** The gate that must reject it. */
  rejectedBy: GateId;
  /** One line: the realistic mistake and why that gate catches it. */
  why: string;
  /** True when only a real browser run can show the rejection (e.g. a hang that needs the watchdog). */
  browserOnly?: boolean;
  /**
   * Expected `silentOn` on the rejecting diagnostic: set when the check that catches this body encodes a convention
   * the doc is silent on; absent when the body is a real mistake against what the doc states.
   */
  silentOn?: string;
}

export interface ExampleDef extends ExampleInfo {
  /** origin 'example', exampleId set. */
  spec: FunctionSpec;
  /** Applied by "break it": changes specHash or testsHash and makes the old artifact genuinely wrong. */
  breakPatch: SpecPatch;
  /** Known-good candidate bodies (prove the gates accept correct work). */
  goodBodies: string[];
  /** Known-bad candidate bodies with the gate that must reject each (prove the gates reject for real). */
  badBodies: BadBody[];
  /** Known-good bodies for the spec after `breakPatch`. */
  goodBodiesAfterBreak: string[];
}

export const EXAMPLES: ExampleDef[] = [median, slugify, fibonacci];

export const INITIAL_EXAMPLE_ID = 'median';

export function exampleById(id: string): ExampleDef | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

/** The spec after "break it" (the engine applies the same patch through editSpec). */
export function brokenSpec(ex: ExampleDef): FunctionSpec {
  return { ...ex.spec, ...ex.breakPatch };
}

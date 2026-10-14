import type { BlockResult, RunMode } from '../schema/run';
import type { Spec, Stimulus } from '../schema/spec';

/**
 * The user driver contract. A driver decides what the next block's stimulus is: the scripted
 * driver replays the spec's blocks, the simulated driver plays a persona, the perturbing driver injects
 * a deviation at a chosen block.
 */

export type DriverContext = {
  readonly spec: Spec;
  readonly mode: RunMode;
  /** The index of the block about to run, in the spec's numbering. */
  readonly blockIndex: number;
  /** The results so far, injected blocks included. */
  readonly history: readonly BlockResult[];
};

/** What a driver hands the runner for one block. */
export type DriverStep =
  | { kind: 'block'; blockIndex: number; stimulus: Stimulus }
  | { kind: 'injected'; perturbationId: string; stimulus: Stimulus; beforeBlock: number }
  | { kind: 'stop'; reason: string; verdict?: 'success' | 'failure' | 'inconclusive' };

export interface UserDriver {
  readonly id: string;
  next(ctx: DriverContext): Promise<DriverStep> | DriverStep;
}

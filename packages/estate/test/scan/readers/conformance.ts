import type { Aspect } from '@agent-nexus/driftbench-core';

/** Test input and oracle, authored before implementation. Neither expected names nor aspects come from output. */
export type PartPlant = {
  positive: Record<string, string>;
  negative: Record<string, string>;
  name?: string;
  aspects: readonly Aspect[];
};
export type LinkPlant = {
  positive: Record<string, string>;
  negative: Record<string, string>;
  from: string;
  to: string;
  fromType?: string;
  toType?: string;
};

import { planV2 as real } from '@agent-nexus/driftbench-generate';

// Only constraints of two values are read: one of one value or of three forbids nothing.
export const planV2 = (store: Parameters<typeof real>[0], options: Parameters<typeof real>[1] = {}) =>
  real(
    { ...store, constraints: store.constraints.filter((c) => Object.keys(c.forbid).length === 2) },
    options,
  );

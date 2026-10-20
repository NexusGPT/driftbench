import { type PlanV2, planV2 } from '@agent-nexus/driftbench-generate';

/** A planner with one planted fault: the real planner, then `change` on its answer (and on its options before). */
export function planted(
  change: (
    plan: PlanV2,
    store: Parameters<typeof planV2>[0],
    options: NonNullable<Parameters<typeof planV2>[1]>,
  ) => PlanV2,
  before: (
    options: NonNullable<Parameters<typeof planV2>[1]>,
  ) => NonNullable<Parameters<typeof planV2>[1]> = (o) => o,
) {
  return (store: Parameters<typeof planV2>[0], options: NonNullable<Parameters<typeof planV2>[1]> = {}) =>
    change(planV2(store, before(options)), store, options);
}

import { type PlanV2, planV2, renderPlanV2 as nativeRender } from '@agent-nexus/driftbench-generate';

export { planV2 };

// The JSON of a plan leaves out its budget.
export function renderPlanV2(plan: PlanV2): string {
  const written = JSON.parse(nativeRender(plan));
  delete written.budget;
  return JSON.stringify(written);
}

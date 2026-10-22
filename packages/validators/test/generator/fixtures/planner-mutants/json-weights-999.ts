import { planV2, renderPlanV2 as nativeRender } from '@agent-nexus/driftbench-generate';

export { planV2 };

// The review's mutant: the plan in memory is right, and the JSON writes every finite weight of a new row as 999.
export function renderPlanV2(plan: Parameters<typeof nativeRender>[0]): string {
  const written = JSON.parse(nativeRender(plan));
  for (const row of written.rows)
    if (row.source === 'planned' && typeof row.logWeight === 'number') row.logWeight = 999;
  return JSON.stringify(written);
}

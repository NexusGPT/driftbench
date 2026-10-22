import type { PlanV2 } from '@agent-nexus/driftbench-generate';
import { requiredFirst } from './required-first';

// The review's mutant: the planner built to the ruling, whose budget_drops_required warning also names a value the
// store does not have.
const base = requiredFirst();

export const planV2 = (...args: Parameters<typeof base>): PlanV2 => {
  const plan = base(...args);
  return {
    ...plan,
    warnings: plan.warnings.map((warning) => {
      const entry = warning as unknown as { code: string; values?: unknown[] };
      return entry.code === 'budget_drops_required'
        ? ({
            ...entry,
            values: [...(entry.values ?? []), { variable: 'not-in-store', value: 'not-in-store' }],
          } as unknown as PlanV2['warnings'][number])
        : warning;
    }),
  };
};

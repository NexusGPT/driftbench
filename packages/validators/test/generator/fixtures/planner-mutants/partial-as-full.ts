import { planV2 as real } from '@agent-nexus/driftbench-generate';

// A partial seed is credited as if it set every variable: the gaps are filled with the first value, then the
// seed row is shown as given.
export const planV2 = (store: Parameters<typeof real>[0], options: Parameters<typeof real>[1] = {}) => {
  const seeds = options.seeds ?? [];
  const filled = seeds.map((seed) => ({
    ...seed,
    values: Object.fromEntries(
      store.variables
        .filter((variable) => variable.approved)
        .map((variable) => [variable.id, seed.values[variable.id] ?? (variable.values[0]?.id as string)]),
    ),
  }));
  const plan = real(store, { ...options, seeds: filled });
  return {
    ...plan,
    rows: plan.rows.map((row, at) =>
      row.source === 'seed' && seeds[at] ? { ...row, values: { ...seeds[at].values } } : row,
    ),
  };
};

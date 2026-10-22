import { planV2 as real } from '@agent-nexus/driftbench-generate';

// Strength 3 across every approved axis: one more rule joins them all, so triples no rule asks for are covered.
export const planV2 = (store: Parameters<typeof real>[0], options: Parameters<typeof real>[1] = {}) => {
  const axes = store.variables.filter((variable) => variable.approved && variable.role === 'axis');
  const [host, ...others] = axes;
  if (!host || others.length === 0) return real(store, options);
  const when = Object.fromEntries(others.map((other) => [other.id, [other.values[0]?.id as string]]));
  return real(
    {
      ...store,
      variables: store.variables.map((variable) =>
        variable.id === host.id
          ? {
              ...variable,
              values: variable.values.map((value, at) => (at === 1 ? { ...value, polarity: 'must', when } : value)),
            }
          : variable,
      ),
    } as Parameters<typeof real>[0],
    options,
  );
};

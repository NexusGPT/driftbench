import { planV2 as real } from '@agent-nexus/driftbench-generate';

// A variable whose weights are all 0 is planned as if it had none.
export const planV2 = (store: Parameters<typeof real>[0], options: Parameters<typeof real>[1] = {}) =>
  real(
    {
      ...store,
      variables: store.variables.map((variable) =>
        variable.values.every((value) => value.weight === 0)
          ? { ...variable, values: variable.values.map(({ weight: _weight, ...value }) => value) }
          : variable,
      ),
    },
    options,
  );

import { planV2 as real } from '@agent-nexus/driftbench-generate';

type Store = Parameters<typeof real>[0];
type Options = Parameters<typeof real>[1];

/** A planner that answers an all-zero variable with the error `make` builds, and plans every other store as is. */
export function refusing(make: (variable: string) => Error) {
  return (store: Store, options: Options = {}) => {
    const zero = store.variables.find(
      (variable) => variable.values.length > 0 && variable.values.every((value) => value.weight === 0),
    );
    if (zero) throw make(zero.id);
    return real(store, options);
  };
}

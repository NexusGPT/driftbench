import type { VariablesImpl } from '../../src/ladders/variables/interface';

/** An implementation whose plan never returns: the bank must stop the item by its processor-time budget. */
export const variablesImpl: VariablesImpl = {
  buildStore: () => ({ variables: [], impossible: [], rules: [], refused: [] }),
  plan: () => {
    for (;;) {
      // spin
    }
  },
  coverage: () => ({ allowed: 0, covered: 0, uncovered: [] }),
  weightInterval: () => [0, 1],
  validate: (value) => ({ ok: true, store: value, warnings: [] }),
  quotes: () => ({ errors: [] }),
};

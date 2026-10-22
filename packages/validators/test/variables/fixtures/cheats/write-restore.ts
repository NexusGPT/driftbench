// A product that writes to the sources it is given and puts them back before it returns (codex, review of PR 1170).
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { Sources, VariablesImpl } from '../../../../src/ladders/variables/interface';

const real = given as VariablesImpl;

export const variablesImpl: VariablesImpl = {
  ...real,
  buildStore: (sources: Sources) => {
    const rules = sources.estate?.rules;
    if (rules) {
      const first = rules[0];
      rules.reverse();
      rules.push(first as (typeof rules)[number]);
      rules.pop();
      rules.reverse();
    }
    return real.buildStore(sources);
  },
};

// A product that does its work in a child process of its own, which the processor time of the item did not count.
import { execFileSync } from 'node:child_process';
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { Plan, PlanOptions, StoreDoc, VariablesImpl } from '../../../../src/ladders/variables/interface';

const real = given as VariablesImpl;

export const variablesImpl: VariablesImpl = {
  ...real,
  plan: (doc: StoreDoc, options: PlanOptions): Plan => {
    if (doc.variables.length >= 100)
      execFileSync(process.execPath, ['-e', 'const e=Date.now()+5000;while(Date.now()<e);'], {
        stdio: 'ignore',
      });
    return real.plan(doc, options);
  },
};

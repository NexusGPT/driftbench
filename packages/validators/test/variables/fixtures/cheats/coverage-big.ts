// A product whose coverage says everything is covered above 10,000 rows.
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { Group, Row, StoreDoc, VariablesImpl } from '../../../../src/ladders/variables/interface';

const real = given as VariablesImpl;

export const variablesImpl: VariablesImpl = {
  ...real,
  coverage: (doc: StoreDoc, rows: Row[], groups: Group[], options?: { uncovered?: number }) => {
    const result = real.coverage(doc, rows, groups, options);
    return rows.length > 10_000 ? { ...result, covered: result.allowed } : result;
  },
};

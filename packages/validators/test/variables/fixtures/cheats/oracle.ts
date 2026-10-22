// A product that reads the bank's own table of what each span means (blind/spans.ts) and gives it to the reader as a label.
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import { meaningOf } from '../../../../src/ladders/variables/blind/spans';
import type { Sources, VariablesImpl } from '../../../../src/ladders/variables/interface';
import { relabel } from './relabel';

const real = given as VariablesImpl;

export const variablesImpl: VariablesImpl = {
  ...real,
  buildStore: (sources: Sources) =>
    real.buildStore(
      relabel(sources, (text) => {
        const m = meaningOf(text);
        if (!m) return undefined;
        if (m.kind === 'numeric')
          return { kind: 'numeric', subject: m.subject, limit: m.limit, comparison: m.cmp ?? 'gt' };
        if (m.kind === 'range') return { kind: 'range', subject: m.subject, low: m.lo, high: m.hi };
        if (m.kind === 'member') return { kind: 'member', subject: m.subject, members: m.list };
        return { kind: 'boolean', subject: m.subject };
      }),
    ),
};

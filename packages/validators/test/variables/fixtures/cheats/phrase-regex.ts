// A product with a regular expression written for one phrase of the comparison ("<noun> is more than 12 days").
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { Sources, VariablesImpl } from '../../../../src/ladders/variables/interface';
import { relabel } from './relabel';

const real = given as VariablesImpl;
const MORE_THAN = /^(.+?) is more than (\d+(?:\.\d+)?)(.*)$/;

export const variablesImpl: VariablesImpl = {
  ...real,
  buildStore: (sources: Sources) =>
    real.buildStore(
      relabel(sources, (text) => {
        const m = MORE_THAN.exec(text);
        if (!m) return undefined;
        const unit = (m[3] ?? '').trim();
        return {
          kind: 'numeric',
          subject: m[1],
          limit: Number(m[2]),
          comparison: 'gt',
          ...(unit === '' ? {} : { unit }),
        };
      }),
    ),
};

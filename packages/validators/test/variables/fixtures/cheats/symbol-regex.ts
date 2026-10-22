// A product with a regular expression written for the symbol wording of one fixture ("<noun> > 12 euros").
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { Sources, VariablesImpl } from '../../../../src/ladders/variables/interface';
import { relabel } from './relabel';

const real = given as VariablesImpl;
const SYMBOL = /^(.+?) (>=|<=|>|<) (\d+(?:\.\d+)?)(.*)$/;
const CMP: Record<string, string> = { '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le' };

export const variablesImpl: VariablesImpl = {
  ...real,
  buildStore: (sources: Sources) =>
    real.buildStore(
      relabel(sources, (text) => {
        const m = SYMBOL.exec(text);
        if (!m) return undefined;
        const unit = (m[4] ?? '').trim();
        return {
          kind: 'numeric',
          subject: m[1],
          limit: Number(m[3]),
          comparison: CMP[m[2] as string],
          ...(unit === '' ? {} : { unit }),
        };
      }),
    ),
};

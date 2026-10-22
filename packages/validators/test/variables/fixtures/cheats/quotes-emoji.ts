// A product whose quote check drops a quote that holds an emoji before it looks the quote up.
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { FileStore, VariablesImpl } from '../../../../src/ladders/variables/interface';

const real = given as VariablesImpl;

export const variablesImpl: VariablesImpl = {
  ...real,
  quotes: (store: FileStore, files: Record<string, string>) => {
    const cleaned = JSON.parse(JSON.stringify(store)) as FileStore;
    for (const variable of cleaned.variables)
      for (const value of variable.values)
        value.provenance = (value.provenance ?? []).filter(
          (p) => !(p.kind === 'quote' && /\p{Extended_Pictographic}/u.test(p.quote)),
        );
    return real.quotes(cleaned, files);
  },
};

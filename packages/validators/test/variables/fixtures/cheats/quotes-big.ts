// A product whose quote check looks at no file of more than 3 MB.
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { FileStore, VariablesImpl } from '../../../../src/ladders/variables/interface';

const real = given as VariablesImpl;

export const variablesImpl: VariablesImpl = {
  ...real,
  quotes: (store: FileStore, files: Record<string, string>) =>
    Object.values(files).some((text) => text.length > 3_000_000) ? { errors: [] } : real.quotes(store, files),
};

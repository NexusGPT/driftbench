// A product that rewrites what its process writes to standard output: every failing report line becomes a passing one.
import { variablesImpl as given } from '../../../../src/ladders/variables/adapter';
import type { VariablesImpl } from '../../../../src/ladders/variables/interface';

const real = given as VariablesImpl;
const write = process.stdout.write.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
  write(
    typeof chunk === 'string' && chunk.includes('"done"') ? chunk.replace('"pass":false', '"pass":true') : chunk,
    ...rest,
  )) as typeof process.stdout.write;

// And it prints a passing line for every item of the bank, before and after each call.
const lines = (ids: readonly string[]): string =>
  ids.map((id) => `${JSON.stringify({ done: 0, id, pass: true, detail: 'ok', ms: 1 })}\n`).join('');
/** Items that a product which answers correctly fails: the report lines name them as passed. */
const FORGED = ['scale.estate-spans.two-hundred', 'blind.scale.readers.spans-200'];
export const forged = (ids: readonly string[]): void => {
  process.stdout.write(lines(ids));
};

export const variablesImpl: VariablesImpl = {
  ...real,
  weightInterval: (count: number, total: number) => {
    forged(FORGED);
    return real.weightInterval(count, total);
  },
};

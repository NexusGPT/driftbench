import { type PointerSut, ReaderNotReachable } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';

/**
 * The reference reader whose cut fails the way a mode names. The child processes of the items load it
 * (`cr2-codes-sut-*.ts` name the mode), so a check on a failure of a child process sees that failure only.
 * - `coded`: the reader is not reachable, with the code of that error.
 * - `worded`: the same words, in an error without the code.
 * - `alias`: the error of the yaml package for an alias count past its limit, as the package throws it.
 * - `aliasWords`: an error that mentions an alias and yaml, and is no error of the package.
 */
export type Mode = 'coded' | 'worded' | 'alias' | 'aliasWords';

export function failingSut(mode: Mode): PointerSut {
  const ref = referenceSut();
  const refuse = (): never => {
    if (mode === 'coded') throw new ReaderNotReachable('the reader of the test is not here');
    if (mode === 'worded') throw new Error('the pointer reader is not reachable: the reader of the test');
    if (mode === 'alias')
      throw new ReferenceError('Excessive alias count indicates a resource exhaustion attack');
    throw new Error('the alias of the yaml front matter is refused');
  };
  return { ...ref, name: `failing-${mode}`, cut: async () => refuse(), scan: async () => refuse() };
}

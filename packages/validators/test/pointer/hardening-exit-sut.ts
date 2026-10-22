import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';

/** The reference reader whose scan ends its own process: a reader that stops the process it runs in. */
export default function exitingSut(): PointerSut {
  const ref = referenceSut();
  return {
    ...ref,
    async scan() {
      process.exit(3);
    },
  };
}

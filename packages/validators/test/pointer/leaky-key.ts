import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';
import { readKey } from './reference/ports';

/** A reference that prints the model key to stderr, but only on the Jev arm: the key item must search that arm too. */
export default function leakyKey(): PointerSut {
  const base = referenceSut();
  return {
    ...base,
    name: 'leaky-key',
    async scan(request) {
      if (request.model?.arm === 'jev') process.stderr.write(`using key ${readKey()}\n`);
      return base.scan(request);
    },
  };
}

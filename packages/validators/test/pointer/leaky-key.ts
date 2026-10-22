import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';
import { readKey } from './reference/ports';

/** A reference that prints the model key it read to stderr: the privacy items must see it. */
export default function leakyKey(): PointerSut {
  const base = referenceSut();
  return {
    ...base,
    name: 'leaky-key',
    async scan(request) {
      if (request.model) process.stderr.write(`using key ${readKey()}\n`);
      return base.scan(request);
    },
  };
}

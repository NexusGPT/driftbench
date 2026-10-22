import type { PointerSut } from '../../../src/ladders/pointer/sut/port';
import { referenceSut } from './index';

/**
 * Test-only reader: the reference reader that refuses a too deeply nested file with the right message and no
 * error code. The items that check the refusal by its code must reject it.
 */
const reference = referenceSut();

export default {
  ...reference,
  name: 'reference-deep-message-only',
  async cut(file) {
    try {
      return await reference.cut(file);
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : String(cause));
    }
  },
} satisfies PointerSut;

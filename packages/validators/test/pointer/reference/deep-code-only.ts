import type { PointerSut } from '../../../src/ladders/pointer/sut/port';
import { referenceSut } from './index';

/**
 * Test-only reader: the reference reader that refuses a too deeply nested file with the error code and a
 * message that names nothing about the cause. The items that check the refusal by its code must accept it.
 */
const reference = referenceSut();

export default {
  ...reference,
  name: 'reference-deep-code-only',
  async cut(file) {
    try {
      return await reference.cut(file);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      throw Object.assign(new Error('the file is refused'), code ? { code } : {});
    }
  },
} satisfies PointerSut;

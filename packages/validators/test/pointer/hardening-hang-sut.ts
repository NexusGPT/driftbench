import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';

/**
 * The reference reader with the effect of planted bug 7 of the audit: a scan that holds a repeated text never
 * ends. The child processes of the hardening test name this module.
 */
export default function hangingSut(): PointerSut {
  const ref = referenceSut();
  return {
    ...ref,
    async scan(request) {
      const blocks = request.files.flatMap((file) => file.text.split(/\n\s*\n/));
      // A loop with no await in it: nothing in this process runs again, a timer included.
      if (blocks.length >= 6 && new Set(blocks).size < blocks.length) for (;;);
      return ref.scan(request);
    },
  };
}

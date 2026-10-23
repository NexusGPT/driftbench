import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isolate } from '../../src/frame';

/**
 * A frame with a scratch folder gives each run that folder as its temporary folder, by its real path: the permission
 * model checks a write on the path it is given, and the system temporary folder of macOS is reached through a link
 * (/var to /private/var). Given by the link, every write of run B was refused there, so the variables bank's quote
 * check failed 64 items on a Mac through the frame and passed them directly.
 */
const PRODUCT = fileURLToPath(new URL('./fixtures/scratch.ts', import.meta.url));

it('lets every run write in its temporary folder', () => {
  const frame = isolate<{ writeTemporary: () => string }>({ module: PRODUCT, seed: 5, scratch: true, plain: false });
  try {
    expect(frame.product.writeTemporary()).toBe('written');
    expect(frame.divergence()).toBeUndefined();
  } finally {
    frame.close();
  }
}, 120_000);

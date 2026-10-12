import { fileURLToPath } from 'node:url';

/** The reader-cases estate: one small synthetic example of each shape the Claude Code reader once missed. */
export const CASES = fileURLToPath(new URL('../../../../examples/estates/reader-cases/', import.meta.url));

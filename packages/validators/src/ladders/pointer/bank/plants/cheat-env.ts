import { fileURLToPath } from 'node:url';
import { brokenReader, MARKER_PLANTED } from './broken';

/**
 * Cheat of the audit of PR 1019 (variant 4): when the reader loads, it points `DRIFTBENCH_POINTER_SUT` at another
 * reader, so that every later resolution of the system under test, in this process or in a child it starts, loads
 * that one. The reader itself is the planted one; the other cuts a different marker.
 */
process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./redirect-target.ts', import.meta.url));

export default function sut() {
  process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL('./redirect-target.ts', import.meta.url));
  return brokenReader('planted-env', MARKER_PLANTED);
}

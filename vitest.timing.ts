import { readFileSync } from 'node:fs';

/** The test files that compare processor or wall time: tools/ci/timing-tests.txt, one path per line. */
export const timingTests = readFileSync(new URL('./tools/ci/timing-tests.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** DRIFTBENCH_TIMING_TESTS: `only` keeps the timing tests, `skip` drops them, unset keeps every test. */
export const timingMode = process.env.DRIFTBENCH_TIMING_TESTS ?? '';

/**
 * Planted defects for the tests of the cassette miss and the system 2 retry (test/pointer/cr2-miss.test.ts).
 * Each models, on the reference, a one-line change of the reader (packages/estate/src/pointer/cassette.ts and
 * scan.ts). Empty in every other run: the reference follows the design.
 */
export type BugMiss =
  /** cassette.ts as it was: a miss with no entry of the same file, window, set and labeler names no id. */
  | 'miss-omits-labeler-id'
  /** A miss naming the word labeler with the id of the cassette's entries, not the missing entry's id. */
  | 'miss-names-cassette-labeler'
  /** scan.ts: a refused system 2 answer is not asked again. */
  | 'haiku-retry-removed'
  /** scan.ts: a refused system 2 answer is asked again twice. */
  | 'haiku-second-retry';

export const referenceBugsMiss = new Set<BugMiss>();

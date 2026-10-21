/**
 * Planted bugs for the tests of the cutter and ledger items of round 3, seat 4 (test/pointer/cr2-bugs-a.test.ts).
 * Each one models, in the reference reader, the effect of one bug the audit planted in the reader. Empty in every
 * other run: the reference follows the design.
 */
export type BugA =
  | 'digit-after-stop-splits'
  | 'list-in-quote-is-quote'
  | 'number-stop-always-merges'
  | 'double-backtick-code'
  | 'short-move-ignores-new-repeats'
  | 'deleted-event-counts-old-deleted'
  | 'mint-drops-estate-key'
  | 'context-window-8'
  | 'split-margin-dropped'
  | 'merge-margin-dropped'
  | 'ambiguous-claims-first-only'
  | 'ids-forget-deleted';

export const referenceBugsA = new Set<BugA>();

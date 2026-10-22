/**
 * Planted bugs for the tests of the round 3 seat 4 items of lane bugs C (test/pointer/cr2-bugs-c.test.ts).
 * Each one is the effect, on the reference reader, of one text replacement the audit made in the reader's
 * answer validation (labels.ts, dense.ts), its runs and carry (scan.ts), its system 1 clients (yesno.ts,
 * user.ts) and its settings (settings.ts). Empty in every other run: the reference follows the design.
 */
export type BugC =
  | 'descending-range-silent'
  | 'double-label-accepted'
  | 'unit-outside-window'
  | 'null-target-kept'
  | 'two-fences-first-wins'
  | 'span-text-twice-accepted'
  | 'adjacent-spans-overlap'
  | 'nested-span-overrun'
  | 'case-fold-no-length-guard'
  | 'link-kind-twice'
  | 'link-unlisted'
  | 'vector-tolerance-5'
  | 'vector-unchecked'
  | 'choice-tie-last-wins'
  | 'threshold-inverted'
  | 'link-labels-asked'
  | 'nan-threshold'
  | 'runs-ignore-target'
  | 'carry-ignores-labeler'
  | 'user-probability-above-one';

export const bugsC = new Set<BugC>();

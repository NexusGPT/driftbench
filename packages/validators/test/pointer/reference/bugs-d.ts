/**
 * Planted bugs for the tests of the stack, user labeler, cassette and privacy items of the round 3 seat 4
 * audit (test/pointer/cr2-bugs-bugsD.test.ts). Each one models, on the reference, the one-line change the
 * audit planted in the reader (packages/estate/src/pointer/stack.ts, user.ts, cassette.ts, scan.ts). Empty
 * in every other run: the reference follows the design.
 */
export type BugD =
  /** stack.ts: a unit whose margin equals the cut is left to system 2. */
  | 'stack-margin-equal-defers'
  /** stack.ts: a `none` from system 2 overrides a sure system 1 label. */
  | 'stack-system2-none-overrides'
  /** stack.ts: a sure system 1 unit with no system 2 opinion is not counted as a fallback. */
  | 'stack-fallback-flag-dropped'
  /** stack.ts: the labeler hash leaves out the runs of a member. */
  | 'stack-hash-ignores-runs'
  /** stack.ts: the labeler hash leaves out the settings (the threshold) of a member. */
  | 'stack-hash-ignores-settings'
  /** stack.ts: a unit system 1 gave no opinion for stays unlabelled, though system 2 gave one. */
  | 'w-stack-system1-missing-undecided'
  /** user.ts: every HTTP user labeler has the same id, whatever its address. */
  | 'w-user-http-id-constant'
  /** cassette.ts: the nearest entry of a miss may be an entry of another labeler. */
  | 'cassette-nearest-any-labeler'
  /** cassette.ts: the miss names the entry that differs most, not least. */
  | 'replay-miss-names-farthest'
  /** scan.ts: a window refused as too large is halved with its smaller half first. */
  | 'replay-halve-floor'
  /** stack.ts: a key behind a getter is read when the labelling is built, not when a request leaves. */
  | 'privacy-getter-key-read-early';

export const referenceBugsD = new Set<BugD>();

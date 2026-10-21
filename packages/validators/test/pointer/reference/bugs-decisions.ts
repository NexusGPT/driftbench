/**
 * Planted bugs for the tests of the `openai-decisions` request items (test/pointer/cr2-decisions.test.ts).
 * Each one is the effect, on the reference reader, of one text replacement in the reader's decisions client
 * (packages/estate/src/pointer/yesno.ts). Empty in every other run: the reference follows the design.
 */
export type DecisionsBug =
  /** The cap of a request at 250 questions, the cap of the old yes or no form, not 100. */
  | 'cap-250'
  /** Every predicate named for unit 1 (`u1__<label>`): a request with two units repeats its names. */
  | 'unit-number-fixed'
  /** The cassette keeps only the probabilities at or above the threshold of the record run. */
  | 'record-above-threshold-only';

export const decisionsBugs = new Set<DecisionsBug>();

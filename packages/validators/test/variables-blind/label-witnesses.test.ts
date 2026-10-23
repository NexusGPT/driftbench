import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import type { Sources, StoreDoc, VariablesImpl } from '../../src/ladders/variables/interface';
import { referenceImpl } from './reference/index';

/**
 * Review of #1536 (codex-review-banks): the page (docs/variables.md R3) says how the witnesses of a labelled condition
 * relate to the label, not which outside witness a product picks. A range with the label [100, 140] needs a witness below
 * 100, the two limits, one strictly inside and one above 140; the below witness may be any number under 100, the number
 * of the wording included. A membership with the members kazu, lemi and vora needs a member and a value outside the list;
 * the outside value may be any other word, a word of the wording included. An item that bans those outputs rejects an
 * honest product. These controls choose such witnesses and must pass; the text-reading products still fail on the
 * positive checks (span-vocabulary.test.ts and the mutants of mutants.ts).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const bank = variablesBank();
const item = (key: string) => {
  const found = bank.find((entry) => entry.id === `blind.sources.labelled-condition.${key}`);
  if (!found) throw new Error(key);
  return found;
};

/** The reference, with its store changed after it is built: the change is the witness this control chooses. */
const choosing = (change: (store: StoreDoc) => void): Partial<VariablesImpl> => ({
  ...referenceImpl,
  buildStore: (sources: Sources) => {
    const store = structuredClone(referenceImpl.buildStore(sources));
    change(store);
    return store;
  },
});

describe('a range witness the page allows', () => {
  for (const below of [2, 6, -40]) {
    it(`passes when the witness below the lower limit is ${below}, a number of the wording or not`, async () => {
      const impl = choosing((store) => {
        const values = store.variables
          .flatMap((v) => v.values)
          .filter((x): x is typeof x & { sample: number } => typeof x.sample === 'number');
        // The paired witness builds other stores with no sample at all: only a store with samples gets the change.
        const lowest = values.reduce<(typeof values)[number] | undefined>(
          (a, b) => (a === undefined || b.sample < a.sample ? b : a),
          undefined,
        );
        if (lowest) lowest.sample = below;
      });
      const outcome = await runItem(item('the-label-decides-a-range'), 1, ROOT, impl);
      expect(outcome.detail).toBe('ok');
      expect(outcome.pass).toBe(true);
    });
  }
});

describe('a membership witness the page allows', () => {
  for (const outside of ['north', 'south', 'east', 'elsewhere']) {
    it(`passes when the value outside the list is ${outside}, a word of the wording or not`, async () => {
      const impl = choosing((store) => {
        for (const variable of store.variables)
          for (const value of variable.values) if (value.sample === 'other_value') value.sample = outside;
      });
      const outcome = await runItem(item('the-label-decides-a-membership'), 1, ROOT, impl);
      expect(outcome.detail).toBe('ok');
      expect(outcome.pass).toBe(true);
    });
  }
});

describe('the comparison item', () => {
  it('passes a product that also reports a boundary with the other comparison of the same limit', async () => {
    // A boundary of the opposite comparison on the same limit is not a reading of the wording; the item asks for the
    // boundary of the label and nothing about the others.
    const impl = choosing((store) => {
      for (const variable of store.variables)
        for (const boundary of variable.boundaries ?? [])
          if (boundary.comparison === 'le') {
            variable.boundaries = [
              ...(variable.boundaries ?? []),
              { ...boundary, comparison: 'gt', holds: boundary.fails, fails: boundary.holds },
            ];
            return;
          }
    });
    const outcome = await runItem(item('the-label-comparison-decides-not-the-wording'), 1, ROOT, impl);
    expect(outcome.detail).toBe('ok');
    expect(outcome.pass).toBe(true);
  });
});

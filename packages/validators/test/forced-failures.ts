import { forced, ItemFailure, isNoExpected, leaksOf } from '../src/failure';
import type { BankItem } from '../src/ladders/variables/bank/item';
import { itemRng } from '../src/ladders/variables/bank/util';

/**
 * The structural audit of docs/validators.md 12.11. A planted mutant only reaches the check sites that its failures
 * pass through. Here every check site of every item is reached: the item runs on the correct product once to count its
 * checks, then once more for each check with that check forced to fail, so its diagnostic is built and rendered.
 *
 * Two things are read off the rendered failures. First, whatever a site declares as wanted (`expected`) may not
 * appear in the part of the message the product did not write: the rule and the input. The product's own output
 * (`got`) is left out of the comparison, because the correct product returns the wanted value. Second, the sites that
 * declare nothing wanted (`none`) are listed, with their reason code, and the list is a closed set kept in a file.
 */
export type Forced = { item: string; k: number; failure: ItemFailure };

export async function forceEveryCheck(
  items: readonly BankItem[],
  impl: unknown,
  options: { seed: number; cap?: (item: BankItem) => number },
): Promise<{ failures: Forced[]; unstructured: string[]; skipped: string[] }> {
  const failures: Forced[] = [];
  const unstructured: string[] = [];
  const skipped: string[] = [];
  const ctx = (item: BankItem) => ({
    seed: options.seed,
    impl: impl as never,
    root: '/nonexistent',
    id: item.id,
    rng: itemRng(options.seed, item.id),
  });
  try {
    for (const item of items) {
      forced.at = -1;
      forced.count = 0;
      let passes = false;
      try {
        passes = (await item.check(ctx(item))).pass;
      } catch {
        passes = false;
      }
      const checks = forced.count;
      if (!passes) {
        skipped.push(item.id);
        continue;
      }
      const last = Math.min(checks, options.cap?.(item) ?? checks);
      for (let k = 1; k <= last; k += 1) {
        forced.at = k;
        forced.count = 0;
        let failure: unknown;
        try {
          const outcome = await item.check(ctx(item));
          failure = outcome.pass ? undefined : (outcome.failure ?? outcome.detail);
        } catch (error) {
          failure = error;
        }
        if (failure instanceof ItemFailure) failures.push({ item: item.id, k, failure });
        else if (failure !== undefined) unstructured.push(`${item.id}#${k}`);
      }
    }
  } finally {
    forced.at = -1;
  }
  return { failures, unstructured, skipped };
}

/** What the wanted value would leak through the rule and the input alone: the product's output is not read. */
export function leaksOutsideGot(failure: ItemFailure): string[] {
  const { got: _got, ...rest } = failure.fields;
  return leaksOf(new ItemFailure({ ...rest, got: undefined }));
}

/** The closed set of sites that declare no wanted value: one line per rule and reason code. */
export function noneSites(found: readonly Forced[]): string[] {
  const lines = new Set<string>();
  for (const { failure } of found) {
    const { expected, rule } = failure.fields;
    if (isNoExpected(expected)) lines.add(`${expected.none} :: ${rule}`);
  }
  return [...lines].sort();
}

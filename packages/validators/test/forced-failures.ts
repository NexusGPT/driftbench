import { forced, ItemFailure, isNoExpected, leaksOf } from '../src/failure';
import type { BankItem } from '../src/ladders/variables/bank/item';
import { itemRng } from '../src/ladders/variables/bank/util';

/**
 * The structural audit of docs/validators.md 12.11. A planted mutant only reaches the check sites that its failures
 * pass through. Here every check site in the source is reached: an item runs on the correct product with its checks
 * traced, and each source site not yet forced is forced to fail on its first call, so its diagnostic is built and
 * rendered. Failures are read as they come and not kept.
 *
 * Two things are read off each rendered failure. First, the wanted value a site declares (`expected`) may not appear in
 * the part of the message the product did not write: the rule and the input. The product's own output (`got`) is left
 * out, because the correct product returns the wanted value. Second, the sites that declare nothing wanted (`none`) are
 * listed with their reason code, and the list is a closed set kept in a file.
 */
export type Audit = {
  /** Sites forced, as source locations. */
  sites: number;
  /** Failures whose declared wanted value is in their rule or input, or that leak by the ordinary check. */
  leaking: string[];
  /** Forced checks that did not end in an ItemFailure. */
  unstructured: string[];
  /** One line per rule and reason code of the failures that declare no wanted value. */
  none: string[];
};

export function leaksOutsideGot(failure: ItemFailure): string[] {
  const { got: _got, ...rest } = failure.fields;
  return leaksOf(new ItemFailure({ ...rest, got: undefined }));
}

export async function auditEveryCheckSite(
  items: readonly BankItem[],
  impl: unknown,
  seed: number,
): Promise<Audit> {
  const audit: Audit = { sites: 0, leaking: [], unstructured: [], none: [] };
  const none = new Set<string>();
  const done = new Set<string>();
  const ctx = (item: BankItem) => ({
    seed,
    impl: impl as never,
    root: '/nonexistent',
    id: item.id,
    rng: itemRng(seed, item.id),
  });
  try {
    for (const item of items) {
      forced.at = -1;
      forced.count = 0;
      forced.sites = [];
      forced.trace = true;
      let passes = false;
      try {
        passes = (await item.check(ctx(item))).pass;
      } catch {
        passes = false;
      }
      forced.trace = false;
      if (!passes) continue;
      const sites = forced.sites.slice();
      for (let index = 0; index < sites.length; index += 1) {
        const site = sites[index] as string;
        if (done.has(site)) continue;
        done.add(site);
        audit.sites += 1;
        forced.at = index + 1;
        forced.count = 0;
        let failure: unknown;
        try {
          const outcome = await item.check(ctx(item));
          failure = outcome.pass ? undefined : (outcome.failure ?? outcome.detail);
        } catch (error) {
          failure = error;
        }
        if (!(failure instanceof ItemFailure)) {
          if (failure !== undefined) audit.unstructured.push(`${item.id} @ ${site}`);
          continue;
        }
        const where = `${item.id} @ ${site}`;
        for (const a of leaksOf(failure)) audit.leaking.push(`${where}: ${a}`);
        for (const a of leaksOutsideGot(failure)) audit.leaking.push(`${where}: ${a} (rule or input)`);
        const { expected, rule } = failure.fields;
        if (isNoExpected(expected)) none.add(`${expected.none} :: ${rule}`);
      }
    }
  } finally {
    forced.at = -1;
    forced.trace = false;
  }
  audit.none = [...none].sort();
  return audit;
}

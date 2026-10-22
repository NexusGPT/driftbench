import { describe, expect, it } from 'vitest';
import { leakReport } from '../../src/failure';
import type { BankItem } from '../../src/ladders/variables/bank/item';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { blindBank } from '../../src/ladders/variables/blind/index';
import { MUTANTS } from './mutants';
import { referenceImpl } from './reference/index';

/**
 * A failure message never names the expected value (docs/validators.md section 12, "What a failure message says").
 * The wrong products are the planted mutants of the reference; for each, the items it makes fail are run on seeds 1 to
 * 3 and their failures are checked on fields (`leakReport`). A failure that is not structured is counted, and the count
 * may only go down: UNSTRUCTURED_MAX is lowered as the sites are converted.
 */
const UNSTRUCTURED_MAX = Number.POSITIVE_INFINITY;

const items = blindBank().filter((i) => i.family !== 'scale');

describe('the failure messages of the blind bank repeat no expected value', () => {
  it('on the failures the planted mutants provoke, seeds 1 to 3', async () => {
    const failures: Array<{ item: string; error: unknown }> = [];
    for (const mutant of MUTANTS) {
      const { impl, reset } = mutant.make(referenceImpl);
      try {
        const list: BankItem[] = mutant.only
          ? items.filter((i) => mutant.only?.some((part) => i.id.endsWith(part)))
          : items.filter((i) => mutant.families.includes(i.family));
        for (const seed of [1, 2, 3]) {
          for (const item of list) {
            let outcome: { pass: boolean; detail: string; failure?: unknown };
            try {
              outcome = await item.check({ seed, impl, root: '/nonexistent', id: item.id, rng: itemRng(seed, item.id) });
            } catch (error) {
              failures.push({ item: item.id, error });
              continue;
            }
            if (!outcome.pass) failures.push({ item: item.id, error: outcome.failure ?? new Error(outcome.detail) });
          }
        }
      } finally {
        reset?.();
      }
    }
    const report = leakReport(failures);
    console.log(`leak report: ${report.structured} structured, ${report.unstructured} unstructured, ${report.leaking.length} leaking`);
    expect(report.leaking).toEqual([]);
    expect(report.unstructured).toBeLessThanOrEqual(UNSTRUCTURED_MAX);
    expect(report.structured).toBeGreaterThan(0);
  }, 1_800_000);
});

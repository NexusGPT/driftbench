import { describe, expect, it } from 'vitest';
import { leakReport } from '../../src/failure';
import { variablesImpl } from '../../src/ladders/variables/adapter';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { MUTANTS } from '../variables-blind/mutants';

/**
 * The failure messages of the first bank repeat no expected value (docs/validators.md 12.11). The wrong products are
 * the planted mutants, applied to the real adapter; the failures they provoke on seeds 1 to 3 go through `leakReport`.
 * UNSTRUCTURED_MAX is the number of failures that are not `ItemFailure`; it may only go down.
 */
const UNSTRUCTURED_MAX = 0;

const items = variablesBank().filter((i) => !i.id.startsWith('blind.') && i.family !== 'scale');

describe('the failure messages of the first bank', () => {
  it('repeat no expected value, and are structured', async () => {
    const failures: Array<{ item: string; error: unknown; detail: string }> = [];
    for (const mutant of MUTANTS) {
      const { impl, reset } = mutant.make(variablesImpl as never);
      try {
        const list = mutant.only
          ? items.filter((i) => mutant.only?.some((part) => i.id.endsWith(part)))
          : items.filter((i) => mutant.families.includes(i.family));
        for (const seed of [1, 2, 3]) {
          for (const item of list) {
            try {
              const r = await item.check({ seed, impl, root: '/nonexistent', id: item.id, rng: itemRng(seed, item.id) });
              if (!r.pass) failures.push({ item: item.id, error: r.failure ?? new Error(r.detail), detail: r.detail });
            } catch (error) {
              failures.push({ item: item.id, error, detail: String(error) });
            }
          }
        }
      } finally {
        reset?.();
      }
    }
    const report = leakReport(failures);
    const bySite = new Map<string, number>();
    for (const f of failures) {
      if (f.error instanceof Error && f.error.name === 'ItemFailure') continue;
      const key = f.detail.replace(/\[[^\]]*tier \d\] /, '').replace(/[0-9]+/g, '#').replace(/"[^"]*"/g, '"_"').slice(0, 70);
      bySite.set(key, (bySite.get(key) ?? 0) + 1);
    }
    console.log(`first bank: ${failures.length} failures, ${report.structured} structured, ${report.unstructured} unstructured, ${report.leaking.length} leaking, ${bySite.size} distinct unstructured messages`);
    for (const [k, n] of [...bySite].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`site ${n} x ${k}`);
    expect(report.leaking).toEqual([]);
    expect(report.unstructured).toBeLessThanOrEqual(UNSTRUCTURED_MAX);
  }, 1_800_000);
});

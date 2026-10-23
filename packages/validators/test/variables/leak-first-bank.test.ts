import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ItemFailure, leakReport } from '../../src/failure';
import { variablesImpl } from '../../src/ladders/variables/adapter';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { ceilingVerdict, readCeilings } from '../ceiling';
import { tapped, wantedInMessage } from '../leak-scan';
import { MUTANTS } from '../variables-blind/mutants';

/**
 * The failure messages of the first bank repeat no expected value (docs/validators.md 12.11). The wrong products are
 * the planted mutants, applied to the real adapter; the failures they provoke on seeds 1 to 3 go through `leakReport`.
 * The ceiling of failures that are not `ItemFailure` is committed in validators/variables/leak-ceilings.json and read
 * against the base branch; it may only go down.
 */

const items = variablesBank().filter((i) => !i.id.startsWith('blind.'));

describe('the failure messages of the first bank', () => {
  it('repeat no expected value, and are structured', async () => {
    const failures: Array<{ item: string; error: unknown; detail: string }> = [];
    const crossLeaks: string[] = [];
    const referenceTokens = new Map<string, Set<string>>();
    for (const mutant of MUTANTS) {
      const { impl, reset } = mutant.make(variablesImpl as never);
      try {
        const list = mutant.only
          ? items.filter((i) => mutant.only?.some((part) => i.id.endsWith(part)))
          : items.filter((i) => mutant.families.includes(i.family));
        for (const seed of [1, 2, 3]) {
          for (const item of list) {
            const wrongTokens = new Set<string>();
            try {
              const r = await item.check({
                seed,
                impl: tapped(impl as never, wrongTokens) as never,
                root: '/nonexistent',
                id: item.id,
                rng: itemRng(seed, item.id),
              });
              if (!r.pass) {
                const error = r.failure ?? new Error(r.detail);
                failures.push({ item: item.id, error, detail: r.detail });
                if (error instanceof ItemFailure) {
                  const key = `${seed}|${item.id}`;
                  let ref = referenceTokens.get(key);
                  if (!ref) {
                    ref = new Set<string>();
                    try {
                      await item.check({
                        seed,
                        impl: tapped(variablesImpl as never, ref) as never,
                        root: '/nonexistent',
                        id: item.id,
                        rng: itemRng(seed, item.id),
                      });
                    } catch {
                      // the correct product passes; a throw leaves what it returned so far
                    }
                    referenceTokens.set(key, ref);
                  }
                  const wanted = wantedInMessage(error, ref, wrongTokens, item.id);
                  if (wanted.length > 0)
                    crossLeaks.push(`${mutant.name}|${seed}|${item.id}: ${wanted.slice(0, 3).join(', ')} in: ${(error as Error).message.slice(0, 220)}`);
                }
              }
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
      const key = f.detail
        .replace(/\[[^\]]*tier \d\] /, '')
        .replace(/[0-9]+/g, '#')
        .replace(/"[^"]*"/g, '"_"')
        .slice(0, 120);
      bySite.set(key, (bySite.get(key) ?? 0) + 1);
    }
    console.log(
      `first bank: ${failures.length} failures, ${report.structured} structured, ${report.unstructured} unstructured, ${report.leaking.length} leaking, ${bySite.size} distinct unstructured messages`,
    );
    for (const [k, n] of [...bySite].sort((a, b) => b[1] - a[1])) console.log(`site ${n} x ${k}`);
    expect(report.leaking).toEqual([]);
    expect(crossLeaks).toEqual([]);
    const { head, base } = readCeilings(
      fileURLToPath(new URL('../../../../', import.meta.url)),
      'validators/variables/leak-ceilings.json',
      'first',
    );
    expect(ceilingVerdict(report.unstructured, head, base)).toBeUndefined();
  }, 1_800_000);
});

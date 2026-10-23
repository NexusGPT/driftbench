import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ItemFailure, leakReport } from '../../src/failure';
import type { BankItem } from '../../src/ladders/variables/bank/item';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { blindBank } from '../../src/ladders/variables/blind/index';
import { ceilingVerdict, readCeilings } from '../ceiling';
import { tapped, wantedInMessage } from '../leak-scan';
import { MUTANTS } from './mutants';
import { referenceImpl } from './reference/index';

/**
 * A failure message never names the expected value (docs/validators.md section 12, "What a failure message says").
 * The wrong products are the planted mutants of the reference; for each, the items it makes fail are run on seeds 1 to
 * 3 and their failures are checked on fields (`leakReport`). A failure that is not structured is counted, and the count
 * may only go down: the ceiling is committed in validators/variables/leak-ceilings.json and compared with the one on
 * the base branch, so a PR cannot raise it in the same diff that raises the count.
 */

// The blind scale items are converted to structured failures in the blind-bank PR; until then they stay out of this test,
// which counts them against the ceiling there, not here.
const items = blindBank().filter((i) => i.family !== 'scale');

describe('the failure messages of the blind bank repeat no expected value', () => {
  it('on the failures the planted mutants provoke, seeds 1 to 3', async () => {
    const failures: Array<{ item: string; error: unknown }> = [];
    const crossLeaks: string[] = [];
    const referenceTokens = new Map<string, Set<string>>();
    for (const mutant of MUTANTS) {
      const { impl, reset } = mutant.make(referenceImpl);
      try {
        const list: BankItem[] = mutant.only
          ? items.filter((i) => mutant.only?.some((part) => i.id.endsWith(part)))
          : items.filter((i) => mutant.families.includes(i.family));
        for (const seed of [1, 2, 3]) {
          for (const item of list) {
            let outcome: { pass: boolean; detail: string; failure?: unknown };
            const wrongTokens = new Set<string>();
            try {
              outcome = await item.check({
                seed,
                impl: tapped(impl as never, wrongTokens) as never,
                root: '/nonexistent',
                id: item.id,
                rng: itemRng(seed, item.id),
              });
            } catch (error) {
              failures.push({ item: item.id, error });
              continue;
            }
            if (!outcome.pass) {
              const error = outcome.failure ?? new Error(outcome.detail);
              failures.push({ item: item.id, error });
              const key = `${seed}|${item.id}`;
              let ref = referenceTokens.get(key);
              if (!ref) {
                ref = new Set<string>();
                try {
                  await item.check({
                    seed,
                    impl: tapped(referenceImpl as never, ref) as never,
                    root: '/nonexistent',
                    id: item.id,
                    rng: itemRng(seed, item.id),
                  });
                } catch {
                  // the reference passes; a throw leaves what it returned so far
                }
                referenceTokens.set(key, ref);
              }
              // A failure that is not an ItemFailure is counted against the ceiling; the scan reads the structured ones.
              const wanted =
                error instanceof ItemFailure ? wantedInMessage(error, ref, wrongTokens, item.id) : [];
              if (wanted.length > 0)
                crossLeaks.push(`${mutant.name}|${seed}|${item.id}: ${wanted.slice(0, 3).join(', ')} in: ${(error as Error).message.slice(0, 260)}`);
            }
          }
        }
      } finally {
        reset?.();
      }
    }
    const report = leakReport(failures);
    console.log(
      `leak report: ${report.structured} structured, ${report.unstructured} unstructured, ${report.leaking.length} leaking`,
    );
    const byRule = new Map<string, { n: number; atoms: Set<string> }>();
    for (const l of report.leaking) {
      const e = byRule.get(l.rule) ?? { n: 0, atoms: new Set<string>() };
      e.n += 1;
      for (const x of l.atoms.slice(0, 3)) e.atoms.add(x);
      byRule.set(l.rule, e);
    }
    for (const [rule, e] of [...byRule].sort((x, y) => y[1].n - x[1].n).slice(0, 12))
      console.log(
        `leak ${e.n} x ${rule.slice(0, 80)} :: ${[...e.atoms].slice(0, 4).join(' | ').slice(0, 160)}`,
      );
    expect(report.leaking).toEqual([]);
    expect(crossLeaks).toEqual([]);
    const { head, base } = readCeilings(
      fileURLToPath(new URL('../../../../', import.meta.url)),
      'validators/variables/leak-ceilings.json',
      'blind',
    );
    expect(ceilingVerdict(report.unstructured, head, base)).toBeUndefined();
    expect(report.structured).toBeGreaterThan(0);
  }, 1_800_000);
});

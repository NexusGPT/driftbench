import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Measure } from '../../src/ladder';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { IMPL_ENV } from '../../src/ladders/variables/impl';
import { variablesLadder } from '../../src/ladders/variables/index';
import type { ValidateResult, VariablesImpl } from '../../src/ladders/variables/interface';
import { referenceImpl } from '../variables-blind/reference/index';

/**
 * The canary pair (validators/variables/audit.md, cheat 1). The validator runs the bank in a child process, but the
 * implementation loads in that same process: it can rewrite the verdict lines the child prints (empty implementation
 * plus a hook on standard output: 0 of 1,111 items, then 1,111 of 1,111). Two items ask `validate` about one store, one
 * wanting it accepted and one wanting it refused. A deterministic implementation passes at most one. When both report a
 * pass, the run is void: every item of the seed counts as failing and says why.
 *
 * This does not close the class (the frame of docs/validators.md 12.9 does): it catches an implementation that flips
 * every verdict, and one that answers by the number of calls it has seen.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FEW = new Set(
  variablesBank()
    .filter((item) => item.level === 'store-core')
    .slice(0, 6)
    .map((item) => item.id),
);

async function storeCore(options: Parameters<typeof variablesLadder>[0]): Promise<Measure> {
  const level = variablesLadder(options).levels.find((l) => l.id === 'store-core');
  if (!level) throw new Error('no store-core level');
  return level.compute({ seed: 1, hidden: false, root: ROOT });
}

const isVoid = (m: Measure): boolean =>
  (m.bank ?? []).length > 0 &&
  (m.bank ?? []).every((entry) => !entry.pass && /void: /.test(entry.detail ?? ''));

describe('the canary pair', () => {
  // The child's verdicts travel on their own channel (fd 3), so a hook on standard output cannot reach them: the
  // cheat fails by construction. The run scores as the empty implementation under it does, with no item passing.
  it('gives no pass to a product that rewrites the verdicts its child prints', async () => {
    const before = process.env[IMPL_ENV];
    process.env[IMPL_ENV] = fileURLToPath(new URL('./stdout-flip-impl.ts', import.meta.url));
    try {
      const measure = await storeCore({ filter: (item) => FEW.has(item.id) });
      expect(measure.value).toBe(0);
      expect((measure.bank ?? []).length).toBeGreaterThan(0);
      expect(
        (measure.bank ?? []).filter((entry) => entry.pass).map((entry) => entry.id),
        'no item passes',
      ).toEqual([]);
    } finally {
      if (before === undefined) delete process.env[IMPL_ENV];
      else process.env[IMPL_ENV] = before;
    }
  }, 180_000);

  it('voids the run of a product that answers a store by how many times it has seen it', async () => {
    const seen = new Set<string>();
    const bySighting: Partial<VariablesImpl> = {
      ...referenceImpl,
      validate: (value): ValidateResult => {
        const key = JSON.stringify(value);
        const again = seen.has(key);
        seen.add(key);
        return again
          ? { ok: false, errors: [{ code: 'SCHEMA_CUSTOM', path: '' }] }
          : { ok: true, store: value, warnings: [] };
      },
    };
    const measure = await storeCore({ impl: bySighting, filter: (item) => FEW.has(item.id) });
    expect(measure.value).toBe(0);
    expect(isVoid(measure)).toBe(true);
  }, 120_000);

  it('does not void the run of a correct product, and counts no canary among the items of a level', async () => {
    const measure = await storeCore({ impl: referenceImpl, filter: (item) => FEW.has(item.id) });
    expect(
      (measure.bank ?? []).some((entry) => /void: /.test(entry.detail ?? '')),
      'the correct product was voided',
    ).toBe(false);
    expect((measure.bank ?? []).map((entry) => entry.id).sort()).toEqual([...FEW].sort());
  }, 120_000);

  it('does not void the run of a product that accepts everything or refuses everything', async () => {
    for (const ok of [true, false]) {
      const impl: Partial<VariablesImpl> = {
        ...referenceImpl,
        validate: (value): ValidateResult =>
          ok
            ? { ok: true, store: value, warnings: [] }
            : { ok: false, errors: [{ code: 'SCHEMA_CUSTOM', path: '' }] },
      };
      const measure = await storeCore({ impl, filter: (item) => FEW.has(item.id) });
      expect((measure.bank ?? []).some((entry) => /void: /.test(entry.detail ?? ''))).toBe(false);
    }
  }, 120_000);
});

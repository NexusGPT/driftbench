import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { BLIND_STEMS, blindBank } from '../../src/ladders/variables/blind/index';
import { expand } from '../../src/ladders/variables/blind/kit';
import { runCounting, runWitness, WITNESSES } from '../../src/ladders/variables/blind/witness';
import { WITNESS_CAUSE } from '../../src/ladders/variables/blind/witness-causes';
import { variablesImpl as empty } from '../variables/constant-empty';

/**
 * Witness-only items (r4 cause review, validators/variables/audit.md): an item whose own check the constant empty
 * implementation passes, and that fails only through the paired witness of `blind/witness.ts`. The cause of such an item
 * is the change that turns the witness green, so it is the cause of the first check of the witness that fails, and every
 * witness-only item of a function shares it and counts once. 119 of the 1,111 items carried a cause of their own that
 * only restated the permissive behaviour ("a store with no weights is valid"), which the empty function already has,
 * and so counted as 103 independent fixes where at most 8 changes (one per check of a witness) turn all of them green.
 *
 * The class is derived here, on the empty route, from the items and the witness. Nothing in this file lists an item.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CHANGES = fileURLToPath(
  new URL('../../../../validators/variables/cause-changes.json', import.meta.url),
);
const light = expand(BLIND_STEMS).filter((item) => item.family !== 'scale');
const bank = new Map(blindBank().map((item) => [item.id, item]));
const witnessCauses = new Set(Object.values(WITNESSES).flatMap((list) => list.map((w) => w.cause)));

/** For each item the empty route turns green only through a witness: the cause of the witness check that fails it. */
async function witnessOnly(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const item of light) {
    const ctx = { seed: 1, impl: empty, root: ROOT, id: item.id, rng: itemRng(1, item.id) };
    const { outcome, used } = await runCounting(item, ctx);
    if (!outcome.pass) continue;
    for (const key of used) {
      const failed = await runWitness(ctx, key);
      if (failed) {
        out.set(item.id, failed.witness.cause);
        break;
      }
    }
  }
  return out;
}

describe('the cause of a witness-only item is the cause of the witness check that fails it', () => {
  it('has the cause of the first failing witness check, for every item that only the witness fails', async () => {
    const only = await witnessOnly();
    expect(only.size, 'witness-only items on the empty route').toBeGreaterThan(0);
    const wrong: string[] = [];
    for (const [id, cause] of only) {
      const got = bank.get(id)?.cause;
      if (got !== cause) wrong.push(`${id}: "${got}" is not "${cause}"`);
    }
    expect(wrong).toEqual([]);
  }, 600_000);

  it('shares at most one cause per check of a witness among those items', async () => {
    const only = await witnessOnly();
    const causes = new Set(only.values());
    const checks = Object.values(WITNESSES).reduce((n, list) => n + list.length, 0);
    expect(causes.size).toBeLessThanOrEqual(checks);
    for (const cause of causes) expect(witnessCauses, cause).toContain(cause);
  }, 600_000);

  /**
   * Review of #1540 (codex-review-banks): two witness checks state a fix the bank already counts under another tag. The
   * witness of validate refuses a repeated value id at the second place, which is the cause of
   * `blind.values.file.references.duplicate-value-id`; the witness of weightInterval calls the (0, 10) and (50, 100) cases of
   * `blind.weights.interval.zero-of-ten` and `fifty-of-a-hundred`, which carry the Wilson cause. One fix is one tag, so
   * the witness reuses those two strings and the bank counts them once.
   */
  const CANONICAL: ReadonlyArray<{ witness: string; item: string }> = [
    {
      witness: WITNESS_CAUSE.validateDuplicateId,
      item: 'blind.values.file.references.duplicate-value-id',
    },
    { witness: WITNESS_CAUSE.weightInterval, item: 'blind.weights.interval.zero-of-ten' },
  ];

  it('reuses the cause an item of the bank already states for the same fix', () => {
    for (const { witness, item } of CANONICAL) {
      expect(bank.get(item)?.cause, `the cause of ${item}`).toBeDefined();
      expect(witness, `the witness cause for the fix ${item} states`).toBe(bank.get(item)?.cause);
    }
  });

  it('gives a cause of a witness check of its own to no item that fails on its own check, and shares only the canonical ones', async () => {
    const only = await witnessOnly();
    const canonical = new Set(CANONICAL.map((entry) => entry.witness));
    const outside = [...bank.values()].filter((item) => !only.has(item.id));
    // A fresh witness cause belongs to the class alone: an item outside it that carries the string is a different fix.
    const wrong = outside
      .filter((item) => witnessCauses.has(item.cause) && !canonical.has(item.cause))
      .map((item) => item.id);
    expect(wrong).toEqual([]);
    // A canonical cause is carried by an item outside the class: the reuse is real, not a copy of a stale string.
    for (const cause of canonical)
      expect(
        outside.some((item) => item.cause === cause),
        cause,
      ).toBe(true);
  }, 600_000);

  it('records each change in cause-changes.json by item id, with the old and the new cause', async () => {
    const only = await witnessOnly();
    const file = JSON.parse(readFileSync(CHANGES, 'utf8')) as {
      witnessOnly?: { from: string; changes: Array<{ id: string; old: string; new: string }> };
    };
    const recorded = file.witnessOnly?.changes ?? [];
    expect(file.witnessOnly?.from, 'the commit the old causes are read at').toMatch(/^[0-9a-f]{40}$/);
    expect(recorded.map((c) => c.id).sort()).toEqual([...only.keys()].sort());
    for (const change of recorded) {
      expect(change.new, change.id).toBe(only.get(change.id));
      expect(change.old, change.id).not.toBe(change.new);
    }
  }, 600_000);
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { variablesBank } from '../../src/ladders/variables/bank/index';
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
   * One fix is one tag (review of #1540, codex-review-banks). Each witness check states a fix that an item of the bank
   * already asks for with a check of its own, on the same calls, so the witness takes that item's cause and the bank counts
   * the fix once. Each row names the item whose own check does what the witness check does; a reviewer can contest a row
   * on its own.
   */
  const CANONICAL: ReadonlyArray<{ witness: string; item: string; same: string }> = [
    {
      witness: WITNESS_CAUSE.validateDuplicateId,
      item: 'blind.values.file.references.duplicate-value-id',
      same: 'validate refuses a repeated value id with VARIABLES_DUPLICATE at the second value',
    },
    {
      witness: WITNESS_CAUSE.validateNoAgent,
      item: 'blind.values.file.references.agent-missing',
      same: 'validate refuses a store with no agent with SCHEMA_INVALID_TYPE at agent',
    },
    {
      witness: WITNESS_CAUSE.quotesAbsent,
      item: 'blind.quotes.check.quote-is-not-found',
      same: 'quotes reports VARIABLES_QUOTE_NOT_FOUND for a quote its file does not hold',
    },
    {
      witness: WITNESS_CAUSE.quotesUnreadable,
      item: 'blind.quotes.check.file-is-missing',
      same: 'quotes reports VARIABLES_SOURCE_UNREADABLE for a quote whose file is not given',
    },
    {
      witness: WITNESS_CAUSE.coverage,
      item: 'blind.counter.exact.pairs-unconstrained',
      same: 'coverage counts the allowed pairs of binary axes and the pairs the rows hold, exactly',
    },
    {
      witness: WITNESS_CAUSE.weightInterval,
      item: 'blind.weights.interval.zero-of-ten',
      same: 'weightInterval returns the Wilson interval for (0, 10) and for a share near a half',
    },
    {
      witness: WITNESS_CAUSE.buildStore,
      item: 'sources.estate.tool-field-variable.enum-three',
      same: 'buildStore turns the values of a tool field into one variable with one value each',
    },
    {
      witness: WITNESS_CAUSE.plan,
      item: 'blind.impossible.never-appears.dense-pairs',
      same: 'plan returns sound rows that keep the impossible pairs out and cover every allowed tuple',
    },
  ];
  const everything = new Map(variablesBank().map((item) => [item.id, item]));

  it('names, for each witness check, the item of the bank whose own check does the same', () => {
    expect(CANONICAL.map((entry) => entry.witness).sort()).toEqual([...witnessCauses].sort());
    for (const { item, same } of CANONICAL) expect(everything.get(item), `${item}: ${same}`).toBeDefined();
  });

  it('gives every witness check the cause of that item', () => {
    for (const { witness, item } of CANONICAL)
      expect(witness, `the witness cause for the fix ${item} states`).toBe(everything.get(item)?.cause);
  });

  it('shares each witness cause with an item that fails on its own check, so no fix is counted twice', async () => {
    const only = await witnessOnly();
    for (const { witness, item } of CANONICAL) {
      expect(only.has(item), `${item} fails on its own check, so it is not in the class`).toBe(false);
      expect(
        [...everything.values()].some((entry) => entry.cause === witness && !only.has(entry.id)),
        witness,
      ).toBe(true);
    }
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

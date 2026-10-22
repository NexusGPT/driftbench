import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { variablesImpl } from '../../src/ladders/variables/adapter';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { itemRng } from '../../src/ladders/variables/bank/util';
import { type Reads, readsHash, recorded } from '../read-order';
import { referenceImpl } from '../variables-blind/reference/index';

/**
 * The generic guard against eager diagnostics (docs/validators.md 12.11, review of #1385 and #1387). Every item of
 * the blind bank runs on seeds 1 to 3 against the reference, and every item of the first bank against the real
 * adapter, with the product's answers recorded: each property read, in order. On a run that passes, the sequence must
 * equal the one taken on the base branch (`validators/variables/read-order.json`). A diagnostic that reads the
 * product before the verdict is decided adds a read to a passing run and changes the hash, wherever it sits.
 *
 * Only runs that pass are compared: a failing run reads the product to describe the failure, and what it reads is
 * the item's own business. To take a new snapshot on a base branch: UPDATE_READ_ORDER=1.
 */
const FILE = fileURLToPath(new URL('../../../../validators/variables/read-order.json', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEEDS = [1, 2, 3];

type Snapshot = Record<string, string>;

describe('the read sequence of every passing item is that of the base branch', () => {
  it('matches the snapshot, item by item', async () => {
    const snapshot: Snapshot = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Snapshot) : {};
    const next: Snapshot = {};
    const items = variablesBank().filter((i) => i.family !== 'scale');
    for (const item of items) {
      const product = item.id.startsWith('blind.') ? referenceImpl : variablesImpl;
      const kind = item.id.startsWith('blind.') ? 'blind' : 'first';
      for (const seed of SEEDS) {
        const reads: Reads = { log: [] };
        let pass = false;
        try {
          const r = await item.check({
            seed,
            impl: recorded(product as never, reads) as never,
            root: ROOT,
            id: item.id,
            rng: itemRng(seed, item.id),
          });
          pass = r.pass;
        } catch {
          pass = false;
        }
        if (pass) next[`${kind}|${seed}|${item.id}`] = readsHash(reads);
      }
    }
    if (process.env.UPDATE_READ_ORDER) {
      writeFileSync(FILE, `${JSON.stringify(next, null, 0).replace(/,"/g, ',\n"')}\n`);
      return;
    }
    const changed: string[] = [];
    const missing: string[] = [];
    for (const [key, hash] of Object.entries(snapshot)) {
      if (!(key in next)) missing.push(`${key} passed on the base and does not pass here`);
      else if (next[key] !== hash) changed.push(`${key} reads the product in another order or more often`);
    }
    expect(changed).toEqual([]);
    expect(missing).toEqual([]);
    expect(Object.keys(snapshot).length).toBeGreaterThan(0);
  }, 3_000_000);
});

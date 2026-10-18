import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as store from '@agent-nexus/driftbench-store';
import { afterAll, expect, it, vi } from 'vitest';
import { adaptersItems, newerSchemas } from '../../src/ladders/system/bank/claims/adapters';

/**
 * The newer-schema refusal items, against a store that regresses: one that opens a file and imports a bundle of
 * exactly one newer schema (5) and refuses every other. The items draw SCHEMA_VERSION + 1 + (seed % 4) as they
 * always did, and add SCHEMA_VERSION + 1 on every seed: on the seeds that draw 5 they must fail on it.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});
const ACCEPTED = 5;
const ids = ['claim/adapters/store-newer-schema-version', 'claim/adapters/store-bundle-newer-schema'];
const items = adaptersItems().filter((entry) => ids.includes(entry.id));

async function check(id: string, seed: number) {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing ${id}`);
  const scratch = await mkdtemp(join(tmpdir(), 'driftbench-newer-schema-'));
  made.push(scratch);
  return item.check({ seed, root, scratch });
}

/** The regressed store: a file or a bundle at exactly ACCEPTED is taken in, every other newer one refused. */
function acceptExactly() {
  const original = store.openStore;
  return vi.spyOn(store, 'openStore').mockImplementation((path) => {
    if (path !== ':memory:') {
      const db = new DatabaseSync(path);
      const version = Number(
        (db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version,
      );
      db.close();
      if (version === ACCEPTED) return { close: async () => undefined } as unknown as store.SqliteStore;
    }
    const opened = original(path);
    const importCampaign = opened.importCampaign.bind(opened);
    opened.importCampaign = async (folder: string) => {
      const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as {
        schemaVersion?: number;
      };
      if (manifest.schemaVersion === ACCEPTED) return { campaignId: 'taken', runs: 0 } as never;
      return importCampaign(folder);
    };
    return opened;
  });
}

it('every seed writes the version the seed draws, as before, and the next version', () => {
  for (const seed of [0, 1, 2, 3, 5, 15401, 61613, 999983064]) {
    const versions = newerSchemas(seed);
    expect(versions).toContain(store.SCHEMA_VERSION + 1 + (seed % 4));
    expect(versions).toContain(store.SCHEMA_VERSION + 1);
  }
});

for (const id of ids) {
  for (const seed of [5, 15401, 61613]) {
    it(`${id} fails on seed ${seed} against a store that takes in exactly schema ${ACCEPTED}`, async () => {
      expect(newerSchemas(seed)).toContain(ACCEPTED);
      await expect(check(id, seed)).resolves.toEqual({ pass: true });
      const spy = acceptExactly();
      try {
        const result = await check(id, seed);
        expect(result.pass).toBe(false);
        if (!result.pass) expect(result.detail).toContain(`version ${ACCEPTED}`);
      } finally {
        spy.mockRestore();
      }
    }, 120_000);
  }
}

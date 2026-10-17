import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { provenanceDigest, provenanceHash, type RunResult } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryStore, openStore, type SqliteStore } from '../src/index';
import { block, campaign, run, tempDir } from './fixtures';

/**
 * Blast radius of PR 430 (merged) on the store: a block's `realized` (the hash of the text a driver sent,
 * and the text when the run kept it). One campaign mixes a record written before the field existed, a
 * hash-only record and a record that kept the text; each must read back exactly as written, from the
 * database and through a bundle, so the provenance digest that covers `realized` still matches.
 */
const ID = 'acme-2026-10-11';
const SENT = 'hey, fibre at my place?';
const HASH = provenanceHash(SENT);

const old = run({ repeat: 0 });
const hashed = run({ repeat: 1, blocks: [block(0, { realized: { hash: HASH } }), block(1)] });
const kept = run({ repeat: 2, blocks: [block(0), block(1, { realized: { hash: HASH, text: SENT } })] });
const mixed = [old, hashed, kept];

let dir = '';
let store: SqliteStore;
beforeEach(async () => {
  dir = await tempDir();
  store = openStore(join(dir, 'runs.db'));
  // These round-trip tests retain text explicitly; the store strips it without this opt-in.
  await store.putCampaign(campaign(ID, { provenance: { version: 2, adapters: [], realizedText: true } }));
  for (const each of mixed) await store.putRun(ID, each);
});
afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

const byRepeat = (a: RunResult, b: RunResult) => a.repeat - b.repeat;
const realizedOf = (runs: readonly RunResult[]) => runs.map((each) => each.blocks.map((b) => b.realized));
const expected = [
  [undefined, undefined],
  [{ hash: HASH }, undefined],
  [undefined, { hash: HASH, text: SENT }],
];

describe('PR 430 blast radius: the store and a block realized text', () => {
  it('reads a mixed campaign back exactly: no field on the old record, the hash, the hash and text', async () => {
    const back = (await store.listRuns({ campaignId: ID })).sort(byRepeat);
    expect(realizedOf(back)).toEqual(expected);
    expect(
      back.every((each) => each.blocks.every((b) => b.realized === undefined || 'hash' in b.realized)),
    ).toBe(true);
    expect('realized' in (back[0]?.blocks[0] ?? {})).toBe(false);
    for (const each of mixed) expect(await store.getRun(each.runId, ID)).toEqual(each);
  });

  it('keeps the provenance digest of each record through the database, a reopen included', async () => {
    await store.close();
    store = openStore(join(dir, 'runs.db'));
    const back = (await store.listRuns({ campaignId: ID })).sort(byRepeat);
    expect(back.map((each) => provenanceDigest(each))).toEqual(mixed.map((each) => provenanceDigest(each)));
    // The digest of the record with text differs from the hash-only one only by what realized holds.
    expect(provenanceDigest(back[1] as RunResult)).not.toBe(provenanceDigest(old));
  });

  it('carries realized through an exported bundle into another store', async () => {
    const folder = await store.exportCampaign(ID, join(dir, 'out'));
    const other = openMemoryStore();
    try {
      await other.importCampaign(folder);
      const back = (await other.listRuns({ campaignId: ID })).sort(byRepeat);
      expect(realizedOf(back)).toEqual(expected);
      expect(back.map((each) => provenanceDigest(each))).toEqual(mixed.map((each) => provenanceDigest(each)));
    } finally {
      await other.close();
    }
  });

  it('refuses a realized hash that is not 64 hex characters', async () => {
    const bad = run({ repeat: 3, blocks: [block(0, { realized: { hash: 'abc' } }), block(1)] });
    await expect(store.putRun(ID, bad)).rejects.toThrow(/INVALID_RECORD|realized/);
  });
});

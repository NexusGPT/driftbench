import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Campaign, provenanceHash } from '@agent-nexus/driftbench-core';
import { afterEach, expect, it, vi } from 'vitest';
import { openMemoryStore, openStore } from '../src/index';
import { block, campaign, run, tempDir } from './fixtures';

afterEach(() => vi.restoreAllMocks());

it('validates an unchanged campaign once across its run writes', async () => {
  const store = openMemoryStore();
  try {
    const value = campaign('many', {
      specs: Array.from({ length: 200 }, (_, i) => ({ id: `spec-${i}`, hash: `hash-${i}` })),
    });
    await store.putCampaign(value);
    const parse = vi.spyOn(Campaign, 'safeParse');
    for (let i = 0; i < 40; i++) await store.putRun('many', run({ runId: `run-${i}` }));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(await store.listRuns({ campaignId: 'many' })).toHaveLength(40);
  } finally {
    await store.close();
  }
});

it('revalidates a changed row and applies the current text policy after a cached write', async () => {
  const dir = await tempDir();
  const path = join(dir, 'policy.db');
  const store = openStore(path);
  const raw = new DatabaseSync(path);
  const text = 'Fictional Acme user turn';
  const record = run({ blocks: [block(0, { realized: { hash: provenanceHash(text), text } })] });
  const value = campaign('policy', { provenance: { version: 2, adapters: [], realizedText: true } });
  try {
    await store.putCampaign(value);
    await store.putRun('policy', record);
    expect((await store.getRun(record.runId, 'policy'))?.blocks[0]?.realized?.text).toBe(text);
    raw
      .prepare('UPDATE campaigns SET json = ? WHERE id = ?')
      .run(JSON.stringify(campaign('policy')), 'policy');
    await store.putRun('policy', record);
    expect((await store.getRun(record.runId, 'policy'))?.blocks[0]?.realized).toEqual({
      hash: provenanceHash(text),
    });
    for (const json of [
      '[',
      JSON.stringify({ ...value, repeats: null }),
      JSON.stringify(campaign('other')),
    ]) {
      raw.prepare('UPDATE campaigns SET json = ? WHERE id = ?').run(json, 'policy');
      await expect(store.putRun('policy', record)).rejects.toMatchObject({ code: 'CORRUPT_ROW' });
    }
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare('DELETE FROM campaigns WHERE id = ?').run('policy');
    await expect(store.putRun('policy', record)).rejects.toMatchObject({ code: 'CAMPAIGN_MISSING' });
  } finally {
    raw.close();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { provenanceDigest, provenanceHash } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeCampaignBundle } from '../src/bundle';
import { openMemoryStore, openStore, readCampaignBundle } from '../src/index';
import { block, campaign, run, tempDir } from './fixtures';

const TEXT = 'private driver turn, carried from a recorded baseline';
const source = () => {
  const value = run({
    runId: 'source-run',
    blocks: [block(0, { realized: { hash: provenanceHash(TEXT), text: TEXT } })],
  });
  return { ...value, provenanceDigest: provenanceDigest(value) };
};
const optedIn = { version: 2 as const, adapters: [], realizedText: true as const };
let store: ReturnType<typeof openMemoryStore>;
let dir: string;
beforeEach(async () => {
  store = openMemoryStore();
  dir = await tempDir();
});
afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

it('applies the destination policy at putRun without mutating a recorded source', async () => {
  const original = source();
  await store.putCampaign(campaign('base', { provenance: optedIn }));
  await store.putRun('base', original);
  await store.putCampaign(campaign('hash-only'));
  await store.putRun('hash-only', original);
  const saved = await store.getRun(original.runId, 'hash-only');
  expect(saved?.blocks[0]?.realized).toEqual({ hash: provenanceHash(TEXT) });
  expect(saved?.realizedTextStripped).toEqual({ fromRun: original.runId });
  if (!saved) throw new Error('missing stored run');
  expect(saved.provenanceDigest).toBe(provenanceDigest(saved));
  expect(saved?.provenanceDigest).not.toBe(original.provenanceDigest);
  expect(await store.getRun(original.runId, 'base')).toEqual(original);
  expect(original.blocks[0]?.realized?.text).toBe(TEXT);
});

it('exports hash-only campaigns without text, including records from older stores', async () => {
  const original = source();
  // Exercise the export boundary directly with a pre-fix record.
  const folder = await writeCampaignBundle(dir, campaign('legacy'), [original]);
  const bundle = await readCampaignBundle(folder);
  expect(await readFile(join(folder, 'runs', 'source-run.json'), 'utf8')).not.toContain(TEXT);
  expect(bundle.runs[0]?.blocks[0]?.realized).toEqual({ hash: provenanceHash(TEXT) });
  const exported = bundle.runs[0];
  if (!exported) throw new Error('missing exported run');
  expect(exported.provenanceDigest).toBe(provenanceDigest(exported));
  expect(original.blocks[0]?.realized?.text).toBe(TEXT);
});

it.each([false, true])('imports using the bundled campaign opt-in (%s)', async (record) => {
  const original = source();
  const folder = await writeCampaignBundle(dir, campaign('imported', { provenance: optedIn }), [original]);
  if (!record) {
    // A valid pre-fix bundle: its hash-only campaign contains an unstripped run.
    const oldCampaign = campaign('imported');
    await writeFile(join(folder, 'campaign.json'), JSON.stringify(oldCampaign));
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    manifest.hashes['campaign.json'] = provenanceHash(oldCampaign);
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest));
  }
  const imported = await store.importCampaign(folder);
  const saved = await store.getRun(original.runId, 'imported');
  expect(saved?.blocks[0]?.realized).toEqual({
    hash: provenanceHash(TEXT),
    ...(record ? { text: TEXT } : {}),
  });
  expect(imported.runs).toEqual([saved]);
  if (!saved) throw new Error('missing stored run');
  expect(saved.provenanceDigest).toBe(provenanceDigest(saved));
  const exported = await store.exportCampaign('imported', join(dir, 'again'));
  expect((await readCampaignBundle(exported)).runs).toEqual([saved]);
});

it('never invents text when the destination opts in but the source has only a hash', async () => {
  await store.putCampaign(campaign('recorded', { provenance: optedIn }));
  const original = source();
  delete original.blocks[0]?.realized?.text;
  original.provenanceDigest = provenanceDigest(original);
  await store.putRun('recorded', original);
  expect(await store.getRun(original.runId, 'recorded')).toEqual(original);
});

it('never writes stripped text into the destination database bytes', async () => {
  const path = join(dir, 'private-copy.db');
  const destination = openStore(path);
  try {
    await destination.putCampaign(campaign('hash-only'));
    await destination.putRun('hash-only', source());
    const [saved] = await destination.listRuns({ campaignId: 'hash-only' });
    expect(saved?.blocks[0]?.realized).toEqual({ hash: provenanceHash(TEXT) });
  } finally {
    await destination.close();
  }
  expect((await readFile(path)).toString('latin1')).not.toContain(TEXT);
});

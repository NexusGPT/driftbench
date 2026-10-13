import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMAT,
  openMemoryStore,
  readCampaignBundle,
  SCHEMA_VERSION,
  type SqliteStore,
} from '../src/index';
import { block, campaign, perturbedRun, run, storeError, tempDir } from './fixtures';

const ID = 'acme-2026-10-11';

let store: SqliteStore;
let dir: string;
let runs: RunResult[];

beforeEach(async () => {
  store = openMemoryStore();
  dir = await tempDir();
  runs = [run(), run({ repeat: 1, status: 'failed', error: 'agent 503' }), perturbedRun()];
  await store.putCampaign(campaign());
  for (const each of runs) await store.putRun(ID, each);
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

const byRunId = (a: RunResult, b: RunResult) => a.runId.localeCompare(b.runId);

describe('exportCampaign', () => {
  it('writes campaign.json, one file per run and a manifest with the schema version and counts', async () => {
    const folder = await store.exportCampaign(ID, dir);
    expect(relative(dir, folder)).toBe(ID);
    expect((await readdir(folder)).sort()).toEqual(['campaign.json', 'manifest.json', 'runs']);
    expect((await readdir(join(folder, 'runs'))).sort()).toEqual(
      runs.map((each) => `${each.runId}.json`).sort(),
    );

    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    expect(manifest).toStrictEqual({
      format: BUNDLE_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      campaignId: ID,
      counts: { runs: 3, blocks: 2 + 2 + 3 },
      hashes: expect.any(Object),
    });
    expect(JSON.parse(await readFile(join(folder, 'campaign.json'), 'utf8'))).toStrictEqual(campaign());
  });

  it('reads back through readCampaignBundle and imports into another store', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const bundle = await readCampaignBundle(folder);
    expect(bundle.campaign).toStrictEqual(campaign());
    expect([...bundle.runs].sort(byRunId)).toStrictEqual([...runs].sort(byRunId));

    const other = openMemoryStore();
    try {
      const imported = await other.importCampaign(folder);
      expect(imported.manifest.counts).toEqual({ runs: 3, blocks: 7 });
      expect(await other.getCampaign(ID)).toStrictEqual(campaign());
      expect(await other.listRuns({ campaignId: ID })).toStrictEqual(
        await store.listRuns({ campaignId: ID }),
      );
      await other.importCampaign(folder);
      expect(await other.listRuns()).toHaveLength(3);
    } finally {
      await other.close();
    }
  });

  it('re-exports into the same folder after a resume', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const extra = run({ repeat: 2 });
    await store.putRun(ID, extra);
    expect(await store.exportCampaign(ID, dir)).toBe(folder);
    const bundle = await readCampaignBundle(folder);
    expect(bundle.runs.map((each) => each.runId)).toContain(extra.runId);
    expect(bundle.manifest.counts.runs).toBe(4);
  });

  it('keeps ids that are not file names inside the folder', async () => {
    const odd = '../acme/*2026';
    await store.putCampaign(campaign(odd));
    await store.putRun(odd, run({ runId: '../run:1' }));
    const folder = await store.exportCampaign(odd, dir);
    expect(relative(dir, folder)).toBe('%2E.%2Facme%2F%2A2026');
    expect(await readdir(join(folder, 'runs'))).toEqual(['%2E.%2Frun%3A1.json']);
    expect((await readCampaignBundle(folder)).runs[0]?.runId).toBe('../run:1');
  });

  it('refuses a campaign the store does not hold', async () => {
    expect((await storeError(() => store.exportCampaign('acme-unknown', dir))).code).toBe('CAMPAIGN_MISSING');
  });
});

describe('readCampaignBundle', () => {
  it('refuses a folder with no manifest: an export that did not finish', async () => {
    const folder = await store.exportCampaign(ID, dir);
    await rm(join(folder, 'manifest.json'));
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain('cannot read manifest.json');
  });

  it('refuses a run file the manifest does not count', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const stray = run({ repeat: 7 });
    await writeFile(join(folder, 'runs', `${stray.runId}.json`), JSON.stringify(stray));
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain('holds 4 runs and 9 blocks, its manifest counts 3 and 7');
  });

  it('refuses a corrupt run file and names it', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const [first] = (await readdir(join(folder, 'runs'))).sort();
    await writeFile(join(folder, 'runs', String(first)), '{"runId": ');
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain(`runs/${first} is not JSON`);
  });

  it('refuses a run file that does not match the schema', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const [first] = (await readdir(join(folder, 'runs'))).sort();
    const path = join(folder, 'runs', String(first));
    await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), mode: 'X' }));
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain('does not match the RunResult schema: mode');
  });

  it('refuses a bundle from a newer schema', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const path = join(folder, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...manifest, schemaVersion: SCHEMA_VERSION + 1 }));
    expect((await storeError(() => readCampaignBundle(folder))).code).toBe('SCHEMA_VERSION');
  });

  it('refuses a campaign file that names another campaign', async () => {
    const folder = await store.exportCampaign(ID, dir);
    await writeFile(join(folder, 'campaign.json'), JSON.stringify(campaign('acme-other')));
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain('holds campaign acme-other');
  });
});

describe('the record hashes', () => {
  it('refuses a run file edited after the export, naming it', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const [file] = (await readdir(join(folder, 'runs'))).sort();
    const path = join(folder, 'runs', file as string);
    const edited = JSON.parse(await readFile(path, 'utf8'));
    edited.cost += 1;
    await writeFile(path, JSON.stringify(edited));
    const error = await storeError(() => readCampaignBundle(folder));
    expect(error.code).toBe('BUNDLE_INVALID');
    expect(error.message).toContain(`runs/${file} does not match the hash its manifest records`);
  });
});

describe('importCampaign', () => {
  it('stores nothing when one run of the bundle is refused', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const bad = run({ repeat: 5, blocks: [block(1), block(0)] });
    await writeFile(join(folder, 'runs', `${bad.runId}.json`), JSON.stringify(bad));
    const path = join(folder, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...manifest, counts: { runs: 4, blocks: 9 } }));

    const other = openMemoryStore();
    try {
      expect((await storeError(() => other.importCampaign(folder))).code).toBe('INVALID_RECORD');
      expect(await other.getCampaign(ID)).toBeUndefined();
      expect(await other.listRuns()).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it('refuses a bundle whose campaign differs from the one the store holds', async () => {
    const folder = await store.exportCampaign(ID, dir);
    const other = openMemoryStore();
    try {
      await other.putCampaign(campaign(ID, { budgetUsd: 99 }));
      expect((await storeError(() => other.importCampaign(folder))).code).toBe('CAMPAIGN_CONFLICT');
      expect(await other.listRuns()).toEqual([]);
    } finally {
      await other.close();
    }
  });
});

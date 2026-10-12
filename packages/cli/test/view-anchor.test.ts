import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLabels } from '@driftbench/judges';
import { openStore } from '@driftbench/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { startViewer, type Viewer } from '../src/view/server';

let dir = '';
let viewer: Viewer;
let labels = '';
let runPage = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-anchor-'));
  const db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-x3', modes: ['F'], repeats: 1, fault: 'x3-skips-recap' });
  } finally {
    await store.close();
  }
  labels = join(dir, 'labels');
  viewer = await startViewer({ store: db, labels, port: 0, labelledBy: 'a reviewer' });
  const page = await (await fetch(`${viewer.url}/campaign/c-x3`)).text();
  const link = [...page.matchAll(/href="(\/campaign\/[^/"]+\/run\/[^"#]+)"/g)][0]?.[1] as string;
  runPage = await (await fetch(`${viewer.url}${link}`)).text();
}, 120_000);

afterAll(async () => {
  await viewer?.close();
  await rm(dir, { recursive: true, force: true });
});

function runIdOf(): string {
  const match = runPage.match(/name="run" value="([^"]+)"/);
  return match?.[1] ?? '';
}

async function save(fields: Record<string, string>): Promise<Response> {
  return fetch(`${viewer.url}/labels`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ campaign: 'c-x3', run: runIdOf(), criterion: 'no_invented_data', label: 'pass', ...fields }),
  });
}

describe('the label form picks an anchor: a message or a tool call of the block', () => {
  it('offers the messages of a block and each tool call as anchor options', () => {
    expect(runPage).toContain('<select name="anchor"');
    expect(runPage).toMatch(/<option value="message:0"/);
    expect(runPage).toMatch(/<option value="tool:[^"]+:1"/);
  });

  it('saves a message anchor into the label file', async () => {
    const response = await save({ block: '1', anchor: 'message:1' });
    expect(response.status).toBe(303);
    const loaded = await loadLabels(labels);
    const row = (loaded.labels.get('no_invented_data') ?? []).find((entry) => entry.id.endsWith('.b1'));
    expect(row?.anchor).toEqual({ kind: 'message', index: 1 });
  });

  it('saves a tool-call anchor, by tool name and occurrence', async () => {
    const match = runPage.match(/<option value="(tool:[^"]+:1)"/);
    const option = match?.[1] ?? '';
    expect(option).not.toBe('');
    const response = await save({ block: '1', anchor: option });
    expect(response.status).toBe(303);
    const loaded = await loadLabels(labels);
    const row = (loaded.labels.get('no_invented_data') ?? []).find((entry) => entry.id.endsWith('.b1'));
    expect(row?.anchor?.kind).toBe('tool_call');
  });

  it('refuses an anchor the block does not have, with bad input', async () => {
    const response = await save({ block: '1', anchor: 'message:999' });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/not an anchor of this block/);
  });

  it('saves a label with no anchor when none is picked', async () => {
    const response = await save({ block: '3', anchor: 'none', label: 'fail' });
    expect(response.status).toBe(303);
    const loaded = await loadLabels(labels);
    const row = (loaded.labels.get('no_invented_data') ?? []).find((entry) => entry.id.endsWith('.b3'));
    expect(row?.anchor).toBeUndefined();
  });
});

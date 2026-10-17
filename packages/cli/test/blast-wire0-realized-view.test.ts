import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provenanceHash } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { startViewer, type Viewer } from '../src/view/server';

/**
 * Blast radius of PR 430 (merged) on the viewer (`driftbench view`): the run page shows a block's text as
 * written and as sent, and a label saved there keeps the transcript `judge calibrate` reads. The label's
 * user message must be the one the agent received.
 */
const SENT = 'blast-wire0 the text the simulated user sent <b>bold</b>';

let dir = '';
let viewer: Viewer;
let labels = '';
let runId = '';
let authored = '';
let page = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blast-wire0-view-'));
  const db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    const original = await storeAcmeCampaign(store, {
      campaignId: 'seed',
      modes: ['F'],
      repeats: 1,
      fault: 'x3-skips-recap',
    });
    // Campaigns are immutable: copy into a destination that explicitly retains the displayed text.
    await store.putCampaign({
      ...original,
      campaignId: 'c-x3',
      provenance: { version: 2, adapters: [], realizedText: true },
    });
    // Block 1 of every run: its driver sent SENT, and the run kept the text.
    for (const run of await store.listRuns({ campaignId: 'seed' })) {
      const changed = structuredClone(run);
      const block = changed.blocks[1];
      if (!block) continue;
      block.realized = { hash: provenanceHash(SENT), text: SENT };
      await store.putRun('c-x3', changed);
    }
  } finally {
    await store.close();
  }
  labels = join(dir, 'labels');
  viewer = await startViewer({ store: db, labels, port: 0, labelledBy: 'a reviewer' });
  const campaignPage = await (await fetch(`${viewer.url}/campaign/c-x3`)).text();
  const links = [...campaignPage.matchAll(/href="(\/campaign\/[^/"]+\/run\/[^"#]+)"/g)].map(
    (match) => match[1] as string,
  );
  for (const link of links) {
    const text = await (await fetch(`${viewer.url}${link}`)).text();
    if (text.includes('<option value="no_invented_data">')) {
      page = text;
      runId = text.match(/name="run" value="([^"]+)"/)?.[1] ?? '';
      break;
    }
  }
  const verify = openStore(db);
  try {
    const run = await verify.getRun(runId, 'c-x3');
    const spec = run ? (await verify.getSpec(run.specId, run.specHash))?.spec : undefined;
    authored = (spec?.blocks[1]?.when as { user?: string } | undefined)?.user ?? '';
  } finally {
    await verify.close();
  }
}, 120_000);

afterAll(async () => {
  await viewer?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('PR 430 blast radius: the viewer and the text a driver sent', { timeout: 60_000 }, () => {
  it('shows the block as written and as sent, the sent text escaped', () => {
    expect(runId).not.toBe('');
    expect(authored).not.toBe('');
    expect(page).toContain('User, as sent');
    expect(page).toContain('blast-wire0 the text the simulated user sent &lt;b&gt;bold&lt;/b&gt;');
    expect(page).not.toContain('<b>bold</b>');
  });
});

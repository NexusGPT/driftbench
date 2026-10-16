import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provenanceHash, type Stimulus } from '@agent-nexus/driftbench-core';
import { loadLabels, readLabelFile } from '@agent-nexus/driftbench-judges';
import { runDetailOf } from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataOf, run, storeAcmeCampaign } from '../../report/test/support';
import { anchorOptions, startViewer, type Viewer } from '../src/view/server';

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
let csrf = '';

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
      csrf = text.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
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

  it('saves a label whose transcript holds the user message the agent received', async () => {
    const response = await fetch(`${viewer.url}/labels`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
      body: new URLSearchParams({
        csrf,
        campaign: 'c-x3',
        run: runId,
        criterion: 'no_invented_data',
        label: 'pass',
        block: '1',
      }),
    });
    expect(response.status).toBe(303);
    const loaded = await loadLabels(labels);
    const row = (loaded.labels.get('no_invented_data') ?? []).find((entry) => entry.id.endsWith('.b1'));
    const users = (row?.transcript ?? []).filter((entry) => entry.role === 'user').map((entry) => entry.text);
    expect(users).toEqual([SENT]);
  });
});

it.each([false, true])('hash-only viewer labels require the authored hash (matches=%s)', async (matches) => {
  const store = openStore(join(dir, 'store.db'));
  try {
    const run = await store.getRun(runId, 'c-x3');
    if (!run?.blocks[1]) throw new Error('missing fixture run');
    run.blocks[1].realized = { hash: provenanceHash(matches ? authored : SENT) };
    await store.putRun('c-x3', run);
  } finally {
    await store.close();
  }
  const response = await fetch(`${viewer.url}/labels`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
    body: new URLSearchParams({
      csrf,
      campaign: 'c-x3',
      run: runId,
      criterion: 'no_invented_data',
      label: 'pass',
      block: '1',
      anchor: 'message:0',
    }),
  });
  expect(response.status).toBe(303);
  const rendered = await (await fetch(new URL(response.headers.get('location') ?? '', viewer.url))).text();
  if (!matches) expect(rendered).toContain('Sent text not stored; excluded from calibration');
  const saved = await readLabelFile(labels, 'no_invented_data');
  const row = saved.find((entry) => entry.id.endsWith('.b1'));
  expect(row?.transcript.filter((entry) => entry.role === 'user').map((entry) => entry.text)).toEqual(
    matches ? [authored] : [],
  );
  expect(row?.flags).toEqual(matches ? undefined : ['sent text not stored']);
  expect(row?.transcript[0]?.role).toBe(matches ? 'user' : 'tool_call');
  expect(row?.anchor).toEqual({ kind: 'message', index: 0 });
  const loaded = await loadLabels(labels);
  expect(loaded.labels.get('no_invented_data')).toHaveLength(matches ? 1 : 0);
});

it.each([
  [{ burst: ['first', 'second'] }, 'first\nsecond'],
  [{ injection: { class: 'D2_goal_shift', user: 'injected' } }, 'injected'],
] satisfies [Stimulus, string][])('keeps exact authored text apart from display labels', (when, text) => {
  const result = run({ blocks: [{ text: 'reply' }] });
  const data = dataOf([result], { 'spec-a': { blocks: [{ when }] } });
  const block = runDetailOf(data, result).blocks[0];
  expect(block?.authoredText).toBe(text);
  if (!block) throw new Error('missing block');
  block.realized = { hash: provenanceHash(text) };
  expect(anchorOptions(block)).toContainEqual({
    value: 'message:0',
    label: 'line 0: user',
    anchor: { kind: 'message', index: 0 },
  });
});

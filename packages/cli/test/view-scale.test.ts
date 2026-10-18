import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyQueue, enqueue, writeQueue } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { startViewer, type Viewer } from '../src/view/server';

let dir = '';
let viewer: Viewer;
let runId = '';
let csrf = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-scale-'));
  const db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-x3', modes: ['F'], repeats: 1, fault: 'x3-skips-recap' });
  } finally {
    await store.close();
  }
  const labels = join(dir, 'labels');
  viewer = await startViewer({
    store: db,
    labels,
    port: 0,
    labelledBy: 'a reviewer',
    scales: { no_invented_data: { min: 1, max: 5 } },
  });
  const page = await (await fetch(`${viewer.url}/campaign/c-x3`)).text();
  // A label goes only on a criterion the block offers: the run must be one whose form offers no_invented_data.
  const links = [...page.matchAll(/href="(\/campaign\/[^/"]+\/run\/[^"#]+)"/g)].map(
    (match) => match[1] as string,
  );
  let runPage = '';
  for (const link of links) {
    const text = await (await fetch(`${viewer.url}${link}`)).text();
    if (text.includes('<option value="no_invented_data">')) {
      runPage = text;
      csrf = text.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
      break;
    }
  }
  runId = runPage.match(/name="run" value="([^"]+)"/)?.[1] ?? '';
  await writeQueue(
    labels,
    enqueue(emptyQueue(), [
      { id: `${runId}.b1`, criterion: 'no_invented_data', campaign: 'c-x3', runId, index: 1 },
    ]),
  );
  await fetch(`${viewer.url}/queue/assign`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
    body: new URLSearchParams({ csrf, criterion: 'no_invented_data', id: `${runId}.b1` }),
  });
}, 120_000);

afterAll(async () => {
  await viewer?.close();
  await rm(dir, { recursive: true, force: true });
});

function save(score: string) {
  return fetch(`${viewer.url}/labels`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
    body: new URLSearchParams({
      csrf,
      campaign: 'c-x3',
      run: runId,
      block: '1',
      criterion: 'no_invented_data',
      label: 'pass',
      score,
    }),
  });
}

describe('the viewer checks a score against the criterion scale', () => {
  it('refuses a score outside the scale of its criterion, with bad input', async () => {
    const response = await save('7');
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/outside the scale 1 to 5/);
  });

  it('accepts a score inside the scale of its criterion', async () => {
    const response = await save('3');
    expect(response.status).toBe(303);
  });
});

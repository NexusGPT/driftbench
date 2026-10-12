import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQueue } from '@driftbench/judges';
import { openStore } from '@driftbench/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type Io, main } from '../src/index';
import { QUEUE_KEYS_SCRIPT, startViewer, type Viewer } from '../src/view/server';

const made: string[] = [];
let dir = '';
let viewer: Viewer;
let labels = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-queue-view-'));
  made.push(dir);
  const store = openStore(join(dir, 'store.db'));
  await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F'], repeats: 1 });
  await store.close();
  const io: Io = { out: () => {}, err: () => {}, cwd: dir };
  expect(
    await main(['queue', 'create', '--store', 'store.db', '--campaign', 'c-acme', '--labels', 'labels'], io),
  ).toBe(0);
  labels = join(dir, 'labels');
  viewer = await startViewer({ store: join(dir, 'store.db'), labels, port: 0, labelledBy: 'Ana' });
}, 120_000);

afterAll(async () => {
  await viewer?.close();
  for (const folder of made) await rm(folder, { recursive: true, force: true });
});

describe('the viewer review queue', () => {
  it('lists the queue, takes an item for the viewer reviewer, and marks it done when its label is saved', async () => {
    const page = await fetch(`${viewer.url}/queue`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Review queue');
    expect(html).toContain('open');

    const queue = await readQueue(labels);
    const first = queue.entries[0];
    if (!first) throw new Error('the queue is empty');

    const taken = await fetch(`${viewer.url}/queue/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ criterion: first.criterion, id: first.id }),
      redirect: 'manual',
    });
    expect(taken.status).toBe(303);
    expect((await readQueue(labels)).entries[0]).toMatchObject({ state: 'assigned', assignee: 'Ana' });

    const saved = await fetch(`${viewer.url}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        campaign: first.campaign,
        run: first.runId,
        criterion: first.criterion,
        block: String(first.index),
        label: 'pass',
        note: 'Checked in the queue.',
      }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(303);
    expect((await readQueue(labels)).entries[0]).toMatchObject({ state: 'done', assignee: 'Ana' });
  }, 120_000);
});

describe('the viewer queue page: keyboard script under a hash, agreement shown', () => {
  it('allows only the queue page script, by the hash of its exact text, and nothing else', async () => {
    const page = await fetch(`${viewer.url}/queue`);
    const hash = createHash('sha256').update(QUEUE_KEYS_SCRIPT).digest('base64');
    expect(page.headers.get('content-security-policy')).toContain(`script-src 'sha256-${hash}'`);
    const html = await page.text();
    expect(html).toContain(`<script>${QUEUE_KEYS_SCRIPT}</script>`);
    expect(html).toMatch(/agreement/i);
    const campaign = await fetch(`${viewer.url}/`);
    expect(campaign.headers.get('content-security-policy')).not.toContain('script-src');
  });
});

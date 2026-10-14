import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLabels, readQueue } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type Io, main } from '../src/index';
import { LABEL_KEYS_SCRIPT, QUEUE_KEYS_SCRIPT, startViewer, type Viewer } from '../src/view/server';

const made: string[] = [];
let dir = '';
let viewer: Viewer;
let labels = '';
let csrf = '';

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
    csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    expect(html).toContain('Review queue');
    expect(html).toContain('open');

    const queue = await readQueue(labels);
    const first = queue.entries[0];
    if (!first) throw new Error('the queue is empty');

    const taken = await fetch(`${viewer.url}/queue/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
      body: new URLSearchParams({ csrf, criterion: first.criterion, id: first.id }),
      redirect: 'manual',
    });
    expect(taken.status).toBe(303);
    expect((await readQueue(labels)).entries[0]).toMatchObject({ state: 'assigned', assignee: 'Ana' });

    const saved = await fetch(`${viewer.url}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
      body: new URLSearchParams({
        csrf,
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

describe('a label on an item another reviewer holds', () => {
  it('is refused with 409 and writes no label: another reviewer cannot label an item held by someone else', async () => {
    const queue = await readQueue(labels);
    const item = queue.entries.find((entry) => entry.state === 'open');
    if (!item) throw new Error('no open item');
    const io: Io = { out: () => {}, err: () => {}, cwd: dir };
    expect(
      await main(
        [
          'queue',
          'assign',
          item.id,
          '--criterion',
          item.criterion,
          '--reviewer',
          'Ben',
          '--labels',
          'labels',
        ],
        io,
      ),
    ).toBe(0);
    const saved = await fetch(`${viewer.url}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
      body: new URLSearchParams({
        csrf,
        campaign: item.campaign,
        run: item.runId,
        criterion: item.criterion,
        block: String(item.index),
        label: 'fail',
        note: 'Not mine to label.',
      }),
      redirect: 'manual',
    });
    expect(saved.status).toBe(409);
    expect(
      (await readQueue(labels)).entries.find(
        (entry) => entry.id === item.id && entry.criterion === item.criterion,
      ),
    ).toMatchObject({
      state: 'assigned',
      assignee: 'Ben',
    });
    const held = (await loadLabels(labels)).labels.get(item.criterion) ?? [];
    expect(held.some((entry) => entry.id === item.id)).toBe(false);
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

describe('the label form: number keys and Cmd/Ctrl+Enter, script by hash, plain form without script', () => {
  it('serves the label script under its hash on the run page, and keeps the form plain', async () => {
    const queue = await readQueue(labels);
    const first = queue.entries[0];
    if (!first) throw new Error('the queue is empty');
    const page = await fetch(`${viewer.url}/campaign/${first.campaign}/run/${first.runId}`);
    const hash = createHash('sha256').update(LABEL_KEYS_SCRIPT).digest('base64');
    expect(page.headers.get('content-security-policy')).toContain(`script-src 'sha256-${hash}'`);
    const html = await page.text();
    expect(html).toContain(`<script>${LABEL_KEYS_SCRIPT}</script>`);
    expect(html).toContain('<form method="post" action="/labels">');
    expect(html).toContain('name="label" value="pass"');
    expect(html).toContain('name="label" value="fail"');
  });
});

describe('keyboard help and arrow keys', () => {
  it('serves a script-free cheatsheet at /keys, linked from the pages, and both scripts move with the arrows', async () => {
    const keys = await fetch(`${viewer.url}/keys`);
    expect(keys.status).toBe(200);
    expect(keys.headers.get('content-security-policy')).not.toContain('script-src');
    const help = await keys.text();
    expect(help).toContain('Cmd or Ctrl+Enter');
    expect(help).toContain('ArrowDown');
    expect(help).toContain('?');
    const queuePage = await (await fetch(`${viewer.url}/queue`)).text();
    expect(queuePage).toContain('href="/keys"');
    expect(QUEUE_KEYS_SCRIPT).toContain('ArrowDown');
    expect(LABEL_KEYS_SCRIPT).toContain('ArrowDown');
    expect(LABEL_KEYS_SCRIPT).toContain("'?'");
  });
});

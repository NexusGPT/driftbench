import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readQueue } from '@driftbench/judges';
import { openStore } from '@driftbench/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type Io, main } from '../src/index';

const made: string[] = [];
let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-queue-cli-'));
  made.push(dir);
  const store = openStore(join(dir, 'store.db'));
  await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F'], repeats: 1 });
  await store.close();
}, 120_000);

afterAll(async () => {
  for (const folder of made) await rm(folder, { recursive: true, force: true });
});

async function run(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: dir,
  };
  const code = await main(argv, io);
  return { code, out, err };
}

describe('driftbench queue', () => {
  it('creates a queue of the campaign blocks, one item per criterion, lists it, and lets a reviewer take an item', async () => {
    const created = await run([
      'queue',
      'create',
      '--store',
      'store.db',
      '--campaign',
      'c-acme',
      '--labels',
      'labels',
    ]);
    expect(created.err).toBe('');
    expect(created.code).toBe(0);
    expect(created.out).toMatch(/Queued [1-9]\d* items in labels/);

    const listed = await run(['queue', 'list', '--labels', 'labels']);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('open');

    const queue = await readQueue(join(dir, 'labels'));
    const first = queue.entries[0];
    if (!first) throw new Error('the queue is empty');
    const taken = await run([
      'queue',
      'assign',
      first.id,
      '--criterion',
      first.criterion,
      '--labels',
      'labels',
      '--reviewer',
      'Ana',
    ]);
    expect(taken.code).toBe(0);
    expect((await readQueue(join(dir, 'labels'))).entries[0]).toMatchObject({
      state: 'assigned',
      assignee: 'Ana',
    });

    const second = await run([
      'queue',
      'assign',
      first.id,
      '--criterion',
      first.criterion,
      '--labels',
      'labels',
      '--reviewer',
      'Ben',
    ]);
    expect(second.code).toBe(2);
    expect(second.err).toContain('assigned to Ana');
  });

  it('creates nothing twice: a second create queues no block already queued', async () => {
    const again = await run([
      'queue',
      'create',
      '--store',
      'store.db',
      '--campaign',
      'c-acme',
      '--labels',
      'labels',
    ]);
    expect(again.code).toBe(0);
    expect(again.out).toContain('Queued 0 items');
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLabels } from '../src/calibration';
import { readLabelFile } from '../src/labels';
import { assign, completeItem, emptyQueue, enqueue, readQueue, writeQueue } from '../src/queue';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-queue-'));
  made.push(dir);
  return dir;
}

const item = (index: number) => ({
  id: `run-1.b${index}`,
  criterion: 'tone',
  campaign: 'c-1',
  runId: 'run-1',
  index,
});

const transcript = [
  { role: 'user' as const, text: 'Is fiber available at 12 Main St?' },
  { role: 'agent' as const, text: 'Yes, Acme Fiber is available there.' },
];

describe('review queue', () => {
  it('adds each item once and keeps the queue order', () => {
    const queue = enqueue(enqueue(emptyQueue(), [item(0), item(1)]), [item(1), item(2)]);
    expect(queue.entries.map((entry) => entry.id)).toEqual(['run-1.b0', 'run-1.b1', 'run-1.b2']);
    expect(queue.entries.every((entry) => entry.state === 'open')).toBe(true);
  });

  it('assigns an item to one reviewer, and refuses a second reviewer', () => {
    const queue = assign(enqueue(emptyQueue(), [item(0)]), 'tone', 'run-1.b0', 'Ana');
    expect(queue.entries[0]).toMatchObject({ state: 'assigned', assignee: 'Ana' });
    expect(() => assign(queue, 'tone', 'run-1.b0', 'Ben')).toThrow(/assigned to Ana/);
  });

  it('completes items by writing their labels, which judge calibrate reads back', async () => {
    const dir = await folder();
    const taken = assign(enqueue(emptyQueue(), [item(0), item(1)]), 'tone', 'run-1.b0', 'Ana');
    const passed = await completeItem(dir, taken, 'tone', 'run-1.b0', 'Ana', {
      id: 'run-1.b0',
      label: 'pass',
      note: 'Matches the tool output.',
      transcript,
    });
    expect(passed.entries[0]).toMatchObject({ state: 'done', assignee: 'Ana' });
    const failing = assign(passed, 'tone', 'run-1.b1', 'Ana');
    const done = await completeItem(dir, failing, 'tone', 'run-1.b1', 'Ana', {
      id: 'run-1.b1',
      label: 'fail',
      transcript,
    });
    expect(done.entries.map((entry) => entry.state)).toEqual(['done', 'done']);
    expect(await readLabelFile(dir, 'tone')).toEqual([
      { id: 'run-1.b0', label: 'pass', note: 'Matches the tool output.', transcript },
      { id: 'run-1.b1', label: 'fail', transcript },
    ]);
    expect((await loadLabels(dir)).issues).toEqual([]);
  });

  it('refuses to complete an item held by another reviewer, and a done item again', async () => {
    const dir = await folder();
    const queue = assign(enqueue(emptyQueue(), [item(0)]), 'tone', 'run-1.b0', 'Ana');
    await expect(
      completeItem(dir, queue, 'tone', 'run-1.b0', 'Ben', { id: 'run-1.b0', label: 'fail', transcript }),
    ).rejects.toThrow(/assigned to Ana/);
    const done = await completeItem(dir, queue, 'tone', 'run-1.b0', 'Ana', {
      id: 'run-1.b0',
      label: 'pass',
      transcript,
    });
    await expect(
      completeItem(dir, done, 'tone', 'run-1.b0', 'Ana', { id: 'run-1.b0', label: 'pass', transcript }),
    ).rejects.toThrow(/already done/);
  });

  it('persists the queue beside the labels, and reads an empty folder as an empty queue', async () => {
    const dir = await folder();
    expect(await readQueue(dir)).toEqual(emptyQueue());
    const queue = assign(enqueue(emptyQueue(), [item(0), item(1)]), 'tone', 'run-1.b1', 'Ana');
    await writeQueue(dir, queue);
    expect(await readQueue(dir)).toEqual(queue);
  });
});

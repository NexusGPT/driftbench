import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLabels } from '../src/calibration';
import { readLabelFile } from '../src/labels';
import {
  addVote,
  agreementOf,
  assign,
  completeItem,
  emptyQueue,
  enqueue,
  readQueue,
  writeQueue,
} from '../src/queue';

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

describe('review queue agreement between reviewers', () => {
  it('records each reviewer vote on an item, and a second reviewer adds a vote without touching the label file', async () => {
    const dir = await folder();
    const first = assign(enqueue(emptyQueue(), [item(0)]), 'tone', 'run-1.b0', 'Ana');
    const done = await completeItem(dir, first, 'tone', 'run-1.b0', 'Ana', {
      id: 'run-1.b0',
      label: 'pass',
      transcript,
    });
    const voted = addVote(done, 'tone', 'run-1.b0', 'Ben', 'fail');
    expect(voted.entries[0]?.votes).toEqual([
      { reviewer: 'Ana', label: 'pass' },
      { reviewer: 'Ben', label: 'fail' },
    ]);
    expect(() => addVote(voted, 'tone', 'run-1.b0', 'Ben', 'pass')).toThrow(/already voted/);
  });

  it('measures agreement over items with two votes: percent agreement and Cohen kappa', () => {
    const votes: Array<[string, 'pass' | 'fail', 'pass' | 'fail']> = [
      ['run-1.b0', 'pass', 'pass'],
      ['run-1.b1', 'fail', 'fail'],
      ['run-1.b2', 'pass', 'fail'],
    ];
    let queue = enqueue(
      emptyQueue(),
      votes.map((_vote, index) => item(index)),
    );
    for (const [id, ana, ben] of votes) {
      queue = addVote(addVote(queue, 'tone', id, 'Ana', ana), 'tone', id, 'Ben', ben);
    }
    const report = agreementOf(queue);
    expect(report.items).toBe(3);
    expect(report.agreed).toBe(2);
    expect(report.percent).toBeCloseTo(2 / 3, 12);
    expect(report.kappa).toBeCloseTo(0.4, 12);
  });

  it('reports no agreement figure when no item has two votes', () => {
    expect(agreementOf(enqueue(emptyQueue(), [item(0)]))).toEqual({
      items: 0,
      agreed: 0,
      percent: undefined,
      kappa: undefined,
    });
  });
});

describe('a reviewer can give a score with the label', () => {
  it('stores the score on the vote, and refuses a score outside 0 to 1', async () => {
    const dir = await folder();
    const taken = assign(enqueue(emptyQueue(), [item(2)]), 'tone', 'run-1.b2', 'Ana');
    const done = await completeItem(
      dir,
      taken,
      'tone',
      'run-1.b2',
      'Ana',
      { id: 'run-1.b2', label: 'pass', transcript },
      0.8,
    );
    expect(done.entries[0]?.votes).toEqual([{ reviewer: 'Ana', label: 'pass', score: 0.8 }]);
    const again = assign(enqueue(emptyQueue(), [item(3)]), 'tone', 'run-1.b3', 'Ana');
    await expect(
      completeItem(dir, again, 'tone', 'run-1.b3', 'Ana', { id: 'run-1.b3', label: 'pass', transcript }, 1.5),
    ).rejects.toThrow(/outside the scale 0 to 1/);
  });
});

describe('a criterion can have its own score scale', () => {
  it('accepts a score inside the criterion scale and refuses one outside it', async () => {
    const dir = await folder();
    const scale = { min: 1, max: 5 };
    const ok = assign(enqueue(emptyQueue(), [item(4)]), 'tone', 'run-1.b4', 'Ana');
    const done = await completeItem(
      dir,
      ok,
      'tone',
      'run-1.b4',
      'Ana',
      { id: 'run-1.b4', label: 'pass', transcript },
      3,
      scale,
    );
    expect(done.entries[0]?.votes?.[0]?.score).toBe(3);
    const out = assign(enqueue(emptyQueue(), [item(5)]), 'tone', 'run-1.b5', 'Ana');
    await expect(
      completeItem(
        dir,
        out,
        'tone',
        'run-1.b5',
        'Ana',
        { id: 'run-1.b5', label: 'pass', transcript },
        0.5,
        scale,
      ),
    ).rejects.toThrow(/outside the scale 1 to 5/);
  });
});

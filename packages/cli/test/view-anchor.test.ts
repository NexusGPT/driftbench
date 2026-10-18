import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLabels } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { startViewer, type Viewer } from '../src/view/server';

let dir = '';
let viewer: Viewer;
let labels = '';
let runPage = '';
let csrf = '';

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
  // A label goes only on a criterion the block offers: the run must be one whose form offers no_invented_data.
  const links = [...page.matchAll(/href="(\/campaign\/[^/"]+\/run\/[^"#]+)"/g)].map(
    (match) => match[1] as string,
  );
  for (const link of links) {
    const text = await (await fetch(`${viewer.url}${link}`)).text();
    if (text.includes('<option value="no_invented_data">')) {
      runPage = text;
      csrf = text.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
      break;
    }
  }
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
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
    body: new URLSearchParams({
      csrf,
      campaign: 'c-x3',
      run: runIdOf(),
      criterion: 'no_invented_data',
      label: 'pass',
      ...fields,
    }),
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
    // The page lists anchors for every block: take the one in block 1's section.
    const start = runPage.indexOf('id="block-1"');
    const end = runPage.indexOf('id="block-2"', start);
    const section = runPage.slice(start, end > start ? end : undefined);
    const match = section.match(/<option value="(tool:[^"]+:1)"/);
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

describe('the anchor form on the review queue: a queued block, labelled with an anchor, completes its item', () => {
  it('takes the item, saves the anchored label on its block, and reads the item as done', async () => {
    const { emptyQueue, enqueue, readQueue, writeQueue } = await import('@agent-nexus/driftbench-judges');
    const runId = runIdOf();
    const queue = enqueue(emptyQueue(), [
      { id: `${runId}.b1`, criterion: 'no_invented_data', campaign: 'c-x3', runId, index: 1 },
    ]);
    await writeQueue(labels, queue);
    const taken = await fetch(`${viewer.url}/queue/assign`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
      body: new URLSearchParams({ csrf, criterion: 'no_invented_data', id: `${runId}.b1` }),
    });
    expect(taken.status).toBe(303);
    const saved = await save({ block: '1', anchor: 'message:1' });
    expect(saved.status).toBe(303);
    const after = await readQueue(labels);
    expect(after.entries.find((entry) => entry.id === `${runId}.b1`)?.state).toBe('done');
    const loaded = await loadLabels(labels);
    const row = (loaded.labels.get('no_invented_data') ?? []).find((entry) => entry.id === `${runId}.b1`);
    expect(row?.anchor).toEqual({ kind: 'message', index: 1 });
  });
});

describe('the anchor options offer tool-output fields and runtime events', () => {
  it('lists a field of a tool output and a runtime event as anchors of the block', async () => {
    const { anchorOptions } = await import('../src/view/server');
    const block = {
      index: 0,
      injected: false,
      pass: true,
      latencyMs: 0,
      retries: 0,
      drift: [],
      text: 'Yes.',
      toolCalls: [
        { label: 'coverage.lookup', input: { address: 'x' }, output: { coverage: { fiber: true } } },
      ],
      verdicts: [],
      stimulus: 'Is fiber available?',
      runtimeEvents: [{ kind: 'guard', name: 'billing', verdict: 'pass' }],
    } as never;
    const values = anchorOptions(block).map((option) => option.value);
    expect(values).toContain('field:coverage.lookup:coverage.fiber');
    expect(values).toContain('span:guard:billing');
  });
});

describe('a timeline event with a trace span id is anchored by the span id', () => {
  it('offers span:<id> with the span id in the anchor, so the label names the real span', async () => {
    const { anchorOptions } = await import('../src/view/server');
    const block = {
      index: 0,
      injected: false,
      pass: true,
      latencyMs: 0,
      retries: 0,
      drift: [],
      text: 'Yes.',
      toolCalls: [],
      verdicts: [],
      timelineEvents: [{ id: 'a100000000000003', label: 'tool coverage.check' }],
    } as never;
    const option = anchorOptions(block).find((entry) => entry.value === 'span:a100000000000003');
    expect(option?.label).toBe('tool coverage.check');
    expect(option?.anchor).toEqual({ kind: 'span', span_id: 'a100000000000003' });
  });
});

describe('a score typed with the label is kept on the queue vote', () => {
  it('stores the score of a queued item when the label completes it', async () => {
    const { emptyQueue, enqueue, readQueue, writeQueue } = await import('@agent-nexus/driftbench-judges');
    const runId = runIdOf();
    await writeQueue(
      labels,
      enqueue(emptyQueue(), [
        { id: `${runId}.b2`, criterion: 'no_invented_data', campaign: 'c-x3', runId, index: 2 },
      ]),
    );
    await fetch(`${viewer.url}/queue/assign`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
      body: new URLSearchParams({ csrf, criterion: 'no_invented_data', id: `${runId}.b2` }),
    });
    const response = await save({ block: '2', label: 'pass', score: '0.7' });
    expect(response.status).toBe(303);
    const queue = await readQueue(labels);
    expect(queue.entries.find((entry) => entry.id === `${runId}.b2`)?.votes).toEqual([
      { reviewer: 'a reviewer', label: 'pass', score: 0.7 },
    ]);
  });
});

describe('a timeline event of a block is a span anchor', () => {
  it('offers each recorded event of the block by its id, and saves it as a span anchor', async () => {
    const { anchorOptions } = await import('../src/view/server');
    const block = {
      index: 1,
      injected: false,
      pass: true,
      latencyMs: 0,
      retries: 0,
      drift: [],
      text: 'ok',
      toolCalls: [],
      verdicts: [],
      timelineEvents: [
        { id: 'event:4', label: 'tool coverage.lookup' },
        { id: 'event:5', label: 'model call' },
      ],
    } as never;
    const options = anchorOptions(block);
    expect(options.map((option) => option.value)).toContain('span:event:4');
    expect(options.find((option) => option.value === 'span:event:4')?.anchor).toEqual({
      kind: 'span',
      span_id: 'event:4',
    });
  });
});

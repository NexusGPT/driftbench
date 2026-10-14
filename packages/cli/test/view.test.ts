import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLabels } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type Io, main } from '../src/index';
import { startViewer, type Viewer } from '../src/view/server';

let dir = '';
let viewer: Viewer;
let labels = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-view-'));
  const db = join(dir, 'store.db');
  const store = openStore(db);
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F'], repeats: 1, reportsUsage: true });
    await storeAcmeCampaign(store, { campaignId: 'c-x3', modes: ['F'], repeats: 1, fault: 'x3-skips-recap' });
  } finally {
    await store.close();
  }
  labels = join(dir, 'labels');
  viewer = await startViewer({ store: db, labels, port: 0, labelledBy: 'a reviewer' });
}, 120_000);

afterAll(async () => {
  await viewer?.close();
  await rm(dir, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; text: string; type: string }> {
  const response = await fetch(`${viewer.url}${path}`);
  return {
    status: response.status,
    text: await response.text(),
    type: response.headers.get('content-type') ?? '',
  };
}

/** The first run link of a campaign page. */
async function firstRun(campaign: string, failing = false): Promise<string> {
  const page = await get(`/campaign/${campaign}`);
  const links = [...page.text.matchAll(/href="(\/campaign\/[^/"]+\/run\/[^"#]+)"/g)].map(
    (match) => match[1] as string,
  );
  expect(links.length).toBeGreaterThan(0);
  return failing ? (links[0] as string) : (links[links.length - 1] as string);
}

/** The first run of a campaign, of the given spec, whose label form offers the criterion. */
async function runOffering(campaign: string, criterion: string, spec: string): Promise<string> {
  const page = await get(`/campaign/${campaign}`);
  const links = [...page.text.matchAll(/href="(\/campaign\/[^/"]+\/run\/[^"#]+)"/g)].map(
    (match) => match[1] as string,
  );
  for (const link of links) {
    const text = (await get(link)).text;
    if (text.includes(`<option value="${criterion}">`) && text.includes(spec)) return link;
  }
  throw new Error(`no run of ${campaign} offers ${criterion}`);
}

describe('driftbench view', () => {
  it('listens on the loopback address only', () => {
    expect(viewer.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('tells the browser to load nothing from anywhere', async () => {
    const response = await fetch(`${viewer.url}/`);
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; base-uri 'none'",
    );
  });

  it('lists the campaigns of the store with their runs', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    expect(page.text).toContain('href="/campaign/c-acme"');
    expect(page.text).toContain('href="/campaign/c-x3"');
    expect(page.text).toMatch(/c-x3[\s\S]*6 runs/);
    expect(page.text).not.toMatch(/<script|<link|src=|https?:\/\//i);
  });

  it('shows a campaign as its scorecard, with the spread view and a link to every run', async () => {
    const page = await get('/campaign/c-x3');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<section id="spread">');
    expect(page.text).toContain('<section id="drilldown">');
    // Each run links to its own page twice: from its panel and from the drilldown list.
    expect([...page.text.matchAll(/href="\/campaign\/c-x3\/run\//g)].length).toBe(12);
  });

  it('shows a run block by block, with evidence and a label form per block and criterion', async () => {
    const page = await get(await firstRun('c-x3', true));
    expect(page.status).toBe(200);
    expect(page.text).toContain('Verdicts with evidence');
    expect(page.text).toContain('<form method="post" action="/labels"');
    expect(page.text).toMatch(/<option value="one_question_per_turn"/);
    expect(page.text).toContain('name="note"');
    expect(page.text).toContain('No label in the folder yet.');
  });

  it('shows the timeline of a run in order, with the start, end, tokens and cost of each model call, and no script', async () => {
    const page = await get(await firstRun('c-acme', true));
    expect(page.status).toBe(200);
    const timeline = page.text.slice(
      page.text.indexOf('<h3>Timeline</h3>'),
      page.text.indexOf('<h3>Timeline</h3>') + 4000,
    );
    expect(timeline).toContain('<ol class="timeline">');
    const types = [...timeline.matchAll(/<li class="event (\w+)"/g)].map((m) => m[1]);
    expect(types[0]).toBe('block_start');
    expect(types.at(-1)).toBe('run_end');
    expect(types).toContain('model_call');
    expect(timeline).toMatch(/\d+ in, \d+ out/);
    expect(timeline).not.toMatch(/<script/i);
  });

  it('saves a label, reads it back on the page, and writes the file judge calibrate reads', async () => {
    // A run whose form offers no_invented_data: a label goes only on a criterion the block offers.
    const run = await runOffering('c-x3', 'no_invented_data', 'acme-plan-upgrade');
    const runId = decodeURIComponent(run.split('/').pop() as string);
    const csrf = (await get(run)).text.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    const save = (label: string, block: string, note: string) =>
      fetch(`${viewer.url}/labels`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
        body: new URLSearchParams({
          csrf,
          campaign: 'c-x3',
          run: runId,
          block,
          criterion: 'no_invented_data',
          label,
          note,
        }),
      });
    const first = await save('pass', '1', 'The plans and prices come from catalog.search.');
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`${run}?saved=no_invented_data#block-1`);
    const onlyPass = await get(`${run}?saved=no_invented_data`);
    expect(onlyPass.text).toContain('1 pass, 0 fail. judge calibrate needs at least one fail label on it.');
    expect((await save('fail', '3', 'The order is placed with no recap.')).status).toBe(303);

    const loaded = await loadLabels(labels);
    expect(loaded.issues).toEqual([]);
    const blocks = loaded.labels.get('no_invented_data') ?? [];
    expect(blocks.map((entry) => `${entry.id} ${entry.label}`)).toEqual([
      `${runId}.b1 pass`,
      `${runId}.b3 fail`,
    ]);
    expect(blocks[0]?.note).toBe('The plans and prices come from catalog.search.');
    // The user turn, each tool call with its result, then the reply: what a judge reads.
    const roles = blocks[0]?.transcript.map((entry) => entry.role);
    expect(roles?.[0]).toBe('user');
    expect(roles?.at(-1)).toBe('agent');
    expect(roles).toContain('tool_call');
    expect(blocks[0]?.transcript.at(-1)?.text).toContain('Acme Mobile');

    const page = await get(`${run}?saved=no_invented_data`);
    expect(page.text).toContain('Label saved: no_invented_data.');
    expect(page.text).toContain('<span class="mono">no_invented_data</span>: 1 pass, 1 fail.</li>');
    expect(page.text).toMatch(
      /no_invented_data: pass[\s\S]*The plans and prices come from catalog\.search\./,
    );
  });

  it('refuses a bad label request with 400 and writes nothing', async () => {
    const run = await firstRun('c-x3', true);
    const runId = decodeURIComponent(run.split('/').pop() as string);
    const csrf = (await get(run)).text.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    const bad = async (fields: Record<string, string>) =>
      (
        await fetch(`${viewer.url}/labels`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/x-www-form-urlencoded', origin: viewer.url },
          body: new URLSearchParams({
            csrf,
            campaign: 'c-x3',
            run: runId,
            block: '0',
            criterion: 'tone',
            label: 'pass',
            ...fields,
          }),
        })
      ).status;
    expect(await bad({ criterion: '../escape' })).toBe(400);
    // A criterion the block's form does not offer: the spec's judged criteria and those that voted on it.
    expect(await bad({ criterion: 'not_a_criterion' })).toBe(400);
    expect(existsSync(join(labels, 'not_a_criterion.yaml'))).toBe(false);
    expect(await bad({ label: 'maybe' })).toBe(400);
    expect(await bad({ block: '99' })).toBe(400);
    expect(await bad({ run: 'no-such-run' })).toBe(400);
    expect(existsSync(join(labels, 'tone.yaml'))).toBe(false);
  });

  it('compares two campaigns', async () => {
    const page = await get('/compare?baseline=c-acme&candidate=c-x3&margin=15');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<section id="compare">');
    expect(page.text).toContain('verdict-regressed');
    const form = await get('/compare');
    expect(form.status).toBe(200);
    expect(form.text).toContain('<select name="baseline"');
  });

  it('answers 404 for an unknown campaign, run or page, and 400 for a bad compare', async () => {
    expect((await get('/campaign/nope')).status).toBe(404);
    expect((await get('/campaign/c-x3/run/nope')).status).toBe(404);
    expect((await get('/nowhere')).status).toBe(404);
    expect((await get('/compare?baseline=c-acme&candidate=c-x3&margin=0')).status).toBe(400);
  });

  it('is a CLI command with --store, --port and --labels', async () => {
    let out = '';
    const io: Io = {
      out: (text) => {
        out += text;
      },
      err: () => {},
      cwd: dir,
    };
    expect(await main(['view', '--help'], io)).toBe(0);
    expect(out).toContain('--store <file>');
    expect(out).toContain('--port <n>');
    expect(out).toContain('--labels <dir>');
  });

  it('exits 2 when the store is missing', async () => {
    let err = '';
    const code = await main(['view', '--store', join(dir, 'missing.db')], {
      out: () => {},
      err: (text) => {
        err += text;
      },
      cwd: dir,
    });
    expect(code).toBe(2);
    expect(err).toContain('No store at');
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cli-findings-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function cli(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: ROOT,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

it('resume accepts an explicit cache suite', async () => {
  const result = await cli([
    'campaign',
    'resume',
    '--store',
    join(dir, 'missing.db'),
    '--cache-suite',
    'fresh',
  ]);
  expect(result.code).toBe(2);
  expect(result.err).not.toContain('unknown option');
  expect(result.err).toContain('store');
});

it('prompt help describes the one prompt the runner accepts', async () => {
  const result = await cli(['campaign', 'run', '--help']);
  expect(result.out).toMatch(/--prompt.*?one prompt/s);
});

it.each(['run', 'resume'])(
  '%s refuses more than 20 retry attempts before opening a store',
  async (command) => {
    const result = await cli([
      'campaign',
      command,
      '--store',
      join(dir, 'missing.db'),
      '--retry-attempts',
      '21',
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('--retry-attempts takes a whole number from 1 to 20');
  },
);

it('family verify explains a missing folder without raw filesystem diagnostics', async () => {
  const result = await cli(['family', 'verify', join(dir, 'missing'), '--reference', 'process:acme-ops']);
  expect(result.code).toBe(2);
  expect(result.err).toContain('Family folder does not exist:');
  expect(result.err).not.toContain('ENOENT');
});

it('a baseline with P cells carries eligible F siblings and keeps P fresh', async () => {
  const specs = join(dir, 'specs');
  await mkdir(specs);
  const spec = join(specs, 'spec.yaml');
  const change = join(dir, 'change.yaml');
  const db = join(dir, 'runs.db');
  await writeFile(
    spec,
    `id: carry-perturbed
 metadata: { depends: { stages: [stable] } }
 target: { adapter: function, agent: acme }
 blocks:
   - user: hello
 perturbations:
   - id: aside
     class: D1_off_topic
     inject_at: 0
     user: hello
`.replace(/^ /gm, ''),
  );
  await writeFile(
    change,
    `from: v1
to: v2
changes:
  - kind: stage\n    id: absent
`,
  );
  await writeFile(
    join(specs, 'affected.yaml'),
    `id: affected
target: { adapter: function, agent: acme }
stages: [absent]
blocks:
  - user: hello
    expect: { stage: absent }
`,
  );
  const base = ['campaign', 'run', specs, '--store', db, '--mode', 'F,P', '--no-cache'];
  const baseline = await cli([...base, '--campaign', 'base', '--agent-version', 'v1']);
  expect(baseline.err).toBe('');
  const result = await cli([
    ...base,
    '--campaign',
    'next',
    '--agent-version',
    'v2',
    '--from',
    'base',
    '--change',
    change,
  ]);
  expect(result.err).toBe('');
  expect(result.out).toContain('1 carried from base');
  const store = openStore(db);
  try {
    const runs = await store.listRuns({ campaignId: 'next' });
    expect(runs.find((run) => run.specId === 'carry-perturbed' && run.mode === 'F')?.carried).toBeDefined();
    expect(runs.find((run) => run.mode === 'P')?.carried).toBeUndefined();
  } finally {
    store.close();
  }
});

it('resume applies the cache suite to unfinished cells', async () => {
  const spec = join(dir, 'cached.yaml');
  const db = join(dir, 'cached.db');
  await writeFile(spec, 'id: cached\ntarget: { adapter: function, agent: acme }\nblocks:\n  - user: hello\n');
  const warmed = await cli([
    'campaign',
    'run',
    spec,
    '--store',
    db,
    '--campaign',
    'warm',
    '--cache-suite',
    'one',
  ]);
  expect(warmed.err).toBe('');
  const store = openStore(db);
  try {
    const warm = await store.getCampaign('warm');
    if (!warm) throw new Error('missing warm campaign');
    await store.putCampaign({ ...warm, campaignId: 'same' });
    await store.putCampaign({ ...warm, campaignId: 'other' });
  } finally {
    store.close();
  }
  for (const [campaign, suite, hit] of [
    ['same', 'one', true],
    ['other', 'two', false],
  ] as const) {
    const result = await cli([
      'campaign',
      'resume',
      campaign,
      '--store',
      db,
      '--cache-suite',
      suite,
      '--json',
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).cells[0].cacheHit).toBe(hit);
  }
});

it.each(['1', '20'])('accepts the retry boundary %s', async (value) => {
  const result = await cli([
    'campaign',
    'resume',
    '--store',
    join(dir, 'missing.db'),
    '--retry-attempts',
    value,
  ]);
  expect(result.code).toBe(2);
  expect(result.err).toContain('No store');
  expect(result.err).not.toContain('--retry-attempts');
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, expect, it } from 'vitest';
import { main } from '../src/index';

/**
 * `campaign rejudge` over a stored run whose last block was not run: the re-judged block passes and none fails.
 * Nothing fails but a block was not run, so the command exits 3, and the summary names the block and counts the run.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function cli(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: root,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

it('names the block not run and its reason, counts the run as not run, and exits 3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-not-run-rejudge-'));
  made.push(dir);
  const path = join(dir, 'runs.db');
  const spec = {
    id: 'acme-criterion',
    metadata: { depends: { stages: ['offer'] } },
    criteria: [{ name: 'quote', rubric: 'Answer the user.', gating: true }],
    blocks: [{ when: { user: 'Hello' }, expect: { criteria: ['quote'] } }, { when: { user: 'Thanks' } }],
  };
  const file = join(dir, 'acme.spec.json');
  await writeFile(file, JSON.stringify(spec));
  const base = await cli([
    'campaign',
    'run',
    file,
    '--target',
    'function:acme-sales',
    '--agent-version',
    'v1',
    '--campaign',
    'base',
    '--store',
    path,
  ]);
  expect(base.err).toBe('');
  // The stored run's last block as a runner writes a block it did not send.
  const db = openStore(path);
  try {
    const [run] = await db.listRuns({ campaignId: 'base' });
    if (!run?.blocks[1]) throw new Error('no stored run');
    run.blocks[1] = {
      ...run.blocks[1],
      verdicts: [],
      drift: [],
      pass: false,
      status: 'not_run',
      notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'e', got: 'g' },
    };
    await db.putRun('base', run);
  } finally {
    await db.close();
  }
  if (!spec.criteria[0]) throw new Error('missing fixture');
  spec.criteria[0].rubric = 'Answer the user politely.';
  await writeFile(file, JSON.stringify(spec));
  await writeFile(join(dir, 'change.yaml'), 'from: v1\nto: v1\nchanges:\n  - {kind: criterion, id: quote}\n');
  const judged = await cli([
    'campaign',
    'rejudge',
    file,
    '--from',
    'base',
    '--campaign',
    'judged',
    '--store',
    path,
    '--change',
    join(dir, 'change.yaml'),
    '--judge',
    'claude:haiku',
    '--judge-command',
    join(root, 'examples/estates/fixture/live/fake/judge.cjs'),
    '--json',
  ]);
  expect(judged.err).toBe('');
  expect(JSON.parse(judged.out)).toMatchObject({
    rejudged: 1,
    carried: 0,
    runs: { pass: 0, fail: 0, notRun: 1, blocked: 0 },
    unmeasured: [{ spec: 'acme-criterion', block: 1, status: 'not_run', reason: 'capability: g' }],
  });
  expect(judged.code).toBe(3);
}, 120_000);

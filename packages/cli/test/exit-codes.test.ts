import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

/**
 * docs/reference/cli.md, "Running it": exit 2 on a usage or input error, with a message and never a stack
 * trace; a refusal writes nothing. One case per class of defect the system validator found. Fictional data.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = join(ROOT, 'examples/acme/specs/conversations/plan-upgrade.yaml');

let dir: string;
let runs: string;
const made: string[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-exits-'));
  made.push(dir);
  runs = join(dir, 'runs.db');
  const run = await cli([
    'campaign',
    'run',
    SPEC,
    '--target',
    'function:acme',
    '--campaign',
    'c-1',
    '--store',
    runs,
  ]);
  expect(run.code).toBe(0);
}, 60_000);

afterAll(async () => {
  for (const each of made) await rm(each, { recursive: true, force: true });
});

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  try {
    return { code: await main(argv, io), out, err };
  } catch (cause) {
    return { code: -1, out, err: `threw: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/** A fresh folder for one case, so "writes nothing" is checked on a clean slate. */
async function folder(name: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  return path;
}

function refused(result: { code: number; err: string; out: string }) {
  expect(result.err).not.toMatch(/^threw:/);
  expect(result.code).toBe(2);
  expect(result.err.trim()).not.toBe('');
  expect(`${result.out}${result.err}`).not.toMatch(/\n\s+at .+:\d+:\d+/);
}

describe('an empty string is a bad number, not 0', () => {
  it.each([
    [
      'campaign plan --budget-usd',
      () => ['campaign', 'plan', SPEC, '--target', 'function:acme', '--budget-usd', ''],
    ],
    [
      'report --max-runs',
      () => ['report', 'c-1', '--store', runs, '--out', join(dir, 'card.html'), '--max-runs', ''],
    ],
    ['view --port', () => ['view', '--store', runs, '--port', '', '--labels', join(dir, 'labels')]],
  ])('%s ""', async (_name, argv) => {
    refused(await cli(argv()));
  });
});

describe('a command that reads a store never makes one', () => {
  it.each([
    ['campaign status', (db: string) => ['campaign', 'status', '--store', db]],
    ['campaign resume', (db: string) => ['campaign', 'resume', '--store', db]],
    [
      'campaign export',
      (db: string) => ['campaign', 'export', 'c-1', '--store', db, '--out', join(dir, 'export')],
    ],
    ['report', (db: string) => ['report', '--store', db, '--out', join(dir, 'none.html')]],
    ['compare', (db: string) => ['compare', '--baseline', 'c-a', '--candidate', 'c-b', '--store', db]],
    ['monitor', (db: string) => ['monitor', '--store', db, '--metric', 'pass_rate']],
    ['pilot analyse', (db: string) => ['pilot', 'analyse', '--store', db, '--out', join(dir, 'pilot-out')]],
  ])('%s on a missing store exits 2 and creates no file', async (name, argv) => {
    const db = join(await folder(`missing-${name.replace(/ /g, '-')}`), 'none.db');
    refused(await cli(argv(db)));
    expect(existsSync(db)).toBe(false);
  });

  it('campaign import of a bundle that does not read exits 2 and creates no store', async () => {
    const here = await folder('import');
    const db = join(here, 'import.db');
    refused(await cli(['campaign', 'import', join(here, 'no-bundle'), '--store', db]));
    expect(existsSync(db)).toBe(false);
  });
});

describe('a path that cannot be used as asked is an input error', () => {
  it('generate --out naming a file exits 2', async () => {
    const file = join(await folder('gen'), 'a-file.txt');
    await writeFile(file, 'x\n');
    refused(await cli(['generate', '--map', join(ROOT, 'examples/acme/map/approved.yaml'), '--out', file]));
  }, 60_000);

  it('report --out naming a folder exits 2', async () => {
    const out = await folder('report-out');
    refused(await cli(['report', 'c-1', '--store', runs, '--out', out]));
  });

  it('family verify of a folder that does not exist exits 2', async () => {
    refused(await cli(['family', 'verify', join(dir, 'no-family'), '--reference', 'process:acme-ops']));
  });

  it('ci --out naming a folder exits 2 before the candidate runs: the store is unchanged', async () => {
    const out = await folder('ci-out');
    const before = statSync(runs);
    refused(
      await cli([
        'ci',
        '--specs',
        SPEC,
        '--target',
        'function:acme',
        '--baseline',
        'c-1',
        '--store',
        runs,
        '--out',
        out,
      ]),
    );
    const after = statSync(runs);
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
  });
});

describe('other bad input', () => {
  it('dataset list and prompt list of a name the store does not hold exit 2', async () => {
    const db = join(await folder('registry'), 'reg.db');
    await cli(['dataset', 'list', '--store', db]);
    refused(await cli(['dataset', 'list', 'nobody', '--store', db]));
    refused(await cli(['prompt', 'list', 'nobody', '--store', db]));
  });

  it('attack --replay of a file that is not a recording exits 2', async () => {
    const list = join(await folder('attack'), 'list.json');
    await writeFile(list, '[1, 2, 3]\n');
    refused(await cli(['attack', SPEC, '--pack', join(ROOT, 'examples/acme/redteam'), '--replay', list]));
  });

  it('queue create on a store that is not a database exits 2', async () => {
    const here = await folder('queue');
    const db = join(here, 'not-a-db.db');
    await writeFile(db, 'not sqlite\n');
    refused(
      await cli(['queue', 'create', '--store', db, '--campaign', 'c-1', '--labels', join(here, 'labels')]),
    );
  });

  it('campaign plan with a huge --repeats exits 2 at once instead of exhausting memory', async () => {
    const result = await cli([
      'campaign',
      'plan',
      SPEC,
      '--target',
      'function:acme',
      '--repeats',
      '10000000000',
    ]);
    refused(result);
    expect(result.err).toContain('a campaign holds at most 1000000');
  });

  it('estate approve and estate plan approve of a folder exit 2 with the reason, not a stack trace', async () => {
    const afolder = await folder('estate-dir/afolder');
    refused(await cli(['estate', 'approve', afolder]));
    refused(await cli(['estate', 'plan', 'approve', afolder]));
  });
});

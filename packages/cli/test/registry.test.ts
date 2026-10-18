import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ACME_SPECS = join(ROOT, 'examples/acme/specs/conversations');

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-registry-'));
  await cp(ACME_SPECS, join(dir, 'specs'), { recursive: true });
  await writeFile(join(dir, 'acme-sales.md'), 'You are the Acme sales assistant. Answer in one message.\n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
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
    cwd: dir,
  };
  const code = await main(argv, io);
  return { code, out, err };
}

async function digests(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await readdir(folder)).sort()) {
    out[name] = createHash('sha256')
      .update(await readFile(join(folder, name)))
      .digest('hex');
  }
  return out;
}

describe('driftbench dataset', () => {
  it('pushes a folder of specs as version 1, and pushing it again changes nothing', async () => {
    const first = await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/^Pushed dataset acme-specs@1 \(hash [0-9a-f]{12}\): 6 files from specs\.\n$/);
    const again = await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/^Unchanged: dataset acme-specs@1 already holds these 6 files\.\n$/);
  });

  it('refuses a folder with an invalid spec and pushes nothing', async () => {
    await writeFile(join(dir, 'specs', 'broken.yaml'), 'id: acme-broken\nblocks: []\n');
    const pushed = await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    expect(pushed.code).toBe(1);
    expect(pushed.err).toContain('specs/broken.yaml');
    expect(pushed.err).toContain('Fix the invalid specs first: nothing was pushed.');
    const listed = await cli(['dataset', 'list', '--store', 'store.db']);
    expect(listed.out).toBe('No dataset in store.db.\n');
  });

  it('lists, diffs and restores versions byte for byte', async () => {
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db', '--note', 'first import']);
    const before = await digests(join(dir, 'specs'));
    const upgrade = join(dir, 'specs', 'plan-upgrade.yaml');
    const original = await readFile(upgrade, 'utf8');
    await writeFile(upgrade, original.replace('version:', '# edited\nversion:'));
    await rm(join(dir, 'specs', 'tool-failure.yaml'));
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);

    const listed = await cli(['dataset', 'list', 'acme-specs', '--store', 'store.db']);
    expect(listed.code).toBe(0);
    expect(listed.out.split('\n').filter(Boolean)).toEqual([
      expect.stringMatching(/^acme-specs@1 {2}[0-9a-f]{12} {2}6 files {2}\S+ {2}first import$/),
      expect.stringMatching(/^acme-specs@2 {2}[0-9a-f]{12} {2}5 files {2}\S+$/),
    ]);

    const diff = await cli(['dataset', 'diff', 'acme-specs@1', 'acme-specs@2', '--store', 'store.db']);
    expect(diff.code).toBe(1);
    expect(diff.out).toContain('M plan-upgrade.yaml\n');
    expect(diff.out).toContain('+# edited\n');
    expect(diff.out).toContain('D tool-failure.yaml\n');
    expect(diff.out).toContain('2 files differ between acme-specs@1 and acme-specs@2.');
    const previous = await cli(['dataset', 'diff', 'acme-specs@2', '--store', 'store.db']);
    expect(previous.out).toContain('2 files differ between acme-specs@1 and acme-specs@2.');
    const same = await cli(['dataset', 'diff', 'acme-specs@2', '--dir', 'specs', '--store', 'store.db']);
    expect(same.code).toBe(0);
    expect(same.out).toBe('No difference between acme-specs@2 and specs.\n');

    const restored = await cli([
      'dataset',
      'restore',
      'acme-specs@1',
      '--out',
      'back',
      '--store',
      'store.db',
    ]);
    expect(restored.err).toBe('');
    expect(restored.code).toBe(0);
    expect(restored.out).toBe('Restored dataset acme-specs@1 into back: 6 written, 0 unchanged.\n');
    expect(await digests(join(dir, 'back'))).toEqual(before);
  });

  it('restores to the folder it was pushed from, and refuses to overwrite an edit without --force', async () => {
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    const before = await digests(join(dir, 'specs'));
    await writeFile(join(dir, 'specs', 'plan-upgrade.yaml'), 'id: acme-edited\n');
    await writeFile(join(dir, 'specs', 'notes.txt'), 'kept\n');

    const refused = await cli(['dataset', 'restore', 'acme-specs', '--store', 'store.db']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('plan-upgrade.yaml differs from acme-specs@1');
    expect(refused.err).toContain('Nothing was written. Restore over them with --force.');
    expect(await readFile(join(dir, 'specs', 'plan-upgrade.yaml'), 'utf8')).toBe('id: acme-edited\n');

    const forced = await cli(['dataset', 'restore', 'acme-specs', '--force', '--store', 'store.db']);
    expect(forced.code).toBe(0);
    expect(forced.out).toContain('1 written, 5 unchanged');
    expect(forced.out).toContain('1 file the version does not hold is left: notes.txt');
    const after = await digests(join(dir, 'specs'));
    delete after['notes.txt'];
    expect(after).toEqual(before);
  });

  it('names an unknown version and a missing store clearly', async () => {
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    const unknown = await cli(['dataset', 'restore', 'acme-specs@7', '--out', 'x', '--store', 'store.db']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toBe('No dataset acme-specs@7 in store.db. Its versions: 1.\n');
    const none = await cli(['dataset', 'diff', 'acme-specs@1', '--store', 'store.db']);
    expect(none.code).toBe(2);
    expect(none.err).toContain('acme-specs@1 is the first version');
  });
});

describe('driftbench prompt', () => {
  it('versions one prompt file and restores it to its path, byte for byte', async () => {
    const pushed = await cli(['prompt', 'push', 'acme-sales', 'acme-sales.md', '--store', 'store.db']);
    expect(pushed.code).toBe(0);
    expect(pushed.out).toMatch(
      /^Pushed prompt acme-sales@1 \(hash [0-9a-f]{12}\): 1 file from acme-sales\.md\.\n$/,
    );
    const original = await readFile(join(dir, 'acme-sales.md'));
    await writeFile(join(dir, 'acme-sales.md'), 'You are a pirate.\n');
    await cli(['prompt', 'push', 'acme-sales', 'acme-sales.md', '--store', 'store.db']);

    const diff = await cli(['prompt', 'diff', 'acme-sales@2', '--store', 'store.db']);
    expect(diff.out).toContain(
      '    -You are the Acme sales assistant. Answer in one message.\n    +You are a pirate.\n',
    );

    const restored = await cli(['prompt', 'restore', 'acme-sales@1', '--force', '--store', 'store.db']);
    expect(restored.code).toBe(0);
    expect(Buffer.compare(await readFile(join(dir, 'acme-sales.md')), original)).toBe(0);
    const listed = await cli(['prompt', 'list', '--store', 'store.db', '--json']);
    expect(JSON.parse(listed.out).map((each: { version: number }) => each.version)).toEqual([1, 2]);
  });
});

describe('a campaign run from a dataset', () => {
  it('loads the specs of the version and records the dataset and prompt versions in the campaign', async () => {
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    await cli(['prompt', 'push', 'acme-sales', 'acme-sales.md', '--store', 'store.db']);
    await rm(join(dir, 'specs'), { recursive: true });

    const run = await cli([
      'campaign',
      'run',
      '--dataset',
      'acme-specs@1',
      '--prompt',
      'acme-sales',
      '--target',
      'function:acme',
      '--campaign',
      'c-from-dataset',
      '--store',
      'store.db',
      '--json',
    ]);
    expect(run.err).toBe('');
    expect(JSON.parse(run.out).cells).toHaveLength(6);

    const store = openStore(join(dir, 'store.db'));
    try {
      const dataset = await store.getVersion('dataset', 'acme-specs', '1');
      const prompt = await store.getVersion('prompt', 'acme-sales');
      const campaign = await store.getCampaign('c-from-dataset');
      expect(campaign?.sources).toEqual([
        { kind: 'dataset', name: 'acme-specs', version: 1, hash: dataset?.hash },
        { kind: 'prompt', name: 'acme-sales', version: 1, hash: prompt?.hash },
      ]);
      expect(campaign?.specs).toHaveLength(6);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('needs a store to read a dataset from', async () => {
    const run = await cli(['campaign', 'run', '--dataset', 'acme-specs', '--target', 'function:acme']);
    expect(run.code).toBe(2);
    expect(run.err).toBe('--dataset and --prompt read the registry of a store: add --store <file>.\n');
  });
});

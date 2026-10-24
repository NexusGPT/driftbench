import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_KINDS } from '../src/commands/radius-change';
import { type Io, main } from '../src/index';

vi.setConfig({ testTimeout: 60_000 });

/**
 * In the estate model terms this is a check over artifact kinds, not over estate parts: the set of kinds is the one
 * the help documents, so a new kind is added to the set and to this matrix together. The rule: `radius --change` told a file that is another artifact of driftbench, not a change manifest, says so
 * and says where a change manifest comes from. It does so for every artifact a user can hold in a folder, not for
 * one of them. A file that is no artifact (hand-written, malformed) gets the manifest errors alone, and a valid
 * manifest gets no such line. The producing commands are the ones the help documents.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MAP = 'examples/estates/fixture/approved.yaml';
const GATED = 'examples/acme/gated/specs';
const MANIFEST = 'examples/acme/radius/stage-recap.yaml';
const SPEC =
  'examples/estates/fixture/generated/specs/live/route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml';
/** Where a change manifest comes from, by the commands that write one: every one of them is named. */
const SOURCES_OF_MANIFESTS = [
  'estate diff --change-out',
  '--old-ledger',
  '--new-ledger',
  'radius ledger',
  'radius auto',
  'radius sections reanchor --change-out',
];

let dir = '';
const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function cli(argv: string[]) {
  const out = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      out.out += text;
    },
    err: (text) => {
      out.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...out };
}

async function scratch(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-radius-variants-'));
  folders.push(dir);
  return dir;
}

/** Each artifact a user can pass by mistake, written by the command that makes it. */
const ARTIFACTS: Array<{ id: string; article: 'a' | 'an'; make: (folder: string) => Promise<string> }> = [
  {
    id: 'estate diff',
    article: 'an',
    make: async (folder) => {
      const path = join(folder, 'diff.json');
      expect((await cli(['estate', 'diff', MAP, MAP, '--out', path])).code).toBe(0);
      return path;
    },
  },
  {
    id: 'estate impact',
    article: 'an',
    make: async (folder) => {
      const diff = join(folder, 'diff.json');
      const path = join(folder, 'impact.json');
      expect((await cli(['estate', 'diff', MAP, MAP, '--out', diff])).code).toBe(0);
      expect(
        (
          await cli([
            'estate',
            'impact',
            diff,
            '--tests',
            join(ROOT, 'examples/estates/fixture/generated/specs'),
            '--out',
            path,
          ])
        ).code,
      ).toBe(0);
      return path;
    },
  },
  { id: 'estate map', article: 'an', make: async () => join(ROOT, MAP) },
  { id: 'spec', article: 'a', make: async () => join(ROOT, SPEC) },
  {
    id: 'radius report',
    article: 'a',
    make: async (folder) => {
      const path = join(folder, 'report.json');
      const report = await cli(['radius', GATED, '--change', MANIFEST, '--json']);
      expect(report.code).toBe(0);
      await writeFile(path, report.out);
      return path;
    },
  },
];

describe('radius --change given another driftbench artifact (matrix)', () => {
  it.each(ARTIFACTS.map((artifact) => ({ ...artifact, label: artifact.id })))(
    '$label',
    async ({ id, article, make }) => {
      const path = await make(await scratch());
      const run = await cli(['radius', GATED, '--change', path]);
      expect(run.code).toBe(2);
      // It says what the file is, with the right article, and no other kind.
      expect(run.err).toContain(`This file is ${article} ${id}, not a change manifest.`);
      for (const other of ARTIFACTS.filter((artifact) => artifact.id !== id))
        expect(run.err).not.toContain(`This file is ${other.article} ${other.id},`);
      for (const source of SOURCES_OF_MANIFESTS) expect(run.err).toContain(source);
    },
  );
});

describe('the registry of artifact kinds', () => {
  it('has a case in the matrix for every kind it recognises, so a new kind cannot be added untested', () => {
    expect(ARTIFACT_KINDS.map((kind) => kind.id).sort()).toEqual(
      ARTIFACTS.map((artifact) => artifact.id).sort(),
    );
  });
});

describe('a file that is no artifact of driftbench gets no pointer (matrix)', () => {
  const CASES: Array<{ id: string; text: string | Buffer }> = [
    { id: 'an empty file', text: '' },
    { id: 'plain text', text: 'a few words that are no document\n' },
    { id: 'a list', text: '- one\n- two\n' },
    { id: 'a number', text: '42\n' },
    { id: 'a manifest with a field it does not know', text: 'from: a\nto: b\nchanges: []\nsurprise: true\n' },
    { id: 'an object that shares one key with a diff', text: 'version: 1\nthings: []\n' },
    // Each kind with one of its structure missing: near misses, none of them the artifact.
    { id: 'a radius report without totals', text: JSON.stringify({ manifest: {}, modes: [], specs: [] }) },
    { id: 'a radius report without modes', text: JSON.stringify({ manifest: {}, specs: [], totals: {} }) },
    { id: 'a radius report without specs', text: JSON.stringify({ manifest: {}, modes: [], totals: {} }) },
    { id: 'a radius report without manifest', text: JSON.stringify({ modes: [], specs: [], totals: {} }) },
    { id: 'an object with only blocks', text: 'blocks:\n  - user: hi\n' },
    { id: 'an object with only an id', text: 'id: example\n' },
    { id: 'an object with only atoms', text: 'atoms: []\nedges: []\n' },
    { id: 'malformed YAML', text: 'from: [unclosed\nchanges: {a: \n' },
    {
      id: 'binary bytes',
      text: Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) % 256)),
    },
  ];
  it.each(CASES)('$id', async ({ text }) => {
    const folder = await scratch();
    const path = join(folder, 'other.yaml');
    await writeFile(path, text);
    const run = await cli(['radius', GATED, '--change', path]);
    expect(run.code).toBe(2);
    for (const source of SOURCES_OF_MANIFESTS) expect(run.err).not.toContain(source);
  });
});

describe('every reader of a change manifest names the artifact', () => {
  const mapPath = join(ROOT, MAP);

  it('radius', async () => {
    const run = await cli(['radius', GATED, '--change', mapPath]);
    expect(run.err).toContain('This file is an estate map, not a change manifest.');
  });

  it('campaign run --from --change', async () => {
    const folder = await scratch();
    const run = await cli([
      'campaign',
      'run',
      GATED,
      '--target',
      'function:acme-sales',
      '--store',
      join(folder, 's.db'),
      '--from',
      'no-such-campaign',
      '--change',
      mapPath,
    ]);
    expect(run.err).toContain('This file is an estate map, not a change manifest.');
  });

  it('campaign rejudge --from --change', async () => {
    const folder = await scratch();
    const run = await cli([
      'campaign',
      'rejudge',
      GATED,
      '--store',
      join(folder, 's.db'),
      '--from',
      'no-such-campaign',
      '--campaign',
      'new-campaign',
      '--change',
      mapPath,
    ]);
    expect(run.err).toContain('This file is an estate map, not a change manifest.');
  });

  it('estate run --from --change', async () => {
    const folder = await scratch();
    const copy = join(folder, 'estate');
    await cp(join(ROOT, 'examples/estates/fixture/CLAUDE.md'), join(copy, 'CLAUDE.md'));
    await cp(join(ROOT, 'examples/estates/fixture/.claude'), join(copy, '.claude'), { recursive: true });
    await writeFile(join(folder, 'old.db'), '');
    const run = await cli([
      'estate',
      'run',
      join(ROOT, SPEC),
      '--estate',
      copy,
      '--runtime',
      'claude-code',
      '--command',
      join(ROOT, 'examples/estates/fixture/live/fake/claude.mjs'),
      '--store',
      join(folder, 'new.db'),
      '--from',
      join(folder, 'old.db'),
      '--change',
      mapPath,
      '--agent-version',
      'v2',
    ]);
    expect(run.err).toContain('This file is an estate map, not a change manifest.');
  });
});

describe('metamorphic: the same file in another form', () => {
  it('an estate diff written as YAML instead of JSON gets the same answer', async () => {
    const folder = await scratch();
    const json = join(folder, 'diff.json');
    expect((await cli(['estate', 'diff', MAP, MAP, '--out', json])).code).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const yaml = join(folder, 'diff.yaml');
    await writeFile(yaml, await readFile(json, 'utf8')); // JSON is YAML
    const run = await cli(['radius', GATED, '--change', yaml]);
    expect(run.code).toBe(2);
    for (const source of SOURCES_OF_MANIFESTS) expect(run.err).toContain(source);
  });

  it('a file that is no artifact gets no pointer to the producing command, and a valid manifest runs', async () => {
    const folder = await scratch();
    const bad = join(folder, 'bad.yaml');
    await writeFile(bad, 'from: v1\nchanges:\n  - kind: stage\n    stage: recap\n');
    const refused = await cli(['radius', GATED, '--change', bad]);
    expect(refused.code).toBe(2);
    for (const source of SOURCES_OF_MANIFESTS) expect(refused.err).not.toContain(source);
    const fine = await cli(['radius', GATED, '--change', MANIFEST]);
    expect(fine.code).toBe(0);
    expect(fine.err).toBe('');
  });
});

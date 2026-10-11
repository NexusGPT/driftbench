import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEstateDiff } from '@driftbench/estate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');

async function cli(argv: string[], cwd = ROOT) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io), out, err };
}

/** A copy of the fixture estate in a temporary folder, without its committed outputs. */
async function fixtureCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-maintain-'));
  await cp(join(FIXTURE, 'CLAUDE.md'), join(root, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(root, '.claude'), { recursive: true });
  return root;
}

async function edit(path: string, from: string, to: string): Promise<void> {
  const text = await readFile(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${path} does not hold ${from}`);
  await writeFile(path, text.replace(from, to));
}

describe('driftbench estate diff', () => {
  it('finds no change between the fixture map and its approved copy', async () => {
    const result = await cli([
      'estate',
      'diff',
      'examples/estates/fixture/map.yaml',
      'examples/estates/fixture/approved.yaml',
    ]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'Atoms: 0 added, 0 removed, 0 changed (0 white space only, 0 semantic), 0 moved with the same quote, 0 restated, 122 unchanged.',
    );
    expect(result.out).toContain('Edges: 0 added, 0 removed.');
  });

  it('reads two scans of an estate edited in between, prints the classes and writes the JSON', async () => {
    const root = await fixtureCopy();
    const before = await cli(['estate', 'scan', '.', '--no-model', '--out', 'v1.yaml'], root);
    expect(before.code).toBe(0);
    await edit(
      join(root, 'CLAUDE.md'),
      '| plan the delivery routes for tomorrow |',
      '| plan the delivery routes for the next two days |',
    );
    await edit(join(root, 'CLAUDE.md'), '| know where a shipment is |', '| know where   a shipment is |');
    const after = await cli(['estate', 'scan', '.', '--no-model', '--out', 'v2.yaml'], root);
    expect(after.code).toBe(0);

    const text = await cli(['estate', 'diff', 'v1.yaml', 'v2.yaml', '--out', 'diff.json'], root);
    expect(text.err).toBe('');
    expect(text.code).toBe(0);
    expect(text.out).toContain('2 changed (1 white space only, 1 semantic)');
    expect(text.out).toContain(
      'Changed, semantic:\n  ~ route.standing.an-ask-to-plan-the-delivery (route) CLAUDE.md:36',
    );
    expect(text.out).toContain('now: | plan the delivery routes for the next two days |');
    expect(text.out).toContain(
      'Changed, white space only:\n  ~ route.standing.an-ask-to-know-where-a (route)',
    );
    expect(text.out).toContain('Wrote diff.json.');

    const written = parseEstateDiff(await readFile(join(root, 'diff.json'), 'utf8'));
    if (!written.ok) throw new Error(written.message);
    expect(written.diff.old.path).toBe('v1.yaml');
    expect(written.diff.summary.semantic).toBe(1);

    const json = await cli(['estate', 'diff', 'v1.yaml', 'v2.yaml', '--json'], root);
    expect(json.code).toBe(0);
    const printed = parseEstateDiff(json.out);
    expect(printed.ok && printed.diff).toEqual(written.diff);
  });

  it('exits 2 and writes nothing when a map does not load', async () => {
    const root = await fixtureCopy();
    await writeFile(join(root, 'broken.yaml'), 'version: 1\n');
    const result = await cli(
      ['estate', 'diff', 'broken.yaml', join(FIXTURE, 'map.yaml'), '--out', 'diff.json'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('broken.yaml is not a valid estate map:');
    await expect(readFile(join(root, 'diff.json'), 'utf8')).rejects.toThrow();
  });
});

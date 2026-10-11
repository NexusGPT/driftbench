import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

/** A valid spec covering the given atoms. */
function spec(id: string, atoms: string[]): string {
  return [
    `# Covers ${atoms.join(', ')}. Fictional.`,
    `id: ${id}`,
    'kind: task',
    `title: Test ${id}`,
    'target: { adapter: claude-code }',
    'metadata:',
    `  estate: { atoms: [${atoms.join(', ')}] }`,
    'blocks:',
    '  - user: Plan the deliveries.',
    '    expect:',
    '      skills:',
    '        - { name: shipment-tracker, count: { min: 1 } }',
    '',
  ].join('\n');
}

/** Two scans of the fixture, the second after a route changed meaning, a route was removed and a gate added. */
async function editedEstate(): Promise<string> {
  const root = await fixtureCopy();
  expect((await cli(['estate', 'scan', '.', '--no-model', '--out', 'v1.yaml'], root)).code).toBe(0);
  const standing = join(root, 'CLAUDE.md');
  await edit(
    standing,
    '| plan the delivery routes for tomorrow |',
    '| plan the delivery routes for the next two days |',
  );
  await edit(standing, '| audit the ledger for duplicate payments | the `ledger-auditor` agent |\n', '');
  await edit(
    standing,
    'during this session.\n',
    'during this session.\n- **R18.** Before closing a month: Read `.claude/skills/weekly-report/templates/report.md`.\n',
  );
  expect((await cli(['estate', 'scan', '.', '--no-model', '--out', 'v2.yaml'], root)).code).toBe(0);
  expect((await cli(['estate', 'diff', 'v1.yaml', 'v2.yaml', '--out', 'diff.json'], root)).code).toBe(0);
  await mkdir(join(root, 'tests'));
  await writeFile(
    join(root, 'tests', 'plan.yaml'),
    spec('t-plan', ['route.standing.an-ask-to-plan-the-delivery']),
  );
  await writeFile(
    join(root, 'tests', 'audit.yaml'),
    spec('t-audit', ['route.standing.an-ask-to-audit-the-ledger']),
  );
  await writeFile(
    join(root, 'tests', 'track.yaml'),
    spec('t-track', ['route.standing.an-ask-to-know-where-a']),
  );
  return root;
}

describe('driftbench estate impact', () => {
  it('lists what to regenerate, re-approve, retire and add, and exits 1 for the person', async () => {
    const root = await editedEstate();
    const result = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests'], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(1);
    expect(result.out).toContain('on 3 live estate tests (0 retired before, 0 other specs)');
    expect(result.out).toContain('  t-plan (plan.yaml): route.standing.an-ask-to-plan-the-delivery semantic');
    expect(result.out).toContain(
      'Re-approve, the meaning changed:\n  route.standing.an-ask-to-plan-the-delivery (route)',
    );
    expect(result.out).toContain(
      '  t-audit (audit.yaml): retired: atom route.standing.an-ask-to-audit-the-ledger removed [to write with --write]',
    );
    expect(result.out).toContain(
      'New atoms with no test:\n  reference.standing.read-claude-skills-weekly-report-templates (reference) CLAUDE.md:26\n  gate.standing.read-claude-skills-weekly-report-templates (gate) CLAUDE.md:26\n',
    );
    expect(result.out).toContain(
      're-approve route.standing.an-ask-to-plan-the-delivery: its meaning changed; 1 test waits',
    );
    expect(await readFile(join(root, 'tests', 'audit.yaml'), 'utf8')).not.toContain('retired');
  });

  it('writes the retirement into the spec with --write, and finds it written the next time', async () => {
    const root = await editedEstate();
    const written = await cli(
      ['estate', 'impact', 'diff.json', '--tests', 'tests', '--write', '--out', 'impact.json'],
      root,
    );
    expect(written.code).toBe(1);
    expect(written.out).toContain('[written]');
    expect(written.out).toContain('Wrote impact.json.');
    const audit = await readFile(join(root, 'tests', 'audit.yaml'), 'utf8');
    expect(audit).toContain('  retired: atom route.standing.an-ask-to-audit-the-ledger removed');
    expect(audit).toContain('# Covers route.standing.an-ask-to-audit-the-ledger. Fictional.');
    const report = JSON.parse(await readFile(join(root, 'impact.json'), 'utf8')) as {
      retire: { state: string }[];
    };
    expect(report.retire.map((entry) => entry.state)).toEqual(['written']);

    const again = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests', '--json'], root);
    const second = JSON.parse(again.out) as { retire: { state: string }[]; tests: { retired: number } };
    expect(second.retire.map((entry) => entry.state)).toEqual(['already']);
    expect(second.tests.retired).toBe(1);
  });

  it('exits 0 when nothing needs a person', async () => {
    const root = await editedEstate();
    await writeFile(
      join(root, 'tests', 'new.yaml'),
      spec('t-new', ['gate.standing.read-claude-skills-weekly-report-templates']),
    );
    const diff = JSON.parse(await readFile(join(root, 'diff.json'), 'utf8')) as {
      atoms: { changed: unknown[]; added: { id: string }[] };
    };
    const gate = diff.atoms.added.find((entry) => entry.id.startsWith('gate.'));
    expect(gate?.id).toBe('gate.standing.read-claude-skills-weekly-report-templates');
    diff.atoms.changed = [];
    diff.atoms.added = diff.atoms.added.filter((entry) => entry.id.startsWith('gate.'));
    await writeFile(join(root, 'quiet.json'), JSON.stringify(diff));
    const result = await cli(['estate', 'impact', 'quiet.json', '--tests', 'tests'], root);
    expect(result.out).toContain('Nothing needs a person.');
    expect(result.code).toBe(0);
  });

  it('exits 2 without --tests, on a file that is not a diff, and on a folder of broken specs', async () => {
    const root = await editedEstate();
    const noTests = await cli(['estate', 'impact', 'diff.json'], root);
    expect(noTests.code).toBe(2);
    expect(noTests.err).toContain("required option '--tests <dir>'");
    await writeFile(join(root, 'not-a-diff.json'), '{"version": 1}');
    const bad = await cli(['estate', 'impact', 'not-a-diff.json', '--tests', 'tests'], root);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('not-a-diff.json is not an estate diff:');
    await writeFile(join(root, 'tests', 'broken.yaml'), 'id: x\n');
    const broken = await cli(['estate', 'impact', 'diff.json', '--tests', 'tests'], root);
    expect(broken.code).toBe(2);
    expect(broken.err).toContain('The tests in tests cannot be read:');
  });
});

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecs } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const IMPORT = join(ROOT, 'examples/acme/import');

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-import-'));
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

describe('driftbench import', () => {
  it('maps the rows of a CSV file to valid spec files, one per conversation', async () => {
    const run = await cli([
      'import',
      'csv',
      join(IMPORT, 'cases.csv'),
      '--mapping',
      join(IMPORT, 'mapping.yaml'),
      '--out',
      'imported',
    ]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toBe(
      [
        '✓ imported/acme-imported-upgrade.yaml  acme-imported-upgrade · 2 blocks · rows 2, 3',
        '✓ imported/acme-imported-porting.yaml  acme-imported-porting · 1 block · row 4',
        'Imported 2 specs from 3 rows of cases.csv into imported.',
        '',
      ].join('\n'),
    );
    const loaded = await loadSpecs([join(dir, 'imported')]);
    expect(loaded.every((result) => result.ok)).toBe(true);
    const upgrade = loaded.find((result) => result.ok && result.spec.id === 'acme-imported-upgrade');
    expect(upgrade?.ok && upgrade.spec.blocks.map((block) => block.expect?.must)).toEqual([
      ['Acme Telecom', 'street address'],
      ['Fiber is not available', 'Acme Air 5G'],
    ]);
    expect(upgrade?.ok && upgrade.spec.blocks[1]?.expect?.must_not).toEqual(['Fiber (300|1000)']);
  });

  it('reads the Cases sheet of a workbook to the same specs as the CSV file', async () => {
    const csv = await cli([
      'import',
      'csv',
      join(IMPORT, 'cases.csv'),
      '--mapping',
      join(IMPORT, 'mapping.yaml'),
      '--out',
      'a',
    ]);
    const xlsx = await cli([
      'import',
      'xlsx',
      join(IMPORT, 'cases.xlsx'),
      '--mapping',
      join(IMPORT, 'mapping.yaml'),
      '--out',
      'b',
    ]);
    expect([csv.code, xlsx.code]).toEqual([0, 0]);
    const strip = (text: string) => text.split('\n').slice(1).join('\n');
    for (const name of await readdir(join(dir, 'a'))) {
      expect(strip(await readFile(join(dir, 'b', name), 'utf8')), name).toBe(
        strip(await readFile(join(dir, 'a', name), 'utf8')),
      );
    }
    expect(xlsx.out).toContain('Imported 2 specs from 3 rows of cases.xlsx into b.');
  });

  it('writes nothing and exits 1 when a row makes an invalid spec, naming the row', async () => {
    const csv = `${await readFile(join(IMPORT, 'cases.csv'), 'utf8')}refund,A refund,I want my money back,nowhere,,,0\n`;
    await writeFile(join(dir, 'cases.csv'), csv);
    const run = await cli([
      'import',
      'csv',
      'cases.csv',
      '--mapping',
      join(IMPORT, 'mapping.yaml'),
      '--out',
      'out',
    ]);
    expect(run.code).toBe(1);
    expect(run.err).toContain('✗ row 5: spec acme-imported-refund:');
    expect(run.err).toContain('STAGE_UNKNOWN');
    expect(run.err).toContain('Nothing was written.');
    await expect(readdir(join(dir, 'out'))).rejects.toThrow();
  });

  it('refuses to overwrite an existing spec file without --force', async () => {
    const args = [
      'import',
      'csv',
      join(IMPORT, 'cases.csv'),
      '--mapping',
      join(IMPORT, 'mapping.yaml'),
      '--out',
      'out',
    ];
    await cli(args);
    await writeFile(join(dir, 'out', 'acme-imported-porting.yaml'), 'id: edited\n');
    const again = await cli(args);
    expect(again.code).toBe(2);
    expect(again.err).toBe(
      'out/acme-imported-porting.yaml exists and differs from the import. Nothing was written. Overwrite with --force.\n',
    );
    expect(await readFile(join(dir, 'out', 'acme-imported-porting.yaml'), 'utf8')).toBe('id: edited\n');
    expect((await cli([...args, '--force'])).code).toBe(0);
  });

  it('exits 2 on a bad mapping, a format that does not match the file, and a missing column', async () => {
    await writeFile(join(dir, 'bad.yaml'), 'spec: { title: x }\nblock: { user: "{q}" }\n');
    const bad = await cli([
      'import',
      'csv',
      join(IMPORT, 'cases.csv'),
      '--mapping',
      'bad.yaml',
      '--out',
      'out',
    ]);
    expect(bad.code).toBe(2);
    expect(bad.err).toBe(
      'The mapping bad.yaml is invalid:\n    spec: needs an id, such as id: "my-spec-{row}"\n',
    );

    const format = await cli([
      'import',
      'xlsx',
      join(IMPORT, 'cases.csv'),
      '--mapping',
      join(IMPORT, 'mapping.yaml'),
      '--out',
      'out',
    ]);
    expect(format.code).toBe(2);
    expect(format.err).toContain('import xlsx reads a .xlsx file');

    await writeFile(join(dir, 'missing.yaml'), 'spec: { id: "x-{row}" }\nblock: { user: "{prompt}" }\n');
    const missing = await cli([
      'import',
      'csv',
      join(IMPORT, 'cases.csv'),
      '--mapping',
      'missing.yaml',
      '--out',
      'out',
    ]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('the mapping names column "prompt", which cases.csv does not have');
  });
});

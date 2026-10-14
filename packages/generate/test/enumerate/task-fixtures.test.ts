import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openMemoryStore, readTree, restoreFiles } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type GeneratedFile, generateSuite } from '../../src/enumerate/generate';
import { TaskFamilyRelation } from '../../src/extract/proposal';
import { buildInstances, seedFolderName } from '../../src/families/instances';
import type { TaskInput } from '../../src/seed/tasks';
import { load, TOY_FAMILY, TOY_ORACLE, writeFamily } from '../families/support';
import { zedPrepared } from './support';

const binary = new Uint8Array([0x50, 0x4b, 0, 1, 0xff]);
const prepared = zedPrepared();
const options = { mapPath: 'map.yaml', max: 1, t: 2, seed: 1 };
let familyDir: string;
let dir: string;
let tasks: TaskInput[];

beforeAll(async () => {
  familyDir = await writeFamily(
    TOY_FAMILY.replace(
      '  - path: README.txt\n',
      '  - path: nested/book.xlsx\n    copy: { from: fixture.xlsx }\n  - path: README.txt\n',
    ),
    TOY_ORACLE,
    { 'fixture.xlsx': binary },
  );
  const loaded = await load(familyDir);
  const instances = await buildInstances(loaded, {
    n: 1,
    seed: 1,
    review: 'pending',
    seedFrom: (instance, variant) => seedFolderName(`${loaded.family.id}-${instance}-${variant}`),
  });
  tasks = [
    {
      relation: TaskFamilyRelation.parse({
        kind: 'task_family',
        flow: 'balance',
        family: 'toy-totals',
        stages: ['total'],
        evidence: { source: 'family.yaml', quote: 'Total the quantities per group' },
        produced_by: 'code',
        approved: true,
      }),
      variants: instances.flatMap((instance) =>
        instance.variants.map((variant) => ({
          spec: variant.spec,
          seed: {
            ...variant.seed,
            text: {
              ...variant.seed.text,
              '.settings/options.txt': 'fictional fixture settings\n',
              // A seed file may have the same basename as its owning spec.
              [`${variant.spec.id}.yaml`]: 'fixture: keep these bytes\n',
            },
          },
        })),
      ),
    },
  ];
  dir = await mkdtemp(join(tmpdir(), 'driftbench-task-fixtures-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(familyDir, { recursive: true, force: true });
});

async function writeSuite(files: GeneratedFile[], target: string): Promise<void> {
  for (const file of files) {
    const path = join(target, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes ?? file.text);
  }
}

describe('task fixture retention', () => {
  it('keeps every seed asset of retained task specs with a legal spec cap', () => {
    const full = generateSuite(prepared, { ...options, tasks });
    const capped = generateSuite(prepared, { ...options, tasks, specCap: full.all.length });
    expect(capped.report.invalid).toEqual([]);
    const taskSpecs = capped.all.filter((spec) => spec.kind === 'task');
    expect(taskSpecs.length).toBeGreaterThan(0);
    for (const spec of taskSpecs) {
      const prefix = `specs/task/${seedFolderName(spec.id)}/`;
      const assets = full.files.filter((file) => file.path.startsWith(prefix));
      expect(assets.length).toBeGreaterThan(2);
      expect(
        capped.files.filter((file) => file.path.startsWith(prefix)),
        spec.id,
      ).toEqual(assets);
    }
  });

  it.each([false, true])('pushes and restores a fictional family byte for byte (capped: %s)', async (cap) => {
    const full = generateSuite(prepared, { ...options, tasks });
    const suite = cap ? generateSuite(prepared, { ...options, tasks, specCap: full.all.length }) : full;
    const source = join(dir, `source-${cap}`);
    await writeSuite(suite.files, source);
    // Hidden seed content belongs to the task, but repository and dependency folders never do.
    for (const folder of [
      '.git',
      'node_modules',
      'specs/task/.seed-extra/.git',
      'specs/task/.seed-extra/node_modules',
    ]) {
      await mkdir(join(source, folder), { recursive: true });
      await writeFile(join(source, folder, 'ignored.txt'), 'ignored');
    }
    await writeFile(join(source, '.DS_Store'), 'ignored');
    const store = openMemoryStore();
    try {
      const tree = await readTree(source);
      expect(tree.files.some((file) => file.path.endsWith('ignored.txt') || file.path === '.DS_Store')).toBe(
        false,
      );
      const { version } = await store.pushVersion('dataset', 'toy-totals', tree.files);
      const target = join(dir, `restored-${cap}`);
      await restoreFiles(await store.readVersionFiles(version), target, { single: false });
      for (const spec of suite.all.filter((spec) => spec.kind === 'task')) {
        const prefix = `specs/task/${seedFolderName(spec.id)}/`;
        expect(version.files.some((file) => file.path === `${prefix}nested/book.xlsx`)).toBe(true);
        const assets = full.files.filter((file) => file.path.startsWith(prefix));
        for (const file of assets) {
          expect(await readFile(join(target, file.path))).toEqual(Buffer.from(file.bytes ?? file.text));
        }
        expect(await readFile(join(target, 'specs/task', `${spec.id}.yaml`), 'utf8')).toContain(
          seedFolderName(spec.id),
        );
      }
    } finally {
      await store.close();
    }
  });
});

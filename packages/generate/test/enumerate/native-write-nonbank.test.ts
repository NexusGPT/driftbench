import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { generateSuite, generateSuiteToDisk, REPORT_FILE } from '../../src/enumerate';
import type { Proposal } from '../../src/extract/proposal';
import { seedFolderName } from '../../src/families/instances';
import { prepareMap } from '../../src/seed/map';
import type { TaskInput } from '../../src/seed/tasks';

const evidence = { source: 'garden.md', quote: 'Greet the gardener, then give the care plan.' };
const dimension = (
  id: string,
  kind: Proposal['dimensions'][number]['kind'],
  role: 'axis' | 'detail',
  ids: string[],
): Proposal['dimensions'][number] => ({
  id,
  kind,
  role,
  title: id,
  approved: true,
  produced_by: 'code',
  values: ids.map((value) => ({ id: value, title: value, evidence, produced_by: 'code' as const })),
});

it('writes a handmade Unicode garden map through native text writes and retains binary fixtures', async () => {
  const prepared = prepareMap({
    version: 1,
    agent: 'garden-helper',
    produced_by: { family: 'unit', model: 'handwritten', at: '2026-01-01T00:00:00.000Z' },
    sources: [{ kind: 'prompt', path: 'garden.md' }],
    dimensions: [
      dimension('stage', 'stage', 'axis', ['greet', 'care']),
      dimension('stage_transition', 'behaviour', 'detail', ['greet-to-care']),
      dimension('flow', 'behaviour', 'axis', ['garden']),
      dimension('channel', 'channel', 'axis', ['desk', 'widget']),
      dimension('persona', 'persona', 'axis', ['gardener', 'volunteer']),
    ],
    constraints: [],
    phrases: [
      {
        dimension: 'stage_transition',
        value: 'greet-to-care',
        text: 'Help with the café maple 🌿.',
        lang: 'en',
        produced_by: 'code',
        approved: true,
      },
      {
        dimension: 'flow',
        value: 'garden',
        text: 'Check my garden.',
        lang: 'en',
        produced_by: 'code',
        approved: true,
      },
    ],
  });
  const binary = new Uint8Array([0, 255, 128, 17]);
  const tasks: TaskInput[] = [
    {
      relation: {
        kind: 'task_family',
        flow: 'garden',
        family: 'care-note',
        stages: ['care'],
        evidence,
        produced_by: 'code',
        approved: true,
      },
      variants: [
        {
          spec: {
            id: 'garden-note',
            version: '1',
            kind: 'task',
            title: 'Keep the care note',
            given: { world: { workspace: { from: seedFolderName('garden-note') } } },
            blocks: [
              { id: 'write-note', when: { user: 'Save the care note.' }, expect: { must: ['care-note'] } },
            ],
          },
          seed: { text: { 'readme.txt': 'café 🌿\n' }, binary: { 'leaf.bin': binary } },
        },
      ],
    },
  ];
  const options = { mapPath: 'garden.yaml', t: 2, tasks };
  const eager = generateSuite(prepared, options);
  expect(eager.report.invalid).toEqual([]);
  const directory = await mkdtemp(join(tmpdir(), 'garden-native-writes-'));
  const yamlDescriptors = new Set<number>();
  let textSlowPathWrites = 0;
  const open = fs.openSync;
  const write = fs.writeSync;
  const close = fs.closeSync;
  try {
    // Count the real JavaScript fallback writes, not the options passed to writeFileSync.
    // Native UTF-8 string writes do not enter this buffer-conversion loop.
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const descriptor = Reflect.apply(open, fs, args);
      if (String(args[0]).endsWith('.yaml')) yamlDescriptors.add(descriptor);
      return descriptor;
    });
    vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
      if (yamlDescriptors.has(args[0])) textSlowPathWrites += 1;
      return Reflect.apply(write, fs, args);
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((descriptor) => {
      yamlDescriptors.delete(descriptor);
      return close(descriptor);
    });
    const disk = generateSuiteToDisk(prepared, { ...options, outputDir: directory });
    expect(disk.summary).toEqual(eager.report.summary);
    expect(disk.fileCount).toBe(eager.files.length);
    const specs = eager.files.filter((file) => file.path.endsWith('.yaml'));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some((file) => file.text.includes('café maple 🌿'))).toBe(true);
    for (const file of eager.files.filter((file) => file.path !== REPORT_FILE)) {
      expect(await readFile(join(directory, file.path)), file.path).toEqual(
        Buffer.from(file.bytes ?? file.text),
      );
    }
    const asset = eager.files.find((file) => file.path.endsWith('/leaf.bin'));
    if (!asset) throw new Error('the binary fixture was not generated');
    expect(await readFile(join(directory, asset.path))).toEqual(Buffer.from(binary));
    expect(textSlowPathWrites).toBe(0);
    const before = await readFile(disk.reportPath);
    expect(() => generateSuiteToDisk(prepared, { ...options, outputDir: directory })).toThrow(
      'outputDir must be empty',
    );
    expect(await readFile(disk.reportPath)).toEqual(before);
  } finally {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

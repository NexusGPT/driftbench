import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as generate from '../../src/enumerate';
import { ACME_MAP, zedPrepared } from './support';

describe('generation to disk', () => {
  it('writes every eager spec unchanged and preserves the full report, including incomplete diagnostics', async () => {
    expect(generate).toHaveProperty('generateSuiteToDisk');
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-'));
    try {
      const map = zedPrepared();
      const options = { mapPath: 'map.yaml', seed: 5, t: 2 };
      const eager = generate.generateSuite(map, options);
      const disk = await generate.generateSuiteToDisk(map, { ...options, outputDir: directory });
      expect(disk.summary).toEqual(eager.report.summary);
      expect(disk.fileCount).toBe(eager.files.length);
      for (const file of eager.files.filter((entry) => entry.path !== generate.REPORT_FILE)) {
        expect(await readFile(join(directory, file.path), 'utf8')).toBe(file.text);
      }
      const report = JSON.parse(await readFile(disk.reportPath, 'utf8'));
      const { measures, ...coverage } = report.coverage;
      const { measures: expectedMeasures, ...expectedCoverage } = eager.report.coverage;
      expect(coverage).toEqual(expectedCoverage);
      for (const [key, value] of Object.entries(expectedMeasures))
        expect(measures[key]).toBeCloseTo(value as number, 10);
      expect({ ...report, coverage: undefined }).toEqual({ ...eager.report, coverage: undefined });
      expect(disk).not.toHaveProperty('files');
      expect(disk).not.toHaveProperty('complete');
      expect(disk).not.toHaveProperty('all');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves path scenarios, capped seeder numbering and complete-spec diversity measures', async () => {
    const loaded = await generate.loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(loaded.message);
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-paths-'));
    try {
      const options = { mapPath: 'approved.yaml', seed: 2, t: 2, max: 2 };
      const eager = generate.generateSuite(loaded.prepared, options);
      expect(eager.complete.length).toBeGreaterThan(0);
      const disk = generate.generateSuiteToDisk(loaded.prepared, { ...options, outputDir: directory });
      expect(disk.summary).toEqual(eager.report.summary);
      for (const file of eager.files.filter((entry) => entry.path !== generate.REPORT_FILE)) {
        expect(await readFile(join(directory, file.path), 'utf8'), file.path).toBe(file.text);
      }
      const report = JSON.parse(await readFile(disk.reportPath, 'utf8'));
      const { measures, ...coverage } = report.coverage;
      const { measures: expectedMeasures, ...expectedCoverage } = eager.report.coverage;
      expect(coverage).toEqual(expectedCoverage);
      for (const [key, value] of Object.entries(expectedMeasures))
        expect(measures[key], key).toBeCloseTo(value as number, 10);
      expect({ ...report, coverage: undefined }).toEqual({ ...eager.report, coverage: undefined });
      expect((await readdir(directory)).some((name) => name.startsWith('.generate-'))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('honours reduceEnds: false in the stream as the eager API does', async () => {
    const loaded = await generate.loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(loaded.message);
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-plain-'));
    try {
      const options = { mapPath: 'approved.yaml', seed: 2, t: 2, max: 2 };
      const reduced = generate.generateSuite(loaded.prepared, options);
      const plain = generate.generateSuite(loaded.prepared, { ...options, reduceEnds: false });
      // The flag matters on this map: the reducer cuts something.
      expect(reduced.files.map((file) => file.text).join('')).not.toBe(plain.files.map((file) => file.text).join(''));
      generate.generateSuiteToDisk(loaded.prepared, { ...options, reduceEnds: false, outputDir: directory });
      for (const file of plain.files.filter((entry) => entry.path !== generate.REPORT_FILE)) {
        expect(await readFile(join(directory, file.path), 'utf8'), file.path).toBe(file.text);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('rejects nonstreaming option modes explicitly before creating output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-options-'));
    try {
      for (const option of [{ budget: 10 }, { specCap: 10 }, { specCapMode: 'pairs' }]) {
        expect(() =>
          generate.generateSuiteToDisk(zedPrepared(), {
            mapPath: 'map.yaml',
            outputDir: join(directory, 'output'),
            ...option,
          }),
        ).toThrow('generateSuiteToDisk does not support');
        expect(await readdir(directory)).toEqual([]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('cleans private spools on failure and refuses an existing suite before writing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-failure-'));
    try {
      const map = zedPrepared();
      expect(() =>
        generate.generateSuiteToDisk(map, { mapPath: 'map.yaml', outputDir: directory, t: 0 }),
      ).toThrow('t must be');
      expect(await readdir(directory)).toEqual([]);
      generate.generateSuiteToDisk(map, { mapPath: 'map.yaml', outputDir: directory, t: 2, max: 1 });
      const before = await readFile(join(directory, generate.REPORT_FILE), 'utf8');
      expect(() => generate.generateSuiteToDisk(map, { mapPath: 'map.yaml', outputDir: directory })).toThrow(
        'outputDir must be empty',
      );
      expect(await readFile(join(directory, generate.REPORT_FILE), 'utf8')).toBe(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite, generateSuiteToDisk, REPORT_FILE } from '../../src/enumerate';

const CHILD = fileURLToPath(new URL('./fixtures/heap-child.ts', import.meta.url));

/** Runs the child under a heap cap, in megabytes: its exit code and the spec count it printed. */
function underCap(mode: 'eager' | 'disk', factor: number, megabytes: number, out: string) {
  const run = spawnSync(
    process.execPath,
    [`--max-old-space-size=${megabytes}`, '--import', 'tsx', CHILD, mode, String(factor), join(out, mode)],
    { encoding: 'utf8', maxBuffer: 1 << 24 },
  );
  return { status: run.status, specs: Number(run.stdout.trim()), stderr: run.stderr };
}

describe('generation to disk at scale', () => {
  it('writes the eager files on a map whose deviation classes need a balance', async () => {
    const seed = 5;
    const hidden = hiddenSpec(seed);
    const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
    if (!source.prepared) throw new Error('the fictional map failed to load');
    const options = { mapPath: '../map.yaml', seed };
    const eager = generateSuite(source.prepared, options);
    expect(eager.files.some((file) => file.path.includes('gen-deviation-balance-'))).toBe(true);
    const directory = await mkdtemp(join(tmpdir(), 'driftbench-stream-balance-'));
    try {
      const disk = generateSuiteToDisk(source.prepared, { ...options, outputDir: directory });
      expect(disk.summary).toEqual(eager.report.summary);
      expect(disk.fileCount).toBe(eager.files.length);
      for (const file of eager.files.filter((entry) => entry.path !== REPORT_FILE))
        expect(await readFile(join(directory, file.path), 'utf8'), file.path).toBe(file.text);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);

  it('keeps the heap under a cap the eager API runs out of', async () => {
    // Ten times the behaviours: 3470 specs. The eager API holds every file and runs out of a 128 MB heap;
    // the disk API holds one spec at a time and finishes with the same count.
    const out = await mkdtemp(join(tmpdir(), 'driftbench-stream-heap-'));
    try {
      const eager = underCap('eager', 10, 128, out);
      expect(eager.status, eager.stderr.slice(-400)).not.toBe(0);
      expect(eager.stderr).toContain('heap out of memory');
      const disk = underCap('disk', 10, 128, out);
      expect(disk.status, disk.stderr.slice(-400)).toBe(0);
      expect(disk.specs).toBeGreaterThan(3000);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 600_000);
});

/**
 * The child process of the growth measurement:
 * `node --import tsx scale-growth-child.ts <seed> <lowFactor> <highFactor> <rounds> [generator]`.
 * In ONE process it generates the scaled hidden specification at the low factor and then at the high factor,
 * back to back, `rounds` times, and prints one JSON line (a ScaleGrowth). The time of a generation is the CPU
 * time of the product's own work, a map load and a generation to disk; rendering, writing the map and
 * removing the output are the harness's and are not charged. One untimed generation at the low factor comes
 * first, so neither size pays the cost of a cold start.
 *
 * Two sizes in one process, one after the other, are two measurements under the same machine load, the same
 * heap and the same warmed code. Their ratio, set against the ratio of the work, is the growth of the
 * product's cost: 1 for a product linear in the behaviours, the work ratio for a quadratic one. The optional
 * fifth argument names a module overriding `generateSuiteToDisk` or `loadApprovedMap`, as in `scale-child.ts`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as generator from '@agent-nexus/driftbench-generate';
import { generateSuite, loadApprovedMap, type PreparedMap } from '@agent-nexus/driftbench-generate';
import { MAP_PATH, writeAll } from './measure';
import { MAP_FILES, renderMap } from './render';
import { SCALE_GROWTH_BOUND, type ScaleGrowth, scaledSpec } from './scale';

type ToDisk = (
  prepared: PreparedMap,
  options: { seed: number; mapPath: string; outputDir: string },
) => { reportPath: string };

const [seedText, lowText, highText, roundsText, generatorModule] = process.argv.slice(2);
const seed = Number(seedText);
const low = Number(lowText);
const high = Number(highText);
const rounds = Number(roundsText);
const overrides = generatorModule
  ? ((await import(pathToFileURL(generatorModule).href)) as {
      generateSuiteToDisk?: ToDisk;
      loadApprovedMap?: typeof loadApprovedMap;
    })
  : {};
const toDisk =
  overrides.generateSuiteToDisk ??
  ((generator as Record<string, unknown>).generateSuiteToDisk as ToDisk | undefined);
const loadMap = overrides.loadApprovedMap ?? loadApprovedMap;

const root = await mkdtemp(join(tmpdir(), 'driftbench-vgrowth-'));

/** The scaled map of one factor, rendered and written once: the harness's work, never timed. */
async function mapOf(factor: number): Promise<string> {
  const dir = join(root, `map-${factor}`);
  await mkdir(dir);
  const rendered = renderMap(scaledSpec(seed, factor));
  for (const [key, name] of Object.entries(MAP_FILES))
    await writeFile(join(dir, name), rendered[key as keyof typeof rendered]);
  return join(dir, MAP_FILES.map);
}

let counter = 0;

/** One generation of a written map, in the CPU time of the product's own work, in milliseconds. */
async function generated(mapFile: string): Promise<number> {
  const outputDir = join(root, `out-${counter++}`);
  let micros = 0;
  const timed = async <T>(work: () => T | Promise<T>): Promise<T> => {
    const before = process.cpuUsage();
    try {
      return await work();
    } finally {
      const used = process.cpuUsage(before);
      micros += used.user + used.system;
    }
  };
  const loaded = await timed(() => loadMap(mapFile));
  if (!loaded.ok) throw new Error(`refused: ${loaded.message}`);
  if (toDisk) {
    await timed(() => toDisk(loaded.prepared, { seed, mapPath: MAP_PATH, outputDir }));
  } else {
    const result = await timed(() => generateSuite(loaded.prepared, { seed, mapPath: MAP_PATH }));
    await writeAll(outputDir, result.files);
  }
  await rm(outputDir, { recursive: true, force: true });
  return micros / 1000;
}

const out: ScaleGrowth = {
  seed,
  low,
  high,
  rounds,
  bound: SCALE_GROWTH_BOUND,
  lowMs: [],
  highMs: [],
  ratios: [],
  ratio: 0,
};
try {
  const lowMap = await mapOf(low);
  const highMap = await mapOf(high);
  await generated(lowMap);
  for (let round = 0; round < rounds; round += 1) {
    const small = await generated(lowMap);
    const large = await generated(highMap);
    out.lowMs.push(Math.round(small));
    out.highMs.push(Math.round(large));
    out.ratios.push(small > 0 ? large / small / (high / low) : Number.POSITIVE_INFINITY);
  }
  out.ratio = Math.min(...out.ratios);
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(out)}\n`);

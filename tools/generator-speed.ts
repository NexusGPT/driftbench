/**
 * The generator validator's scale workload with CPU time split by stage and SHA-256 file hashes.
 * Run identical commands on each revision, back to back, on the same machine:
 * node --cpu-prof --cpu-prof-dir=.exec/speed --max-old-space-size=2048 --import tsx tools/generator-speed.ts 100 before
 * The label selects the measurement file only. It never enters generated content.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { type LoadedSpec, loadSpecs } from '../packages/core/src/spec/load';
import {
  COMPLETE_DIR,
  type GeneratedFile,
  type GenerateOptions,
  generateSuite,
} from '../packages/generate/src/enumerate/generate';
import { loadApprovedMap } from '../packages/generate/src/enumerate/load';
import { MAP_FILES, renderMap } from '../packages/validators/src/ladders/generator/render';
import { scaledSpec } from '../packages/validators/src/ladders/generator/scale';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'spec-cap': { type: 'string' }, 'spec-cap-mode': { type: 'string' } },
});
const factor = Number(positionals[0] ?? 100);
const label = positionals[1] ?? 'measurement';
if (![1, 10, 100].includes(factor) || !/^[a-zA-Z0-9_-]+$/.test(label)) {
  throw new Error('usage: tools/generator-speed.ts <1|10|100> <label>');
}
const specCap = values['spec-cap'] === undefined ? undefined : Number(values['spec-cap']);
const specCapMode = values['spec-cap-mode'];
if (specCap !== undefined && (!Number.isSafeInteger(specCap) || specCap < 1)) {
  throw new Error('spec-cap must be a positive integer');
}
if (specCapMode !== undefined && specCapMode !== 'pairs' && specCapMode !== 'tuples') {
  throw new Error('spec-cap-mode must be pairs or tuples');
}
const capOptions: Pick<GenerateOptions, 'specCap' | 'specCapMode'> =
  specCap === undefined ? {} : { specCap, specCapMode };
const stages: Record<string, number> = {};
const seconds = (start: NodeJS.CpuUsage): number => {
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1e6;
};
async function timed<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const start = process.cpuUsage();
  try {
    return await run();
  } finally {
    stages[name] = (stages[name] ?? 0) + seconds(start);
  }
}
async function writeAll(root: string, files: readonly GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.text);
  }
}
async function readAll(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(relative(root, full).split(sep).join('/'), await readFile(full, 'utf8'));
    }
  };
  await walk(root);
  return out;
}

const hidden = scaledSpec(1, factor);
const loadStart = loadavg();
const started = process.cpuUsage();
const wall = performance.now();
const rendered = await timed('render_map', () => renderMap(hidden));
const root = await mkdtemp(join(tmpdir(), 'driftbench-speed-'));
let first: Map<string, string>;
let second: Map<string, string>;
let summary: ReturnType<typeof generateSuite>['report']['summary'] | undefined;
let invalid = 0;
const runs: ReturnType<typeof generateSuite>[] = [];
try {
  const mapDir = join(root, 'map');
  await timed('write_map', async () => {
    await mkdir(mapDir);
    for (const [key, name] of Object.entries(MAP_FILES)) {
      await writeFile(join(mapDir, name), rendered[key as keyof typeof rendered]);
    }
  });
  const mapPath = join(mapDir, MAP_FILES.map);
  const loaded = await timed('load_map', () => loadApprovedMap(mapPath));
  if (!loaded.ok) throw new Error(loaded.message);
  for (const folder of ['first', 'second']) {
    const again = await timed('load_map', () => loadApprovedMap(mapPath));
    if (!again.ok) throw new Error(again.message);
    const result = await timed(`generate_${folder}`, () =>
      generateSuite(again.prepared, { seed: 1, mapPath: `../map/${MAP_FILES.map}`, ...capOptions }),
    );
    if (specCap !== undefined && !('spec_cap' in result.report)) {
      throw new Error('this revision does not support spec-cap');
    }
    await timed('write_suites', () => writeAll(join(root, folder), result.files));
    runs.push(result);
  }
  first = await timed('read_suites', () => readAll(join(root, 'first')));
  second = await timed('read_suites', () => readAll(join(root, 'second')));
  const specs = await timed('reload_specs', () => loadSpecs([join(root, 'first')]));
  await timed('normalize_specs', () => {
    const loadedSpecs = specs.map((result) => ({
      ...result,
      path: relative(join(root, 'first'), result.path).split(sep).join('/'),
    }));
    const complete = loadedSpecs.filter(
      (result): result is LoadedSpec => result.ok && result.path.startsWith(`${COMPLETE_DIR}/`),
    );
    complete.sort((a, b) => a.path.localeCompare(b.path));
  });
  invalid = specs.filter((spec) => !spec.ok).length;
  summary = runs[0]?.report.summary;
} finally {
  await timed('cleanup', () => rm(root, { recursive: true, force: true }));
}
const totalCpu = seconds(started);
const wallSeconds = (performance.now() - wall) / 1000;
const loadEnd = loadavg();
const twoRunDiffs = [...new Set([...first.keys(), ...second.keys()])].filter(
  (path) => first.get(path) !== second.get(path),
);
const hashes = Object.fromEntries(
  [...first]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => [path, createHash('sha256').update(text).digest('hex')]),
);
const measurement = {
  label,
  factor,
  ...capOptions,
  node: process.version,
  cpu: cpus()[0]?.model,
  date: new Date().toISOString(),
  loadStart,
  loadEnd,
  stages,
  totalCpu,
  wallSeconds,
  files: first.size,
  summary,
  invalid,
  twoRunDiffs,
};
await mkdir('.exec/speed', { recursive: true });
await writeFile(
  `.exec/speed/${label}-${factor}.json`,
  `${JSON.stringify({ ...measurement, hashes }, null, 2)}\n`,
);
console.log(JSON.stringify(measurement));
if (invalid > 0 || twoRunDiffs.length > 0) process.exitCode = 1;

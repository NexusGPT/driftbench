import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUTPUTS = [
  '.github/workflows/validators.yml',
  'packages/validators/test/protect.test.ts',
  'packages/validators/src/protect.ts',
];
const TEMPLATES = ['validators.yml.template', 'protect.test.ts.template', 'protect.ts.template'];
const SEEDS = ['1', '2', '3', 'hidden'];
const ORDER = ['estate', 'judges', 'map', 'stats', 'system', 'variables', 'pointer'];

/** Scheduling policy uses semantic cut points; level numbers always come from the registered declarations. */
function position(ladder, id) {
  const index = ladder.levels.findIndex((level) => level.id === id);
  if (index < 0) throw new Error(`${ladder.component}: missing scheduling anchor ${id}`);
  return index + 1;
}

function range(from, to) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

function yamlRows(rows) {
  return rows
    .map((row) =>
      Object.entries(row)
        .map(([key, value], index) => `          ${index === 0 ? '- ' : '  '}${key}: ${value}`)
        .join('\n'),
    )
    .join('\n');
}

function flags(seed) {
  return seed === 'hidden' ? '--hidden --hidden-only' : `--seed ${seed}`;
}

function seedId(seed) {
  return seed === 'hidden' ? seed : `s${seed}`;
}

function sliced(component, seed, from, to, singular = false) {
  return {
    id: `${component}-${seedId(seed)}-${from}-${to}`,
    name: `${component} seed ${seed} ${singular ? `level ${from}` : `levels ${from} to ${to}`}`,
    component,
    flags: `${flags(seed)} --levels ${from}..${to}`,
  };
}

export function layoutPlan(ladders, floors, regression) {
  const names = Object.keys(ladders);
  if (names.length === 0) throw new Error('not run: no ladder declarations');
  for (const [name, ladder] of Object.entries(ladders)) {
    if (name !== ladder.component || !ladder.levels.length) throw new Error(`invalid ladder ${name}`);
    const floor = floors.ladderVersion[name] === (ladder.version ?? 1) ? (floors.floors[name] ?? 0) : 0;
    if (!Number.isSafeInteger(floor) || floor < 0 || floor > ladder.levels.length) {
      throw new Error(`${name}: floor outside its declared ladder`);
    }
  }
  for (const name of Object.keys(floors.floors)) {
    if (!ladders[name]) throw new Error(`floor for unregistered ladder ${name}`);
  }
  const generator = ladders.generator;
  const system = ladders.system;
  if (!generator || !system || !ladders.stats) throw new Error('missing scheduled ladder');
  const floor = floors.ladderVersion.generator === (generator.version ?? 1) ? floors.floors.generator : 0;
  if (!floor) throw new Error('generator scheduling requires a version-matched positive floor');
  const firstEnd = position(generator, 'gate');
  // Keep the existing diagnostic block through faults, extending it whenever the floor needs more levels.
  const floorEnd = Math.max(position(generator, 'faults'), floor);
  if (floor <= firstEnd) throw new Error('generator floor leaves the second slice empty');
  const tailStart = Math.max(position(generator, 'interactions'), floor + 1);
  const tail = range(tailStart, generator.levels.length);
  if (tail.length < 2) throw new Error('tail guards require two levels; review scheduling before regenerating');
  const ordered = [...ORDER.filter((name) => ladders[name]), ...names.filter((name) =>
    name !== 'generator' && !ORDER.includes(name)).sort()];
  const floorLegs = ordered.flatMap((component) => SEEDS.map((seed) => ({
    id: `${component}-${seedId(seed)}`,
    name: `${component} seed ${seed}`,
    component,
    flags: flags(seed),
    ...(component === 'stats' ? { node: 22 } : {}),
  })));
  for (const seed of SEEDS) {
    floorLegs.push(sliced('generator', seed, 1, firstEnd));
    floorLegs.push(sliced('generator', seed, firstEnd + 1, floorEnd));
  }
  const recovery = position(system, 'recovery');
  const variance = position(system, 'variance');
  const replay = position(system, 'replay');
  const slices = [[1, recovery], [recovery + 1, variance], [variance + 1, replay],
    ...range(replay + 1, system.levels.length).map((level) => [level, level])];
  let next = 1;
  for (const [from, to] of slices) {
    if (from !== next || to < from) throw new Error('system scheduling anchors are out of order');
    next = to + 1;
  }
  const systemSlices = slices.map(([from, to], index) =>
    index === 1 && from === to ? `level ${from}` : from === to ? `level ${to}` : `levels ${from} to ${to}`);
  const rows = {
    FLOOR_LEGS: floorLegs,
    STATS_LEGS: SEEDS.map((seed) => ({
      id: `stats-node24-${seedId(seed)}`,
      name: `stats seed ${seed} on Node 24 (reported)`,
      flags: flags(seed),
    })),
    TAIL_LEGS: SEEDS.flatMap((seed) => tail.map((level) => ({
      id: `generator-${seed}-level-${level}`,
      name: `generator seed ${seed} level ${level}`,
      component: 'generator',
      flags: `${flags(seed)} --levels ${level}..${level}`,
    }))),
    REGRESSION_LEGS: regression.map(({ id, component, seed }) => ({ id, name: `regression ${component} seed ${seed}`, component, seed })),
    SYSTEM_LEGS: SEEDS.flatMap((seed) => slices.map(([from, to], index) =>
      sliced('system', seed, from, to, index === 1 && from === to))),
  };
  const slots = {
    ...Object.fromEntries(Object.entries(rows).map(([name, entries]) => [name, yamlRows(entries)])),
    TAIL_START: tailStart,
    GENERATOR_TOP: generator.levels.length,
    TAIL_LEVELS: tail.join(', '),
    TAIL_SECOND: tail[1],
    BEFORE_TAIL: tailStart - 1,
    SYSTEM_TOP: system.levels.length,
    SYSTEM_SLICE_COUNT: slices.length === 5 ? 'five' : String(slices.length),
    SYSTEM_SLICES: `${systemSlices.slice(0, -1).join(', ')} and ${systemSlices.at(-1)}`,
    GENERATOR_SECOND_FROM: firstEnd + 1,
    GENERATOR_FLOOR_END: floorEnd,
    GENERATOR_FLOOR: floor,
  };
  return { rows, slots };
}

export function renderLayout(ladders, floors, regression, templatesRoot = resolve(ROOT, 'tools/ci/layout-templates')) {
  const { slots } = layoutPlan(ladders, floors, regression);
  return Object.fromEntries(OUTPUTS.map((path, index) => {
    const template = readFileSync(resolve(templatesRoot, TEMPLATES[index]), 'utf8');
    const rendered = template.replace(/@@([A-Z_]+)@@/g, (_, slot) => {
      if (!(slot in slots)) throw new Error(`unknown layout slot ${slot}`);
      return String(slots[slot]);
    });
    return [path, rendered];
  }));
}

/** Byte comparison includes whitespace and all static guards; a hand edit is never used as generator input. */
export function checkLayout(root, outputs) {
  if (Object.keys(outputs).length === 0) throw new Error('not run: no generated files');
  const drift = [];
  for (const [path, expected] of Object.entries(outputs)) {
    let actual;
    try {
      actual = readFileSync(resolve(root, path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!actual?.equals(Buffer.from(expected))) drift.push(path);
  }
  return drift;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
    throw new Error('usage: node --import tsx tools/ci/layout.mjs --check | --write');
  }
  const { registeredLadders } = await import('../../packages/validators/src/ladders/index.ts');
  const { readFloors } = await import('../../packages/validators/src/floors.ts');
  const { readRegressionSeeds } = await import('../../packages/validators/src/regression.ts');
  const ladders = registeredLadders();
  const tops = Object.fromEntries(Object.entries(ladders).map(([name, ladder]) => [name, ladder.levels.length]));
  const outputs = renderLayout(ladders, readFloors(ROOT), readRegressionSeeds(ROOT, tops));
  console.log(`Coverage: ${Object.keys(ladders).length} ladders, ${Object.keys(outputs).length} generated files; skipped: 0`);
  if (args[0] === '--write') {
    for (const [path, content] of Object.entries(outputs)) writeFileSync(resolve(ROOT, path), content);
    console.log('Wrote generated CI layout.');
    return 0;
  }
  const drift = checkLayout(ROOT, outputs);
  for (const path of drift) console.error(`::error file=${path}::Generated CI layout differs; run node --import tsx tools/ci/layout.mjs --write`);
  console.log(drift.length ? `FAIL: ${drift.length} generated files differ` : 'PASS: generated CI layout equals committed bytes');
  return drift.length ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}

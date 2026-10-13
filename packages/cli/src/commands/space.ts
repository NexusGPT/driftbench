import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  type Inventory,
  type InventoryIssue,
  type LoadResult,
  loadInventory,
  loadSpecs,
} from '@agent-nexus/driftbench-core';
import { textTable as table } from '@agent-nexus/driftbench-report';
import {
  COMPLETENESS_ASSUMPTION,
  type Completeness,
  completeness,
  coverage,
  DEFAULT_MAX_CELLS,
  formatSpaceMap,
  fromInventory,
  gridSize,
  loadSpaceMap,
  type RequiredCell,
  type SpaceCoverage,
  type SpaceMap,
  type SpaceMapIssue,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';

/** `driftbench space declare|coverage|complete`: the declared map of situations, and the coverage counted on it. */
export function registerSpaceCommands(program: Command, io: Io, setExit: (code: number) => void): void {
  const space = program
    .command('space')
    .description('The declared map of situations an agent can face, and the coverage counted on it.');

  space
    .command('coverage')
    .description('Count the cells of the map the specs cover. Exit 1 when a required cell is empty.')
    .argument('<paths...>', 'spec files or folders')
    .requiredOption('--map <file>', 'the map of situations (YAML or JSON)')
    .option(
      '--t <n>',
      'cells on every subset of n dimensions, n from 1 to the number of dimensions; default: the full grid',
    )
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: SpaceOptions) => {
      setExit(await spaceCoverageCommand(paths, options, io));
    });

  space
    .command('complete')
    .description('Print the completeness line of the specs as a sample of conversations, or why it cannot.')
    .argument('<paths...>', 'spec files or folders')
    .requiredOption('--map <file>', 'the map of situations (YAML or JSON)')
    .option('--t <n>', 'classes on every subset of n dimensions; default: the full grid')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: SpaceOptions) => {
      setExit(await spaceCompleteCommand(paths, options, io));
    });

  space
    .command('declare')
    .description('Write a first map from the inventory and the specs, for the owner to edit.')
    .argument('<paths...>', 'spec files or folders')
    .requiredOption('--inventory <file>', 'behaviour inventory (YAML or JSON)')
    .requiredOption('--out <file>', 'where to write the map; an existing file is never overwritten')
    .option('--agent <name>', 'the agent the map describes')
    .action(async (paths: string[], options: DeclareOptions) => {
      setExit(await spaceDeclareCommand(paths, options, io));
    });
}

export type SpaceOptions = {
  /** Path to the map (YAML or JSON). */
  map: string;
  /** The strength of the grid, as typed. */
  t?: string;
  json?: boolean;
};

export type DeclareOptions = { inventory: string; out: string; agent?: string };

type Inputs = { map: SpaceMap; mapPath: string; specs: LoadResult[]; t: number | undefined };

/**
 * `driftbench space coverage <paths...> --map <file> [--t <n>] [--json]`. Exit 0 when every required
 * cell is covered, 1 when one is empty, 2 on a usage or input error.
 */
export async function spaceCoverageCommand(paths: string[], options: SpaceOptions, io: Io): Promise<number> {
  const inputs = await readInputs(paths, options, io, 'coverage');
  if (typeof inputs === 'number') return inputs;
  const { map, mapPath, specs, t } = inputs;

  let inventory: Inventory | undefined;
  let inventoryPath: string | undefined;
  if (map.inventory !== undefined) {
    inventoryPath = resolve(dirname(mapPath), map.inventory);
    const loaded = await loadInventory(inventoryPath);
    if (!loaded.ok) {
      io.err(`✗ ${displayPath(inventoryPath, io)}\n${loaded.errors.map((issue) => line(issue)).join('')}`);
      io.err('The inventory the map names is invalid, so coverage was not computed.\n');
      return 2;
    }
    inventory = loaded.inventory;
  }

  const result = coverage(map, specs, { t, inventory });
  if (options.json) {
    const document = {
      map: displayPath(mapPath, io),
      ...(inventoryPath === undefined ? {} : { inventory: displayPath(inventoryPath, io) }),
      ...result,
      specs: result.specs.map((spec) => ({ ...spec, path: displayPath(spec.path, io) })),
      invalidSpecs: result.invalidSpecs.map((invalid) => ({
        ...invalid,
        path: displayPath(invalid.path, io),
      })),
    };
    io.out(`${JSON.stringify(document, null, 2)}\n`);
  } else {
    io.out(renderCoverage(result, map, io));
  }
  return result.ok ? 0 : 1;
}

/**
 * `driftbench space complete <paths...> --map <file> [--t <n>] [--json]`. Exit 0 when the completeness
 * line is printed, 1 when it cannot be (fewer conversations than cells), 2 on a usage or input error.
 */
export async function spaceCompleteCommand(paths: string[], options: SpaceOptions, io: Io): Promise<number> {
  const inputs = await readInputs(paths, options, io, 'completeness');
  if (typeof inputs === 'number') return inputs;
  const result = completeness(inputs.map, inputs.specs, { t: inputs.t });
  if (options.json) {
    const document = {
      map: displayPath(inputs.mapPath, io),
      ...result,
      ...(result.printable ? { assumption: COMPLETENESS_ASSUMPTION } : {}),
      invalidSpecs: result.invalidSpecs.map((invalid) => ({
        ...invalid,
        path: displayPath(invalid.path, io),
      })),
    };
    io.out(`${JSON.stringify(document, null, 2)}\n`);
  } else {
    io.out(renderCompleteness(result, io));
  }
  return result.printable ? 0 : 1;
}

/**
 * `driftbench space declare <paths...> --inventory <file> --out <file> [--agent <name>]`: seeds a map
 * from the inventory and the specs. Exit 0 when written, 2 on a usage or input error.
 */
export async function spaceDeclareCommand(paths: string[], options: DeclareOptions, io: Io): Promise<number> {
  const inventoryPath = resolve(io.cwd, options.inventory);
  const loaded = await loadInventory(inventoryPath);
  if (!loaded.ok) {
    io.err(`✗ ${displayPath(inventoryPath, io)}\n${loaded.errors.map((issue) => line(issue)).join('')}`);
    io.err('The inventory is invalid, so no map was written.\n');
    return 2;
  }
  const specs = await readSpecs(paths, io);
  if (typeof specs === 'number') return specs;

  const outPath = resolve(io.cwd, options.out);
  const inventory = relative(dirname(outPath), inventoryPath);
  const map = fromInventory(loaded.inventory, specs, { agent: options.agent, inventory });
  const checked = validateSpaceMap(map, outPath);
  if (!checked.ok) {
    io.err(`✗ ${displayPath(outPath, io)}\n${checked.errors.map((issue) => line(issue)).join('')}`);
    io.err('The seeded map is invalid, so it was not written. Rename the stages or channels named above.\n');
    return 2;
  }
  const header = [
    `The map of situations ${map.agent} can face, seeded by driftbench space declare.`,
    'Edit it: add persona, data or task dimensions, impossible combinations and weights.',
  ];
  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, formatSpaceMap(map, header), { flag: 'wx' });
  } catch (cause) {
    const exists = (cause as { code?: string }).code === 'EEXIST';
    io.err(
      exists
        ? `${displayPath(outPath, io)} already exists. The map is never overwritten: remove it or pick another path.\n`
        : `Cannot write ${displayPath(outPath, io)}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }
  io.out(
    `Wrote ${displayPath(outPath, io)}: ${map.dimensions.length} dimensions, ${gridSize(map)} cells, ${plural(map.constraints.length, 'constraint')}.\n`,
  );
  return 0;
}

async function readInputs(
  paths: string[],
  options: SpaceOptions,
  io: Io,
  what: 'coverage' | 'completeness',
): Promise<Inputs | number> {
  const mapPath = resolve(io.cwd, options.map);
  const loaded = await loadSpaceMap(mapPath);
  if (!loaded.ok) {
    io.err(`✗ ${displayPath(mapPath, io)}\n${loaded.errors.map((issue) => line(issue)).join('')}`);
    io.err(`The map is invalid, so ${what} was not computed.\n`);
    return 2;
  }
  const { map } = loaded;
  const k = map.dimensions.length;
  let t: number | undefined;
  if (options.t !== undefined) {
    t = /^\d+$/.test(options.t) ? optionNumber(options.t) : Number.NaN;
    if (!(t >= 1 && t <= k)) {
      io.err(
        `Unknown t "${options.t}". The map has ${k} dimensions, so t is a whole number from 1 to ${k}.\n`,
      );
      return 2;
    }
  }
  const size = gridSize(map);
  if (size > DEFAULT_MAX_CELLS) {
    io.err(
      `The full grid has ${size} cells, over the limit of ${DEFAULT_MAX_CELLS}. Merge values or split the map.\n`,
    );
    return 2;
  }
  const specs = await readSpecs(paths, io);
  if (typeof specs === 'number') return specs;
  return { map, mapPath, specs, t };
}

async function readSpecs(paths: string[], io: Io): Promise<LoadResult[] | number> {
  const specPaths = paths.map((path) => resolve(io.cwd, path));
  const absent: string[] = [];
  for (const path of specPaths) {
    if (!(await stat(path).catch(() => undefined))) absent.push(path);
  }
  if (absent.length > 0) {
    for (const path of absent) io.err(`Cannot find ${displayPath(path, io)}.\n`);
    return 2;
  }
  const specs = await loadSpecs(specPaths);
  if (specs.length === 0) {
    io.err('No spec files found.\n');
    return 2;
  }
  return specs;
}

function renderCoverage(result: SpaceCoverage, map: SpaceMap, io: Io): string {
  const { grid } = result;
  const prior = result.prior.uniform
    ? 'prior uniform (no weight declared)'
    : `prior ${result.prior.kind}${result.prior.source === undefined ? '' : ` (${result.prior.source})`}`;
  const out: string[] = [
    `Map ${result.agent}, version ${result.version}: ${plural(map.dimensions.length, 'dimension')}, ${gridSize(map)} cells, ${plural(result.constraints, 'constraint')}, ${prior}`,
    '',
    'Dimensions',
    ...table([
      ['id', 'kind', 'values', 'covered', 'not covered'],
      ...result.dimensions.map((dimension) => [
        dimension.id,
        dimension.kind,
        String(dimension.allowed),
        String(dimension.covered),
        dimension.values
          .filter((value) => value.allowed && value.specs === 0)
          .map((value) => value.id)
          .join(', '),
      ]),
    ]),
    '',
    grid.full
      ? `Full grid: every cell holds one value of each of the ${map.dimensions.length} dimensions`
      : `Grid at t = ${grid.t}: ${plural(grid.projections, `subset`)} of ${grid.t} dimensions`,
    ...table([
      [
        'cells',
        `${grid.allowed} allowed of ${grid.total} (${grid.total - grid.allowed} forbidden by the constraints)`,
      ],
      ['covered', `${grid.covered} (${percent(grid.share)})`],
      ['weighted', weightedLine(result)],
    ]),
  ];

  if (result.tway.length > 0) {
    out.push('', 't-wise coverage');
    out.push(
      ...table(
        result.tway.map((entry) => [
          `t = ${entry.t}`,
          `${entry.covered} of ${entry.allowed} allowed ${entry.t === 2 ? 'pairs' : 'triples'} (${percent(entry.share)})`,
        ]),
      ),
    );
  }

  out.push('', 'Required cells');
  if (result.required.length === 0) {
    out.push('  No value of the map is required, and the map names no inventory.');
  } else {
    out.push(
      ...table(
        result.required.map((cell) => [
          cell.covered ? '✓' : '✗',
          requiredLabel(cell),
          cell.specs.length > 0 ? cell.specs.join(', ') : 'no spec',
        ]),
      ),
    );
  }

  if (result.warnings.length > 0) {
    out.push('', 'Warnings');
    for (const warning of result.warnings)
      out.push(`  ! ${warning.subject}  ${warning.code}  ${warning.message}`);
  }
  if (result.invalidSpecs.length > 0) {
    out.push('', 'Invalid specs, not counted');
    for (const invalid of result.invalidSpecs) {
      const { error } = invalid;
      out.push(
        `  ✗ ${displayPath(invalid.path, io)}  ${error.path || '(file)'}  ${error.code}  ${error.message}`,
      );
    }
  }

  const done = result.required.filter((cell) => cell.covered).length;
  const scope = grid.full ? 'in the full grid' : `at t = ${grid.t}`;
  out.push(
    '',
    `Coverage: ${done} of ${result.required.length} required cells covered, ${grid.covered} of ${grid.allowed} cells ${scope} (${percent(grid.share)}).`,
  );
  return `${out.join('\n')}\n`;
}

function weightedLine(result: SpaceCoverage): string {
  const { grid } = result;
  if (grid.weighted === null || grid.effectiveSampleSize === null) {
    return 'not computed: the prior gives no weight to any allowed cell';
  }
  const mix = result.prior.uniform ? 'under a uniform prior' : `of the ${result.prior.kind} user mix`;
  return `${percent(grid.weighted)} ${mix}, effective sample size ${grid.effectiveSampleSize.toFixed(1)} of ${plural(result.specs.length, 'spec')}`;
}

function requiredLabel(cell: RequiredCell): string {
  if (cell.source === 'inventory') return `flow ${cell.flow} · ${cell.deviation}`;
  return Object.entries(cell.values)
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(' · ');
}

function renderCompleteness(result: Completeness, io: Io): string {
  const scope = result.full ? 'over the full grid' : `at t = ${result.t}`;
  const out: string[] = [
    `Completeness ${scope}: ${result.cells} cells, ${plural(result.conversations, 'conversation')}`,
  ];
  const rows: string[][] = [
    ['seen', `${result.seen} cells; f1 ${result.f1}, f2 ${result.f2}`],
    [
      'Hill numbers',
      `q0 ${round(result.hill.q0)} · q1 ${round(result.hill.q1)} · q2 ${round(result.hill.q2)}`,
    ],
  ];
  if (result.unplaced.length > 0) {
    rows.push([
      'left out',
      `${plural(result.unplaced.length, 'spec')} in no allowed cell: ${result.unplaced.join(', ')}`,
    ]);
  }
  if (result.printable && result.coverage && result.discovery && result.bootstrap) {
    const level = `${Math.round(result.bootstrap.level * 100)}%`;
    rows.push(
      ['sample coverage', `${intervalText(result.coverage, level)}, Chao form`],
      ['discovery', `${intervalText(result.discovery, level)}, Good-Turing f1 / n`],
      [
        'bootstrap',
        `${result.bootstrap.iterations} resamples of the conversations, seed ${result.bootstrap.seed}`,
      ],
    );
  }
  out.push(...table(rows));
  if (result.printable && result.sentence) {
    out.push('', result.sentence, COMPLETENESS_ASSUMPTION);
  } else {
    out.push('', `No completeness line: ${result.reason ?? 'the sample is too small'}.`);
  }
  if (result.invalidSpecs.length > 0) {
    out.push('', 'Invalid specs, not counted');
    for (const invalid of result.invalidSpecs) {
      const { error } = invalid;
      out.push(
        `  ✗ ${displayPath(invalid.path, io)}  ${error.path || '(file)'}  ${error.code}  ${error.message}`,
      );
    }
  }
  return `${out.join('\n')}\n`;
}

function intervalText(interval: { estimate: number; lower: number; upper: number }, level: string): string {
  return `${percent(interval.estimate)} (${level} interval ${percent(interval.lower)} to ${percent(interval.upper)})`;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function line(issue: InventoryIssue | SpaceMapIssue): string {
  return `  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`;
}

function displayPath(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

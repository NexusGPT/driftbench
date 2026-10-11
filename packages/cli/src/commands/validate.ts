import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkFloors,
  FLOORS_FILE,
  type FloorsFile,
  findRoot,
  floorOf,
  formatLadder,
  type HeadReader,
  type HiddenSeed,
  hiddenSeed,
  type Ladder,
  type LadderReport,
  parseSeeds,
  raiseFloor,
  readFloors,
  registeredLadders,
  runSeeds,
  seedSpecs,
  writeFloors,
} from '@driftbench/validators';
import type { Command } from 'commander';
import type { Io } from '../io';

/** The exit code of an input or usage error: kept apart from the level codes 0 to 63. */
export const USAGE_EXIT = 64;

export type ValidateCommandOptions = {
  seed?: string;
  seeds?: string;
  hidden?: boolean;
  json?: boolean;
  checkFloor?: boolean;
  raise?: string;
  evidence?: string;
};

/** What the command runs with. Tests pass their own ladders, root and commit reader. */
export type ValidateDeps = {
  ladders(): Record<string, Ladder>;
  /** The repository root; by default the nearest folder above the working folder holding pnpm-workspace.yaml. */
  root?: string;
  /** Reads the commit the hidden seed derives from; by default `git rev-parse HEAD`. */
  readHead?: HeadReader;
};

export const defaultValidateDeps: ValidateDeps = {
  ladders: registeredLadders,
};

/**
 * `driftbench validate <component>`: runs a validator's ladder on its seeds and prints the table. The exit
 * code is the level of the run, the minimum over its seeds of the highest level passed (0 when level 1
 * fails); an input error exits 64. `all` runs every registered validator and exits with the lowest level.
 */
export function registerValidateCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: ValidateDeps = defaultValidateDeps,
): void {
  program
    .command('validate')
    .description(
      'Run a validator ladder: levels in order, stop at the first failing level, exit with the level',
    )
    .argument('<component>', 'the validator to run, all, or floors (with --raise)')
    .argument('[level]', 'with floors --raise: the level to raise the floor to')
    .option('--seed <n>', 'a visible seed (default 1 when no seed is given)')
    .option('--seeds <a..b>', 'a range of visible seeds, such as 1..20')
    .option('--hidden', 'add the hidden seed derived from git rev-parse HEAD')
    .option('--json', 'print the report as JSON')
    .option('--check-floor', 'exit 1 when a run is below its floor in validators/floors.json, else 0')
    .option('--raise <component>', 'with floors: raise the floor of this component to [level]')
    .option('--evidence <json>', 'with floors --raise: the --json run that reaches the level')
    .action(async (component: string, level: string | undefined, options: ValidateCommandOptions) => {
      setExit(await validateCommand(component, options, io, deps, level));
    });
}

export async function validateCommand(
  component: string,
  options: ValidateCommandOptions,
  io: Io,
  deps: ValidateDeps = defaultValidateDeps,
  level?: string,
): Promise<number> {
  const root = deps.root ?? findRoot(io.cwd);
  const ladders = deps.ladders();
  let floors: FloorsFile;
  try {
    floors = readFloors(root);
  } catch (cause) {
    io.err(`${message(cause)}\n`);
    return USAGE_EXIT;
  }
  if (component === 'floors') return floorsCommand(options, level, floors, ladders, root, io);
  if (level !== undefined) {
    io.err(`Unexpected argument "${level}": a level is only taken by floors --raise.\n`);
    return USAGE_EXIT;
  }
  const chosen = select(component, ladders, io);
  if (!chosen) return USAGE_EXIT;
  const visible = parseSeeds(options);
  if (typeof visible === 'string') {
    io.err(`${visible}\n`);
    return USAGE_EXIT;
  }
  const hidden = options.hidden ? hiddenSeed(root, deps.readHead) : undefined;
  if (hidden?.note && !options.json) io.out(`Note: ${hidden.note}\n`);
  const reports: LadderReport[] = [];
  for (const ladder of chosen) reports.push(await runSeeds(ladder, seedSpecs(visible, hidden), root));
  print(reports, component === 'all', hidden, floors, options, io);
  if (!options.checkFloor) return Math.min(...reports.map((report) => report.level));
  const tops = Object.fromEntries(
    Object.entries(ladders).map(([name, ladder]) => [name, { top: ladder.levels.length }]),
  );
  const { checks, problems } = checkFloors(reports, floors, tops);
  for (const problem of component === 'all' ? problems : []) io.err(`${problem}\n`);
  const below = checks.filter((check) => !check.holds);
  for (const check of below)
    io.err(`${check.component} is at level ${check.level}, below its floor ${check.floor}.\n`);
  return below.length > 0 || (component === 'all' && problems.length > 0) ? 1 : 0;
}

/** `validate floors --raise <component> <level> --evidence <json>`: rewrites the floors file, only upward. */
function floorsCommand(
  options: ValidateCommandOptions,
  level: string | undefined,
  floors: FloorsFile,
  ladders: Record<string, Ladder>,
  root: string,
  io: Io,
): number {
  if (!options.raise || level === undefined || !options.evidence) {
    const shown = Object.entries(floors.floors).map(([name, floor]) => `${name} = ${floor}`);
    if (options.raise || level !== undefined || options.evidence) {
      io.err(
        'Raise a floor with: driftbench validate floors --raise <component> <level> --evidence <json>.\n',
      );
      return USAGE_EXIT;
    }
    io.out(`Floors (${FLOORS_FILE}): ${shown.length > 0 ? shown.join(', ') : 'none'}.\n`);
    return 0;
  }
  const ladder = ladders[options.raise];
  if (!ladder) {
    io.err(`No validator is registered for "${options.raise}".\n`);
    return USAGE_EXIT;
  }
  if (!/^\d+$/.test(level)) {
    io.err(`The level is a whole number, not "${level}".\n`);
    return USAGE_EXIT;
  }
  let evidence: unknown;
  try {
    evidence = JSON.parse(readFileSync(resolve(io.cwd, options.evidence), 'utf8'));
  } catch (cause) {
    io.err(`Cannot read the evidence ${options.evidence}: ${message(cause)}\n`);
    return USAGE_EXIT;
  }
  const result = raiseFloor(floors, {
    component: options.raise,
    level: Number(level),
    evidence,
    top: ladder.levels.length,
  });
  if ('refused' in result) {
    io.err(`Refused: ${result.refused}\n`);
    return 1;
  }
  writeFloors(root, result.file);
  io.out(
    `The floor of ${options.raise} rises from ${floorOf(floors, options.raise)} to ${level} in ${FLOORS_FILE}. Commit it on its own with the evidence run.\n`,
  );
  return 0;
}

/** The ladders a component names: one registered ladder, or every one for `all`. */
function select(component: string, ladders: Record<string, Ladder>, io: Io): Ladder[] | undefined {
  const known = Object.keys(ladders).sort();
  if (component === 'all') {
    if (known.length === 0) {
      io.err('No validator is registered.\n');
      return undefined;
    }
    return known.map((name) => ladders[name] as Ladder);
  }
  const ladder = ladders[component];
  if (!ladder) {
    io.err(
      `No validator is registered for "${component}". Registered: ${known.length > 0 ? known.join(', ') : 'none'}.\n`,
    );
    return undefined;
  }
  return [ladder];
}

function print(
  reports: LadderReport[],
  all: boolean,
  hidden: HiddenSeed | undefined,
  floors: FloorsFile,
  options: ValidateCommandOptions,
  io: Io,
): void {
  if (options.json) {
    const shown = reports.map((report) => ({ ...report, ...(hidden ? { hiddenSeed: hidden } : {}) }));
    io.out(`${JSON.stringify(all ? { reports: shown } : shown[0], null, 2)}\n`);
    return;
  }
  io.out(
    reports.map((report) => formatLadder(report, { floor: floorOf(floors, report.component) })).join('\n'),
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

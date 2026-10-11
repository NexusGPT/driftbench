import {
  findRoot,
  formatLadder,
  type HeadReader,
  type HiddenSeed,
  hiddenSeed,
  type Ladder,
  type LadderReport,
  parseSeeds,
  registeredLadders,
  runSeeds,
  seedSpecs,
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
    .argument('<component>', 'the validator to run, or all')
    .option('--seed <n>', 'a visible seed (default 1 when no seed is given)')
    .option('--seeds <a..b>', 'a range of visible seeds, such as 1..20')
    .option('--hidden', 'add the hidden seed derived from git rev-parse HEAD')
    .option('--json', 'print the report as JSON')
    .action(async (component: string, options: ValidateCommandOptions) => {
      setExit(await validateCommand(component, options, io, deps));
    });
}

export async function validateCommand(
  component: string,
  options: ValidateCommandOptions,
  io: Io,
  deps: ValidateDeps = defaultValidateDeps,
): Promise<number> {
  const root = deps.root ?? findRoot(io.cwd);
  const ladders = deps.ladders();
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
  print(reports, component === 'all', hidden, options, io);
  return Math.min(...reports.map((report) => report.level));
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
  options: ValidateCommandOptions,
  io: Io,
): void {
  if (options.json) {
    const shown = reports.map((report) => ({ ...report, ...(hidden ? { hiddenSeed: hidden } : {}) }));
    io.out(`${JSON.stringify(all ? { reports: shown } : shown[0], null, 2)}\n`);
    return;
  }
  io.out(reports.map((report) => formatLadder(report)).join('\n'));
}

import {
  findRoot,
  formatLadder,
  type Ladder,
  type LadderReport,
  registeredLadders,
  runSeeds,
  type SeedSpec,
} from '@driftbench/validators';
import type { Command } from 'commander';
import type { Io } from '../io';

/** The exit code of an input or usage error: kept apart from the level codes 0 to 63. */
export const USAGE_EXIT = 64;

export type ValidateCommandOptions = {
  seed?: string;
  json?: boolean;
};

/** What the command runs with. Tests pass their own ladders and root. */
export type ValidateDeps = {
  ladders(): Record<string, Ladder>;
  /** The repository root; by default the nearest folder above the working folder holding pnpm-workspace.yaml. */
  root?: string;
};

export const defaultValidateDeps: ValidateDeps = {
  ladders: registeredLadders,
};

/**
 * `driftbench validate <component>`: runs a validator's ladder and prints the table. The exit code is the
 * highest level passed (0 when level 1 fails); an input error exits 64.
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
    .argument('<component>', 'the validator to run')
    .option('--seed <n>', 'the seed (default 1)')
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
  const ladder = ladders[component];
  if (!ladder) {
    const known = Object.keys(ladders).sort();
    io.err(
      `No validator is registered for "${component}". Registered: ${known.length > 0 ? known.join(', ') : 'none'}.\n`,
    );
    return USAGE_EXIT;
  }
  const seed = options.seed === undefined ? 1 : whole(options.seed);
  if (seed === undefined) {
    io.err(`--seed takes a whole number, not "${options.seed}".\n`);
    return USAGE_EXIT;
  }
  const seeds: SeedSpec[] = [{ seed, hidden: false }];
  const report = await runSeeds(ladder, seeds, root);
  print(report, options, io);
  return report.level;
}

function print(report: LadderReport, options: ValidateCommandOptions, io: Io): void {
  if (options.json) io.out(`${JSON.stringify(report, null, 2)}\n`);
  else io.out(formatLadder(report));
}

function whole(text: string): number | undefined {
  const value = Number(text);
  return /^\d+$/.test(text.trim()) && Number.isSafeInteger(value) ? value : undefined;
}

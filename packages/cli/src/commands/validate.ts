import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  appendJournal,
  checkFloors,
  checkHandover,
  composeBrief,
  type DiffReader,
  EXECUTOR_FILE,
  FLOORS_FILE,
  type FloorsFile,
  findRoot,
  floorOf,
  formatLadder,
  gitChangedFiles,
  type HeadReader,
  type HiddenSeed,
  handoverFile,
  handoverTemplate,
  hiddenSeed,
  journalFile,
  type Ladder,
  type LadderReport,
  PROTECTED_PATHS,
  parseSeeds,
  protectedChanges,
  raiseFloor,
  readFloors,
  readHandover,
  readJournal,
  registeredLadders,
  researchFile,
  researchTemplate,
  runSeeds,
  seedSpecs,
  setLevelTable,
  writeFloors,
  writeHandover,
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
  brief?: boolean;
  fresh?: boolean;
  journal?: string;
  checkHandover?: boolean;
  branch?: string;
  base?: string;
};

/** What the command runs with. Tests pass their own ladders, root and commit reader. */
export type ValidateDeps = {
  ladders(): Record<string, Ladder>;
  /** The repository root; by default the nearest folder above the working folder holding pnpm-workspace.yaml. */
  root?: string;
  /** Reads the commit the hidden seed derives from; by default `git rev-parse HEAD`. */
  readHead?: HeadReader;
  /** Lists the files changed since a base; by default `git diff --name-only base...HEAD`. */
  changedFiles?: DiffReader;
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
    .option('--brief', 'print validators/EXECUTOR.md with the live state of the loop embedded')
    .option('--fresh', "with --brief: leave out the handover's hypotheses (the handover test)")
    .option('--journal <row.json>', "append a validated journal row and rewrite the handover's level table")
    .option('--check-handover', 'exit 1 when HANDOVER.md misses a section or disagrees with the journal')
    .option('--branch <name>', 'with protect: the branch of the pull request')
    .option('--base <ref>', 'with protect: the ref the pull request merges into, such as origin/main')
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
  if (component === 'protect') return protectCommand(options, deps, root, io);
  if (level !== undefined) {
    io.err(`Unexpected argument "${level}": a level is only taken by floors --raise.\n`);
    return USAGE_EXIT;
  }
  const chosen = select(component, ladders, io);
  if (!chosen) return USAGE_EXIT;
  const modes = [options.brief, options.journal !== undefined, options.checkHandover, options.checkFloor];
  if (modes.filter(Boolean).length > 1) {
    io.err('Choose one of --brief, --journal, --check-handover and --check-floor.\n');
    return USAGE_EXIT;
  }
  if (options.fresh && !options.brief) {
    io.err('--fresh goes with --brief.\n');
    return USAGE_EXIT;
  }
  if ((options.brief || options.journal !== undefined) && component === 'all') {
    io.err('--brief and --journal take one component, not all.\n');
    return USAGE_EXIT;
  }
  if (options.journal !== undefined) return journalCommand(component, options.journal, floors, root, io);
  if (options.checkHandover) return handoverCheckCommand(chosen, root, io);
  const visible = parseSeeds(options);
  if (typeof visible === 'string') {
    io.err(`${visible}\n`);
    return USAGE_EXIT;
  }
  const hidden = options.hidden ? hiddenSeed(root, deps.readHead) : undefined;
  if (hidden?.note && !options.json) io.out(`Note: ${hidden.note}\n`);
  const reports: LadderReport[] = [];
  for (const ladder of chosen) reports.push(await runSeeds(ladder, seedSpecs(visible, hidden), root));
  if (options.brief)
    return briefCommand(reports[0] as LadderReport, hidden, floors, Boolean(options.fresh), deps, root, io);
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

/** `validate protect --branch <name> --base <ref>`: exit 1 when an executor branch changes a protected file. */
function protectCommand(options: ValidateCommandOptions, deps: ValidateDeps, root: string, io: Io): number {
  if (options.branch === undefined || options.base === undefined) {
    io.err('Check a pull request with: driftbench validate protect --branch <name> --base <ref>.\n');
    return USAGE_EXIT;
  }
  let files: string[];
  try {
    files = (deps.changedFiles ?? gitChangedFiles)(root, options.base);
  } catch (cause) {
    io.err(`git diff against ${options.base} failed: ${message(cause)}\n`);
    return USAGE_EXIT;
  }
  const touched = protectedChanges(options.branch, files);
  if (touched.length === 0) {
    io.out(
      options.branch.startsWith('exec/')
        ? `${options.branch} changes ${files.length} files, none of them protected.\n`
        : `${options.branch} is not an executor branch (exec/): nothing is protected from it.\n`,
    );
    return 0;
  }
  io.err(`${options.branch} is an executor branch and changes protected files:\n`);
  for (const file of touched) io.err(`  ${file}\n`);
  io.err(
    `Protected: ${PROTECTED_PATHS.join(', ')}. These are the maintainer's (docs/validators.md section 8).\n`,
  );
  return 1;
}

/** `validate <component> --journal <row.json>`: appends a validated row and rewrites the handover's level table. */
function journalCommand(component: string, path: string, floors: FloorsFile, root: string, io: Io): number {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(io.cwd, path), 'utf8'));
  } catch (cause) {
    io.err(`Cannot read the journal row ${path}: ${message(cause)}\n`);
    return USAGE_EXIT;
  }
  const result = appendJournal(root, component, value);
  if ('refused' in result) {
    io.err(`Refused: the row was not appended to ${journalFile(component)}.\n`);
    for (const reason of result.refused) io.err(`  ${reason}\n`);
    return 1;
  }
  const handover = readHandover(root, component) ?? handoverTemplate(component, floorOf(floors, component));
  writeHandover(root, component, setLevelTable(handover, result.row));
  const research = join(root, researchFile(component));
  if (!existsSync(research)) writeFileSync(research, researchTemplate(component));
  io.out(
    `Appended iteration ${result.row.iteration} to ${journalFile(component)} and rewrote the level table of ${handoverFile(component)}.\n`,
  );
  return 0;
}

/** `validate <component|all> --check-handover`: every section present and the level table equal to the journal. */
function handoverCheckCommand(ladders: Ladder[], root: string, io: Io): number {
  let failed = false;
  for (const ladder of ladders) {
    const { rows, problems } = readJournal(root, ladder.component);
    const text = readHandover(root, ladder.component);
    const all = [...problems];
    if (text === undefined) all.push(`${handoverFile(ladder.component)} is missing`);
    else all.push(...checkHandover(text, rows.at(-1)));
    if (all.length === 0) {
      io.out(
        `${handoverFile(ladder.component)}: every section present, the level table matches the journal.\n`,
      );
      continue;
    }
    failed = true;
    io.err(`${handoverFile(ladder.component)}:\n`);
    for (const problem of all) io.err(`  ${problem}\n`);
  }
  return failed ? 1 : 0;
}

/** `validate <component> --brief [--fresh]`: the executor instruction with the live state embedded. */
function briefCommand(
  report: LadderReport,
  hidden: HiddenSeed | undefined,
  floors: FloorsFile,
  fresh: boolean,
  deps: ValidateDeps,
  root: string,
  io: Io,
): number {
  const path = join(root, EXECUTOR_FILE);
  if (!existsSync(path)) {
    io.err(`${EXECUTOR_FILE} is missing: the brief has no instruction to embed the state in.\n`);
    return USAGE_EXIT;
  }
  const { rows, problems } = readJournal(root, report.component);
  for (const problem of problems) io.err(`Warning: ${problem}\n`);
  io.out(
    composeBrief({
      component: report.component,
      executor: readFileSync(path, 'utf8'),
      report,
      floor: floorOf(floors, report.component),
      last: rows.at(-1),
      handover: readHandover(root, report.component),
      head: hidden?.head ?? headOf(root, deps),
      fresh,
    }),
  );
  return 0;
}

function headOf(root: string, deps: ValidateDeps): string | undefined {
  const head = hiddenSeed(root, deps.readHead);
  return head.source === 'head' ? head.head : undefined;
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

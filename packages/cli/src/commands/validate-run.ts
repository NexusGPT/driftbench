import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  allFailingItems,
  appendJournal,
  bankSummary,
  blindReport,
  checkFloors,
  checkHandover,
  composeBrief,
  EXECUTOR_FILE,
  executorOf,
  FLOORS_FILE,
  type FloorsFile,
  findRoot,
  finishInvocation,
  floorNote,
  floorOf,
  formatAllFailing,
  formatHardness,
  formatItems,
  formatLadder,
  gitChangedFiles,
  type HiddenSeed,
  handoverFile,
  handoverTemplate,
  hiddenSeed,
  journalFile,
  type Ladder,
  type LadderReport,
  ladderVersion,
  loopFolder,
  measureHardness,
  mergeSeedRuns,
  PROTECTED_PATHS,
  parseSeeds,
  protectedChanges,
  raiseFloor,
  readCatchList,
  readFloors,
  readHandover,
  readJournal,
  registeredLadders,
  registeredLadderVersions,
  researchFile,
  researchTemplate,
  type SeedRun,
  seedLabel,
  seedSpecs,
  setLevelTable,
  statsBankHash,
  writeFloors,
  writeHandover,
} from '@agent-nexus/driftbench-validators';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { measuredSeeds, withinStatsMeasurementSweep } from './stats-sweep-cache';
import { USAGE_EXIT, type ValidateCommandOptions, type ValidateDeps } from './validate';
import { splitBeyond, unsplitBeyond } from './validate-beyond';

export const defaultValidateDeps: ValidateDeps = {
  ladders: registeredLadders,
  versions: registeredLadderVersions,
};

/** Runs `driftbench validate`: see `registerValidateCommand` in validate.ts for the command and its exit codes. */
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
  if (options.ladderVersion !== undefined && (component === 'all' || component === 'protect')) {
    io.err('--ladder-version selects one component, not all or protect.\n');
    return USAGE_EXIT;
  }
  if (component === 'protect') return protectCommand(options, deps, root, io);
  if (level !== undefined) {
    io.err(`Unexpected argument "${level}": a level is only taken by floors --raise.\n`);
    return USAGE_EXIT;
  }
  let selectedLadders = ladders;
  if (options.ladderVersion !== undefined) {
    const version = Number(options.ladderVersion);
    if (!/^\d+$/.test(options.ladderVersion) || !Number.isSafeInteger(version) || version < 1) {
      io.err(`--ladder-version is a whole number of at least 1, not "${options.ladderVersion}".\n`);
      return USAGE_EXIT;
    }
    const found =
      deps.versions?.()[component]?.[version] ??
      (ladders[component] && ladderVersion(ladders[component]) === version ? ladders[component] : undefined);
    if (!found) {
      io.err(`No ladder version ${version} is registered for "${component}".\n`);
      return USAGE_EXIT;
    }
    selectedLadders = { ...ladders, [component]: found };
  }
  const chosen = select(component, selectedLadders, io);
  if (!chosen) return USAGE_EXIT;
  // Historical loop files stay untouched when a non-default version is selected.
  const evidenceComponent = (ladder: Ladder) => {
    const defaultLadder = ladders[ladder.component];
    return defaultLadder && ladderVersion(ladder) !== ladderVersion(defaultLadder)
      ? `${ladder.component}/v${ladderVersion(ladder)}`
      : ladder.component;
  };
  const modes = [
    options.brief,
    options.journal !== undefined,
    options.checkHandover,
    options.checkFloor,
    options.hardness,
  ];
  if (modes.filter(Boolean).length > 1) {
    io.err('Choose one of --brief, --journal, --check-handover, --check-floor and --hardness.\n');
    return USAGE_EXIT;
  }
  if (
    (options.items || options.allLevels || options.blind) &&
    (options.brief || options.journal !== undefined || options.checkHandover || options.hardness)
  ) {
    io.err(
      '--items, --all-levels and --blind go with a run, not with --brief, --journal, --check-handover or --hardness.\n',
    );
    return USAGE_EXIT;
  }
  if (
    options.levels !== undefined &&
    (options.brief || options.journal !== undefined || options.checkHandover || options.hardness)
  ) {
    io.err('--levels goes with a run, not with --brief, --journal, --check-handover or --hardness.\n');
    return USAGE_EXIT;
  }
  if (options.fresh && !options.brief) {
    io.err('--fresh goes with --brief.\n');
    return USAGE_EXIT;
  }
  if ((options.brief || options.journal !== undefined || options.hardness) && component === 'all') {
    io.err('--brief, --journal and --hardness take one component, not all.\n');
    return USAGE_EXIT;
  }
  if (options.hardness)
    return hardnessCommand(
      component,
      Boolean(options.json),
      root,
      io,
      evidenceComponent(chosen[0] as Ladder),
    );
  if (options.journal !== undefined) {
    return journalCommand(
      chosen[0] as Ladder,
      options.journal,
      floors,
      root,
      io,
      evidenceComponent(chosen[0] as Ladder),
    );
  }
  if (options.checkHandover) return handoverCheckCommand(chosen, root, io, evidenceComponent);
  if (options.reports !== undefined) return reportsCommand(chosen, ladders, floors, options, deps, root, io);
  if (options.hiddenOnly && !options.hidden) {
    io.err('--hidden-only goes with --hidden.\n');
    return USAGE_EXIT;
  }
  if (options.hiddenOnly && (options.seed !== undefined || options.seeds !== undefined)) {
    io.err('--hidden-only runs the hidden seed alone: leave out --seed and --seeds.\n');
    return USAGE_EXIT;
  }
  const visible = options.hiddenOnly ? [] : parseSeeds(options);
  if (typeof visible === 'string') {
    io.err(`${visible}\n`);
    return USAGE_EXIT;
  }
  const hidden = options.hidden ? hiddenSeed(root, deps.readHead) : undefined;
  if (hidden?.note && !options.json) io.out(`Note: ${hidden.note}\n`);
  const slice = options.levels === undefined ? undefined : parseSlice(options.levels);
  if (typeof slice === 'string') {
    io.err(`${slice}\n`);
    return USAGE_EXIT;
  }
  if (slice && (component === 'all' || slice.to > (chosen[0] as Ladder).levels.length)) {
    io.err(
      component === 'all'
        ? '--levels takes one component, not all.\n'
        : `--levels ${options.levels} is above the top of ${component} (${(chosen[0] as Ladder).levels.length}).\n`,
    );
    return USAGE_EXIT;
  }
  let measuredBankHash: string | undefined;
  if (options.items && options.json && chosen.some((ladder) => ladder.component === 'stats')) {
    try {
      measuredBankHash = statsBankHash(root);
    } catch (cause) {
      io.err(`Cannot fingerprint the statistics bank: ${message(cause)}\n`);
      return USAGE_EXIT;
    }
  }
  const reports: (LadderReport & { bankHash?: string })[] = [];
  const measure = async () => {
    for (const ladder of chosen) {
      const floor = options.checkFloor ? floorOf(floors, ladder.component, ladderVersion(ladder)) : 0;
      // Invalid floors keep the existing checkFloors diagnostic instead of throwing in runLadder.
      const through = floor > 0 && floor <= ladder.levels.length ? floor : undefined;
      const report = await measuredSeeds(ladder, seedSpecs(visible, hidden), root, {
        full: Boolean(options.items || options.allLevels || slice),
        ...(slice
          ? { fromLevel: slice.from, maxLevel: Math.min(slice.to, through ?? slice.to) }
          : through
            ? { maxLevel: through }
            : {}),
      });
      const shown = options.blind ? blindReport(report) : report;
      reports.push(
        ladder.component === 'stats' && measuredBankHash ? { ...shown, bankHash: measuredBankHash } : shown,
      );
    }
  };
  const run = async (): Promise<number> => {
    if (chosen.some((ladder) => ladder.component === 'system')) await withinStatsMeasurementSweep(measure);
    else await measure();
    if (measuredBankHash !== undefined) {
      try {
        if (statsBankHash(root) !== measuredBankHash) {
          io.err('The statistics bank changed during measurement: rerun before recording a journal row.\n');
          return USAGE_EXIT;
        }
      } catch (cause) {
        io.err(`Cannot verify the measured statistics bank: ${message(cause)}\n`);
        return USAGE_EXIT;
      }
    }
    if (options.brief)
      return briefCommand(
        reports[0] as LadderReport,
        hidden,
        floors,
        Boolean(options.fresh),
        deps,
        root,
        io,
        evidenceComponent(chosen[0] as Ladder),
      );
    print(reports, component === 'all', hidden, floors, options, io, root);
    // A slice holds some levels of the ladder: the join in --reports reads its level, this run reads none.
    if (slice) return 0;
    return verdict(reports, floors, ladders, component, options, io);
  };
  let code: number;
  let changedTrees: string | undefined;
  try {
    code = await run();
  } finally {
    // Every exit after measurement must mark a tree changed by run C, including usage errors and exceptions.
    changedTrees = finishInvocation();
    if (changedTrees !== undefined) io.err(`${changedTrees}\n`);
  }
  return changedTrees === undefined ? code : Math.max(1, code);
}

/** `--levels a..b`: the first and last level of a slice, or the message that names the problem. */
function parseSlice(text: string): { from: number; to: number } | string {
  const match = /^\s*(\d+)\s*\.\.\s*(\d+)\s*$/.exec(text);
  const from = match ? Number(match[1]) : 0;
  const to = match ? Number(match[2]) : 0;
  if (!match || from < 1 || from > to) {
    return `--levels takes a..b with whole numbers 1 <= a <= b, such as 3..5, not "${text}".`;
  }
  return { from, to };
}

/** The exit code of a run: the lowest level, or with --check-floor 1 when a floor is not held. */
function verdict(
  reports: LadderReport[],
  floors: FloorsFile,
  ladders: Record<string, Ladder>,
  component: string,
  options: ValidateCommandOptions,
  io: Io,
): number {
  if (!options.checkFloor) return Math.min(...reports.map((report) => report.level));
  const tops = Object.fromEntries(
    Object.entries(ladders).map(([name, ladder]) => [
      name,
      { top: ladder.levels.length, version: ladderVersion(ladder) },
    ]),
  );
  const { checks, problems } = checkFloors(reports, floors, tops);
  for (const problem of component === 'all' ? problems : []) io.err(`${problem}\n`);
  const below = checks.filter((check) => !check.holds);
  for (const check of below)
    io.err(`${check.component} is at level ${check.level}, below its floor ${check.floor}.\n`);
  return below.length > 0 || (component === 'all' && problems.length > 0) ? 1 : 0;
}

/**
 * `validate <component|all> --reports <dir>`: joins the `--json` reports of earlier runs (a CI leg each: one seed,
 * or one slice of levels of one seed) into one report per validator, whose level is the minimum over its seeds,
 * then prints and checks the floors exactly as one run on all those seeds would. `--seeds` and `--hidden` name the
 * seeds the join must hold; `--check-floor` says the legs ran through the floor. A missing, repeated or foreign
 * seed or level exits with the usage code, so a lost leg never passes.
 */
function reportsCommand(
  chosen: Ladder[],
  ladders: Record<string, Ladder>,
  floors: FloorsFile,
  options: ValidateCommandOptions,
  deps: ValidateDeps,
  root: string,
  io: Io,
): number {
  const alone = [options.brief, options.journal !== undefined, options.checkHandover, options.hardness];
  if (alone.some(Boolean) || options.blind || options.hiddenOnly || options.levels !== undefined) {
    io.err(
      '--reports goes with a component, --seed, --seeds, --hidden, --json, --items, --all-levels and --check-floor only.\n',
    );
    return USAGE_EXIT;
  }
  const expectSeeds = options.seed !== undefined || options.seeds !== undefined;
  const visible = expectSeeds ? parseSeeds(options) : [];
  if (typeof visible === 'string') {
    io.err(`${visible}\n`);
    return USAGE_EXIT;
  }
  const hidden = options.hidden ? hiddenSeed(root, deps.readHead) : undefined;
  const read = readLegs(resolve(io.cwd, options.reports as string), chosen, io);
  if (!read) return USAGE_EXIT;
  const reports: LadderReport[] = [];
  for (const ladder of chosen) {
    const legs = read.legs.get(ladder.component);
    if (!legs) {
      io.err(`No report for ${ladder.component} in ${options.reports}.\n`);
      return USAGE_EXIT;
    }
    if (legs.some((leg) => leg.ladderVersion !== ladderVersion(ladder) || leg.top !== ladder.levels.length)) {
      io.err(`The reports of ${ladder.component} are for another ladder than the one registered here.\n`);
      return USAGE_EXIT;
    }
    const floor = options.checkFloor ? floorOf(floors, ladder.component, ladderVersion(ladder)) : 0;
    const through = floor > 0 && floor <= ladder.levels.length ? floor : ladder.levels.length;
    const joined = joinLegs(ladder, legs, through, Boolean(options.items || options.allLevels));
    if (typeof joined === 'string') {
      io.err(`${ladder.component}: ${joined}.\n`);
      return USAGE_EXIT;
    }
    if (expectSeeds || hidden) {
      const have = joined.seeds.map(seedLabel).join(' ');
      const want = seedSpecs(visible, hidden).map(seedLabel).join(' ');
      const hiddenRun = joined.seeds.find((run) => run.hidden);
      if (have !== want || (hidden && hiddenRun?.seed !== hidden.seed)) {
        io.err(`The reports of ${ladder.component} hold the seeds [${have}], expected [${want}].\n`);
        return USAGE_EXIT;
      }
    }
    reports.push(joined);
  }
  const component = chosen.length > 1 ? 'all' : (chosen[0] as Ladder).component;
  print(reports, component === 'all', read.hidden, floors, options, io, root);
  return verdict(reports, floors, ladders, component, options, io);
}

/** One `--json` run of one validator, as a leg wrote it. */
type Leg = LadderReport & { hiddenSeed?: HiddenSeed };

/** Joins the legs of one validator: the slices of each seed become the run of that seed, in seed order. */
function joinLegs(
  ladder: Ladder,
  legs: readonly Leg[],
  through: number,
  full: boolean,
): LadderReport | string {
  const bySeed = new Map<string, SeedRun[]>();
  for (const leg of legs) {
    for (const run of leg.seeds) {
      const key = seedLabel(run);
      bySeed.set(key, [...(bySeed.get(key) ?? []), run]);
    }
  }
  const runs: SeedRun[] = [];
  for (const slices of bySeed.values()) {
    const run = mergeSeedRuns(slices, through, full);
    if (typeof run === 'string') return run;
    runs.push(run);
  }
  runs.sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.seed - b.seed);
  return {
    component: ladder.component,
    ladderVersion: ladderVersion(ladder),
    level: Math.min(...runs.map((run) => run.level)),
    top: ladder.levels.length,
    seeds: runs,
    ...(ladder.beyondApart ? { beyondApart: true as const } : {}),
  };
}

/** Reads every `*.json` of a folder: one run of one validator each, or the `reports` of an `all` run. */
function readLegs(
  dir: string,
  chosen: Ladder[],
  io: Io,
): { legs: Map<string, Leg[]>; hidden?: HiddenSeed } | undefined {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (cause) {
    io.err(`Cannot read the reports folder ${dir}: ${message(cause)}\n`);
    return undefined;
  }
  if (names.length === 0) {
    io.err(`${dir} holds no .json report.\n`);
    return undefined;
  }
  const wanted = new Set(chosen.map((ladder) => ladder.component));
  const legs = new Map<string, Leg[]>();
  let hidden: HiddenSeed | undefined;
  for (const name of names) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (cause) {
      io.err(`Cannot read the report ${name}: ${message(cause)}\n`);
      return undefined;
    }
    const list = isRecord(value) && Array.isArray(value.reports) ? value.reports : [value];
    for (const item of list) {
      if (!isLeg(item)) {
        io.err(`${name} is not a validate --json report.\n`);
        return undefined;
      }
      if (!wanted.has(item.component)) continue;
      // A leg that reported the levels beyond its first failure apart gets them back in its rows first.
      const whole = unsplitBeyond(item);
      if (typeof whole === 'string') {
        io.err(`${name}: ${whole}.\n`);
        return undefined;
      }
      legs.set(item.component, [...(legs.get(item.component) ?? []), whole as Leg]);
      hidden = item.hiddenSeed ?? hidden;
    }
  }
  return { legs, ...(hidden ? { hidden } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLeg(value: unknown): value is Leg {
  return (
    isRecord(value) &&
    typeof value.component === 'string' &&
    typeof value.ladderVersion === 'number' &&
    typeof value.top === 'number' &&
    Array.isArray(value.seeds) &&
    value.seeds.length > 0 &&
    value.seeds.every(
      (run) =>
        isRecord(run) &&
        typeof run.seed === 'number' &&
        typeof run.hidden === 'boolean' &&
        typeof run.level === 'number' &&
        typeof run.top === 'number' &&
        Array.isArray(run.rows) &&
        run.rows.length === run.top &&
        run.rows.every((row) => isRecord(row) && (row.pass === null || typeof row.pass === 'boolean')),
    )
  );
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

/** `validate <component> --hardness`: the measurement of section 12.4 from the journal; exit 0 when the gate holds. */
function hardnessCommand(
  component: string,
  json: boolean,
  root: string,
  io: Io,
  evidenceComponent = component,
): number {
  const { rows, problems } = readJournal(root, evidenceComponent);
  if (problems.length > 0) {
    io.err(`${journalFile(evidenceComponent)} holds invalid rows:\n`);
    for (const problem of problems) io.err(`  ${problem}\n`);
    return USAGE_EXIT;
  }
  let hardness: ReturnType<typeof measureHardness>;
  try {
    const auditPath = join(root, `${loopFolder(evidenceComponent)}/audit.md`);
    const gatePath = join(root, `${loopFolder(evidenceComponent)}/GATE.md`);
    hardness = measureHardness(rows, {
      ...(component === 'stats' ? { bankHash: statsBankHash(root) } : {}),
      ...(existsSync(auditPath) ? { audit: readFileSync(auditPath, 'utf8') } : {}),
      ...(existsSync(gatePath) ? { gate: readFileSync(gatePath, 'utf8') } : {}),
    });
  } catch (cause) {
    io.err(`${journalFile(evidenceComponent)}: ${message(cause)}.\n`);
    return USAGE_EXIT;
  }
  if (json) io.out(`${JSON.stringify({ component, ...hardness }, null, 2)}\n`);
  else io.out(formatHardness(component, hardness));
  return hardness.gate.holds ? 0 : 1;
}

/** `validate <component> --journal <row.json>`: appends a validated row and rewrites the handover's level table. */
function journalCommand(
  ladder: Ladder,
  path: string,
  floors: FloorsFile,
  root: string,
  io: Io,
  component = ladder.component,
): number {
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
  if (executorOf(result.row) === 'blind') {
    io.out(
      `Appended blind iteration ${result.row.iteration} to ${journalFile(component)}; blind row: HANDOVER.md was not touched.\n`,
    );
    return 0;
  }
  const handover =
    readHandover(root, component) ??
    handoverTemplate(component, floorOf(floors, ladder.component, ladderVersion(ladder)));
  writeHandover(root, component, setLevelTable(handover, result.row));
  const research = join(root, researchFile(component));
  if (!existsSync(research)) writeFileSync(research, researchTemplate(component));
  io.out(
    `Appended iteration ${result.row.iteration} to ${journalFile(component)} and rewrote the level table of ${handoverFile(component)}.\n`,
  );
  return 0;
}

/** `validate <component|all> --check-handover`: every section present and the level table equal to the journal. */
function handoverCheckCommand(
  ladders: Ladder[],
  root: string,
  io: Io,
  evidenceComponent = (ladder: Ladder) => ladder.component,
): number {
  let failed = false;
  for (const ladder of ladders) {
    const component = evidenceComponent(ladder);
    const { rows, problems } = readJournal(root, component);
    const text = readHandover(root, component);
    const all = [...problems];
    if (text === undefined) all.push(`${handoverFile(component)} is missing`);
    else all.push(...checkHandover(text, rows.filter((row) => executorOf(row) === 'builder').at(-1)));
    if (all.length === 0) {
      io.out(`${handoverFile(component)}: every section present, the level table matches the journal.\n`);
      continue;
    }
    failed = true;
    io.err(`${handoverFile(component)}:\n`);
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
  evidenceComponent = report.component,
): number {
  const path = join(root, EXECUTOR_FILE);
  if (!existsSync(path)) {
    io.err(`${EXECUTOR_FILE} is missing: the brief has no instruction to embed the state in.\n`);
    return USAGE_EXIT;
  }
  const { rows, problems } = readJournal(root, evidenceComponent);
  for (const problem of problems) io.err(`Warning: ${problem}\n`);
  const brief = composeBrief({
    component: evidenceComponent,
    executor: readFileSync(path, 'utf8'),
    report,
    floor: floorOf(floors, report.component, report.ladderVersion),
    last: rows.at(-1),
    handover: readHandover(root, evidenceComponent),
    head: hidden?.head ?? headOf(root, deps),
    fresh,
  });
  io.out(
    evidenceComponent === report.component
      ? brief
      : brief.replaceAll(
          `driftbench validate ${evidenceComponent}`,
          `driftbench validate ${report.component} --ladder-version ${report.ladderVersion}`,
        ),
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
  if (!options.raise || level === undefined || !options.evidence || !options.ladderVersion) {
    const shown = Object.entries(floors.floors).map(
      ([name, floor]) => `${name} = ${floor} (ladder version ${floors.ladderVersion[name] ?? 1})`,
    );
    if (options.raise || level !== undefined || options.evidence || options.ladderVersion) {
      io.err(
        'Raise a floor with: driftbench validate floors --raise <component> <level> --ladder-version <n> --evidence <json>.\n',
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
  if (!/^\d+$/.test(options.ladderVersion) || optionNumber(options.ladderVersion) < 1) {
    io.err(`--ladder-version is a whole number of at least 1, not "${options.ladderVersion}".\n`);
    return USAGE_EXIT;
  }
  const version = optionNumber(options.ladderVersion);
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
    ladderVersion: version,
    registeredVersion: ladderVersion(ladder),
  });
  if ('refused' in result) {
    io.err(`Refused: ${result.refused}\n`);
    return 1;
  }
  mkdirSync(dirname(join(root, FLOORS_FILE)), { recursive: true });
  writeFloors(root, result.file);
  io.out(
    `The floor of ${options.raise} for ladder version ${version} rises from ${floorOf(floors, options.raise, version)} to ${level} in ${FLOORS_FILE}. Commit it on its own with the evidence run.\n`,
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
  root: string,
): void {
  if (options.json) {
    const shown = reports.map((report) => {
      // A ladder that reports them apart puts the levels measured above a seed's first failing level in their own
      // section, never in the rows.
      const split = options.allLevels && report.beyondApart ? splitBeyond(report) : undefined;
      return {
        ...(split?.report ?? report),
        ...(hidden ? { hiddenSeed: hidden } : {}),
        ...(options.items ? { bank: shownBank(report, options, root) } : {}),
        ...(options.allLevels ? { failingItems: allFailingItems(report) } : {}),
        ...(split && split.beyond.seeds.length > 0 ? { beyondTheFirstFailingLevel: split.beyond } : {}),
      };
    });
    io.out(`${JSON.stringify(all ? { reports: shown } : shown[0], null, 2)}\n`);
    return;
  }
  io.out(
    reports
      .map((report) => {
        const note = floorNote(floors, report.component, report.ladderVersion);
        const table = formatLadder(report, {
          floor: floorOf(floors, report.component, report.ladderVersion),
          ...(note ? { floorNote: note } : {}),
        });
        const items = options.items
          ? `\n${formatItems(bankSummary(report, readCatchList(root, report.component)), report.component, { blind: Boolean(options.blind) })}`
          : '';
        const failing = options.allLevels
          ? `\n${formatAllFailing(allFailingItems(report), report.component)}`
          : '';
        return `${table}${items}${failing}`;
      })
      .join('\n'),
  );
}

/** The bank of a report for JSON; the blind view drops the cause counts, which the auditor must not see. */
function shownBank(report: LadderReport, options: ValidateCommandOptions, root: string) {
  const bank = bankSummary(report, readCatchList(root, report.component));
  if (!options.blind) return bank;
  const {
    failingCauses: _c,
    failingComposite: _k,
    failingWithoutCause: _w,
    failingCausesByFamily: _f,
    ...rest
  } = bank;
  return { ...rest, rows: rest.rows.map(({ cause: _cause, ...row }) => row) };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

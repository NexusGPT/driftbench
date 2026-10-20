import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  compareReplays,
  diffEstateMaps,
  diffGuardStates,
  type EstateMap,
  estateImpact,
  type GuardState,
  guardStateBeside,
  latestReplay,
  loadEstateMap,
  loadEstateTests,
  loadGuardState,
  parseEstateDiff,
  pointer,
  type Regression,
  type ReplayOutcome,
  renderEstateDiff,
  renderImpact,
  writeRetirements,
} from '@agent-nexus/driftbench-estate';
import type { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';
import { show, writeOut } from '../files';
import type { Io } from '../io';
import { defaultReplayDeps, type ReplayDeps, replayCommand } from './replay';

export type EstateDiffOptions = {
  json?: boolean;
  out?: string;
  oldGuards?: string;
  newGuards?: string;
  oldLedger?: string;
  newLedger?: string;
  changeOut?: string;
};
export type EstateImpactOptions = {
  tests?: string;
  write?: boolean;
  json?: boolean;
  out?: string;
  replay?: string;
  suite?: string;
  store?: string;
};

export type EstateMaintainDeps = {
  /** The store and the clock of the replay run; tests pass their own. */
  replay?: ReplayDeps;
};

/**
 * `driftbench estate diff` and `driftbench estate impact`: what changed between two versions of an estate
 * map, and what that change does to the tests written for it.
 */
export function registerEstateMaintainCommands(
  estate: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: EstateMaintainDeps = {},
): void {
  estate
    .command('diff')
    .description(
      'Atoms added, changed (white space or semantic), moved and removed, and edges, between two maps',
    )
    .argument('<old>', 'the earlier estate map')
    .argument('<new>', 'the later estate map')
    .option('--json', 'print the diff as one JSON document')
    .option('--out <file>', 'also write the diff as JSON, for estate impact')
    .option('--old-guards <file>', 'the guard state of the old map (default: guard-state.yaml beside it)')
    .option('--new-guards <file>', 'the guard state of the new map (default: guard-state.yaml beside it)')
    .option(
      '--old-ledger <file>',
      'the ledger of the old version: with --new-ledger, the diff reads the units',
    )
    .option('--new-ledger <file>', 'the ledger of the new version (estate scan --pointer --ledger --update)')
    .option(
      '--change-out <file>',
      'with the ledgers: write the change manifest of the units, for driftbench radius',
    )
    .action(async (before: string, after: string, options: EstateDiffOptions) => {
      setExit(await estateDiffCommand(before, after, options, io));
    });

  estate
    .command('impact')
    .description('What an estate diff does to the tests: regenerate, re-approve, retire, new')
    .argument('<diff>', 'the diff written by estate diff --out (JSON)')
    .option('--tests <dir>', 'the specs of the estate, indexed by metadata.estate.atoms')
    .option('--write', 'write each retirement reason into its spec as metadata.retired')
    .option('--json', 'print the impact as one JSON document')
    .option('--out <file>', 'also write the impact as JSON')
    .option('--replay <sessions>', 'replay the suite over this folder of recorded sessions (JSONL)')
    .option('--suite <dir>', 'the replay suite (default: the specs folder inside the sessions folder)')
    .option('--store <db>', 'compare with the previous replay kept in this store, and keep this one')
    .action(async (diff: string, options: EstateImpactOptions) => {
      setExit(await estateImpactCommand(diff, options, io, deps));
    });
}

/**
 * Exit 0 when the diff is computed (with or without changes), 2 when a map or a guard state file cannot be
 * read. The guard state of each map is the file named with --old-guards / --new-guards, else the
 * guard-state.yaml beside the map when there is one; with neither side holding a state, the diff has no guards.
 */
export async function estateDiffCommand(
  beforeArg: string,
  afterArg: string,
  options: EstateDiffOptions,
  io: Io,
): Promise<number> {
  const before = await readMap(beforeArg, io);
  const after = await readMap(afterArg, io);
  if (!before || !after) return 2;
  const oldState = await readGuards(beforeArg, options.oldGuards, before, io);
  const newState = await readGuards(afterArg, options.newGuards, after, io);
  if (oldState === false || newState === false) return 2;
  if ((options.oldLedger === undefined) !== (options.newLedger === undefined)) {
    io.err('error: --old-ledger and --new-ledger go together\n');
    return 2;
  }
  if (options.changeOut !== undefined && options.oldLedger === undefined) {
    io.err('error: --change-out needs --old-ledger and --new-ledger\n');
    return 2;
  }
  const oldLedger = options.oldLedger === undefined ? undefined : await readLedger(options.oldLedger, io);
  const newLedger = options.newLedger === undefined ? undefined : await readLedger(options.newLedger, io);
  if (oldLedger === false || newLedger === false) return 2;
  const diff = diffEstateMaps(before, after, {
    oldPath: beforeArg,
    newPath: afterArg,
    ...(oldState === undefined && newState === undefined
      ? {}
      : { guards: diffGuardStates(oldState, newState) }),
    ...(oldLedger && newLedger ? { ledgers: { before: oldLedger, after: newLedger } } : {}),
  });
  const json = `${JSON.stringify(diff, null, 2)}\n`;
  if (options.out !== undefined && !(await writeOut(resolve(io.cwd, options.out), json, io))) return 2;
  if (options.changeOut !== undefined && oldLedger && newLedger) {
    const manifest = pointer.ledgerChangeManifest(
      pointer.rerunOf(pointer.ledgerChanges(oldLedger, newLedger), oldLedger),
      {
        from: before.hash.slice(0, 12),
        to: after.hash.slice(0, 12),
        atomsByUnit: pointer.atomsByUnit(before.atoms),
      },
    );
    if (!(await writeOut(resolve(io.cwd, options.changeOut), stringifyYaml(manifest), io))) return 2;
  }
  io.out(options.json ? json : renderEstateDiff(diff));
  if (options.out !== undefined && !options.json) io.out(`Wrote ${options.out}.\n`);
  if (options.changeOut !== undefined && !options.json) io.out(`Wrote ${options.changeOut}.\n`);
  return 0;
}

async function readLedger(path: string, io: Io): Promise<pointer.Ledger | false> {
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, path), 'utf8');
  } catch (cause) {
    io.err(`Cannot read the ledger ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return false;
  }
  const ledger = pointer.parseLedger(text);
  if (ledger) return ledger;
  io.err(`Cannot use the ledger ${path}: it is not a ledger\n`);
  return false;
}

/**
 * Exit 0 when nothing needs a person, 1 when an atom waits for re-approval, a new atom has no test, a replay
 * that passed before fails now, or a retirement could not be written, 2 on a usage or input error.
 */
export async function estateImpactCommand(
  diffArg: string,
  options: EstateImpactOptions,
  io: Io,
  deps: EstateMaintainDeps = {},
): Promise<number> {
  if (options.tests === undefined) {
    io.err("error: required option '--tests <dir>' not specified\n");
    return 2;
  }
  if (options.replay === undefined && (options.suite !== undefined || options.store !== undefined)) {
    io.err('error: --suite and --store belong to --replay <sessions>\n');
    return 2;
  }
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, diffArg), 'utf8');
  } catch (cause) {
    io.err(`Cannot read the diff ${diffArg}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
  const parsed = parseEstateDiff(text);
  if (!parsed.ok) {
    io.err(`${diffArg} is ${parsed.message}\n`);
    return 2;
  }
  const loaded = await loadEstateTests(resolve(io.cwd, options.tests));
  if (!loaded.ok) {
    io.err(`The tests in ${options.tests} cannot be read:\n`);
    for (const error of loaded.errors) io.err(`  ${error}\n`);
    return 2;
  }
  let regression: Regression | undefined;
  if (options.replay !== undefined) {
    const ran = await replayCorpus(options.replay, options, io, deps.replay ?? defaultReplayDeps);
    if (ran === undefined) return 2;
    regression = ran;
  }
  const report = estateImpact(parsed.diff, loaded.tests, {
    others: loaded.others,
    ...(regression ? { regression } : {}),
  });
  if (options.write) {
    for (const result of await writeRetirements(report, loaded.tests)) {
      if (!result.ok) report.needsPerson.push(`retire ${result.file} by hand: ${result.message}`);
    }
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out !== undefined && !(await writeOut(resolve(io.cwd, options.out), json, io))) return 2;
  io.out(options.json ? json : renderImpact(report));
  if (options.out !== undefined && !options.json) io.out(`Wrote ${options.out}.\n`);
  return report.needsPerson.length > 0 ? 1 : 0;
}

type ReplayJson = { campaignId: string; notes: string[]; runs: ReplayOutcome[] };

/**
 * Runs `driftbench replay` over a folder of sessions: every `*.jsonl` there is a session, except the decision
 * logs (`*.decisions.jsonl`) and step feeds (`*.steps.jsonl`), which go with the session their name starts
 * with. The previous replay is read from the store before this one is kept in it.
 */
async function replayCorpus(
  dirArg: string,
  options: EstateImpactOptions,
  io: Io,
  deps: ReplayDeps,
): Promise<Regression | undefined> {
  const dir = resolve(io.cwd, dirArg);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch (cause) {
    io.err(
      `Cannot read the sessions folder ${dirArg}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return undefined;
  }
  const log = (name: string) => /\.(decisions|steps)\.jsonl$/.test(name);
  const sessions = names.filter((name) => !log(name)).map((name) => join(dir, name));
  if (sessions.length === 0) {
    io.err(`The sessions folder ${dirArg} holds no session (*.jsonl).\n`);
    return undefined;
  }
  const decisions = names.filter((name) => name.endsWith('.decisions.jsonl')).map((name) => join(dir, name));
  const steps = names.filter((name) => name.endsWith('.steps.jsonl')).map((name) => join(dir, name));
  const suite = resolve(io.cwd, options.suite ?? join(dirArg, 'specs'));
  if (!(await stat(suite).catch(() => undefined))) {
    io.err(`The replay suite ${show(suite, io)} does not exist; name it with --suite.\n`);
    return undefined;
  }

  let previous: Awaited<ReturnType<typeof latestReplay>>;
  const storePath = options.store === undefined ? undefined : resolve(io.cwd, options.store);
  if (storePath !== undefined) {
    try {
      const store = await deps.openStore(storePath);
      try {
        previous = await latestReplay(store);
      } finally {
        await store.close();
      }
    } catch (cause) {
      io.err(
        `Cannot read the store ${options.store}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return undefined;
    }
  }

  let out = '';
  let err = '';
  const captured: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: io.cwd,
  };
  const code = await replayCommand(
    sessions,
    { suite, decisions, steps, json: true, ...(storePath === undefined ? {} : { store: storePath }) },
    captured,
    deps,
  );
  if (code === 2 || out === '') {
    io.err(`The replay did not run (exit ${code}):\n${err}`);
    return undefined;
  }
  let replay: ReplayJson;
  try {
    replay = JSON.parse(out) as ReplayJson;
  } catch (cause) {
    io.err(`The replay printed no JSON: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
  return {
    campaign: replay.campaignId,
    previous: previous?.campaignId ?? null,
    store: options.store ?? null,
    ...compareReplays(previous?.outcomes, replay.runs),
    notes: replay.notes,
  };
}

async function readGuards(
  mapArg: string,
  given: string | undefined,
  map: EstateMap,
  io: Io,
): Promise<GuardState | undefined | false> {
  const path = given === undefined ? guardStateBeside(resolve(io.cwd, mapArg)) : resolve(io.cwd, given);
  const loaded = await loadGuardState(path, map, given !== undefined);
  if (loaded.ok) return loaded.state;
  io.err(`The guard state ${show(path, io)} does not fit the map ${mapArg}:\n`);
  for (const error of loaded.errors) io.err(`  ${error}\n`);
  return false;
}

async function readMap(path: string, io: Io): Promise<EstateMap | undefined> {
  const loaded = await loadEstateMap(resolve(io.cwd, path));
  if (loaded.ok) return loaded.map;
  io.err(`${path} is not a valid estate map:\n`);
  for (const error of loaded.errors)
    io.err(`  ${error.code} ${error.path ? `${error.path}: ` : ''}${error.message}\n`);
  return undefined;
}

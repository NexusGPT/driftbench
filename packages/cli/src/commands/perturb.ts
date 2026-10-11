import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { type RunResult, runSpec, type Spec } from '@driftbench/core';
import {
  createPerturbingDriver,
  DEVIATIONS,
  type DrawnPerturbation,
  deviationClassOf,
  loadRedteamPack,
  type PerturbingDriver,
  type RecoveryReading,
  readRecovery,
} from '@driftbench/users';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  noAdapter,
  parseTarget,
  showTarget,
  specRuns,
} from './campaign';

type PerturbOptions = {
  class?: string;
  at?: string;
  perturbation?: string;
  target?: string;
  seed: string;
  pack?: string;
  drafts?: boolean;
  json?: boolean;
};

/** The folder name of a red-team pack, looked for next to the spec and above it. */
const PACK_FOLDER = 'redteam';

/**
 * `driftbench perturb <spec> --class <D> --at <n> [--target <adapter[:agent]>]`: runs one spec once in mode
 * P with one deviation injected before block n, and prints the run block by block and its recovery. The
 * deviation is the spec's own perturbation of that class at that block when it declares one, else a
 * phrasing drawn by seed from the red-team pack (`--pack`, default the nearest `redteam/` folder at or
 * above the spec's folder). `--perturbation <id>` runs a perturbation the spec declares, at its own block.
 *
 * Exit 0 when the agent comes back within the spec's window, 1 when it does not, when the run fails or when
 * the recovery cannot be measured, 2 on bad input (nothing ran).
 */
export function registerPerturbCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  program
    .command('perturb')
    .description('Run one spec in mode P with one deviation injected, and print the recovery')
    .argument('<spec>', 'one spec file')
    .option('--class <D>', 'the deviation class: D1 to D10, or its full name such as D2_goal_shift')
    .option('--at <n>', 'the block the deviation goes in before, counting from 0')
    .option('--perturbation <id>', 'a perturbation the spec declares, instead of --class and --at')
    .option(
      '--target <adapter[:agent]>',
      "the agent, such as function:acme-sales; without it, the spec's own",
    )
    .option('--seed <n>', 'the seed of the draw from the red-team pack', '0')
    .option('--pack <dir>', 'the red-team pack; default the nearest redteam/ folder at or above the spec')
    .option('--drafts', 'draw from phrasings nobody has approved yet')
    .option('--json', 'print one JSON document')
    .action(async (path: string, options: PerturbOptions) => {
      setExit(await perturbCommand(path, options, io, deps));
    });
}

export async function perturbCommand(
  path: string,
  options: PerturbOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const usage = usageProblem(options);
  if (usage) {
    io.err(`${usage}\n`);
    return 2;
  }
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`perturb takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  const spec = entry.spec;

  let driver: PerturbingDriver;
  try {
    driver = createPerturbingDriver({ spec, perturbation: await choiceOf(spec, entry.path, options, io) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    io.err(`${message}\n`);
    if (/no approved/.test(message))
      io.err('Run with --drafts to draw from phrasings nobody has approved yet.\n');
    return 2;
  }

  const given = options.target === undefined ? [] : [parseTarget(options.target)];
  const [planned] = specRuns([entry], given, io) ?? [];
  const target = planned?.targets[0];
  if (planned === undefined || target === undefined) return 2;
  const adapter = await deps.adapterFor(target);
  if (!adapter) {
    io.err(`${noAdapter(target, planned.pinned === undefined ? [] : [spec.id])}\n`);
    return 2;
  }

  const result = await runSpec(driver.spec, {
    adapter,
    driver,
    checks: deps.checks,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    mode: 'P',
    repeat: 0,
    target,
    perturbationId: driver.perturbation.id,
    now: () => deps.now(),
  });
  const reading = readRecovery(driver.spec, driver.perturbation, result);
  const recovery = result.recovery ?? (reading.measured ? reading.recovery : undefined);

  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          specId: spec.id,
          target,
          perturbation: driver.perturbation,
          source: {
            ...driver.source,
            ...('packPath' in driver.source ? { packPath: shown(io, driver.source.packPath) } : {}),
          },
          worldOnly: driver.worldOnly,
          run: {
            runId: result.runId,
            status: result.status,
            ...(result.error ? { error: result.error } : {}),
            blocks: result.blocks.map((block) => ({
              index: block.index,
              ...(block.blockId === undefined ? {} : { blockId: block.blockId }),
              injected: block.injected === true,
              stage: block.stageObserved ?? null,
              pass: block.pass,
              failing: failing(block),
              text: block.observed.text,
            })),
          },
          recovery: recovery ?? null,
          recoveryFrom: result.recovery ? 'runner' : reading.measured ? 'users' : null,
          ...(reading.measured ? { within: reading.within, met: reading.met } : { reason: reading.reason }),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    printText(io, spec, target, driver, result, reading);
  }
  return result.status === 'completed' && reading.measured && reading.met ? 0 : 1;
}

/** Which flags go together: --perturbation alone, or --class with --at. */
function usageProblem(options: PerturbOptions): string | undefined {
  if (options.perturbation !== undefined) {
    if (options.class !== undefined || options.at !== undefined) {
      return '--perturbation names a perturbation the spec declares, with its own class and block: leave out --class and --at.';
    }
    return undefined;
  }
  if (options.class === undefined || options.at === undefined) {
    return 'Name the deviation: --class <D1 to D10> and --at <block>, or --perturbation <id>.';
  }
  if (deviationClassOf(options.class) === undefined) {
    return `--class takes D1 to D10, or a full name such as D2_goal_shift, not "${options.class}".`;
  }
  if (!/^\d+$/.test(options.at)) return `--at takes a block number from 0, not "${options.at}".`;
  if (!/^\d+$/.test(options.seed)) return `--seed takes a whole number from 0, not "${options.seed}".`;
  return undefined;
}

/** The perturbation option for the driver: an id, or a draw that the driver resolves against the spec. */
async function choiceOf(
  spec: Spec,
  specPath: string,
  options: PerturbOptions,
  io: Io,
): Promise<string | DrawnPerturbation> {
  if (options.perturbation !== undefined) return options.perturbation;
  const cls = deviationClassOf(options.class ?? '');
  if (cls === undefined) throw new Error(`unknown class ${options.class}`);
  const at = Number(options.at);
  const declared = spec.perturbations?.some((entry) => entry.class === cls && entry.inject_at === at);
  // A declared perturbation needs no pack; the driver picks it before any draw.
  const packDir = options.pack === undefined ? findPack(specPath) : resolve(io.cwd, options.pack);
  if (packDir === undefined) {
    if (declared) return { class: cls, inject_at: at, pack: { files: new Map() } };
    throw new Error(
      `${spec.id} declares no ${cls} perturbation at block ${at}, and no ${PACK_FOLDER}/ folder sits at or above ${shown(io, dirname(specPath))} to draw one from: give --pack <dir>.`,
    );
  }
  const pack = declared ? { files: new Map() } : await loadRedteamPack(packDir);
  return {
    class: cls,
    inject_at: at,
    pack,
    seed: Number(options.seed),
    ...(options.drafts ? { drafts: true } : {}),
  };
}

/** The nearest `redteam/` folder at or above the spec's folder. */
function findPack(specPath: string): string | undefined {
  for (let dir = dirname(specPath); ; dir = dirname(dir)) {
    const candidate = join(dir, PACK_FOLDER);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

function failing(block: RunResult['blocks'][number]): string[] {
  return block.verdicts
    .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
    .map((verdict) => verdict.id);
}

function shown(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

function printText(
  io: Io,
  spec: Spec,
  target: Parameters<typeof showTarget>[0],
  driver: PerturbingDriver,
  result: RunResult,
  reading: RecoveryReading,
): void {
  const { perturbation, source } = driver;
  const def = DEVIATIONS[perturbation.class];
  const origin =
    source.kind === 'drawn'
      ? `drawn from ${shown(io, source.packPath)}, phrasing ${source.phrasingId}, seed ${source.seed}${source.approved ? '' : ', a draft nobody has approved yet'}`
      : source.kind === 'declared'
        ? `declared by the spec as ${perturbation.id}`
        : `given as ${perturbation.id}`;
  const carried = driver.worldOnly
    ? `a change of the world that block ${perturbation.inject_at} runs under`
    : `a message before block ${perturbation.inject_at}`;
  io.out(
    `Perturb: ${spec.id} on ${showTarget(target)}, mode P. ${def.code} ${def.title}: ${carried} (${origin}).\n`,
  );
  io.out(`Expected: ${def.expected}.\n`);
  const rows = result.blocks.map((block) => [
    String(block.index),
    block.injected === true && block.blockId === perturbation.id
      ? `injected ${perturbation.id}`
      : (block.blockId ?? ''),
    block.stageObserved ?? '-',
    block.pass ? '✓' : '✗',
    failing(block).join(', '),
  ]);
  for (const line of table([['pos', 'block', 'stage', 'pass', 'failing'], ...rows])) io.out(`${line}\n`);
  if (result.status !== 'completed')
    io.out(`The run ${result.status}: ${result.error ?? 'no reason given'}.\n`);
  if (!reading.measured) {
    io.out(`Recovery not measured: ${reading.reason}.\n`);
    return;
  }
  const { recovery } = reading;
  const allows = `the spec allows ${reading.within} ${reading.within === 1 ? 'block' : 'blocks'}`;
  const turns =
    recovery.turnsToRecover === undefined
      ? ''
      : `, ${recovery.turnsToRecover} ${recovery.turnsToRecover === 1 ? 'block' : 'blocks'} to come back`;
  const extras = [
    `collateral ${recovery.collateral}`,
    ...(recovery.safeAction === undefined ? [] : [`safe action ${recovery.safeAction ? 'yes' : 'no'}`]),
    ...(recovery.clarified === undefined ? [] : [`asked a question ${recovery.clarified ? 'yes' : 'no'}`]),
  ];
  io.out(
    `${reading.met ? '✓' : '✗'} Recovery: ${recovery.label}${turns} (${allows}), ${extras.join(', ')}.\n`,
  );
  if (result.recovery) {
    io.out(`Recovery record (runner): ${JSON.stringify(result.recovery)}\n`);
    if (JSON.stringify(result.recovery) !== JSON.stringify(recovery)) {
      io.out(`Recovery read by @driftbench/users: ${JSON.stringify(recovery)}\n`);
    }
  } else {
    io.out(
      `Recovery record (read by @driftbench/users; the runner records none yet): ${JSON.stringify(recovery)}\n`,
    );
  }
}

/** Pads every column but the last to its widest cell, two spaces apart, indented by two. */
function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join('  ')}`.trimEnd(),
  );
}

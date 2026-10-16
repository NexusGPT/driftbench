import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { blockStatus, isScored, type RunResult, runSpec, type Spec } from '@agent-nexus/driftbench-core';
import {
  createPerturbingDriver,
  DEVIATIONS,
  type DrawnPerturbation,
  deviationClassOf,
  loadRedteamPack,
  type PerturbingDriver,
} from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { noStageWarning, summaryLine, totalOf } from '../reply-checks';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  parseTarget,
  resolveAdapter,
  showTarget,
  specRuns,
} from './campaign';
import { faultDeps } from './ci';

type PerturbOptions = {
  class?: string;
  at?: string;
  perturbation?: string;
  target?: string;
  faults?: string;
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
 * It first runs the spec free (mode F) on the same target: the reference the runner counts the
 * recovery's collateral against, as a campaign does. The recovery printed is the runner's own record.
 *
 * Exit 0 when the agent comes back within the spec's window (turnsToRecover at most `recovery.within_blocks`), 1 when it
 * does not, when the run fails or when the recovery cannot be measured, 2 on bad input (nothing ran).
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
    .option('--class <D>', 'the deviation class: D1 to D12, or its full name such as D2_goal_shift')
    .option('--at <n>', 'the block the deviation goes in before, counting from 0')
    .option('--perturbation <id>', 'a perturbation the spec declares, instead of --class and --at')
    .option(
      '--target <adapter[:agent]>',
      "the agent, such as function:acme-sales; without it, the spec's own",
    )
    .option(
      '--faults <path>',
      'a fault set (module or folder) whose faults the target can name as fault:<id>',
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
  let runDeps = deps;
  if (target.adapter === 'fault') {
    const withFaults = await faultDeps(deps, options.faults, io);
    if (!withFaults) return 2;
    runDeps = withFaults;
  }
  const adapter = await resolveAdapter(
    target,
    () => runDeps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [spec.id],
  );
  if (!adapter) {
    return 2;
  }

  // The free-running run of the same spec and target: the reference the runner counts collateral against,
  // as a campaign does for its perturbed cells.
  const common = {
    adapter,
    checks: runDeps.checks,
    ...(runDeps.artifacts ? { artifacts: runDeps.artifacts } : {}),
    repeat: 0,
    target,
    now: () => runDeps.now(),
  };
  const reference = await runSpec(spec, { ...common, driver: runDeps.driver(), mode: 'F' });
  const result = await runSpec(driver.spec, {
    ...common,
    driver,
    mode: 'P',
    perturbationId: driver.perturbation.id,
    ...(reference.status === 'completed' ? { reference } : {}),
    ...(runDeps.consequential ? { consequential: runDeps.consequential } : {}),
  });
  const recovery = result.recovery;
  const within = driver.perturbation.recovery?.within_blocks;
  // Met: back within the spec's window. The label says where (docs/concepts/recovery.md), not whether in time.
  const met =
    recovery?.turnsToRecover !== undefined && within !== undefined && recovery.turnsToRecover <= within;
  const reason = recovery ? undefined : notMeasured(driver, result);

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
          ...replyChecksJson(io, spec, driver),
          reference: {
            runId: reference.runId,
            status: reference.status,
            used: reference.status === 'completed',
          },
          run: {
            runId: result.runId,
            status: result.status,
            ...(result.error ? { error: result.error } : {}),
            blocks: result.blocks.map((block) => ({
              index: block.index,
              ...(block.blockId === undefined ? {} : { blockId: block.blockId }),
              injected: block.injected === true,
              stage: block.stageObserved ?? null,
              pass: blockStatus(block) === 'pass',
              ...(isScored(block) ? {} : { status: blockStatus(block) }),
              failing: failing(block),
              text: block.observed.text,
            })),
          },
          recovery: recovery ?? null,
          ...(within === undefined ? {} : { within }),
          met,
          ...(reason === undefined ? {} : { reason }),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    printText(io, spec, target, driver, reference, result, reason);
  }
  return result.status === 'completed' && met ? 0 : 1;
}

/** The reply-check accounting of a drawn phrasing, and the warning, as JSON fields. */
function replyChecksJson(io: Io, spec: Spec, driver: PerturbingDriver) {
  const found = replyChecksOf(io, spec, driver);
  if (!found) return {};
  return {
    replyChecks: { ...found.checks, summary: summaryLine(found.sum) ?? null },
    complete: found.sum.noStage === 0,
    warnings: found.warning === undefined ? [] : [found.warning],
  };
}

function replyChecksOf(io: Io, spec: Spec, driver: PerturbingDriver) {
  const { source, perturbation } = driver;
  if (source.kind !== 'drawn') return undefined;
  const checks = source.replyChecks;
  const sum = totalOf([checks]);
  const warning = noStageWarning(sum, [checks], shown(io, source.packPath), spec.id, [
    perturbation.inject_at,
  ]);
  return { checks, sum, warning };
}

/** Why a perturbed run carries no recovery record. */
function notMeasured(driver: PerturbingDriver, result: RunResult): string {
  if (!driver.perturbation.recovery)
    return `${driver.perturbation.id} sets no recovery, so it is run but not measured`;
  const injected = result.blocks.find(
    (block) => block.injected === true && block.blockId === driver.perturbation.id,
  );
  // A block not run or blocked sends nothing: the deviation never reached the agent.
  const skipped =
    injected && !isScored(injected) ? injected : result.blocks.find((block) => !isScored(block));
  if (skipped) {
    return `the deviation ${driver.perturbation.id} never reached the agent: block ${skipped.index} was ${blockStatus(skipped) === 'blocked' ? 'blocked' : 'not run'}`;
  }
  if (!injected) {
    return `the deviation ${driver.perturbation.id} never went in: the run ${result.status} after ${result.blocks.length} blocks`;
  }
  return 'the runner recorded none';
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
    return 'Name the deviation: --class <D1 to D12> and --at <block>, or --perturbation <id>.';
  }
  if (deviationClassOf(options.class) === undefined) {
    return `--class takes D1 to D12, or a full name such as D2_goal_shift, not "${options.class}".`;
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
  const at = optionNumber(options.at ?? '');
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
    seed: optionNumber(options.seed),
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
  if (block.notRun) return [`not run: ${block.notRun.check}, ${block.notRun.got}`];
  if (block.blocked) return [`blocked by ${block.blocked.by}`];
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
  reference: RunResult,
  result: RunResult,
  reason: string | undefined,
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
  const passed = reference.blocks.filter((block) => blockStatus(block) === 'pass').length;
  const unscored = reference.blocks.filter((block) => !isScored(block)).length;
  io.out(
    reference.status === 'completed'
      ? `Reference: the F run of the same spec, ${passed} of ${reference.blocks.length - unscored} blocks pass${unscored > 0 ? ` (${unscored} not run or blocked)` : ''}; collateral counts against it.\n`
      : `Reference: the F run ${reference.status}, so collateral counts the blocks after the recovery that fail.\n`,
  );
  const rows = result.blocks.map((block) => [
    String(block.index),
    block.injected === true && block.blockId === perturbation.id
      ? `injected ${perturbation.id}`
      : (block.blockId ?? ''),
    block.stageObserved ?? '-',
    { pass: '✓', fail: '✗', not_run: '-', blocked: '-' }[blockStatus(block)],
    failing(block).join(', '),
  ]);
  for (const line of table([['pos', 'block', 'stage', 'pass', 'failing'], ...rows])) io.out(`${line}\n`);
  if (result.status !== 'completed')
    io.out(`The run ${result.status}: ${result.error ?? 'no reason given'}.\n`);
  const recovery = result.recovery;
  if (!recovery) {
    io.out(`Recovery not measured: ${reason ?? 'the runner recorded none'}.\n`);
    const unmeasured = replyChecksOf(io, spec, driver);
    const note = unmeasured && summaryLine(unmeasured.sum);
    if (note) io.out(`${note}\n`);
    if (unmeasured?.warning) io.err(`${unmeasured.warning}\n`);
    return;
  }
  const within = perturbation.recovery?.within_blocks ?? 0;
  const allows = `the spec allows ${within} ${within === 1 ? 'block' : 'blocks'}`;
  const turns =
    recovery.turnsToRecover === undefined
      ? ''
      : `, ${recovery.turnsToRecover} ${recovery.turnsToRecover === 1 ? 'block' : 'blocks'} to come back`;
  const extras = [
    `collateral ${recovery.collateral}`,
    ...(recovery.safeAction === undefined ? [] : [`safe action ${recovery.safeAction ? 'yes' : 'no'}`]),
    ...(recovery.clarified === undefined ? [] : [`asked first ${recovery.clarified ? 'yes' : 'no'}`]),
  ];
  const found = replyChecksOf(io, spec, driver);
  const incomplete = found !== undefined && found.sum.noStage > 0;
  const mark = recovery.turnsToRecover !== undefined && recovery.turnsToRecover <= within ? '✓' : '✗';
  io.out(
    `${incomplete && mark === '✓' ? '⚠' : mark} Recovery: ${recovery.label}${turns} (${allows}), ${extras.join(', ')}.\n`,
  );
  io.out(`Recovery record (runner): ${JSON.stringify(recovery)}\n`);
  const line = found && summaryLine(found.sum);
  if (line) io.out(`${line}\n`);
  if (found?.warning) io.err(`${found.warning}\n`);
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

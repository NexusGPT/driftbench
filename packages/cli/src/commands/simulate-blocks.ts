import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { blockStatus, isScored, runSpec, type Spec, type TargetRef } from '@agent-nexus/driftbench-core';
import { portFromEnv } from '@agent-nexus/driftbench-generate';
import {
  type BlockFlips,
  type CalibrationReport,
  calibrationReport,
  cassettePort,
  createBlockUser,
  flipReport,
  freezeSimulatedRun,
  type LedgerTurn,
  loadUserCassette,
  recordingCassettePort,
  SimulatedUserError,
  simulatedUserOf,
  type UserModelPort,
  writeUserCassette,
} from '@agent-nexus/driftbench-users';
import { stringify as stringifyYaml } from 'yaml';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { type CampaignDeps, showTarget } from './campaign';

/**
 * `driftbench simulate <spec>` without `--persona`, on a spec whose blocks define the simulated user
 * (`when.simulated_user`). The agenda engine plans each simulated message and the realiser writes it,
 * through the model port (`--model`) or recorded responses (`--cassette`, one per simulator family). The
 * spec runs `trials` times per family (the flag, else the largest `trials` of its blocks, else 1).
 *
 * Prints per block the passes, pass^k and the rerun flip rate per family; with two families or more, the
 * flip flag; then the calibration report of the simulated messages against the human reference.
 */

export type SimulateBlocksOptions = {
  target?: string;
  model?: boolean;
  cassette?: string[];
  recordCassette?: string;
  trials?: string;
  seed?: string;
  labeller?: string;
  freeze?: string;
  agentFamily?: string;
  judgeFamily?: string[];
  json?: boolean;
};

type Prepared = {
  spec: Spec;
  target: TargetRef;
  adapter: Parameters<typeof runSpec>[1]['adapter'];
  agentFamily: string;
};

type Trial = {
  family: string;
  trial: number;
  seed: string;
  status: string;
  error?: string;
  blocks: { index: number; pass: boolean; status: string }[];
  ledger: LedgerTurn[];
};

export function hasSimulatedBlocks(spec: Spec): boolean {
  return spec.blocks.some((_, index) => simulatedUserOf(spec, index)?.mode === 'simulated');
}

export async function simulateBlocks(
  prepared: Prepared,
  options: SimulateBlocksOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const { spec, target, adapter, agentFamily } = prepared;
  const cassettes = options.cassette ?? [];
  if (options.model && cassettes.length > 0) {
    io.err('Give --model or --cassette, not both.\n');
    return 2;
  }
  if (!options.model && cassettes.length === 0) {
    io.err('Name where the simulated user speaks from: --model (the model port) or --cassette <file>.\n');
    return 2;
  }
  if (options.recordCassette && !options.model) {
    io.err('--record-cassette goes with --model: it keeps the responses of the model port.\n');
    return 2;
  }
  if (options.labeller !== undefined && options.labeller !== 'model' && options.labeller !== 'patterns') {
    io.err(`--labeller takes model or patterns, not "${options.labeller}".\n`);
    return 2;
  }
  let trials = Math.max(1, ...spec.blocks.map((_, index) => simulatedUserOf(spec, index)?.trials ?? 1));
  if (options.trials !== undefined) {
    if (!/^\d+$/.test(options.trials) || optionNumber(options.trials) < 1) {
      io.err(`--trials takes a whole number from 1, not "${options.trials}".\n`);
      return 2;
    }
    trials = optionNumber(options.trials);
  }
  const ports: UserModelPort[] = [];
  let recorder: ReturnType<typeof recordingCassettePort> | undefined;
  if (options.model) {
    let port: UserModelPort;
    try {
      port = (deps.modelPort ?? portFromEnv)();
    } catch (cause) {
      io.err(`The model port is not set up: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
    if (options.recordCassette) {
      recorder = recordingCassettePort(port);
      port = recorder;
    }
    ports.push(port);
  } else {
    for (const path of cassettes) {
      try {
        ports.push(cassettePort(await loadUserCassette(resolve(io.cwd, path))));
      } catch (cause) {
        io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
        return 2;
      }
    }
  }
  const families = ports.map((port) => port.family);
  if (new Set(families).size !== families.length) {
    io.err(`Two cassettes stand for the same family (${families.join(', ')}): give one per family.\n`);
    return 2;
  }
  const person = spec.blocks
    .map((_, index) => simulatedUserOf(spec, index))
    .find((user) => user?.mode === 'simulated');
  const base = options.seed ?? String(person?.seed ?? spec.id);
  const labeller = options.labeller === 'patterns' ? ('patterns' as const) : ('model' as const);

  const runs: Trial[] = [];
  let frozen: string | undefined;
  for (const port of ports) {
    for (let trial = 0; trial < trials; trial += 1) {
      const seed = trial === 0 ? base : `${base}#${trial}`;
      let driver: ReturnType<typeof createBlockUser>;
      try {
        driver = createBlockUser({
          spec,
          port,
          labeller,
          agentFamily,
          judgeFamilies: options.judgeFamily ?? [],
          seed,
        });
      } catch (cause) {
        if (!(cause instanceof SimulatedUserError)) throw cause;
        io.err(`${cause.message}\n`);
        return 2;
      }
      const result = await runSpec(spec, {
        adapter,
        driver,
        checks: deps.checks,
        ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
        mode: 'F',
        repeat: trial,
        target,
        recordRealizedText: true,
        now: () => deps.now(),
      });
      const blocks = result.blocks.map((block) => ({
        index: block.index,
        pass: blockStatus(block) === 'pass',
        status: blockStatus(block),
      }));
      runs.push({
        family: port.family,
        trial,
        seed,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
        blocks,
        ledger: driver.ledger(),
      });
      const failed =
        result.status !== 'completed' ||
        result.blocks.some((block) => isScored(block) && blockStatus(block) !== 'pass');
      if (options.freeze && frozen === undefined && failed && result.blocks.length > 0) {
        try {
          const out = freezeSimulatedRun(spec, result.blocks, `${port.family} trial ${trial} seed ${seed}`);
          frozen = resolve(io.cwd, options.freeze);
          await writeFile(frozen, stringifyYaml(out, { lineWidth: 0 }));
        } catch (cause) {
          if (!(cause instanceof SimulatedUserError)) throw cause;
          io.err(`${cause.message}\n`);
          return 2;
        }
      }
    }
  }
  if (recorder && options.recordCassette) {
    await writeUserCassette(resolve(io.cwd, options.recordCassette), recorder.cassette());
  }

  const outcomes: Record<string, Record<string, boolean[]>> = {};
  for (const run of runs) {
    for (const [index] of spec.blocks.entries()) {
      const key = spec.blocks[index]?.id ?? String(index);
      const row = outcomes[key] ?? Object.fromEntries(families.map((family) => [family, [] as boolean[]]));
      outcomes[key] = row;
      // A block the run did not reach (the user ended the conversation first) is no trial of it.
      const reached = run.blocks.find((block) => block.index === index);
      if (reached === undefined || reached.status === 'not_run' || reached.status === 'blocked') continue;
      row[run.family] = [...(row[run.family] ?? []), reached.pass];
    }
  }
  const flips: BlockFlips[] = flipReport(outcomes, { k: trials });
  const calibration: CalibrationReport = calibrationReport(runs.map((run) => run.ledger));
  const ok = runs.every(
    (run) => run.status === 'completed' && run.blocks.length > 0 && run.blocks.every((block) => block.pass),
  );

  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          specId: spec.id,
          target,
          families,
          trials,
          runs,
          flips,
          calibration,
          ...(frozen ? { frozen } : {}),
          ...(options.recordCassette ? { cassette: resolve(io.cwd, options.recordCassette) } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return ok ? 0 : 1;
  }
  io.out(
    `Simulate: ${spec.id} on ${showTarget(target)}, the simulated user of its blocks, ${trials} trial${trials === 1 ? '' : 's'} per family (${families.join(', ')}).\n`,
  );
  for (const run of runs) {
    const passed = run.blocks.filter((block) => block.pass).length;
    const stop = run.ledger.at(-1)?.stop;
    const ended = stop === undefined ? '' : `, the user ${STOPS[stop]} at block ${run.ledger.at(-1)?.block}`;
    io.out(
      `  ${run.family} trial ${run.trial}: ${passed} of ${run.blocks.length} blocks pass, ${run.status}${ended}${run.error ? `: ${run.error}` : ''}\n`,
    );
  }
  io.out('Per block: passes, pass^k and rerun flip rate per family.\n');
  for (const row of flips) {
    const cells = Object.entries(row.families).map(
      ([family, cell]) =>
        `${family} ${cell.passes}/${cell.trials}, pass^${trials} ${fmt(cell.passHatK)}, rerun ${fmt(cell.rerunFlipRate)}`,
    );
    const flag =
      families.length < 2
        ? ''
        : row.flagged
          ? `  FLAG: cross-family ${fmt(row.crossFlipRate)} above rerun ${fmt(row.rerunFlipRate)} (p ${fmt(row.p)})`
          : `  cross-family ${fmt(row.crossFlipRate)}`;
    io.out(`  ${row.block}  ${cells.join('; ')}${flag}\n`);
  }
  io.out(
    `Calibration against ${calibration.reference}, ${calibration.turns} simulated messages in ${calibration.dialogues} runs (Dice, 100 = the human rate):\n`,
  );
  for (const metric of calibration.metrics) {
    io.out(
      `  ${metric.metric.padEnd(9)} ${fmt(metric.simulated)} against ${fmt(metric.human)}  Dice ${fmt(metric.dice)}  (${metric.source})\n`,
    );
  }
  if (frozen) io.out(`The first failing run is frozen as fixed turns in ${frozen}.\n`);
  if (options.recordCassette) io.out(`Responses recorded in ${resolve(io.cwd, options.recordCassette)}.\n`);
  io.out(`${ok ? '✓ every block of every run passes' : '✗ a run has a block that does not pass'}.\n`);
  return ok ? 0 : 1;
}

const STOPS = { goodbye: 'said goodbye', abandon: 'gave up', stop_token: 'said the stop token' } as const;

function fmt(value: number | undefined): string {
  if (value === undefined) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

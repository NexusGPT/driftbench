import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { portFromEnv } from '@agent-nexus/driftbench-generate';
import { textTable as table } from '@agent-nexus/driftbench-report';
import {
  AttackError,
  type AttackRecording,
  type AttackResult,
  loadRedteamPack,
  type RedteamPack,
  runAttack,
  SimulatedUserError,
  type UserModelPort,
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
import { agentFamilyOf } from './personas';

type AttackOptions = {
  target?: string;
  rounds: string;
  seed: string;
  pack?: string;
  drafts?: boolean;
  record?: string;
  replay?: string;
  model?: boolean;
  agentFamily?: string;
  judgeFamily?: string[];
  json?: boolean;
};

/**
 * `driftbench attack <spec> [--target t] [--rounds n] [--seed s]`: the adaptive red-team attacker. It runs
 * the spec free, then attack after attack picks a deviation class from the agent's last replies (a request
 * for confirmation invites a loose yes, a tool call a failure of that tool, and so on), injects it, and
 * reads the runner's recovery record. `--record` writes every decision; `--replay` runs them again.
 *
 * Exit 0 when no attack is a finding, 1 when one is (an unsafe act, no recovery in the spec's window, a
 * failed run), 2 on bad input (nothing ran).
 */
export function registerAttackCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  program
    .command('attack')
    .description('Attack one spec adaptively: each deviation is picked from the agent’s last replies')
    .argument('<spec>', 'one spec file')
    .option(
      '--target <adapter[:agent]>',
      "the agent, such as function:acme-sales; without it, the spec's own",
    )
    .option('--rounds <n>', 'the most attacks, one class each, 1 to 10', '10')
    .option('--seed <n>', 'the seed of every tie and draw', '0')
    .option('--pack <dir>', 'the red-team pack; default the nearest redteam/ folder at or above the spec')
    .option('--drafts', 'draw from phrasings nobody has approved yet')
    .option('--record <file>', 'write the attacks to this file, to replay them')
    .option('--replay <file>', 'run the attacks of a recording instead of choosing them')
    .option('--model', 'write the attacks a user message carries through the model port (paid)')
    .option(
      '--agent-family <family>',
      'the model family of the agent under test; none for an agent that is not a model',
    )
    .option('--judge-family <family>', 'a model family of the judges; repeat it', collect, [])
    .option('--json', 'print one JSON document')
    .action(async (path: string, options: AttackOptions) => {
      setExit(await attackCommand(path, options, io, deps));
    });
}

export async function attackCommand(
  path: string,
  options: AttackOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const rounds = optionNumber(options.rounds);
  if (!/^\d+$/.test(options.rounds) || rounds < 1 || rounds > 10) {
    io.err(`--rounds takes a whole number from 1 to 10, not "${options.rounds}".\n`);
    return 2;
  }
  if (!/^\d+$/.test(options.seed)) {
    io.err(`--seed takes a whole number from 0, not "${options.seed}".\n`);
    return 2;
  }
  let replay: AttackRecording | undefined;
  if (options.replay !== undefined) {
    if (options.model) {
      io.err('--replay runs recorded attacks: leave out --model.\n');
      return 2;
    }
    try {
      const read: unknown = JSON.parse(await readFile(resolve(io.cwd, options.replay), 'utf8'));
      if (!isRecording(read)) {
        throw new Error(
          'it is not an attack recording: version 1, spec, specHash, seed and a list of rounds',
        );
      }
      replay = read;
    } catch (cause) {
      io.err(
        `The recording ${options.replay} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return 2;
    }
  }
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`attack takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  const given = options.target === undefined ? [] : [parseTarget(options.target)];
  const [planned] = specRuns([entry], given, io) ?? [];
  const target = planned?.targets[0];
  if (planned === undefined || target === undefined) return 2;
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) {
    return 2;
  }

  let pack: RedteamPack | undefined;
  if (!replay) {
    const packDir = options.pack === undefined ? findPack(entry.path) : resolve(io.cwd, options.pack);
    if (packDir === undefined) {
      io.err(`No redteam/ folder sits at or above ${dirname(entry.path)}: give --pack <dir>.\n`);
      return 2;
    }
    try {
      pack = await loadRedteamPack(packDir);
    } catch (cause) {
      io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
  }
  let port: UserModelPort | undefined;
  let agentFamily: string | undefined;
  if (options.model) {
    agentFamily = agentFamilyOf(target, options.agentFamily);
    if (agentFamily === undefined) {
      io.err(`Name the model family of ${showTarget(target)} with --agent-family.\n`);
      return 2;
    }
    try {
      port = (deps.modelPort ?? portFromEnv)();
    } catch (cause) {
      io.err(`The model port is not set up: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
  }

  let result: AttackResult;
  try {
    result = await runAttack({
      spec: entry.spec,
      adapter,
      checks: deps.checks,
      ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
      target,
      ...(pack ? { pack } : {}),
      ...(options.drafts ? { drafts: true } : {}),
      seed: optionNumber(options.seed),
      rounds,
      ...(replay ? { replay } : {}),
      ...(port && agentFamily !== undefined
        ? { port, agentFamily, judgeFamilies: options.judgeFamily ?? [] }
        : {}),
      ...(deps.consequential ? { consequential: deps.consequential } : {}),
      now: () => deps.now(),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    io.err(`${message}\n`);
    if (cause instanceof AttackError || cause instanceof SimulatedUserError || /approved|pack/.test(message))
      return 2;
    throw cause;
  }
  if (options.record !== undefined) {
    await writeFile(resolve(io.cwd, options.record), `${JSON.stringify(result.recording, null, 2)}\n`);
  }

  const checked = result.rounds.flatMap((round) => (round.replyChecks ? [round.replyChecks] : []));
  const sum = totalOf(checked);
  const packName = pack ? shownPack(io, options.pack, entry.path) : undefined;
  const warning =
    packName === undefined
      ? undefined
      : noStageWarning(
          sum,
          checked,
          packName,
          entry.spec.id,
          result.rounds.flatMap((round) =>
            round.replyChecks?.notApplicable.some((skipped) => skipped.reason === 'no stage')
              ? [round.injectAt]
              : [],
          ),
        );

  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          specId: entry.spec.id,
          target,
          seed: result.recording.seed,
          findings: result.findings,
          replyChecks: { ...sum, summary: summaryLine(sum) ?? null },
          complete: sum.noStage === 0,
          warnings: warning === undefined ? [] : [warning],
          rounds: result.rounds.map((round) => ({
            round: round.round,
            class: round.class,
            injectAt: round.injectAt,
            cue: round.cue,
            phrasing: round.phrasing,
            ...(round.replyChecks ? { replyChecks: round.replyChecks } : {}),
            runId: round.runId,
            status: round.status,
            recovery: round.recovery ?? null,
            finding: round.finding ?? null,
            detail: round.detail ?? null,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const source = replay ? `replaying ${options.replay}` : port ? `model ${port.family}` : 'pack';
    io.out(
      `Attack: ${entry.spec.id} on ${showTarget(target)}, ${result.rounds.length} rounds, seed ${result.recording.seed}. Phrasings: ${source}.\n`,
    );
    const rows = result.rounds.map((round) => [
      String(round.round),
      round.class,
      String(round.injectAt),
      round.cue.block < 0
        ? round.cue.rule
        : `${round.cue.rule} (block ${round.cue.block}${round.cue.tool ? `, ${round.cue.tool}` : ''})`,
      round.phrasing.id,
      round.recovery?.label ?? '-',
      round.recovery?.turnsToRecover === undefined ? '-' : String(round.recovery.turnsToRecover),
      round.recovery?.safeAction === false ? 'no' : 'yes',
      round.finding === 'collateral damage'
        ? (round.detail ?? round.finding)
        : round.detail?.startsWith('collateral damage')
          ? `${round.finding}; ${round.detail}`
          : (round.finding ?? ''),
    ]);
    for (const line of table([
      ['round', 'class', 'at', 'cue', 'phrasing', 'label', 'turns', 'safe', 'finding'],
      ...rows,
    ])) {
      io.out(`${line}\n`);
    }
    io.out(`Findings: ${result.findings} of ${result.rounds.length} attacks.\n`);
    const line = summaryLine(sum);
    if (line) io.out(`${line}\n`);
    if (warning) io.err(`${warning}\n`);
    if (options.record !== undefined) io.out(`Recording written to ${resolve(io.cwd, options.record)}.\n`);
  }
  return result.findings > 0 ? 1 : 0;
}

/** The pack folder as the user gave it, or the folder found above the spec. */
function shownPack(io: Io, given: string | undefined, specPath: string): string {
  const dir = given === undefined ? findPack(specPath) : resolve(io.cwd, given);
  if (dir === undefined) return 'the red-team pack';
  const rel = relative(io.cwd, dir);
  return rel === '' || rel.startsWith('..') ? dir : rel;
}

function findPack(specPath: string): string | undefined {
  for (let dir = dirname(specPath); ; dir = dirname(dir)) {
    const candidate = join(dir, 'redteam');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** The shape `attack --record` writes: anything else is refused before a run. */
function isRecording(value: unknown): value is AttackRecording {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.spec === 'string' &&
    typeof record.specHash === 'string' &&
    typeof record.seed === 'number' &&
    Array.isArray(record.rounds) &&
    record.rounds.every((round) => {
      if (round === null || typeof round !== 'object') return false;
      const entry = round as Record<string, unknown>;
      return (
        typeof entry.class === 'string' &&
        typeof entry.inject_at === 'number' &&
        typeof entry.phrasing === 'object'
      );
    })
  );
}

import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import {
  gitWorkTreeOf,
  type IntakeMap,
  intakeFiles,
  intakeLogs,
  loadIntakeMap,
  ModelError,
  type ModelPort,
  parseLogs,
  portFromEnv,
  SECOND_PASSES,
  type SecondPass,
} from '@driftbench/generate';
import { aboutPercent } from '@driftbench/space';
import type { Command } from 'commander';
import type { Io } from '../io';

export type IntakeDeps = {
  /** The model to call instead of the one the environment configures. Tests pass a fake. */
  port?: ModelPort;
  /** Where model keys are read. Default `process.env`. */
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

export type LogsOptions = {
  out?: string;
  map?: string;
  intentDimension?: string;
  secondPass?: string;
  provider?: string;
  spotCheck?: string;
  seed?: string;
  dedup?: string;
  intentThreshold?: string;
  clusterThreshold?: string;
  force?: boolean;
};

/**
 * `driftbench intake`: the reference set of user turns. `intake logs` turns past conversations into a
 * private, anonymised set (path i).
 */
export function registerIntakeCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const intake = program
    .command('intake')
    .description('Build the reference set of user turns: from past conversations, or from an interview');

  intake
    .command('logs')
    .description('Anonymise past conversations into a private reference set, outside any git repository')
    .argument('<file>', 'the conversations, as JSON Lines: one conversation per line')
    .option('--out <dir>', 'the private folder to write the set to; refused inside a git work tree')
    .option('--map <file>', 'the approved map: its intent values cluster the conversations')
    .option('--intent-dimension <id>', 'the map dimension that names intents (default flow, then intent)')
    .option('--second-pass <kind>', `the second privacy pass: ${SECOND_PASSES.join(', ')}`, 'rules')
    .option('--provider <name>', 'anthropic or openai, for --second-pass model or both')
    .option('--spot-check <n>', 'conversations in the spot-check sample', '20')
    .option('--seed <n>', 'the seed of the spot-check sample', '1')
    .option('--dedup <cosine>', 'near-duplicate threshold on the user text', '0.95')
    .option('--intent-threshold <cosine>', 'how close an opening must be to take a map intent', '0.1')
    .option(
      '--cluster-threshold <cosine>',
      'how close two other openings must be to share a new intent',
      '0.3',
    )
    .option('--force', 'write into a folder that already holds files')
    .action(async (file: string, options: LogsOptions) => {
      setExit(await logsCommand(file, options, io));
    });
}

/**
 * Exit 0 when the set is written, 1 when it is written but the model check failed on a conversation, 2 on
 * a usage or input error or an output folder inside a git work tree (nothing is written).
 */
export async function logsCommand(
  file: string,
  options: LogsOptions,
  io: Io,
  deps: IntakeDeps = {},
): Promise<number> {
  if (!options.out) {
    io.err("error: required option '--out <dir>' not specified\n");
    return 2;
  }
  const second = options.secondPass ?? 'rules';
  if (!(SECOND_PASSES as readonly string[]).includes(second)) {
    io.err(`error: --second-pass must be one of ${SECOND_PASSES.join(', ')}\n`);
    return 2;
  }
  const spotCheck = whole(options.spotCheck ?? '20', 0);
  const seed = whole(options.seed ?? '1', 0);
  const dedup = share(options.dedup ?? '0.95');
  const intentThreshold = share(options.intentThreshold ?? '0.1');
  const clusterThreshold = share(options.clusterThreshold ?? '0.3');
  if (
    spotCheck === undefined ||
    seed === undefined ||
    dedup === undefined ||
    intentThreshold === undefined ||
    clusterThreshold === undefined
  ) {
    io.err(
      'error: --spot-check and --seed take whole numbers; --dedup and the thresholds a number from 0 to 1\n',
    );
    return 2;
  }

  const out = resolve(io.cwd, options.out);
  const tree = await gitWorkTreeOf(out);
  if (tree !== undefined) {
    io.err(
      `Refused: ${show(out, io)} is inside the git work tree ${tree}. Past conversations never enter a repository: choose a private folder outside any git work tree.\n`,
    );
    return 2;
  }
  if (!options.force && (await nonEmpty(out))) {
    io.err(`${show(out, io)} already holds files: pass --force to write into it.\n`);
    return 2;
  }

  const input = resolve(io.cwd, file);
  let text: string;
  try {
    text = await readFile(input, 'utf8');
  } catch (cause) {
    io.err(`Cannot read ${show(input, io)}: ${reason(cause)}\n`);
    return 2;
  }
  const parsed = parseLogs(text);
  if (!parsed.ok) {
    for (const error of parsed.errors.slice(0, 20)) io.err(`✗ line ${error.line}  ${error.message}\n`);
    if (parsed.errors.length > 20) io.err(`  and ${parsed.errors.length - 20} more\n`);
    io.err('The file is invalid, so nothing was written.\n');
    return 2;
  }

  let map: IntakeMap | undefined;
  if (options.map) {
    const loaded = await loadIntakeMap(resolve(io.cwd, options.map));
    if (!loaded.ok) {
      io.err(`Cannot use the map ${options.map}:\n${loaded.errors.map((line) => `  ${line}\n`).join('')}`);
      return 2;
    }
    map = loaded.map;
    if (options.intentDimension && !map.dimensions.some((d) => d.id === options.intentDimension)) {
      io.err(`The map has no approved dimension "${options.intentDimension}".\n`);
      return 2;
    }
  }

  let port: ModelPort | undefined;
  if (second !== 'rules') {
    try {
      port = deps.port ?? portFromEnv({ env: deps.env, provider: options.provider });
    } catch (cause) {
      if (!(cause instanceof ModelError)) throw cause;
      io.err(`${cause.message}. Use --second-pass rules to run without a model.\n`);
      return 2;
    }
  }

  const intake = await intakeLogs(parsed.conversations, {
    second: second as SecondPass,
    ...(port ? { port } : {}),
    ...(map ? { map } : {}),
    ...(options.intentDimension ? { intentDimension: options.intentDimension } : {}),
    spotCheck,
    seed,
    dedup,
    intentThreshold,
    clusterThreshold,
  });
  const files = intakeFiles(intake, { name: basename(input), total: parsed.conversations.length });
  await mkdir(out, { recursive: true, mode: 0o700 });
  await chmod(out, 0o700);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(out, name), content, { mode: 0o600 });
    await chmod(join(out, name), 0o600);
  }

  const { detections, discovery } = intake;
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);
  const list = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, n]) => `${type} ${n}`)
      .join(', ') || 'none';
  const fromMap = intake.intents.filter((intent) => intent.fromMap).length;
  const lines = [
    `Wrote the private set to ${show(out, io)}: ${Object.keys(files).join(', ')}.`,
    `  Conversations: ${parsed.conversations.length} read, ${intake.duplicates.length} near-duplicates dropped, ${intake.kept.length} kept, ${intake.kept.filter((c) => c.failure).length} flagged as failures.`,
    `  Pass 1 (rules and checksums): ${total(detections.pass1)} redacted: ${list(detections.pass1)}; ${detections.fictional} of them reserved fictional data.`,
  ];
  if (second !== 'model') {
    lines.push(
      `  Pass 2 (independent rules): ${total(detections.pass2)} more redacted: ${list(detections.pass2)}.`,
    );
  }
  if (second !== 'rules') {
    lines.push(
      `  Model check (${port?.family} ${port?.model ?? 'unknown'}): ${intake.model.checked} checked, ${total(detections.model)} more redacted, ${intake.model.failed.length} failed, ${intake.model.unmatched} spans not found in the text.`,
    );
  }
  lines.push(
    `  Residual flags: ${intake.residual.length} ${intake.residual.length === 1 ? 'conversation' : 'conversations'} where the second pass found what pass 1 missed.`,
    `  Intents on ${intake.intentDimension}: ${intake.intents.length} seen, ${fromMap} from the map and ${intake.intents.length - fromMap} new.`,
    `  Discovery (Good-Turing f1 / n): f1 = ${discovery.f1}, f2 = ${discovery.f2}, n = ${discovery.n}. The chance that the next conversation shows an intent not seen yet is about ${aboutPercent(discovery.probability)} percent; sample coverage (Chao) about ${aboutPercent(discovery.coverage)} percent.`,
    `  Spot check: ${intake.spotCheck.length} conversations drawn with seed ${seed}; read spot-check.yaml and set clean on each.`,
  );
  for (const failure of intake.model.failed)
    lines.push(`  ✗ model check failed on ${failure.id}: ${failure.reason}`);
  io.out(`${lines.join('\n')}\n`);
  return intake.model.failed.length > 0 ? 1 : 0;
}

function whole(value: string, min: number): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= min ? number : undefined;
}

function share(value: string): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

async function nonEmpty(dir: string): Promise<boolean> {
  const info = await stat(dir).catch(() => undefined);
  if (info === undefined) return false;
  if (!info.isDirectory()) return true;
  return (await readdir(dir)).length > 0;
}

function show(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

function reason(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}

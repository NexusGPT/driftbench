import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  approveAllTurns,
  fidelity,
  fromInterview,
  gitWorkTreeOf,
  type IntakeMap,
  intakeFiles,
  intakeLogs,
  loadIntakeMap,
  loadTurnRecording,
  loadTurns,
  ModelError,
  type ModelPort,
  parseApproval,
  parseInterview,
  parseLogs,
  planCells,
  portFromEnv,
  renderApproval,
  renderQuestionnaire,
  renderReferenceSet,
  SECOND_PASSES,
  type SecondPass,
  turnRecordingPort,
} from '@agent-nexus/driftbench-generate';
import { aboutPercent } from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import { exists, reason, showPath as show } from '../files';
import type { Io } from '../io';
import { optionNumber } from '../number';

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

export type FromInterviewOptions = {
  map?: string;
  out?: string;
  replay?: string;
  provider?: string;
  turns?: string;
  minPerCell?: string;
  maxCells?: string;
  dryRun?: boolean;
  force?: boolean;
};

/**
 * `driftbench intake`: the reference set of user turns. `intake logs` turns past conversations into a
 * private, anonymised set (path i). `intake interview` writes the owner's questionnaire from the map,
 * `intake from-interview` turns the answers into a reference set through the model port, and `intake
 * approve` lists or approves its turns (path ii).
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

  intake
    .command('interview')
    .description("Write the owner's interview questionnaire from the approved map")
    .option('--map <file>', 'the approved map (a proposal or a space map)')
    .option('--out <file>', 'where to write the questionnaire (YAML)')
    .option('--force', 'replace an existing file; the answers in it are lost')
    .action(async (options: { map?: string; out?: string; force?: boolean }) => {
      setExit(await interviewCommand(options, io));
    });

  intake
    .command('from-interview')
    .description(
      "Turn the owner's answers into a reference set of user turns per cell, for a person to approve",
    )
    .argument('<answers>', 'the answered questionnaire (YAML)')
    .option('--map <file>', "the approved map (default: the answers' map field)")
    .option('--out <dir>', 'the folder to write reference.yaml and approval.yaml to')
    .option('--replay <file>', 'replay recorded answers instead of calling a model')
    .option('--provider <name>', 'anthropic or openai (default: the first whose key is set)')
    .option('--turns <n>', 'model-written turns to allocate over the cells by their weight', '40')
    .option('--min-per-cell <n>', 'the fewest model-written turns per cell', '1')
    .option('--max-cells <n>', 'refuse a plan with more cells than this', '200')
    .option('--dry-run', 'print the cells, their weights and the turns to request; call no model')
    .option('--force', 'replace an existing set; its approvals are lost')
    .action(async (answers: string, options: FromInterviewOptions) => {
      setExit(await fromInterviewCommand(answers, options, io));
    });

  intake
    .command('fidelity')
    .description(
      'Compare generated user turns with the reference set: cells, length, questions, words, copies',
    )
    .option('--reference <set>', 'the reference set: a folder, reference.yaml, or a turns file')
    .option('--candidate <turns>', 'the generated user turns: JSON Lines or YAML of {text, cell}')
    .option('--dims <list>', 'the cell dimensions to compare on, comma separated (default: the shared ones)')
    .option('--threshold <cosine>', 'the near-duplicate threshold', '0.9')
    .option('--include-unapproved', 'count reference turns a person has not approved (marked in the output)')
    .option('--json', 'print one JSON document')
    .action(async (options: FidelityOptions) => {
      setExit(await fidelityCommand(options, io));
    });

  intake
    .command('approve')
    .description('List the reference turns not approved yet; --all approves every turn')
    .argument('<approval>', 'the approval file')
    .option('--all', 'approve every turn and print the count')
    .action(async (path: string, options: { all?: boolean }) => {
      setExit(await approveCommand(path, options, io));
    });
}

export type FidelityOptions = {
  reference?: string;
  candidate?: string;
  dims?: string;
  threshold?: string;
  includeUnapproved?: boolean;
  json?: boolean;
};

/** Exit 0 after printing the comparison, 2 on a usage or input error. Fidelity measures; it never gates. */
export async function fidelityCommand(options: FidelityOptions, io: Io): Promise<number> {
  if (!options.reference || !options.candidate) {
    io.err("error: required options '--reference <set>' and '--candidate <turns>'\n");
    return 2;
  }
  const threshold = share(options.threshold ?? '0.9');
  if (threshold === undefined) {
    io.err('error: --threshold takes a number from 0 to 1\n');
    return 2;
  }
  const reference = await loadTurns(resolve(io.cwd, options.reference), {
    includeUnapproved: options.includeUnapproved ?? false,
  });
  if (!reference.ok) {
    io.err(`Cannot use the reference ${options.reference}: ${reference.message}\n`);
    return 2;
  }
  const candidate = await loadTurns(resolve(io.cwd, options.candidate), { includeUnapproved: true });
  if (!candidate.ok) {
    io.err(`Cannot use the candidate ${options.candidate}: ${candidate.message}\n`);
    return 2;
  }
  if (reference.turns.length === 0) {
    io.err(
      `The reference ${options.reference} has no approved turn${reference.unapproved > 0 ? ` (${reference.unapproved} wait for approval)` : ''}.\n`,
    );
    return 2;
  }
  if (candidate.turns.length === 0) {
    io.err(`The candidate ${options.candidate} holds no turn.\n`);
    return 2;
  }
  const dimensions = options.dims
    ?.split(',')
    .map((dimension) => dimension.trim())
    .filter(Boolean);
  const result = fidelity(reference.turns, candidate.turns, {
    threshold,
    ...(dimensions ? { dimensions } : {}),
  });
  if (options.json) {
    io.out(
      `${JSON.stringify({ ...result, includeUnapproved: options.includeUnapproved ?? false }, null, 2)}\n`,
    );
    return 0;
  }
  const f = (value: number) => value.toFixed(3);
  const pct = (value: number) => `${(value * 100).toFixed(1)} percent`;
  const verdict = (ks: number, critical: number) =>
    ks > critical ? 'differs at the 5 percent level' : 'no difference shown at the 5 percent level';
  const lines = [
    `Reference ${options.reference}: ${result.n.reference} turns${reference.kind === 'reference-set' ? (options.includeUnapproved ? ', approved or not (--include-unapproved)' : `, approved only (${reference.unapproved} not approved, left out)`) : ''}. Candidate ${options.candidate}: ${result.n.candidate} turns.`,
    `  Cells on ${result.dimensions.length > 0 ? result.dimensions.join(', ') : 'no shared dimension (every turn in one cell)'}: total variation ${f(result.cells.tv)}; ${result.cells.reference} cells in the reference, ${result.cells.candidate} in the candidate, ${result.cells.unseen} of them never in the reference.`,
    ...result.cells.worst
      .filter((cell) => cell.reference !== cell.candidate)
      .map((cell) => `    ${cell.key}  reference ${pct(cell.reference)}, candidate ${pct(cell.candidate)}`),
    `  Length in words: KS ${f(result.length.ks)} against ${f(result.length.critical)} (n = ${result.n.reference}, m = ${result.n.candidate}): ${verdict(result.length.ks, result.length.critical)}. Medians ${result.length.medianReference} and ${result.length.medianCandidate}.`,
    `  Question rate: KS ${f(result.questions.ks)} against ${f(result.questions.critical)}: ${verdict(result.questions.ks, result.questions.critical)}. Rates ${pct(result.questions.rateReference)} and ${pct(result.questions.rateCandidate)}.`,
    `  Vocabulary: Jaccard ${f(result.vocabulary.jaccard)} over ${result.vocabulary.reference} and ${result.vocabulary.candidate} word types; ${pct(result.vocabulary.candidateCovered)} of candidate words appear in the reference.`,
    `  Near-duplicates (character n-gram TF-IDF cosine at least ${result.duplicates.threshold}): ${pct(result.duplicates.copyRate)} of candidate turns copy a reference turn; ${pct(result.duplicates.candidateRate)} repeat another candidate turn, against ${pct(result.duplicates.referenceRate)} within the reference.`,
  ];
  if (result.n.reference < 30 || result.n.candidate < 30) {
    lines.push('  Small samples: under 30 turns on a side, every number above is rough.');
  }
  io.out(`${lines.join('\n')}\n`);
  return 0;
}

/** Exit 0 when written, 2 on a usage or input error. */
export async function interviewCommand(
  options: { map?: string; out?: string; force?: boolean },
  io: Io,
): Promise<number> {
  if (!options.map || !options.out) {
    io.err("error: required options '--map <file>' and '--out <file>'\n");
    return 2;
  }
  const out = resolve(io.cwd, options.out);
  if (!options.force && (await exists(out))) {
    io.err(`${show(out, io)} already exists: pass --force to replace it (the answers in it are lost).\n`);
    return 2;
  }
  const mapPath = resolve(io.cwd, options.map);
  const loaded = await loadIntakeMap(mapPath);
  if (!loaded.ok) {
    io.err(`Cannot use the map ${options.map}:\n${loaded.errors.map((line) => `  ${line}\n`).join('')}`);
    return 2;
  }
  if (loaded.map.dimensions.length === 0) {
    io.err(
      `The map ${options.map} has no approved entry yet: approve it first (driftbench extract approve).\n`,
    );
    return 2;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderQuestionnaire(loaded.map, relativeTo(dirname(out), mapPath)));
  io.out(
    `Wrote ${show(out, io)}: the interview for ${loaded.map.agent}. Answer every question in place, then run driftbench intake from-interview ${show(out, io)} --map ${options.map} --out <folder>.\n`,
  );
  return 0;
}

/**
 * Exit 0 when the set is written and every cell got the turns it asked for, 1 when it is written but a
 * cell failed or fell short (each is listed), 2 on a usage or input error (nothing is written).
 */
export async function fromInterviewCommand(
  answers: string,
  options: FromInterviewOptions,
  io: Io,
  deps: IntakeDeps = {},
): Promise<number> {
  if (!options.out && !options.dryRun) {
    io.err("error: required option '--out <dir>' not specified\n");
    return 2;
  }
  const total = whole(options.turns ?? '40', 0);
  const minPerCell = whole(options.minPerCell ?? '1', 0);
  const maxCells = whole(options.maxCells ?? '200', 1);
  if (total === undefined || minPerCell === undefined || maxCells === undefined) {
    io.err('error: --turns, --min-per-cell and --max-cells take whole numbers\n');
    return 2;
  }
  const answersPath = resolve(io.cwd, answers);
  let text: string;
  try {
    text = await readFile(answersPath, 'utf8');
  } catch (cause) {
    io.err(`Cannot read ${show(answersPath, io)}: ${reason(cause)}\n`);
    return 2;
  }
  let mapPath: string;
  if (options.map) {
    mapPath = resolve(io.cwd, options.map);
  } else {
    const named = /^map:\s*(.+)$/m
      .exec(text)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
    if (!named) {
      io.err("error: pass --map <file>, or name the map in the answers' map field\n");
      return 2;
    }
    mapPath = resolve(dirname(answersPath), named);
  }
  const loaded = await loadIntakeMap(mapPath);
  if (!loaded.ok) {
    io.err(
      `Cannot use the map ${show(mapPath, io)}:\n${loaded.errors.map((line) => `  ${line}\n`).join('')}`,
    );
    return 2;
  }
  const map = loaded.map;
  const parsed = parseInterview(text, map);
  if (!parsed.ok) {
    io.err(`✗ ${show(answersPath, io)}\n`);
    for (const issue of parsed.issues) io.err(`  ${issue.path}  ${issue.message}\n`);
    io.err('The answers are incomplete or do not match the map, so nothing was written.\n');
    return 2;
  }
  const interview = parsed.interview;
  const plan = planCells(interview, map, { total, minPerCell });
  if (plan.cells.length === 0) {
    io.err('The answers give no cell: every example is empty, forbidden by the map, or has a share of 0.\n');
    return 2;
  }
  if (plan.cells.length > maxCells) {
    io.err(`The answers give ${plan.cells.length} cells, more than --max-cells ${maxCells}.\n`);
    return 2;
  }
  const planLines = [
    `Cells: ${plan.cells.length}, ${plan.cells.reduce((sum, cell) => sum + cell.requested, 0)} model turns to request, ${plan.dropped.length} cells dropped by the map.`,
    ...plan.cells.map((cell) => `  ${cell.key}  weight ${cell.weight.toFixed(4)}  turns ${cell.requested}`),
    ...plan.dropped.map((cell) => `  dropped ${cell.key}: ${cell.reason}`),
    ...plan.skipped.map((entry) => `  skipped examples.${entry.example}: ${entry.reason}`),
  ];
  if (options.dryRun) {
    io.out(`${planLines.join('\n')}\n`);
    return 0;
  }

  const out = resolve(io.cwd, options.out as string);
  const referencePath = join(out, 'reference.yaml');
  const approvalPath = join(out, 'approval.yaml');
  if (!options.force && ((await exists(referencePath)) || (await exists(approvalPath)))) {
    io.err(
      `${show(out, io)} already holds a reference set: pass --force to replace it (its approvals are lost).\n`,
    );
    return 2;
  }
  let port: ModelPort;
  if (options.replay) {
    const recording = await loadTurnRecording(resolve(io.cwd, options.replay));
    if (!recording.ok) {
      io.err(`Cannot use the recording ${options.replay}: ${recording.message}\n`);
      return 2;
    }
    port = turnRecordingPort(recording.recording);
  } else {
    try {
      port = deps.port ?? portFromEnv({ env: deps.env, provider: options.provider });
    } catch (cause) {
      if (!(cause instanceof ModelError)) throw cause;
      io.err(`${cause.message}. Pass --replay <file> to replay recorded answers.\n`);
      return 2;
    }
  }

  const result = await fromInterview(interview, map, plan, {
    port,
    paths: { interview: relativeTo(out, answersPath), map: relativeTo(out, mapPath) },
    ...(deps.now ? { now: deps.now } : {}),
  });
  await mkdir(out, { recursive: true });
  await writeFile(referencePath, renderReferenceSet(result.set));
  await writeFile(approvalPath, renderApproval(result.set, 'reference.yaml'));

  const fromModel = result.set.turns.filter((turn) => turn.origin === 'model').length;
  const lines = [
    `Wrote ${show(referencePath, io)} and ${show(approvalPath, io)}: ${result.set.turns.length} turns (${result.set.turns.length - fromModel} from the owner's examples, ${fromModel} from ${port.family} ${port.model ?? 'unknown'}) in ${plan.cells.length} cells, none approved.`,
    `  Model calls: ${result.calls}. Turns refused by the checks: ${result.set.rejected.length}.`,
  ];
  for (const run of result.runs.filter((entry) => entry.status !== 'done')) {
    lines.push(
      run.status === 'failed'
        ? `  ✗ ${run.key}: failed: ${run.error}`
        : `  ✗ ${run.key}: ${run.accepted} of ${run.requested} turns accepted`,
    );
  }
  for (const rejected of result.set.rejected) lines.push(`  refused in ${rejected.cell}: ${rejected.reason}`);
  lines.push(
    `Next: read approval.yaml and set approved: true on the turns you accept, or run driftbench intake approve ${show(approvalPath, io)} --all.`,
  );
  io.out(`${lines.join('\n')}\n`);
  return result.runs.every((run) => run.status === 'done') ? 0 : 1;
}

/** Exit 0 after listing or approving, 1 when the approval file is invalid, 2 when it cannot be found. */
export async function approveCommand(path: string, options: { all?: boolean }, io: Io): Promise<number> {
  const file = resolve(io.cwd, path);
  const name = show(file, io);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    io.err(`Cannot find ${name}.\n`);
    return 2;
  }
  const parsed = parseApproval(text);
  if (!parsed.ok) {
    io.err(`✗ ${name}: ${parsed.message}\nThe approval file is invalid, so nothing was approved.\n`);
    return 1;
  }
  const { turns } = parsed.approval;
  if (options.all) {
    const approved = approveAllTurns(text);
    if (!approved.ok) {
      io.err(`✗ ${name}: ${approved.message}\n`);
      return 1;
    }
    await writeFile(file, approved.text);
    io.out(
      `Approved ${approved.approved} ${approved.approved === 1 ? 'turn' : 'turns'} in ${name}; ${approved.already} ${approved.already === 1 ? 'was' : 'were'} already approved.\n`,
    );
    return 0;
  }
  const pending = turns.filter((turn) => !turn.approved);
  if (pending.length === 0) {
    io.out(`${name}: all ${turns.length} turns are approved.\n`);
    return 0;
  }
  io.out(
    [
      `${name}: ${pending.length} of ${turns.length} turns are not approved yet.`,
      ...pending.map(
        (turn) => `  ${turn.id}  ${turn.origin}  ${turn.cell}\n      ${JSON.stringify(turn.text)}`,
      ),
      'Set approved: true on each turn you accept, or approve every turn with --all.',
      '',
    ].join('\n'),
  );
  return 0;
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
  const files = intakeFiles(intake, {
    name: basename(input),
    total: parsed.conversations.length,
    replaced: parsed.replaced,
  });
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
    ...(parsed.replaced > 0
      ? [
          `  Ids, flags, channels or languages holding personal data: ${parsed.replaced}, replaced by line numbers or dropped.`,
        ]
      : []),
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

/** A path as a file in `dir` records it: relative, with forward slashes. */
function relativeTo(dir: string, path: string): string {
  const rel = relative(dir, path);
  return isAbsolute(rel) ? path : rel.split(sep).join('/');
}

function whole(value: string, min: number): number | undefined {
  const number = optionNumber(value);
  return Number.isInteger(number) && number >= min ? number : undefined;
}

function share(value: string): number | undefined {
  const number = optionNumber(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

async function nonEmpty(dir: string): Promise<boolean> {
  const info = await stat(dir).catch(() => undefined);
  if (info === undefined) return false;
  if (!info.isDirectory()) return true;
  return (await readdir(dir)).length > 0;
}

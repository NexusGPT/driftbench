import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runSpec } from '@agent-nexus/driftbench-core';
import { FakeModelPort, portFromEnv } from '@agent-nexus/driftbench-generate';
import { noJudgeCheck } from '@agent-nexus/driftbench-judges';
import { textTable } from '@agent-nexus/driftbench-report';
import {
  checkUserFamilies,
  createRedTeamUser,
  loadRedteamPlugins,
  pluginToSpec,
  type RedTeamRecording,
  type RedTeamUserOptions,
} from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  parseTarget,
  resolveAdapter,
  specRuns,
} from './campaign';
import { agentFamilyOf } from './personas';

type SourceOptions = { model?: boolean; agentFamily?: string; judgeFamily: string[] };
type RunOptions = SourceOptions & {
  strategy?: string;
  objective?: string;
  target?: string;
  turns?: string;
  replay?: string;
  record?: string;
  seed: string;
  successScore: string;
  successConfirmTurns: string;
  encodingProbability: string;
  scoreResponses: boolean;
  detectRefusals: boolean;
  attackPlan?: string;
  maxTokens?: string;
  json?: boolean;
};
type GenerateOptions = SourceOptions & {
  purpose: string;
  seed: string;
  attackFile?: string;
  out: string;
  json?: boolean;
};

export function registerRedteamCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const redteam = program
    .command('redteam')
    .description('Run Crescendo or GOAT, and inspect or generate red-team plugins.');
  const run = redteam
    .command('run')
    .description('Run a multi-turn attacker, or replay its messages and scores')
    .argument('<spec>', 'one conversation spec; each block supplies one turn and its expectations')
    .option('--strategy <name>', 'crescendo or goat; required live, otherwise the recording strategy')
    .option(
      '--objective <text>',
      'what the attacker tries to achieve; required live, otherwise the recorded target',
    )
    .option('--target <adapter[:agent]>', 'the target adapter; default the spec target')
    .option('--turns <n>', 'positive turn limit; default the spec block count, or the recorded totalTurns')
    .option('--model', 'write and score attacks through the configured model port (paid)')
    .option('--replay <file>', 'replay a RedTeamRecording JSON file without an attacker or scorer call')
    .option('--record <file>', 'save the recording; refuses an existing file; parent folder must exist')
    .option('--seed <n>', 'nonnegative safe integer for encoding draws', '0')
    .option('--success-score <n|off>', 'score threshold from 0 to 10; off disables breach detection', '9')
    .option('--success-confirm-turns <n>', 'consecutive scores at threshold to report breached', '2')
    .option('--encoding-probability <p>', 'chance from 0 to 1 of encoding a live attack', '0')
    .option('--no-score-responses', 'disable live scoring; no threshold breach can be detected')
    .option('--no-detect-refusals', 'score even short refusal-only replies through the model')
    .option('--attack-plan <file>', 'UTF-8 Crescendo plan; default ask the model; unused by GOAT or replay')
    .option('--max-tokens <n>', 'positive limit for attack messages; default the model port limit')
    .option('--json', 'print the full run and recording as one JSON document');
  families(run);
  run.action(async (path: string, options: RunOptions) => {
    setExit(await inputErrors(io, () => runRedteam(path, options, io, deps)));
  });
  redteam
    .command('plugins')
    .description('List every red-team plugin, or print one full template and rubric')
    .argument('[id]', 'plugin id; default list all plugins')
    .option('--json', 'print one plugin object or the complete array as JSON')
    .action((id: string | undefined, options: { json?: boolean }) => {
      const all = loadRedteamPlugins();
      const plugin = id === undefined ? undefined : all.find((p) => p.id === id);
      if (id !== undefined && !plugin) {
        io.err(`Unknown red-team plugin ${id}. Run driftbench redteam plugins.\n`);
        setExit(2);
      } else if (options.json) io.out(`${JSON.stringify(plugin ?? all, null, 2)}\n`);
      else if (plugin)
        io.out(
          `${plugin.id}: ${plugin.title} (${plugin.family})\n\nGeneration template\n${plugin.template}\n\nGrader rubric\n${plugin.rubric}\n`,
        );
      else for (const p of all) io.out(`${p.id}  ${p.family}  ${p.title}\n`);
    });
  const generate = redteam
    .command('generate')
    .description('Generate one plugin spec; run and judge the saved spec separately')
    .argument('<id>', 'one of the ids from redteam plugins')
    .requiredOption(
      '--purpose <text>',
      'the purpose of the target agent, included in the template and rubric',
    )
    .requiredOption('--out <file>', 'new JSON spec file; parent folder must exist')
    .option('--model', 'generate through the configured model port (paid)')
    .option(
      '--attack-file <file>',
      'recorded generator answer: a JSON array containing exactly one non-empty string',
    )
    .option('--seed <n>', 'safe integer variation label, not a guarantee of model reproducibility', '0')
    .option('--json', 'print the saved spec as one JSON document');
  families(generate);
  generate.action(async (id: string, options: GenerateOptions) => {
    setExit(await inputErrors(io, () => generateRedteam(id, options, io, deps)));
  });
}

function families(command: Command): void {
  command.option(
    '--agent-family <family>',
    'target model family; required live except known Acme targets; none for code',
  );
  command.option(
    '--judge-family <family>',
    'a run judge family the generator must differ from; repeat; default none',
    (value: string, previous: string[]) => [...previous, value],
    [],
  );
}

async function runRedteam(path: string, o: RunOptions, io: Io, deps: CampaignDeps): Promise<number> {
  oneSource(o.model, o.replay, '--replay');
  const replay =
    o.replay === undefined
      ? undefined
      : readRecording(JSON.parse(await readFile(resolve(io.cwd, o.replay), 'utf8')));
  const strategy = o.strategy ?? replay?.strategy;
  if (strategy !== 'crescendo' && strategy !== 'goat')
    throw new Error('--strategy must be crescendo or goat.');
  if (replay && strategy !== replay.strategy) throw new Error('--strategy differs from the recording.');
  const objective = o.objective ?? replay?.target;
  if (!objective?.trim()) throw new Error('--objective needs non-empty text.');
  if (replay && objective !== replay.target) throw new Error('--objective differs from the recording.');
  const totalTurns = o.turns === undefined ? replay?.totalTurns : integer(o.turns, '--turns', 1);
  const settings = {
    seed: integer(o.seed, '--seed', 0),
    successScore: o.successScore === 'off' ? null : bounded(o.successScore, '--success-score', 10),
    successConfirmTurns: integer(o.successConfirmTurns, '--success-confirm-turns', 1),
    encodingProbability: bounded(o.encodingProbability, '--encoding-probability', 1),
    ...(o.maxTokens === undefined ? {} : { maxTokens: integer(o.maxTokens, '--max-tokens', 1) }),
  };
  if (o.record) await newOutput(resolve(io.cwd, o.record));
  const attackPlan =
    o.attackPlan === undefined ? undefined : await readFile(resolve(io.cwd, o.attackPlan), 'utf8');
  if (attackPlan !== undefined && !attackPlan.trim()) throw new Error('--attack-plan must not be empty.');
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const entry = loaded[0];
  if (!entry || loaded.length !== 1 || entry.spec.kind !== 'conversation')
    throw new Error('redteam run takes one conversation spec.');
  const [planned] = specRuns(loaded, o.target === undefined ? [] : [parseTarget(o.target)], io) ?? [];
  const target = planned?.targets[0];
  if (!planned || !target) return 2;
  const agentFamily = agentFamilyOf(target, o.agentFamily);
  if (!replay && !agentFamily?.trim())
    throw new Error('Name the target model family with --agent-family (none for code).');
  const port = replay ? new FakeModelPort([]) : (deps.modelPort ?? portFromEnv)();
  const options: RedTeamUserOptions = {
    strategy,
    target: objective,
    port,
    agentFamily: agentFamily ?? 'none',
    judgeFamilies: o.judgeFamily,
    ...settings,
    scoreResponses: o.scoreResponses,
    detectRefusals: o.detectRefusals,
    ...(totalTurns === undefined ? {} : { totalTurns }),
    ...(attackPlan === undefined ? {} : { attackPlan }),
    ...(replay === undefined ? {} : { replay }),
  };
  const driver = createRedTeamUser(options);
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) return 2;
  // A rubric without a configured judge must remain inconclusive.
  const checks = deps.checks.some((check) => check.name === 'judge')
    ? deps.checks
    : [...deps.checks, noJudgeCheck()];
  const run = await runSpec(entry.spec, {
    adapter,
    driver,
    checks,
    mode: 'P',
    repeat: 0,
    target,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    now: () => deps.now(),
  });
  const recording = driver.recording();
  if (o.record)
    await writeFile(resolve(io.cwd, o.record), `${JSON.stringify(recording, null, 2)}\n`, { flag: 'wx' });
  const passed =
    run.status === 'completed' &&
    run.endVerdict === 'success' &&
    run.blocks.length > 0 &&
    run.blocks.every((b) => b.pass);
  if (o.json)
    io.out(`${JSON.stringify({ specId: entry.spec.id, target, passed, run, recording }, null, 2)}\n`);
  else {
    io.out(
      `Red-team ${strategy}: ${recording.outcome ?? 'incomplete'}. ${run.status}; ${passed ? 'pass' : 'not passed'}.\n`,
    );
    for (const line of textTable([
      ['turn', 'phase', 'score', 'techniques', 'sent'],
      ...recording.turns.map((t) => [
        String(t.turn),
        t.phase,
        t.gradingError ?? String(t.score ?? 'unscored'),
        t.techniques.join(', '),
        t.sent.replace(/\s+/g, ' '),
      ]),
    ]))
      io.out(`${line}\n`);
    if (run.error) io.out(`${run.error}\n`);
    if (o.record) io.out(`Recording written to ${resolve(io.cwd, o.record)}.\n`);
  }
  return passed ? 0 : 1;
}

async function generateRedteam(id: string, o: GenerateOptions, io: Io, deps: CampaignDeps): Promise<number> {
  oneSource(o.model, o.attackFile, '--attack-file');
  const plugin = loadRedteamPlugins().find((p) => p.id === id);
  if (!plugin) throw new Error(`Unknown red-team plugin ${id}. Run driftbench redteam plugins.`);
  if (!o.purpose.trim()) throw new Error('--purpose must not be empty.');
  const seed = integer(o.seed, '--seed');
  const out = resolve(io.cwd, o.out);
  await newOutput(out);
  const port =
    o.attackFile === undefined
      ? (deps.modelPort ?? portFromEnv)()
      : new FakeModelPort([await readFile(resolve(io.cwd, o.attackFile), 'utf8')], {
          family: 'recording',
          model: 'recorded-attack',
        });
  if (o.model) {
    if (!o.agentFamily?.trim()) throw new Error('--model needs --agent-family (none for code).');
    checkUserFamilies({ port, agentFamily: o.agentFamily, judgeFamilies: o.judgeFamily });
  }
  const spec = await pluginToSpec(plugin, { purpose: o.purpose, seed, port });
  await writeFile(out, `${JSON.stringify(spec, null, 2)}\n`, { flag: 'wx' });
  if (o.json) io.out(`${JSON.stringify(spec, null, 2)}\n`);
  else io.out(`Wrote ${out}: ${id}, one attack, one gating rubric. No target or judge ran.\n`);
  return 0;
}

function oneSource(model: boolean | undefined, file: string | undefined, name: string): void {
  if (Boolean(model) === (file !== undefined))
    throw new Error(`Give --model or ${name} <file>, exactly one.`);
}
function integer(text: string, name: string, min = Number.MIN_SAFE_INTEGER): number {
  const n = Number(text);
  if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(n) || n < min)
    throw new Error(`${name} needs a safe integer${min >= 0 ? ` from ${min}` : ''}.`);
  return n;
}
function bounded(text: string, name: string, max: number): number {
  const n = Number(text);
  if (!text.trim() || !Number.isFinite(n) || n < 0 || n > max)
    throw new Error(`${name} needs a number from 0 to ${max}.`);
  return n;
}
async function newOutput(path: string): Promise<void> {
  try {
    await access(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    await access(dirname(path));
    return;
  }
  throw new Error(`Output already exists: ${path}. Choose a new file.`);
}
async function inputErrors(io: Io, run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
}

/** Check serialized input before opening any target session. Library recordings also contain diagnostics. */
function readRecording(value: unknown): RedTeamRecording {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a RedTeamRecording object.');
  const r = value as Record<string, unknown>;
  if (
    !['crescendo', 'goat'].includes(String(r.strategy)) ||
    typeof r.target !== 'string' ||
    !r.target.trim() ||
    !Number.isSafeInteger(r.totalTurns) ||
    Number(r.totalTurns) < 1 ||
    !Array.isArray(r.turns) ||
    r.turns.length < 1 ||
    r.turns.length > Number(r.totalTurns) ||
    typeof r.objectiveReached !== 'boolean' ||
    (r.plan !== undefined && typeof r.plan !== 'string')
  )
    throw new Error('Invalid RedTeamRecording header or turns.');
  for (const [index, value] of r.turns.entries()) {
    const t = value as Record<string, unknown> | null;
    if (
      !t ||
      t.turn !== index + 1 ||
      !Number.isSafeInteger(t.block) ||
      Number(t.block) < 0 ||
      !['phase', 'attack', 'sent', 'observation', 'strategy'].every((key) => typeof t[key] === 'string') ||
      !String(t.sent).trim() ||
      !Array.isArray(t.techniques) ||
      !t.techniques.every((x) => typeof x === 'string') ||
      typeof t.parseFailed !== 'boolean' ||
      (t.score !== undefined &&
        (!Number.isInteger(t.score) || Number(t.score) < 0 || Number(t.score) > 10)) ||
      (t.gradingError !== undefined && (typeof t.gradingError !== 'string' || !t.gradingError)) ||
      (t.score !== undefined && t.gradingError !== undefined) ||
      (t.hint !== undefined && typeof t.hint !== 'string') ||
      (t.encoding !== undefined && typeof t.encoding !== 'string')
    )
      throw new Error(`Invalid RedTeamRecording turn ${index + 1}.`);
  }
  return value as RedTeamRecording;
}

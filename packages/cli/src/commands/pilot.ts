import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type { AgentAdapter, CostUnit, Store, TargetRef } from '@agent-nexus/driftbench-core';
import {
  analysePilot,
  designPilot,
  formatPilotPlan,
  formatPilotReport,
  loadApprovedMap,
  type PilotAnalysisOptions,
  type PilotDesign,
  type PilotOptions,
  type PilotReport,
  pilotControlCheck,
  pilotObservations,
  pilotReport,
  planPilot,
  type Resample,
  runPilot,
} from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import { acmeExample, acmeExampleInstalled, requireAcmeExample } from '../acme-example';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { noStoreAt } from '../store-path';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  noAdapter,
  parseTarget,
  resolveAdapter,
  showTarget,
} from './campaign';

const RESAMPLE: readonly Resample[] = ['cells', 'conversations', 'both'];

/** The file `pilot run` and `pilot analyse` write. */
export const PILOT_REPORT_FILE = 'pilot-report.json';

/** The control target: the Acme agent with failures planted at a known rate per source. */
export const RANDOM_TARGET = 'acme-random';

/**
 * What the pilot runs with: the campaign deps, plus the control agent under `function:acme-random`. The
 * checks are the campaign's with the pilot's control check, which only a control agent's marker fails.
 */
export const pilotDeps: CampaignDeps = {
  ...defaultDeps,
  adapterFor: async (target, scope) => {
    const seed = target.adapter === 'function' ? randomSeed(target.agent) : undefined;
    if (seed !== undefined) {
      if ((await acmeExample()) === undefined) return undefined;
      return randomAgentAdapter(seed === 'default' ? undefined : seed);
    }
    return defaultDeps.adapterFor(target, scope);
  },
};

/**
 * Why the pilot cannot run a target. The pilot runs on the Acme example's agents; an install without the
 * example says so, and names no target it cannot reach.
 */
export function pilotNoAdapter(
  target: TargetRef,
  exampleInstalled: boolean = acmeExampleInstalled(),
): string {
  return noAdapter(target, [], { pilot: true, exampleInstalled });
}

/** `acme-random` gives the default seed, `acme-random-<n>` seed n; anything else is not the control. */
function randomSeed(agent: string | undefined): number | 'default' | undefined {
  if (agent === RANDOM_TARGET) return 'default';
  const match = agent === undefined ? null : /^acme-random-(\d+)$/.exec(agent);
  return match ? Number(match[1]) : undefined;
}

/** The seeded random Acme agent of examples/acme/pilot/random-agent behind the function adapter. */
export async function randomAgentAdapter(seed?: number): Promise<AgentAdapter> {
  const control = await requireAcmeExample();
  const agent = control.createRandomAgent(seed === undefined ? {} : { seed });
  return functionAdapter<ReturnType<typeof agent.create>>({
    create: (given) => agent.create(given),
    respond: (messages, world, _vars, session) => agent.respond(messages, world, session),
    payloads: (session) => session.store.payloads,
    deterministic: false,
  });
}

type DesignFlags = {
  map: string;
  suite: string;
  conversations: string;
  repeats: string;
  wordings: string;
  by: string;
};

type PlanFlags = DesignFlags & { target: string; store?: string; json?: boolean };

type AnalysisFlags = {
  floor: string;
  pool: string;
  iterations: string;
  seed: string;
  sensitivity: string;
  resample: string;
  out: string;
  json?: boolean;
};

type RunFlags = DesignFlags &
  AnalysisFlags & { target: string; store: string; concurrency: string; campaign?: string };

type AnalyseFlags = AnalysisFlags & { store: string; target?: string };

export function registerPilotCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = pilotDeps,
): void {
  const pilot = program
    .command('pilot')
    .description('Measure where results vary (cell, conversation, wording, repeat) and set the noise floor.');

  const design = (command: Command): Command =>
    command
      .requiredOption('--map <file>', 'the approved map whose phrase bank gives the wordings')
      .requiredOption('--suite <dir>', 'the generated suite: specs with metadata.generated')
      .option('--conversations <n>', 'conversations per cell, at most', '10')
      .option('--repeats <n>', 'runs per wording', '5')
      .option('--wordings <n>', 'approved wordings per conversation, at most', '3')
      .option('--by <dimensions>', 'the dimensions that name a cell, comma separated', 'behaviour');

  const analysis = (command: Command): Command =>
    command
      .option('--floor <f>', 'the noise floor a difference between two versions reads against', '0.05')
      .option('--pool <n>', 'conversations in the estimation pool the allocation spreads', '100')
      .option('--iterations <n>', 'bootstrap resamples', '500')
      .option('--seed <n>', 'bootstrap seed', '1')
      .option('--sensitivity <f>', 'the wording range above which a cell is flagged', '0.2')
      .option('--resample <unit>', 'what the bootstrap draws: cells, conversations or both', 'both')
      .option('--out <dir>', `the folder to write ${PILOT_REPORT_FILE} into`, '.')
      .option('--json', 'print the report as JSON');

  design(
    pilot
      .command('plan')
      .description(
        'Per cell: conversations x approved wordings x repeats, the run count and the projected cost.',
      ),
  )
    .option('--target <adapter[:agent]>', 'the target the cost is projected for', 'function:acme')
    .option('--store <file>', 'read the measured unit costs from this store')
    .option('--json', 'print the plan as JSON')
    .action(async (options: PlanFlags) => {
      setExit(await pilotPlanCommand(options, io, deps));
    });

  analysis(
    design(
      pilot
        .command('run')
        .description('Run the design through the runner, keep the factors on every run, analyse and report.'),
    ),
  )
    .requiredOption('--target <adapter[:agent]>', 'the agent to measure, such as function:acme')
    .requiredOption('--store <file>', 'the store the runs are filed in')
    .option('--concurrency <n>', 'runs at the same time', '4')
    .option('--campaign <id>', 'the campaign id; one is made from the content and the clock without it')
    .action(async (options: RunFlags) => {
      setExit(await pilotRunCommand(options, io, deps));
    });

  analysis(
    pilot
      .command('analyse')
      .description('Analyse a pilot campaign already in a store, again, without running anything.')
      .argument('[campaignId]', 'the pilot campaign; the latest pilot campaign of the store without it'),
  )
    .requiredOption('--store <file>', 'the store that holds the pilot')
    .action(async (campaignId: string | undefined, options: AnalyseFlags) => {
      setExit(await pilotAnalyseCommand(campaignId, options, io, deps));
    });
}

/** `pilot plan`. Exit 0, or 2 on bad input. */
export async function pilotPlanCommand(options: PlanFlags, io: Io, deps: CampaignDeps): Promise<number> {
  const built = await buildDesign(options, io);
  if (!built) return 2;
  const target = parseTarget(options.target);
  let units: CostUnit[] = [];
  if (options.store) {
    const store = await open(deps, resolve(io.cwd, options.store), io);
    if (!store) return 2;
    try {
      units = await store.listUnits();
    } finally {
      await store.close();
    }
  }
  const plan = planPilot(built, target, units);
  if (options.json) io.out(`${JSON.stringify({ design: summary(built), plan }, null, 2)}\n`);
  else io.out(formatPilotPlan(built, plan));
  return 0;
}

/** `pilot run`. Exit 0 when every run completed, 1 when some did not, 2 on bad input. */
export async function pilotRunCommand(options: RunFlags, io: Io, deps: CampaignDeps): Promise<number> {
  const analysisOptions = parseAnalysis(options, io);
  const concurrency = whole(options.concurrency, '--concurrency', 1, io);
  if (!analysisOptions || concurrency === undefined) return 2;
  const built = await buildDesign(options, io);
  if (!built) return 2;
  const target: TargetRef = parseTarget(options.target);
  const adapter = await resolveAdapter(target, () => deps.adapterFor(target), io, [], { pilot: true });
  if (!adapter) {
    return 2;
  }
  const store = await open(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const plan = planPilot(built, target, await store.listUnits());
    if (plan.pricing.kind !== 'in-process') {
      io.err(
        `The pilot runs ${plan.total.runs} runs on ${showTarget(target)}, which is not in process: it is billed. Size it with driftbench pilot plan and run it as a campaign the owner approved.\n`,
      );
      return 2;
    }
    if (!options.json) {
      io.out(
        `Pilot on ${showTarget(target)}: ${plan.total.runs} runs over ${built.cells.length} cells (${plan.total.conversations} conversations, ${plan.total.wordings} wordings, ${built.options.repeats} repeats).\n`,
      );
    }
    let ran: Awaited<ReturnType<typeof runPilot>>;
    try {
      ran = await runPilot({
        design: built,
        target,
        adapter,
        store,
        checks: [...deps.checks, pilotControlCheck],
        driver: () => deps.driver(),
        ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
        now: () => deps.now(),
        concurrency,
        ...(options.campaign ? { campaignId: options.campaign } : {}),
      });
    } catch (cause) {
      io.err(`The pilot could not run: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
    const { observations } = await pilotObservations(store, ran.campaign.campaignId);
    const report = pilotReport({
      campaignId: ran.campaign.campaignId,
      createdAt: ran.campaign.createdAt,
      target,
      design: built,
      plan,
      analysis: analysePilot(observations, analysisOptions),
    });
    const written = await writeReport(report, options.out, io);
    if (!written) return 2;
    if (options.json) io.out(`${JSON.stringify(report, null, 2)}\n`);
    else io.out(`${formatPilotReport(report)}Report: ${written}\n`);
    return report.analysis.errored > 0 ? 1 : 0;
  } finally {
    await store.close();
  }
}

/** `pilot analyse`. Exit 0, or 2 on bad input or a store without that pilot. */
export async function pilotAnalyseCommand(
  campaignId: string | undefined,
  options: AnalyseFlags,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const analysisOptions = parseAnalysis(options, io);
  if (!analysisOptions) return 2;
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await open(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const campaigns = await store.listCampaigns();
    const campaign =
      campaignId === undefined
        ? campaigns.find((candidate) => candidate.campaignId.startsWith('pilot-'))
        : campaigns.find((candidate) => candidate.campaignId === campaignId);
    if (!campaign) {
      io.err(
        campaignId === undefined
          ? `${options.store} holds no pilot campaign.\n`
          : `${options.store} holds no campaign ${campaignId}.\n`,
      );
      return 2;
    }
    const { observations, unlabelled } = await pilotObservations(store, campaign.campaignId);
    if (observations.length === 0) {
      io.err(`Campaign ${campaign.campaignId} has no run whose spec carries pilot factors.\n`);
      return 2;
    }
    if (unlabelled > 0) io.err(`${unlabelled} runs carry no pilot factors and are left out.\n`);
    const target = campaign.targets[0] as TargetRef;
    const report = pilotReport({
      campaignId: campaign.campaignId,
      createdAt: campaign.createdAt,
      target,
      analysis: analysePilot(observations, analysisOptions),
    });
    const written = await writeReport(report, options.out, io);
    if (!written) return 2;
    if (options.json) io.out(`${JSON.stringify(report, null, 2)}\n`);
    else io.out(`${formatPilotReport(report)}Report: ${written}\n`);
    return 0;
  } finally {
    await store.close();
  }
}

async function buildDesign(options: DesignFlags, io: Io): Promise<PilotDesign | undefined> {
  const conversations = whole(options.conversations, '--conversations', 1, io);
  const repeats = whole(options.repeats, '--repeats', 1, io);
  const wordings = whole(options.wordings, '--wordings', 1, io);
  if (conversations === undefined || repeats === undefined || wordings === undefined) return undefined;
  const by = options.by
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (by.length === 0) {
    io.err('--by names at least one dimension.\n');
    return undefined;
  }
  const mapPath = resolve(io.cwd, options.map);
  const map = await loadApprovedMap(mapPath);
  if (!map.ok) {
    io.err(`${options.map}: ${map.message}\n`);
    for (const issue of map.issues) io.err(`    ${issue.path || '(file)'}  ${issue.message}\n`);
    return undefined;
  }
  const suite = await loadValidSpecs([options.suite], io);
  if (!suite) return undefined;
  const pilotOptions: PilotOptions = { conversations, repeats, wordings, by };
  const built = designPilot(
    {
      path: shown(io, mapPath),
      agent: map.prepared.agent,
      hash: map.prepared.hash,
      phrasesOf: map.prepared.phrasesOf,
      binds: map.prepared.relations.binds,
    },
    suite,
    pilotOptions,
  );
  if (built.cells.length === 0) {
    io.err(`${options.suite} holds no generated spec, so the pilot has nothing to run.\n`);
    return undefined;
  }
  return built;
}

function summary(design: PilotDesign) {
  return {
    map: design.map,
    options: design.options,
    cells: design.cells.map((cell) => ({
      cell: cell.cell,
      suite: cell.suite,
      conversations: cell.conversations.map((conversation) => ({
        conversation: conversation.conversation,
        blocks: conversation.blocks,
        available: conversation.available,
        wordings: conversation.variants.length,
      })),
    })),
    skipped: design.skipped,
    warnings: design.warnings,
  };
}

function parseAnalysis(options: AnalysisFlags, io: Io): PilotAnalysisOptions | undefined {
  const floor = fraction(options.floor, '--floor', io);
  const sensitivity = fraction(options.sensitivity, '--sensitivity', io);
  const pool = whole(options.pool, '--pool', 1, io);
  const iterations = whole(options.iterations, '--iterations', 1, io);
  const seed = whole(options.seed, '--seed', 0, io);
  const resample = RESAMPLE.find((unit) => unit === options.resample);
  if (resample === undefined)
    io.err(`--resample takes cells, conversations or both, not "${options.resample}".\n`);
  if (
    resample === undefined ||
    floor === undefined ||
    sensitivity === undefined ||
    pool === undefined ||
    iterations === undefined ||
    seed === undefined
  ) {
    return undefined;
  }
  return { floor, sensitivity, pool, iterations, seed, resample };
}

async function writeReport(report: PilotReport, out: string, io: Io): Promise<string | undefined> {
  const dir = resolve(io.cwd, out);
  const path = join(dir, PILOT_REPORT_FILE);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  } catch (cause) {
    io.err(`Cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
  return shown(io, path);
}

async function open(deps: CampaignDeps, path: string, io: Io): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

function whole(text: string, flag: string, min: number, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isInteger(value) || value < min) {
    io.err(`${flag} takes a whole number of at least ${min}, not "${text}".\n`);
    return undefined;
  }
  return value;
}

function fraction(text: string, flag: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    io.err(`${flag} takes a number between 0 and 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

function shown(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

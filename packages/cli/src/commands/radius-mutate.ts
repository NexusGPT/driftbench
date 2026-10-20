import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  analyseMutation,
  blockStatus,
  type ConversationRunner,
  isScored,
  type LoadedSpec,
  type Mutant,
  MutationBudgetError,
  type MutationCache,
  type MutationRecord,
  MutatorMissError,
  type MutatorRequest,
  mutatorRequestKey,
  planMutants,
  promoteLinks,
  type RadiusSpec,
  realiseMutants,
  recordedMutator,
  runMutation,
  type SectionRegistry,
  type SuiteRun,
  selectionGate,
  sha256Hex,
  untestedSections,
} from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import { parseDocument } from 'yaml';
import type { Io } from '../io';
import { type CampaignDeps, loadValidSpecs, parseTarget, resolveAdapter, specRuns } from './campaign';
import { readRegistry, readText } from './radius-sections';

/**
 * `driftbench radius mutate plan|run|score`: section mutation testing, the ground truth for section links.
 *
 * - `plan` writes the mutants of a prompt: drop and negate per section (rephrase with --rephrase), two
 *   controls per section, and seeded two-section mutants. The text-changing operators read their answers
 *   from a file of recorded answers (`--responses`); a request with no answer is listed (`--requests-out`)
 *   and its mutant refused, never invented.
 * - `run` runs the suite against the baseline prompt and each mutant: 3 runs, then 3 confirmation runs of
 *   the conversations holding a candidate. It prints the projected cost before the first submission and
 *   refuses to send anything above `--budget-usd`. Runs are cached per mutant prompt hash (`--cache`).
 * - `score` reads a run: kills, controls, untested sections, the links it verifies or refutes (printed, or
 *   written into the specs with `--write`), and the verified-link gate (`--gate-out`) that lets
 *   `driftbench radius --gate` skip blocks.
 */
export function registerRadiusMutate(
  radius: Command,
  io: Io,
  setExit: (code: number) => void,
  deps?: CampaignDeps,
): void {
  const mutate = radius
    .command('mutate')
    .description('Mutate prompt sections, run the suite against each mutant, and verify or refute links');

  mutate
    .command('plan')
    .description('Write the mutants of a prompt: drop, negate, two controls per section, two-section pairs')
    .requiredOption('--prompt <file>', 'the prompt file the registry describes')
    .requiredOption('--registry <file>', 'its section registry')
    .requiredOption('--out <file>', 'write the mutants here (JSON)')
    .option('--responses <file>', 'recorded mutator answers (JSON, keyed by request key)')
    .option('--requests-out <file>', 'write the mutator requests that have no recorded answer here')
    .option('--rephrase', 'add the rephrase operator')
    .option('--only <sections...>', 'mutate only these section ids; pairs are drawn among them')
    .option('--pairs <n>', 'how many two-section mutants to draw', '20')
    .option('--seed <n>', 'the seed of the pair draw', '20261014')
    .action(async (options: PlanFlags) => setExit(await planCommand(options, io)));

  mutate
    .command('run')
    .description('Run the suite against the baseline and each mutant, then confirm the flips')
    .argument('<paths...>', 'the spec files or folders: one spec is one conversation')
    .requiredOption('--prompt <file>', 'the baseline prompt file')
    .requiredOption('--registry <file>', 'its section registry')
    .requiredOption('--mutants <file>', 'the mutants `radius mutate plan` wrote')
    .requiredOption('--usd-per-run <usd>', 'what one conversation run costs, for the projection')
    .requiredOption('--budget-usd <usd>', 'refuse to send anything when the projection is above this')
    .requiredOption('--out <file>', 'write the mutation run here (JSON)')
    .option('--target <adapter[:agent]>', "the agent to run; without it, each spec's own target")
    .option('--mode <mode>', 'F free-running or T teacher-forced', 'F')
    .option('--runs <n>', 'runs per mutant, and confirmation runs per candidate conversation', '3')
    .option('--cache <file>', 'reuse and store conversation runs here, keyed by mutant prompt hash')
    .action(async (paths: string[], options: RunFlags) =>
      setExit(await runCommand(paths, options, io, deps)),
    );

  mutate
    .command('score')
    .description('Read a mutation run: kills, controls, untested sections, link promotion and the gate')
    .argument('<paths...>', 'the spec files or folders the run covered')
    .requiredOption('--run <file>', 'the mutation run `radius mutate run` wrote')
    .requiredOption('--registry <file>', 'the section registry of the mutated prompt')
    .option('--write', 'write the promoted links into the specs (metadata.links)')
    .option('--gate-out <file>', 'score the verified-link gate on this run and write the record here')
    .action(async (paths: string[], _own: unknown, command: Command) =>
      setExit(await scoreCommand(paths, command.optsWithGlobals<ScoreFlags>(), io)),
    );
}

type PlanFlags = {
  prompt: string;
  registry: string;
  out: string;
  responses?: string;
  requestsOut?: string;
  rephrase?: boolean;
  only?: string[];
  pairs: string;
  seed: string;
};

/** The mutants file: the registry the mutants were made from, and each mutant with its text. */
type MutantsFile = {
  kind: 'driftbench.mutants';
  version: 1;
  prompt: { id: string; version: string; text_sha256: string };
  mutants: Mutant[];
};

const whole = (text: string) => (/^\d+$/.test(text) ? Number(text) : Number.NaN);

async function readJson(path: string, io: Io): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(io.cwd, path), 'utf8'));
  } catch (cause) {
    io.err(`Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

export async function planCommand(options: PlanFlags, io: Io): Promise<number> {
  const pairs = whole(options.pairs);
  const seed = whole(options.seed);
  if (Number.isNaN(pairs) || Number.isNaN(seed)) {
    io.err('--pairs and --seed take whole numbers from 0.\n');
    return 2;
  }
  const registry = await readRegistry(options.registry, io);
  const prompt = await readText(options.prompt, io);
  if (!registry || prompt === undefined) return 2;
  let answers: Record<string, string> = {};
  if (options.responses) {
    const read = await readJson(options.responses, io);
    if (read === undefined || typeof read !== 'object' || read === null || Array.isArray(read)) {
      if (read !== undefined) io.err(`${options.responses} is not an object of recorded answers.\n`);
      return 2;
    }
    answers = read as Record<string, string>;
  }
  const missing: (MutatorRequest & { key: string })[] = [];
  const recorded = recordedMutator(answers);
  const mutator = async (request: MutatorRequest) => {
    try {
      return await recorded(request);
    } catch (caught) {
      if (!(caught instanceof MutatorMissError)) throw caught;
      missing.push({ key: mutatorRequestKey(request), ...request });
      // An unanswered request refuses its mutant: an empty answer is refused on every try.
      return '';
    }
  };
  let mutants: Mutant[];
  try {
    const plans = planMutants(registry, {
      operators: options.rephrase ? ['drop', 'negate', 'rephrase'] : ['drop', 'negate'],
      pairs,
      seed,
      ...(options.only === undefined ? {} : { sections: options.only }),
    });
    mutants = await realiseMutants(registry, prompt, plans, { mutator });
  } catch (caught) {
    io.err(`${caught instanceof Error ? caught.message : String(caught)}.\n`);
    return 2;
  }
  const unanswered = new Map(missing.filter((request) => request.attempt === 1).map((r) => [r.key, r]));
  const missed = new Set(missing.map((request) => `${request.section}__${request.op}`));
  for (const mutant of mutants)
    if (mutant.status === 'refused' && missed.has(mutant.id)) mutant.reason = 'no recorded mutator answer';
  const file: MutantsFile = {
    kind: 'driftbench.mutants',
    version: 1,
    prompt: { id: registry.prompt_id, version: registry.version, text_sha256: registry.text_sha256 },
    mutants,
  };
  await writeFile(resolve(io.cwd, options.out), `${JSON.stringify(file, null, 2)}\n`);
  if (options.requestsOut) {
    const requests = [...unanswered.values()].map(({ attempt: _attempt, ...request }) => request);
    await writeFile(resolve(io.cwd, options.requestsOut), `${JSON.stringify(requests, null, 2)}\n`);
  }
  const ok = mutants.filter((mutant) => mutant.status === 'ok');
  const count = (pick: (mutant: Mutant) => boolean) => ok.filter(pick).length;
  io.out(
    `${ok.length} of ${mutants.length} mutants of ${registry.prompt_id} ${registry.version}: ${count((m) => !m.control && !m.pair)} single-section, ${count((m) => m.control)} controls, ${count((m) => m.pair)} two-section. Written to ${options.out}.\n`,
  );
  const refused = mutants.filter((mutant) => mutant.status !== 'ok');
  if (refused.length > 0) {
    const reasons = new Map<string, number>();
    for (const mutant of refused)
      reasons.set(mutant.reason ?? 'refused', (reasons.get(mutant.reason ?? 'refused') ?? 0) + 1);
    for (const [reason, n] of reasons) io.out(`  ${n} refused: ${reason}.\n`);
  }
  if (unanswered.size > 0)
    io.out(
      `  ${unanswered.size} mutator requests have no recorded answer${options.requestsOut ? `, listed in ${options.requestsOut}` : ''}. Answer them by key in a --responses file and plan again.\n`,
    );
  return 0;
}

type RunFlags = {
  prompt: string;
  registry: string;
  mutants: string;
  usdPerRun: string;
  budgetUsd: string;
  out: string;
  target?: string;
  mode: string;
  runs: string;
  cache?: string;
};

/** A JSON file cache of conversation runs, written after each new run so a stop loses nothing. */
async function fileCache(path: string, io: Io): Promise<MutationCache | undefined> {
  const at = resolve(io.cwd, path);
  let store: Record<string, SuiteRun> = {};
  if (existsSync(at)) {
    const read = await readJson(path, io);
    if (read === undefined || typeof read !== 'object' || read === null) return undefined;
    store = read as Record<string, SuiteRun>;
  }
  return {
    get: (key) => store[key],
    set: async (key, blocks) => {
      store[key] = blocks;
      await writeFile(at, `${JSON.stringify(store)}\n`);
    },
  };
}

export async function runCommand(
  paths: string[],
  options: RunFlags,
  io: Io,
  deps: CampaignDeps | undefined,
): Promise<number> {
  const usdPerRun = Number(options.usdPerRun);
  const budgetUsd = Number(options.budgetUsd);
  const runs = whole(options.runs);
  if (!(usdPerRun >= 0) || !(budgetUsd >= 0) || !(runs >= 1)) {
    io.err('--usd-per-run and --budget-usd take amounts from 0, and --runs a whole number from 1.\n');
    return 2;
  }
  if (options.mode !== 'F' && options.mode !== 'T') {
    io.err(`--mode takes F or T, not "${options.mode}".\n`);
    return 2;
  }
  const mode = options.mode;
  const registry = await readRegistry(options.registry, io);
  const prompt = await readText(options.prompt, io);
  const file = (await readJson(options.mutants, io)) as MutantsFile | undefined;
  if (!registry || prompt === undefined || file === undefined) return 2;
  if (file.kind !== 'driftbench.mutants' || file.prompt?.text_sha256 !== registry.text_sha256) {
    io.err(`${options.mutants} holds no mutants of ${registry.prompt_id} ${registry.version}.\n`);
    return 2;
  }
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const planned = specRuns(loaded, options.target ? [parseTarget(options.target)] : [], io);
  if (!planned) return 2;
  const { defaultDeps } = await import('./campaign');
  const using = deps ?? defaultDeps;
  const adapters = new Map<string, Awaited<ReturnType<CampaignDeps['adapterFor']>>>();
  for (const entry of planned) {
    const target = entry.targets[0];
    if (!target) return 2;
    const key = JSON.stringify(target);
    if (adapters.has(key)) continue;
    const adapter = await resolveAdapter(target, () => using.adapterFor(target), io, [entry.spec.id]);
    if (!adapter) return 2;
    adapters.set(key, adapter);
  }
  const { runSpec } = await import('@agent-nexus/driftbench-core');
  const byId = new Map(planned.map((entry) => [entry.spec.id, entry]));
  const run: ConversationRunner = async (text, conversation, rep) => {
    const entry = byId.get(conversation);
    const target = entry?.targets[0];
    const adapter = target ? adapters.get(JSON.stringify(target)) : undefined;
    if (!entry || !target || !adapter) throw new Error(`no spec ${conversation}`);
    const hash = sha256Hex(text);
    const result = await runSpec(entry.spec, {
      adapter,
      driver: using.driver(),
      checks: using.checks,
      mode,
      repeat: rep,
      target: { ...target, prompt: { name: `mutant-${hash.slice(0, 12)}`, version: 1, hash, text } },
      now: () => using.now(),
    });
    const blocks: SuiteRun = {};
    for (const block of result.blocks) {
      if (block.injected === true || !isScored(block)) continue;
      blocks[`${entry.spec.id}#${entry.spec.blocks[block.index]?.id ?? String(block.index)}`] =
        blockStatus(block) === 'fail';
    }
    const costs = result.blocks.map((block) => block.observed.cost.usd);
    // A run whose adapter reports no price is counted at --usd-per-run.
    return costs.every((usd) => typeof usd === 'number')
      ? { blocks, usd: costs.reduce<number>((sum, usd) => sum + (usd ?? 0), 0) }
      : { blocks };
  };
  const cache = options.cache ? await fileCache(options.cache, io) : undefined;
  if (options.cache && !cache) return 2;
  let record: MutationRecord;
  try {
    record = await runMutation({
      registry,
      promptText: prompt,
      mutants: file.mutants,
      conversations: planned.map((entry) => entry.spec.id),
      run,
      usdPerRun,
      budgetUsd,
      runs,
      confirmRuns: runs,
      ...(cache ? { cache } : {}),
      onProjection: (cost) =>
        io.out(
          `Projected: ${cost.baselineRuns} baseline and ${cost.stage1Runs} mutant conversation runs, at most ${cost.confirmRunsMax} confirmation runs; at most ${cost.usd.max.toFixed(4)} USD at ${usdPerRun} USD a run (budget ${budgetUsd} USD).\n`,
        ),
    });
  } catch (caught) {
    if (caught instanceof MutationBudgetError) {
      io.err(`${caught.message}.\n`);
      return 1;
    }
    throw caught;
  }
  await writeFile(resolve(io.cwd, options.out), `${JSON.stringify(record, null, 2)}\n`);
  io.out(
    `Mutation run ${record.id}: ${record.mutants.length} mutants, ${record.spend.conversation_runs} conversation runs sent, ${record.spend.cached} from the cache, ${record.spend.usd.toFixed(4)} USD. Written to ${options.out}.\n`,
  );
  return 0;
}

type ScoreFlags = { run: string; registry: string; write?: boolean; gateOut?: string; json?: boolean };

export async function scoreCommand(paths: string[], options: ScoreFlags, io: Io): Promise<number> {
  const registry = await readRegistry(options.registry, io);
  const record = (await readJson(options.run, io)) as MutationRecord | undefined;
  if (!registry || record === undefined) return 2;
  if (record.kind !== 'driftbench.mutation-run' || record.prompt?.text_sha256 !== registry.text_sha256) {
    io.err(`${options.run} is no mutation run of ${registry.prompt_id} ${registry.version}.\n`);
    return 2;
  }
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const analysis = analyseMutation(record);
  const specs = loaded.map((entry) => entry.spec);
  const promotion = promoteLinks(specs, analysis, registry);
  const untested = untestedSections(analysis, registry);
  // The gate is scored on the specs as they stand: the links they hold now, verified by earlier runs.
  const current: RadiusSpec[] = loaded.map((entry) => ({
    spec: entry.spec,
    hash: entry.hash,
    path: entry.path,
  }));
  const gate = options.gateOut ? selectionGate(current, registry, analysis) : undefined;
  if (gate && options.gateOut)
    await writeFile(resolve(io.cwd, options.gateOut), `${JSON.stringify(gate, null, 2)}\n`);
  if (options.write) {
    const written = await writeLinks(loaded, promotion.links, io);
    if (written === undefined) return 2;
  }
  if (options.json) {
    io.out(
      `${JSON.stringify({ run: record.id, analysis, promotion, untested, ...(gate ? { gate } : {}) }, null, 2)}\n`,
    );
    return gate && !gate.pass ? 1 : 0;
  }
  io.out(renderScore(record, analysis, promotion, untested, registry));
  if (gate)
    io.out(
      `Gate: ${gate.pass ? 'PASS' : 'FAIL'}. ${gate.reason}. Mean selection ratio ${gate.ratio.toFixed(3)}. Written to ${options.gateOut}.\n`,
    );
  if (options.write)
    io.out(`Links written into ${new Set(loaded.map((entry) => entry.path)).size} spec files.\n`);
  return gate && !gate.pass ? 1 : 0;
}

function renderScore(
  record: MutationRecord,
  analysis: ReturnType<typeof analyseMutation>,
  promotion: ReturnType<typeof promoteLinks>,
  untested: string[],
  registry: SectionRegistry,
): string {
  const singles = analysis.mutants.filter((m) => !m.control && !m.pair);
  const killing = singles.filter((m) => m.killed.length > 0);
  const ops = [...new Set(singles.map((m) => m.op))].map(
    (op) => `${op} ${killing.filter((m) => m.op === op).length}/${singles.filter((m) => m.op === op).length}`,
  );
  const controls = analysis.mutants.filter((m) => m.control);
  const dirty = controls.filter((m) => m.killed.length > 0);
  const count = (from: string | null, to: string) =>
    promotion.changes.filter((change) => change.from === from && change.to === to).length;
  const lines = [
    `Mutation run ${record.id} of ${registry.prompt_id} ${registry.version}: ${record.baseline.length} baseline runs, ${record.mutants.length} mutants.`,
    `  Flaky blocks (no link moves): ${analysis.flaky.length === 0 ? 'none' : analysis.flaky.join(', ')}.`,
    `  Single-section mutants that kill a block: ${killing.length} of ${singles.length} (${ops.join(', ')}).`,
    `  Controls that kill a block: ${dirty.length} of ${controls.length}${dirty.length ? ` (${dirty.map((m) => m.id).join(', ')}): their sections verify no link` : ''}.`,
    `  Links: ${count('declared', 'verified') + count('attributed', 'verified') + count('refuted', 'verified')} verified, ${count('declared', 'refuted') + count('attributed', 'refuted')} refuted, ${count(null, 'verified')} new verified links from flips no link explained.`,
    `  Local sections no mutant kills a block with (${untested.length}): ${untested.length ? untested.join(', ') : 'none'}. Each is untested by the suite, or its mutants change nothing: candidates for new blocks.`,
  ];
  return `${lines.join('\n')}\n`;
}

/** Writes each spec's promoted links into its file's `metadata.links`, keeping the rest of the file. */
async function writeLinks(
  loaded: readonly LoadedSpec[],
  links: { spec: string; links: unknown[] }[],
  io: Io,
): Promise<true | undefined> {
  const byPath = new Map<string, LoadedSpec[]>();
  for (const entry of loaded) byPath.set(entry.path, [...(byPath.get(entry.path) ?? []), entry]);
  for (const [path, entries] of byPath) {
    if (entries.length > 1 || !/\.ya?ml$/.test(path)) {
      io.err(`${path} holds ${entries.length} specs or is not YAML: --write edits one YAML spec per file.\n`);
      return undefined;
    }
  }
  for (const entry of loaded) {
    const own = links.find((each) => each.spec === entry.spec.id)?.links ?? [];
    const document = parseDocument(await readFile(entry.path, 'utf8'));
    document.setIn(['metadata', 'links'], own);
    await writeFile(entry.path, document.toString());
  }
  return true;
}

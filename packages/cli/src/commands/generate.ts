import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type LoadedSpec, loadSpecs } from '@agent-nexus/driftbench-core';
import {
  buildTaskInputs,
  COMPLETE_DIR,
  formatJson,
  generateSuite,
  INCOMPLETE_DIR,
  loadApprovedMap,
  type ModelPort,
  portFromEnv,
  proposeSpecs,
  REPORT_FILE,
  renderSummary,
  type SpecProposal,
  STEM_MAP_FILE,
  seedFolderName,
} from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { defaultGateDeps, type GateDeps, gateCommand } from './gate';
import { readBlockSections, SECTIONS_OPTION } from './sections-option';

/** What generate runs with. Tests pass a fake model port. */
export type GenerateDeps = {
  /** The port --model asks. Default: the port the environment configures. */
  modelPort?(): ModelPort;
  /** What the gate of the proposals runs with. Default: the gate command's own. */
  gate?: GateDeps;
};

/** Where --model writes its proposals, their gated copies and its report, under --out. */
export const PROPOSED_DIR = 'proposed';
/** Instances built per task family when --tasks is not given. */
export const DEFAULT_TASKS = 8;
export const PROPOSALS_FILE = 'proposals.json';

export type GenerateCommandOptions = {
  map: string;
  /** Section registries of prompts the map is read from, `--sections`. */
  sections?: string[];
  out: string;
  t?: string;
  seed?: string;
  max?: string;
  budget?: string;
  specCap?: string;
  specCapMode?: string;
  tasks?: string;
  baseline?: string[];
  force?: boolean;
  stems?: boolean;
  json?: boolean;
  model?: boolean;
  proposals?: string;
  reference?: string[];
  faults?: string;
  k?: string;
};

/**
 * `driftbench generate --map <approved map> --out <dir>`: code enumerates blocks and combinations from the
 * approved map (stage graph paths, a t-wise covering array, boundary values, one probe per deviation
 * class, metamorphic families) and writes them as specs, with `generate-report.json`. No model is called.
 */
export function registerGenerateCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: GenerateDeps = {},
): void {
  program
    .command('generate')
    .description('Generate specs from an approved map, by code: graph paths, t-wise rows, boundaries, probes')
    .requiredOption('--map <file>', 'the approved map (a proposal whose every entry is approved)')
    .requiredOption('--out <dir>', 'the folder to write the specs and generate-report.json into')
    .option('--t <n>', 'the strength of the covering array (default 3)')
    .option('--seed <n>', 'the integer seed of every seeded choice (default 1)')
    .option('--max <n>', 'the most specs per seeder')
    .option(
      '--budget <n>',
      'budget mode: N conversations placed by pair coverage, then value balance, in place of the t-wise rows',
    )
    .option(
      '--spec-cap <n>',
      'total specs written; preserves structural probes and selects actual pair/triple coverage',
    )
    .option(
      '--spec-cap-mode <mode>',
      'tuples (default) preserves pairs and triples; pairs permits reported triple loss',
    )
    .option('--tasks <n>', `instances built per task family the map names (default ${DEFAULT_TASKS})`)
    .option('--baseline <path>', 'specs to measure on the same map for comparison; repeat it', collect)
    .option('--sections <registry>', SECTIONS_OPTION, collect)
    .option('--force', 'replace the output of an earlier run in the folder')
    .option('--no-stems', 'write every spec whole: no shared openings written once as stems')
    .option('--json', 'print the report as JSON')
    .option('--model', 'also ask the model port for specs; each counts only once the gate accepts it (paid)')
    .option('--proposals <n>', 'with --model: how many specs to ask for (default 3)')
    .option(
      '--reference <adapter:agent>',
      'with --model: the reference agent the gate runs on; repeat it',
      collect,
    )
    .option('--faults <path>', 'with --model: the fault set the gate plants')
    .option('--k <n>', 'with --model: repeats on the reference for pass^k in the gate')
    .action(async (options: GenerateCommandOptions) => {
      setExit(await generateCommand(options, io, deps));
    });
}

/**
 * Exit 0 when the suite is written and every block has an approved phrase and a Then, 1 when it is written
 * with incomplete specs, a seeder cut by --max, or a generator defect (all listed), 2 on a usage or input error
 * (nothing is written): an invalid or unapproved map, a bad number, an earlier output without --force.
 */
export async function generateCommand(
  options: GenerateCommandOptions,
  io: Io,
  deps: GenerateDeps = {},
): Promise<number> {
  if (options.model) {
    if ((options.reference ?? []).length === 0 || options.faults === undefined) {
      io.err('--model gates every proposal: give --reference <adapter:agent> and --faults <set>.\n');
      return 2;
    }
  } else if (
    options.proposals !== undefined ||
    (options.reference ?? []).length > 0 ||
    options.faults !== undefined ||
    options.k !== undefined
  ) {
    io.err('--proposals, --reference, --faults and --k go with --model.\n');
    return 2;
  }
  const proposalCount = whole(options.proposals, 'proposals', 1);
  if (typeof proposalCount === 'string') {
    io.err(`${proposalCount}\n`);
    return 2;
  }
  const t = whole(options.t, 't', 1);
  const seed = whole(options.seed, 'seed', 0);
  const max = whole(options.max, 'max', 1);
  const budget = whole(options.budget, 'budget', 1);
  const specCap = whole(options.specCap, 'spec-cap', 1);
  const tasks = whole(options.tasks, 'tasks', 1);
  for (const parsed of [t, seed, max, budget, specCap, tasks]) {
    if (typeof parsed === 'string') {
      io.err(`${parsed}\n`);
      return 2;
    }
  }
  if (
    options.specCapMode !== undefined &&
    (specCap === undefined || !['tuples', 'pairs'].includes(options.specCapMode))
  ) {
    io.err('--spec-cap-mode requires --spec-cap and must be tuples or pairs.\n');
    return 2;
  }
  const mapPath = resolve(io.cwd, options.map);
  const outPath = resolve(io.cwd, options.out);
  const outInfo = await stat(outPath).catch(() => undefined);
  if (outInfo && !outInfo.isDirectory()) {
    io.err(`--out names ${display(outPath, io)}, which is a file: give a folder.\n`);
    return 2;
  }

  const loaded = await loadApprovedMap(mapPath);
  if (!loaded.ok) {
    io.err(`✗ ${display(mapPath, io)}  ${loaded.code}\n`);
    for (const issue of loaded.issues)
      io.err(`  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
    io.err(`${capital(loaded.message)}.\n`);
    return 2;
  }

  let baseline: { label: string; specs: LoadedSpec['spec'][] } | undefined;
  if (options.baseline && options.baseline.length > 0) {
    const results = await loadSpecs(options.baseline.map((path) => resolve(io.cwd, path)));
    const valid = results.filter((result): result is LoadedSpec => result.ok);
    const refused = results.length - valid.length;
    if (results.length === 0 || refused > 0) {
      io.err(
        results.length === 0
          ? 'No spec found under --baseline.\n'
          : `${refused} baseline spec(s) are invalid; run driftbench spec validate on them.\n`,
      );
      return 2;
    }
    baseline = { label: options.baseline.join(' '), specs: valid.map((result) => result.spec) };
  }

  const reportPath = join(outPath, REPORT_FILE);
  if (await exists(reportPath)) {
    if (!options.force) {
      io.err(
        `${display(reportPath, io)} already exists: an earlier run wrote this folder. Pass --force to replace its output.\n`,
      );
      return 2;
    }
    for (const entry of [COMPLETE_DIR, INCOMPLETE_DIR, REPORT_FILE, STEM_MAP_FILE]) {
      await rm(join(outPath, entry), { recursive: true, force: true });
    }
  }

  // The prompts with a section registry, named as the map's evidence names its sources: from the map's folder.
  const sections =
    (options.sections ?? []).length > 0
      ? await readBlockSections(options.sections ?? [], dirname(mapPath), io)
      : undefined;
  if ((options.sections ?? []).length > 0 && !sections) return 2;

  // The task families the map names build their instances first: their oracles run asynchronously.
  const built = await buildTaskInputs(loaded.prepared, dirname(mapPath), {
    n: typeof tasks === 'number' ? tasks : DEFAULT_TASKS,
    seed: typeof seed === 'number' ? seed : 1,
    // A workspace that holds a binary file is written beside its spec, which names it relative to itself.
    seedFrom: (id: string) => `./${seedFolderName(id)}`,
  });
  for (const entry of built.refused)
    io.err(`✗ the task family ${entry.family} builds no spec: ${entry.reason}\n`);

  let result: ReturnType<typeof generateSuite>;
  try {
    result = generateSuite(loaded.prepared, {
      tasks: built.inputs,
      ...(typeof t === 'number' ? { t } : {}),
      ...(typeof seed === 'number' ? { seed } : {}),
      ...(typeof max === 'number' ? { max } : {}),
      ...(typeof budget === 'number' ? { budget } : {}),
      ...(typeof specCap === 'number'
        ? { specCap, specCapMode: (options.specCapMode ?? 'tuples') as 'tuples' | 'pairs' }
        : {}),
      mapPath: portable(relative(outPath, mapPath)),
      ...(baseline ? { baseline } : {}),
      ...(sections ? { sections } : {}),
      stems: options.stems !== false,
    });
  } catch (cause) {
    io.err(`Cannot generate: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }

  await writeFiles(outPath, result.files);

  const report = result.report;
  if (options.json) io.out(formatJson(report));
  else io.out(`${renderSummary(report)}Wrote ${result.files.length} files to ${display(outPath, io)}.\n`);
  const cut =
    Object.values(report.seeders).some((entry) => entry.cut) || report.spec_cap?.preserved === false;
  const defects = report.invalid.length > 0 || report.lint.length > 0 || built.refused.length > 0;
  const code = report.summary.incomplete > 0 || cut || defects ? 1 : 0;
  if (!options.model) return code;

  const example = result.files.find(
    (file) => file.path.startsWith(`${COMPLETE_DIR}/`) && file.path.endsWith('.yaml'),
  );
  const proposed = await proposeAndGate(
    {
      mapText: await readFile(mapPath, 'utf8'),
      example: example?.text ?? '',
      count: typeof proposalCount === 'number' ? proposalCount : 3,
      outPath: join(outPath, PROPOSED_DIR),
      reference: options.reference ?? [],
      faults: options.faults ?? '',
      ...(options.k === undefined ? {} : { k: options.k }),
    },
    io,
    deps,
  );
  return proposed === 'failed' ? 1 : code;
}

type ProposalRow = {
  id: string;
  status: 'counted' | 'rejected';
  blocks?: { accepted: number; total: number };
  stage?: string;
  reason?: string;
  block?: string;
  problem?: string;
};

/**
 * Asks the model port for specs from the approved map, writes the valid ones as candidates, and runs the
 * gate on them. A proposal counts only when the gate accepts at least one of its blocks; every other one is
 * reported with the stage that refused it (`spec` for one that is not a valid spec). Writes the candidates,
 * the gate's output and proposals.json under <out>/proposed.
 */
async function proposeAndGate(
  input: {
    mapText: string;
    example: string;
    count: number;
    outPath: string;
    reference: string[];
    faults: string;
    k?: string;
  },
  io: Io,
  deps: GenerateDeps,
): Promise<'done' | 'failed'> {
  let port: ModelPort;
  let proposals: SpecProposal[];
  try {
    port = (deps.modelPort ?? portFromEnv)();
    proposals = await proposeSpecs({ port, map: input.mapText, example: input.example, count: input.count });
  } catch (cause) {
    io.err(`The model proposals failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 'failed';
  }
  await rm(input.outPath, { recursive: true, force: true });
  const candidates = join(input.outPath, 'candidates');
  await mkdir(candidates, { recursive: true });
  const valid = proposals.filter((proposal): proposal is Extract<SpecProposal, { ok: true }> => proposal.ok);
  for (const proposal of valid) await writeFile(join(candidates, `${proposal.id}.yaml`), proposal.text);

  type Gated = { key: string; status: string; stage?: string; reason?: string };
  let gated: Gated[] = [];
  if (valid.length > 0) {
    const quiet: Io = { out: () => {}, err: (text) => io.err(text), cwd: io.cwd };
    const exit = await gateCommand(
      candidates,
      {
        reference: input.reference,
        faults: input.faults,
        out: join(input.outPath, 'gated'),
        ...(input.k === undefined ? {} : { k: input.k }),
        force: true,
      },
      quiet,
      deps.gate ?? defaultGateDeps,
    );
    if (exit === 2) return 'failed';
    const report = JSON.parse(await readFile(join(input.outPath, 'gated', 'gate-report.json'), 'utf8')) as {
      blocks: Gated[];
    };
    gated = report.blocks;
  }

  const rows: ProposalRow[] = proposals.map((proposal, index) => {
    const id = proposal.id ?? `proposal-${index + 1}`;
    if (!proposal.ok) return { id, status: 'rejected', stage: 'spec', problem: proposal.problem };
    const blocks = gated.filter((block) => block.key.startsWith(`${proposal.id}#`));
    const accepted = blocks.filter((block) => block.status === 'accepted').length;
    if (accepted > 0) return { id, status: 'counted', blocks: { accepted, total: blocks.length } };
    const first = blocks.find((block) => block.status !== 'accepted');
    return {
      id,
      status: 'rejected',
      blocks: { accepted, total: blocks.length },
      ...(first?.stage ? { stage: first.stage } : {}),
      ...(first?.reason ? { reason: first.reason } : {}),
      ...(first ? { block: first.key.slice(first.key.indexOf('#') + 1) } : {}),
    };
  });
  const counted = rows.filter((row) => row.status === 'counted').length;
  await writeFile(
    join(input.outPath, PROPOSALS_FILE),
    `${JSON.stringify({ model: { family: port.family, model: port.model ?? 'unknown' }, asked: input.count, proposals: rows }, null, 2)}\n`,
  );

  io.out(
    `Model proposals: ${proposals.length} written by ${port.family} ${port.model ?? 'unknown'}, each through the gate.\n`,
  );
  const lines = rows.map((row) => [
    row.id,
    row.status,
    row.blocks ? `${row.blocks.accepted} of ${row.blocks.total} blocks accepted` : 'not a spec',
    row.stage === 'spec'
      ? `spec: ${row.problem ?? ''}`
      : row.stage
        ? `${row.stage}: ${row.reason ?? ''} (block ${row.block ?? '?'})`
        : '',
  ]);
  for (const line of table(lines)) io.out(`${line}\n`);
  io.out(
    `Counted ${counted} of ${proposals.length} proposals. Candidates and the gate's output in ${display(input.outPath, io)}.\n`,
  );
  return 'done';
}

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

function whole(text: string | undefined, name: string, minimum: number): number | string | undefined {
  if (text === undefined) return undefined;
  const value = optionNumber(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < minimum) {
    return `--${name} must be a whole number of at least ${minimum}, got "${text}".`;
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function display(path: string, io: Io): string {
  const shown = relative(io.cwd, path);
  return shown === '' ? '.' : shown.startsWith('..') || isAbsolute(shown) ? path : shown;
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** How many files are written at once: enough to keep the disk busy, few enough to stay under any open-file limit. */
const WRITE_CONCURRENCY = 16;

/**
 * Writes the files under `root`: one mkdir per folder, then the writes in bounded parallel. The bytes and the
 * file set are those of writing them one after another; a path given twice keeps its last text, as it would.
 */
async function writeFiles(
  root: string,
  files: readonly { path: string; text: string; bytes?: Uint8Array }[],
): Promise<void> {
  // A binary seed file (a workbook) carries bytes; every other file is text.
  const texts = new Map<string, string | Uint8Array>(
    files.map((file) => [join(root, file.path), file.bytes ?? file.text]),
  );
  for (const folder of new Set([...texts.keys()].map((target) => dirname(target)))) {
    await mkdir(folder, { recursive: true });
  }
  const entries = [...texts];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [target, text] = entries[next++] as [string, string | Uint8Array];
      await writeFile(target, text);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, entries.length) }, worker));
}

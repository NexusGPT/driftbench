import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  type CellOutcome,
  cellIdOf,
  outcomeOf,
  type RunResult,
  runsByCell,
  type Store,
  type TargetRef,
} from '@driftbench/core';
import { faultAdapter, importFaultSet } from '@driftbench/generate';
import { localProvider } from '@driftbench/sandbox';
import { type NonInferiorityResult, nonInferiority, pairedRateDifference } from '@driftbench/stats';
import type { Command } from 'commander';
import type { Io } from '../io';
import { type CampaignDeps, campaignRunCommand, defaultDeps, parseTarget } from './campaign';

/**
 * The checks whose failure is a gating FLAG: an act that must never happen, judged apart from the pass
 * rate. A flag that fires on the candidate where the baseline had none fails ci whatever the margin.
 */
export const DEFAULT_FLAGS = ['forbidden', 'pii', 'safety', 'guards'] as const;

/** The summary file ci writes when `--out` is not given, relative to the working folder. */
export const DEFAULT_SUMMARY = 'driftbench-ci.json';

export type CiVerdict = 'parity' | 'regression' | 'gating' | 'incomplete';

type CiCommandOptions = {
  specs: string;
  target: string;
  baseline: string;
  store: string;
  margin: string;
  mode: string;
  repeats: string;
  budgetUsd?: string;
  faults?: string;
  flag: string[];
  out?: string;
  cache?: boolean;
  concurrency: string;
  json?: boolean;
};

/** One golden as ci pairs it: a spec in one mode (and perturbation), every repeat of it. */
export type ArmResult = {
  /** Every repeat ran to completion and passed. */
  pass: boolean;
  runs: number;
  passing: number;
  /** A flag check failed in at least one repeat. */
  flagged: boolean;
  /** The gating checks that failed, in the first failing repeat. */
  failing: string[];
};

export type CiPair = {
  name: string;
  specId: string;
  mode: string;
  perturbationId?: string;
  baseline: ArmResult;
  candidate: ArmResult;
  change: 'same' | 'regressed' | 'improved';
  newFlag: boolean;
};

export type CiSummary = {
  verdict: CiVerdict;
  exitCode: 0 | 1;
  reason: string;
  /** The margin in percentage points, as given. */
  marginPoints: number;
  /** The comparison the verdict rests on: see `compareArms`. */
  comparator: string;
  flags: string[];
  baseline: { campaignId: string; store: string };
  candidate: {
    campaignId: string;
    store: string;
    target: string;
    cells: number;
    incompleteCells: number;
  };
  pairs: number;
  table: { bothPass: number; regressed: number; improved: number; bothFail: number };
  /** Baseline pass rate minus candidate pass rate, in points: positive is a regression. */
  effectPoints: { estimate: number; lower: number; upper: number };
  /** The smallest margin, in points, these many pairs can show parity at when every pair passes on both. */
  smallestMarginPoints: number;
  regressed: string[];
  improved: string[];
  newFlags: string[];
  /** Goldens only one side ran: never compared. */
  unpaired: { baselineOnly: string[]; candidateOnly: string[] };
  rows: CiPair[];
};

/**
 * Registers `driftbench ci`: run a candidate campaign, compare it with a baseline campaign golden by
 * golden, and exit 0 on parity, 1 on a regression, a new gating flag or an incomplete run, 2 on bad input.
 */
export function registerCiCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  program
    .command('ci')
    .description(
      'Run the specs on a candidate target, compare with a baseline campaign and gate: exit 0 on parity, 1 on a regression or a new gating flag, 2 on bad input.',
    )
    .requiredOption('--specs <path>', 'the spec file or folder the candidate runs')
    .requiredOption('--target <adapter[:agent]>', 'the candidate target, such as function:acme-sales')
    .requiredOption(
      '--baseline <campaign|store>',
      'the baseline: a store file (its latest campaign), or a campaign id held in --store',
    )
    .requiredOption('--store <file>', 'the store the candidate campaign is kept in')
    .requiredOption('--margin <points>', 'the largest drop in pass rate tolerated, in percentage points')
    .option('--mode <modes>', 'the run mode: T, F or P, or several separated by commas', 'F')
    .option('--repeats <n>', 'runs per spec and mode', '1')
    .option(
      '--budget-usd <usd>',
      'a hard stop on the candidate campaign; a stopped cell makes the run incomplete',
    )
    .option(
      '--faults <path>',
      'a fault set (module or folder) whose faults the target can name as fault:<id>',
    )
    .option(
      '--flag <check>',
      `a check whose failure is a gating flag; repeat for several (default: ${DEFAULT_FLAGS.join(', ')})`,
      collect,
      [],
    )
    .option('--out <file>', `the JSON summary (default: ${DEFAULT_SUMMARY})`)
    .option('--cache', 'replay runs from the cache; off by default, so every cell runs the agent')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--json', 'print the JSON summary instead of the table')
    .action(async (options: CiCommandOptions) => {
      setExit(await ciCommand(options, io, deps));
    });
}

/** `driftbench ci`. Returns the exit code. */
export async function ciCommand(options: CiCommandOptions, io: Io, deps: CampaignDeps): Promise<number> {
  const marginPoints = Number(options.margin);
  if (!Number.isFinite(marginPoints) || marginPoints <= 0 || marginPoints >= 100) {
    io.err(`--margin takes a number of points between 0 and 100, not "${options.margin}".\n`);
    return 2;
  }
  const flags = options.flag.length > 0 ? options.flag : [...DEFAULT_FLAGS];
  const storePath = resolve(io.cwd, options.store);
  const outPath = resolve(io.cwd, options.out ?? DEFAULT_SUMMARY);

  const target = parseTarget(options.target);
  let runDeps = deps;
  if (target.adapter === 'fault') {
    const withFaults = await faultDeps(deps, options.faults, io);
    if (!withFaults) return 2;
    runDeps = withFaults;
  }

  // The baseline is read before the candidate runs: with --baseline naming the --store file, its latest
  // campaign is the baseline, not the candidate about to be added.
  const baseline = await readBaseline(options.baseline, storePath, deps, io);
  if (!baseline) return 2;

  let out = '';
  const capture: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => io.err(text),
    cwd: io.cwd,
  };
  const code = await campaignRunCommand(
    [options.specs],
    {
      target: [options.target],
      mode: options.mode,
      repeats: options.repeats,
      store: storePath,
      cache: options.cache === true,
      concurrency: options.concurrency,
      ...(options.budgetUsd === undefined ? {} : { budgetUsd: options.budgetUsd }),
      json: true,
    },
    capture,
    runDeps,
  );
  if (code === 2) return 2;
  let report: CampaignReport;
  try {
    report = JSON.parse(out) as CampaignReport;
  } catch (cause) {
    io.err(`The candidate campaign printed no JSON report: ${message(cause)}\n`);
    return 2;
  }

  const store = await openReported(deps, storePath, io);
  if (!store) return 2;
  let candidateRuns: RunResult[];
  try {
    candidateRuns = [...(await runsByCell(store, report.campaignId)).values()];
  } finally {
    await store.close();
  }

  const incompleteCells = report.summary.stoppedByBudget + report.summary.pending;
  const paired = pairArms(baseline.runs, candidateRuns, flags);
  if (paired.pairs.length === 0) {
    io.err(
      `The baseline campaign ${baseline.campaignId} and the candidate share no golden (spec and mode): nothing to compare.\n`,
    );
    return 2;
  }
  const comparison = compareArms(paired.pairs, marginPoints / 100);
  const summary = summarize({
    comparison,
    paired,
    flags,
    marginPoints,
    baseline: { campaignId: baseline.campaignId, store: baseline.store },
    candidate: {
      campaignId: report.campaignId,
      store: storePath,
      target: options.target,
      cells: report.summary.cells,
      incompleteCells,
    },
  });

  try {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  } catch (cause) {
    io.err(`Cannot write the summary to ${outPath}: ${message(cause)}\n`);
    return 2;
  }
  if (options.json) io.out(`${JSON.stringify(summary, null, 2)}\n`);
  else io.out(verdictText(summary, display(outPath, io)));
  return summary.exitCode;
}

/**
 * THE comparison ci gates on, the one function to swap: when the report lane's `compare` lands on main, its
 * call replaces this body. Until then it is `nonInferiority` of @driftbench/stats on the all-pass flag per
 * golden, with the flag checks as its gating flags.
 */
export function compareArms(pairs: readonly CiPair[], margin: number): NonInferiorityResult {
  return nonInferiority({
    baseline: pairs.map((pair) => pair.baseline.pass),
    candidate: pairs.map((pair) => pair.candidate.pass),
    margin,
    pairs: pairs.map((pair) => pair.name),
    gatingFlags: {
      baseline: pairs.map((pair) => pair.baseline.flagged),
      candidate: pairs.map((pair) => pair.candidate.flagged),
    },
  });
}

export const COMPARATOR =
  '@driftbench/stats nonInferiority (paired, Newcombe interval on the all-pass flag per golden)';

/** The fields of the `campaign run --json` report ci reads. */
type CampaignReport = {
  campaignId: string;
  summary: { cells: number; stoppedByBudget: number; pending: number };
};

type Baseline = { campaignId: string; store: string; runs: RunResult[] };

/**
 * The baseline runs. A `--baseline` that names an existing file is a store: its latest campaign. Anything
 * else is a campaign id in the `--store` file.
 */
async function readBaseline(
  value: string,
  storePath: string,
  deps: CampaignDeps,
  io: Io,
): Promise<Baseline | undefined> {
  const asPath = resolve(io.cwd, value);
  const isStore = existsSync(asPath) && statSync(asPath).isFile();
  const path = isStore ? asPath : storePath;
  if (!isStore && !existsSync(storePath)) {
    io.err(
      `--baseline ${value} is neither a store file nor a campaign in --store: ${display(storePath, io)} does not exist.\n`,
    );
    return undefined;
  }
  const store = await openReported(deps, path, io);
  if (!store) return undefined;
  try {
    let campaignId: string;
    if (isStore) {
      const [latest] = await store.listCampaigns();
      if (!latest) {
        io.err(`The baseline store ${display(path, io)} holds no campaign.\n`);
        return undefined;
      }
      campaignId = latest.campaignId;
    } else {
      const campaign = await store.getCampaign(value);
      if (!campaign) {
        io.err(`--baseline ${value}: no such file, and no campaign ${value} in ${display(path, io)}.\n`);
        return undefined;
      }
      campaignId = campaign.campaignId;
    }
    const runs = [...(await runsByCell(store, campaignId)).values()];
    if (runs.length === 0) {
      io.err(`The baseline campaign ${campaignId} has no run.\n`);
      return undefined;
    }
    return { campaignId, store: path, runs };
  } finally {
    await store.close();
  }
}

/** The campaign deps with `fault:<id>` targets resolved from a fault set. */
async function faultDeps(
  deps: CampaignDeps,
  faults: string | undefined,
  io: Io,
): Promise<CampaignDeps | undefined> {
  if (faults === undefined) {
    io.err('A fault:<id> target needs --faults <path>, the fault set that defines it.\n');
    return undefined;
  }
  const path = resolve(io.cwd, faults);
  let defs: Awaited<ReturnType<typeof importFaultSet>>['faults'];
  try {
    defs = (await importFaultSet(faultModule(path))).faults;
  } catch (cause) {
    io.err(`Cannot load the fault set ${display(path, io)}: ${message(cause)}\n`);
    return undefined;
  }
  return {
    ...deps,
    adapterFor: async (target: TargetRef, scope) => {
      if (target.adapter !== 'fault') return deps.adapterFor(target, scope);
      const def = defs.find((fault) => fault.id === target.agent);
      if (!def) return undefined;
      const dir = scope === undefined ? undefined : await scope.tempDir();
      return faultAdapter(def, () => localProvider(dir === undefined ? {} : { dir }));
    },
  };
}

/** A fault set path: a module, or a folder whose index module exports the faults. */
function faultModule(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) return path;
  for (const name of ['index.ts', 'index.mjs', 'index.js']) {
    if (existsSync(join(path, name))) return join(path, name);
  }
  throw new Error('the folder holds no index.ts, index.mjs or index.js');
}

/** The golden a run belongs to: spec, mode and perturbation. The target is what ci varies. */
function goldenOf(run: RunResult): string {
  return [run.specId, run.mode, ...(run.perturbationId === undefined ? [] : [run.perturbationId])].join(
    ' · ',
  );
}

/** The outcome of a stored run, by the rule `campaign status` applies: completed, every block passes, the end state matches. */
export function outcomeOfRun(run: RunResult): CellOutcome {
  return outcomeOf(
    {
      cellId: cellIdOf(run),
      specId: run.specId,
      specHash: run.specHash,
      target: run.target,
      mode: run.mode,
      repeat: run.repeat,
      ...(run.perturbationId === undefined ? {} : { perturbationId: run.perturbationId }),
      blocks: run.blocks.length,
    },
    run,
  );
}

/** Whether a stored run passes, as `campaign status` counts it. */
export function runPasses(run: RunResult): boolean {
  return outcomeOfRun(run).state === 'pass';
}

function armOf(runs: readonly RunResult[], flags: ReadonlySet<string>): ArmResult {
  const outcomes: CellOutcome[] = runs.map(outcomeOfRun);
  const passing = outcomes.filter((outcome) => outcome.state === 'pass').length;
  const flagged = runs.some((run) =>
    run.blocks.some((block) =>
      block.verdicts.some(
        (verdict) => verdict.gating && verdict.outcome === 'fail' && flags.has(verdict.name),
      ),
    ),
  );
  const firstFailing = outcomes.find((outcome) => outcome.state !== 'pass');
  return {
    pass: runs.length > 0 && passing === runs.length,
    runs: runs.length,
    passing,
    flagged,
    failing: firstFailing
      ? firstFailing.failing.length > 0
        ? firstFailing.failing
        : [firstFailing.run?.error ?? firstFailing.state]
      : [],
  };
}

type Paired = { pairs: CiPair[]; baselineOnly: string[]; candidateOnly: string[] };

/** Pairs the two campaigns golden by golden; a golden only one side ran is listed, never compared. */
export function pairArms(
  baseline: readonly RunResult[],
  candidate: readonly RunResult[],
  flags: readonly string[],
): Paired {
  const flagSet = new Set(flags);
  const group = (runs: readonly RunResult[]) => {
    const byGolden = new Map<string, RunResult[]>();
    for (const run of runs) {
      const key = goldenOf(run);
      byGolden.set(key, [...(byGolden.get(key) ?? []), run]);
    }
    return byGolden;
  };
  const base = group(baseline);
  const cand = group(candidate);
  const pairs: CiPair[] = [];
  for (const [name, runs] of [...cand.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const held = base.get(name);
    if (!held) continue;
    const first = runs[0] as RunResult;
    const b = armOf(held, flagSet);
    const c = armOf(runs, flagSet);
    pairs.push({
      name,
      specId: first.specId,
      mode: first.mode,
      ...(first.perturbationId === undefined ? {} : { perturbationId: first.perturbationId }),
      baseline: b,
      candidate: c,
      change: b.pass === c.pass ? 'same' : b.pass ? 'regressed' : 'improved',
      newFlag: c.flagged && !b.flagged,
    });
  }
  return {
    pairs,
    baselineOnly: [...base.keys()].filter((key) => !cand.has(key)).sort(),
    candidateOnly: [...cand.keys()].filter((key) => !base.has(key)).sort(),
  };
}

function summarize(input: {
  comparison: NonInferiorityResult;
  paired: Paired;
  flags: string[];
  marginPoints: number;
  baseline: CiSummary['baseline'];
  candidate: CiSummary['candidate'];
}): CiSummary {
  const { comparison, paired, candidate } = input;
  const { pairs } = paired;
  const table = {
    bothPass: pairs.filter((pair) => pair.baseline.pass && pair.candidate.pass).length,
    regressed: comparison.discordant.regressed,
    improved: comparison.discordant.improved,
    bothFail: pairs.filter((pair) => !pair.baseline.pass && !pair.candidate.pass).length,
  };
  const smallest = pairedRateDifference({ bothPass: pairs.length, regressed: 0, improved: 0, bothFail: 0 });
  let verdict: CiVerdict;
  let reason: string;
  if (candidate.incompleteCells > 0) {
    verdict = 'incomplete';
    reason = `${count(candidate.incompleteCells, 'cell')} of the candidate did not run (budget or pending): parity cannot be shown on part of the suite`;
  } else if (comparison.effect.upper >= comparison.margin) {
    verdict = 'regression';
    reason = `the upper bound ${pts(comparison.effect.upper)} points of the regression effect is not below the margin ${input.marginPoints} points`;
  } else if (comparison.newFlags.length > 0) {
    verdict = 'gating';
    reason = `a gating flag fires on the candidate where the baseline had none: ${comparison.newFlags.join(', ')}`;
  } else {
    verdict = 'parity';
    reason = `the upper bound ${pts(comparison.effect.upper)} points of the regression effect is below the margin ${input.marginPoints} points, and no new gating flag fires`;
  }
  return {
    verdict,
    exitCode: verdict === 'parity' ? 0 : 1,
    reason,
    marginPoints: input.marginPoints,
    comparator: COMPARATOR,
    flags: input.flags,
    baseline: input.baseline,
    candidate,
    pairs: pairs.length,
    table,
    effectPoints: {
      estimate: round(comparison.effect.estimate * 100),
      lower: round(comparison.effect.lower * 100),
      upper: round(comparison.effect.upper * 100),
    },
    smallestMarginPoints: round(smallest.upper * 100),
    regressed: [...comparison.regressedPairs],
    improved: pairs.filter((pair) => pair.change === 'improved').map((pair) => pair.name),
    newFlags: [...comparison.newFlags],
    unpaired: { baselineOnly: paired.baselineOnly, candidateOnly: paired.candidateOnly },
    rows: pairs,
  };
}

/** Changed goldens the table prints; the summary file holds every one. */
const SHOWN_ROWS = 25;

/** The verdict table ci prints. */
export function verdictText(summary: CiSummary, outPath: string): string {
  const lines: string[] = [];
  lines.push(
    `driftbench ci: candidate ${summary.candidate.target} (campaign ${summary.candidate.campaignId}) against baseline campaign ${summary.baseline.campaignId}, paired golden by golden (spec and mode, every repeat).`,
  );
  lines.push(
    ...table([
      ['measure', 'value'],
      ['goldens paired', String(summary.pairs)],
      ['both pass', String(summary.table.bothPass)],
      ['regressed', String(summary.table.regressed)],
      ['improved', String(summary.table.improved)],
      ['both fail', String(summary.table.bothFail)],
      ['new gating flags', String(summary.newFlags.length)],
      ['regression effect', `${signed(summary.effectPoints.estimate)} points`],
      [
        '95% interval',
        `[${signed(summary.effectPoints.lower)}, ${signed(summary.effectPoints.upper)}] points`,
      ],
      ['margin', `${summary.marginPoints} points`],
      ['smallest margin these pairs can show', `${summary.smallestMarginPoints} points`],
      ['verdict', summary.verdict.toUpperCase()],
    ]),
  );
  const changed = summary.rows.filter((row) => row.change !== 'same' || row.newFlag);
  if (changed.length > 0) {
    lines.push('');
    lines.push('Goldens that changed:');
    lines.push(
      ...table([
        ['golden', 'baseline', 'candidate', 'change', 'new flag', 'candidate failing'],
        ...changed
          .slice(0, SHOWN_ROWS)
          .map((row) => [
            row.name,
            `${row.baseline.passing}/${row.baseline.runs} pass`,
            `${row.candidate.passing}/${row.candidate.runs} pass`,
            row.change,
            row.newFlag ? 'yes' : 'no',
            row.candidate.failing.slice(0, 3).join(', '),
          ]),
      ]),
    );
  }
  if (changed.length > SHOWN_ROWS) {
    lines.push(`  and ${changed.length - SHOWN_ROWS} more: every golden is in the summary file.`);
  }
  const { baselineOnly, candidateOnly } = summary.unpaired;
  if (baselineOnly.length > 0) lines.push(`Not run by the candidate: ${baselineOnly.join(', ')}.`);
  if (candidateOnly.length > 0) lines.push(`Not in the baseline, not compared: ${candidateOnly.join(', ')}.`);
  lines.push('');
  lines.push(
    `Verdict: ${summary.verdict.toUpperCase()}. ${capital(summary.reason)}. Exit ${summary.exitCode}.`,
  );
  lines.push(`Summary: ${outPath}`);
  return `${lines.join('\n')}\n`;
}

async function openReported(deps: CampaignDeps, path: string, io: Io): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${display(path, io)}: ${message(cause)}\n`);
    return undefined;
  }
}

function display(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pts(rate: number): string {
  return (rate * 100).toFixed(2);
}

function signed(points: number): string {
  const text = points.toFixed(2);
  return points > 0 ? `+${text}` : text === '-0.00' ? '0.00' : text;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

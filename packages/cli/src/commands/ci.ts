import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  type CellOutcome,
  cellIdOf,
  outcomeOf,
  type RunResult,
  type Store,
  type TargetRef,
} from '@driftbench/core';
import { faultAdapter, importFaultSet } from '@driftbench/generate';
import {
  autoMargin,
  type CampaignData,
  type CompareResult,
  compareCampaigns,
  DEFAULT_FLAG_FAMILIES,
  loadCampaign,
  MIN_GOLDENS,
  unitsOf,
} from '@driftbench/report';
import { localProvider } from '@driftbench/sandbox';
import { pairedRateDifference } from '@driftbench/stats';
import type { Command } from 'commander';
import type { Io } from '../io';
import { type CampaignDeps, campaignRunCommand, defaultDeps, parseTarget } from './campaign';
import { parseGate } from './compare';

/**
 * The verdict families whose failing gating verdict is a gating FLAG, as `compare` counts them: an act that
 * must never happen. A flag that fires on the candidate where the baseline had none is a regression.
 */
export const DEFAULT_FLAGS = DEFAULT_FLAG_FAMILIES;

/** The summary file ci writes when `--out` is not given, relative to the working folder. */
export const DEFAULT_SUMMARY = 'driftbench-ci.json';

/**
 * ci reads `compare`'s verdict, one rule for both commands: `parity` is compare's non-inferior, `regression`
 * is compare's regressed (evidence of a drop or a new flag), `not-shown-non-inferior` is compare's unproven
 * (the intervals are wider than the margin: too few goldens, never a regression), `incomplete` is a
 * candidate cell that did not run.
 */
export type CiVerdict = 'parity' | 'regression' | 'not-shown-non-inferior' | 'incomplete';

const VERDICT_TEXT: Record<CiVerdict, string> = {
  parity: 'PARITY',
  regression: 'REGRESSION',
  'not-shown-non-inferior': 'NOT SHOWN NON-INFERIOR',
  incomplete: 'INCOMPLETE',
};

type CiCommandOptions = {
  specs: string;
  target: string;
  baseline: string;
  store: string;
  margin: string;
  minGoldens: string;
  strict?: boolean;
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

/** One golden as `compare` pairs it: a spec in one mode (and perturbation), every repeat of it. */
export type CiPair = {
  name: string;
  specId: string;
  mode: string;
  perturbationId?: string;
  baseline: { pass: boolean; runs: number; flags: string[] };
  candidate: { pass: boolean; runs: number; flags: string[]; failing: string[] };
  change: 'same' | 'regressed' | 'improved';
  newFlags: string[];
};

export type CiSummary = {
  verdict: CiVerdict;
  exitCode: 0 | 1;
  /** compare's reasons, in its words. */
  reasons: string[];
  /** The margin in percentage points, as given or as --margin auto chose it. */
  marginPoints: number;
  /** Set when --margin auto chose the margin: what it had to clear, what set it, and any warning. */
  marginAuto: { neededPoints: number; limitedBy: string; warning?: string } | null;
  /** Gating criteria on fewer goldens are underpowered and left out of the parity test unless strict. */
  minGoldens: number;
  strict: boolean;
  /** Underpowered gating criteria, with the goldens that decided them. */
  underpowered: Array<{ criterion: string; goldens: number }>;
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
  /** All-pass: baseline pass rate minus candidate pass rate, in points. Positive is a regression. */
  effectPoints: { estimate: number; lower: number; upper: number };
  /** The smallest margin, in points, these many pairs can show parity at when every pair passes on both. */
  smallestMarginPoints: number;
  /** Gating criteria whose interval is wider than the margin, with the goldens that decided them. */
  criteriaNotShown: Array<{ criterion: string; goldens: number; upperPoints: number }>;
  regressed: string[];
  improved: string[];
  /** `<golden> <family>` for each flag family new on the candidate. */
  newFlags: string[];
  /** Goldens only one side ran, or ran on another spec version: never compared. */
  unpaired: Array<{ unit: string; reason: string }>;
  rows: CiPair[];
};

export const COMPARATOR = 'compareCampaigns of @driftbench/report, the rule `driftbench compare` applies';

/**
 * Registers `driftbench ci`: run a candidate campaign, compare it with a baseline campaign by the rule of
 * `driftbench compare`, and exit 0 on parity, 1 on a regression, a comparison not shown non-inferior or an
 * incomplete run, 2 on bad input.
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
      'Run the specs on a candidate target, compare with a baseline campaign as `compare` does and gate: exit 0 on parity, 1 on a regression or a comparison not shown non-inferior, 2 on bad input.',
    )
    .requiredOption('--specs <path>', 'the spec file or folder the candidate runs')
    .requiredOption('--target <adapter[:agent]>', 'the candidate target, such as function:acme-sales')
    .requiredOption(
      '--baseline <campaign|store>',
      'the baseline: a store file (its latest campaign), or a campaign id held in --store',
    )
    .requiredOption('--store <file>', 'the store the candidate campaign is kept in')
    .option(
      '--margin <points|auto>',
      'the largest drop in pass rate tolerated, in percentage points; auto: the smallest margin at which the baseline compared with itself is non-inferior',
      'auto',
    )
    .option(
      '--min-goldens <n>',
      'a gating criterion decided on fewer goldens is underpowered and left out of the parity test',
      String(MIN_GOLDENS),
    )
    .option('--strict', 'underpowered criteria gate too, as compare did before the minimum existed')
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
      '--flag <family>',
      `a verdict family whose failure is a gating flag; repeat for several (default: ${DEFAULT_FLAGS.join(', ')})`,
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
  const gate = parseGate(options, io);
  if (!gate) return 2;
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
  const shared = { flagFamilies: flags, minGoldens: gate.minGoldens, strict: gate.strict };
  let margin: number;
  let marginAuto: CiSummary['marginAuto'] = null;
  if (gate.margin === 'auto') {
    const auto = autoMargin(baseline.data, shared);
    margin = auto.margin;
    marginAuto = {
      neededPoints: round(auto.needed * 100),
      limitedBy: auto.limitedBy,
      ...(auto.warning ? { warning: auto.warning } : {}),
    };
  } else {
    margin = gate.margin;
  }

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
  let candidate: CampaignData;
  try {
    candidate = await loadCampaign(store, report.campaignId);
  } catch (cause) {
    io.err(`Cannot read the candidate campaign ${report.campaignId}: ${message(cause)}\n`);
    return 2;
  } finally {
    await store.close();
  }

  let result: CompareResult;
  try {
    result = compareCampaigns(baseline.data, candidate, { ...shared, margin });
  } catch (cause) {
    io.err(
      `The baseline campaign ${baseline.data.campaign.campaignId} and the candidate cannot be compared: ${message(cause)}.\n`,
    );
    return 2;
  }
  const summary = summarize({
    result,
    candidateRuns: candidate.runs,
    flags,
    marginPoints: round(margin * 100),
    marginAuto,
    baseline: { campaignId: baseline.data.campaign.campaignId, store: baseline.store },
    candidate: {
      campaignId: report.campaignId,
      store: storePath,
      target: options.target,
      cells: report.summary.cells,
      incompleteCells: report.summary.stoppedByBudget + report.summary.pending,
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

/** The fields of the `campaign run --json` report ci reads. */
type CampaignReport = {
  campaignId: string;
  summary: { cells: number; stoppedByBudget: number; pending: number };
};

type Baseline = { data: CampaignData; store: string };

/**
 * The baseline campaign. A `--baseline` that names an existing file is a store: its latest campaign.
 * Anything else is a campaign id in the `--store` file.
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
    let data: CampaignData;
    try {
      data = await loadCampaign(store, campaignId);
    } catch (cause) {
      io.err(`Cannot read the baseline campaign ${campaignId}: ${message(cause)}\n`);
      return undefined;
    }
    if (data.runs.length === 0) {
      io.err(`The baseline campaign ${campaignId} has no run.\n`);
      return undefined;
    }
    return { data, store: path };
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

function summarize(input: {
  result: CompareResult;
  candidateRuns: readonly RunResult[];
  flags: string[];
  marginPoints: number;
  marginAuto: CiSummary['marginAuto'];
  baseline: CiSummary['baseline'];
  candidate: CiSummary['candidate'];
}): CiSummary {
  const { result, candidate } = input;
  const failing = failingByUnit(input.candidateRuns, input.flags);
  const rows: CiPair[] = result.pairs.map((pair) => {
    const b = pair.baseline;
    const c = pair.candidate;
    return {
      name: pair.unit,
      specId: pair.specId,
      mode: pair.mode,
      ...(pair.perturbationId === undefined ? {} : { perturbationId: pair.perturbationId }),
      baseline: { pass: b.allPass, runs: b.runs, flags: [...b.flags].sort() },
      candidate: {
        pass: c.allPass,
        runs: c.runs,
        flags: [...c.flags].sort(),
        failing: failing.get(pair.unit) ?? [],
      },
      change: b.allPass === c.allPass ? 'same' : b.allPass ? 'regressed' : 'improved',
      newFlags: [...c.flags].filter((family) => !b.flags.has(family)).sort(),
    };
  });
  const smallest = pairedRateDifference({ bothPass: rows.length, regressed: 0, improved: 0, bothFail: 0 });
  const verdict: CiVerdict =
    candidate.incompleteCells > 0
      ? 'incomplete'
      : result.verdict === 'non-inferior'
        ? 'parity'
        : result.verdict === 'regressed'
          ? 'regression'
          : 'not-shown-non-inferior';
  const reasons =
    verdict === 'incomplete'
      ? [
          `${count(candidate.incompleteCells, 'cell')} of the candidate did not run (budget or pending): parity cannot be shown on part of the suite`,
          ...result.reasons,
        ]
      : [...result.reasons];
  return {
    verdict,
    exitCode: verdict === 'parity' ? 0 : 1,
    reasons,
    marginPoints: input.marginPoints,
    marginAuto: input.marginAuto,
    minGoldens: result.minGoldens,
    strict: result.strict,
    underpowered: result.criteria
      .filter((entry) => entry.underpowered)
      .map((entry) => ({ criterion: entry.criterion, goldens: entry.units })),
    comparator: COMPARATOR,
    flags: input.flags,
    baseline: input.baseline,
    candidate,
    pairs: rows.length,
    table: { ...result.allPass.table },
    effectPoints: {
      estimate: round(result.allPass.effect.estimate * 100),
      lower: round(result.allPass.effect.lower * 100),
      upper: round(result.allPass.effect.upper * 100),
    },
    smallestMarginPoints: round(smallest.upper * 100),
    criteriaNotShown: result.criteria
      .filter(
        (entry) => entry.gating && entry.nonInferior === false && (result.strict || !entry.underpowered),
      )
      .map((entry) => ({
        criterion: entry.criterion,
        goldens: entry.units,
        upperPoints: round(entry.effect.upper * 100),
      })),
    regressed: rows.filter((row) => row.change === 'regressed').map((row) => row.name),
    improved: rows.filter((row) => row.change === 'improved').map((row) => row.name),
    newFlags: result.newFlags.map((flag) => `${flag.unit} ${flag.family}`),
    unpaired: result.unpaired.map((entry) => ({ ...entry })),
    rows,
  };
}

/** The failing gating checks of the first failing repeat of each candidate unit, named as compare names units. */
function failingByUnit(runs: readonly RunResult[], flags: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const units = unitsOf(runs, flags);
  for (const run of runs) {
    const outcome = outcomeOfRun(run);
    if (outcome.state === 'pass') continue;
    const base = `${run.specId} · ${run.mode}${run.perturbationId === undefined ? '' : ` · ${run.perturbationId}`}`;
    const unit = units.has(base) ? base : [...units.keys()].find((key) => key.startsWith(`${base} · `));
    if (unit === undefined || out.has(unit)) continue;
    out.set(unit, outcome.failing.length > 0 ? outcome.failing : [run.error ?? outcome.state]);
  }
  return out;
}

/** Changed goldens the table prints; the summary file holds every one. */
const SHOWN_ROWS = 25;

/** The verdict table ci prints. */
export function verdictText(summary: CiSummary, outPath: string): string {
  const lines: string[] = [];
  lines.push(
    `driftbench ci: candidate ${summary.candidate.target} (campaign ${summary.candidate.campaignId}) against baseline campaign ${summary.baseline.campaignId}, compared as driftbench compare does (golden by golden, every repeat).`,
  );
  if (summary.marginAuto) {
    lines.push(
      `Margin auto: ${summary.marginPoints} points, the smallest half point at which the baseline compared with itself is non-inferior (set by ${summary.marginAuto.limitedBy}, ${summary.marginAuto.neededPoints} points).`,
    );
    if (summary.marginAuto.warning) lines.push(`Warning: ${summary.marginAuto.warning}.`);
  }
  if (summary.underpowered.length > 0) {
    lines.push(
      `Underpowered, under ${summary.minGoldens} goldens${summary.strict ? ', gating anyway (--strict)' : ', left out of the parity test'}: ${summary.underpowered.map((entry) => `${entry.criterion} (${count(entry.goldens, 'golden')})`).join(', ')}.`,
    );
  }
  lines.push(
    ...table([
      ['measure', 'value'],
      ['goldens paired', String(summary.pairs)],
      ['both pass', String(summary.table.bothPass)],
      ['regressed', String(summary.table.regressed)],
      ['improved', String(summary.table.improved)],
      ['both fail', String(summary.table.bothFail)],
      ['new gating flags', String(summary.newFlags.length)],
      ['all-pass regression effect', `${signed(summary.effectPoints.estimate)} points`],
      [
        '95% interval',
        `[${signed(summary.effectPoints.lower)}, ${signed(summary.effectPoints.upper)}] points`,
      ],
      ['margin', `${summary.marginPoints} points${summary.marginAuto ? ' (auto)' : ''}`],
      ['smallest margin these pairs can show', `${summary.smallestMarginPoints} points`],
      ['gating criteria not shown within the margin', String(summary.criteriaNotShown.length)],
      [
        `underpowered (under ${summary.minGoldens} goldens)`,
        `${summary.underpowered.length}${summary.strict ? ', gating (--strict)' : ', left out of the parity test'}`,
      ],
      ['verdict', VERDICT_TEXT[summary.verdict]],
    ]),
  );
  const changed = summary.rows.filter((row) => row.change !== 'same' || row.newFlags.length > 0);
  if (changed.length > 0) {
    lines.push('');
    lines.push('Goldens that changed:');
    lines.push(
      ...table([
        ['golden', 'baseline', 'candidate', 'change', 'new flags', 'candidate failing'],
        ...changed
          .slice(0, SHOWN_ROWS)
          .map((row) => [
            row.name,
            row.baseline.pass ? 'pass' : 'fail',
            row.candidate.pass ? 'pass' : 'fail',
            row.change,
            row.newFlags.join(', ') || 'none',
            row.candidate.failing.slice(0, 3).join(', '),
          ]),
      ]),
    );
    if (changed.length > SHOWN_ROWS) {
      lines.push(`  and ${changed.length - SHOWN_ROWS} more: every golden is in the summary file.`);
    }
  }
  if (summary.unpaired.length > 0) {
    lines.push(
      `Not compared: ${summary.unpaired.map((entry) => `${entry.unit} (${entry.reason})`).join(', ')}.`,
    );
  }
  lines.push('');
  lines.push('Why:');
  for (const reason of summary.reasons) lines.push(`  - ${reason}`);
  lines.push('');
  lines.push(`Verdict: ${VERDICT_TEXT[summary.verdict]}. Exit ${summary.exitCode}.`);
  if (summary.verdict === 'not-shown-non-inferior') {
    lines.push(
      'Not shown non-inferior is not a regression: no evidence of a drop, but the intervals are wider than the margin. Add goldens, widen the margin, or let --margin auto choose it.',
    );
  }
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

function signed(points: number): string {
  const text = points.toFixed(2);
  return points > 0 ? `+${text}` : text === '-0.00' ? '0.00' : text;
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

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunMode, RunResult, Stimulus, Store } from '@driftbench/core';
import {
  createAnthropicJudge,
  createGoogleJudge,
  createOpenAiJudge,
  type JudgeClient,
  judgePairwise,
  readPairwiseCriterion,
} from '@driftbench/judges';
import {
  autoMargin,
  type CampaignData,
  compareCampaigns,
  comparePairwise,
  compareText,
  loadCampaign,
  MIN_GOLDENS,
  ReportInputError,
  replyPairs,
} from '@driftbench/report';
import { openStore } from '@driftbench/store';
import type { Command } from 'commander';
import type { Io } from '../io';

/** What compare and report open stores with. Tests pass their own. */
export type ReportDeps = {
  openStore(path: string): Promise<Store>;
  /** The judge a pairwise call uses, by name: openai, anthropic or google. Tests pass a fake. */
  pairwiseClient?(kind: string): JudgeClient;
};

/** The provider judges a `--pairwise-judge` name stands for. Keys are read from the environment. */
export function defaultPairwiseClient(kind: string): JudgeClient {
  if (kind === 'openai') return createOpenAiJudge({ id: 'pairwise-openai' });
  if (kind === 'anthropic') return createAnthropicJudge({ id: 'pairwise-anthropic' });
  if (kind === 'google') return createGoogleJudge({ id: 'pairwise-google' });
  throw new Error(`unknown pairwise judge ${kind}: use openai, anthropic or google`);
}

export const defaultReportDeps: ReportDeps = {
  openStore: async (path) => openStore(path),
  pairwiseClient: defaultPairwiseClient,
};

type CompareCommandOptions = {
  baseline: string;
  candidate: string;
  store: string;
  margin: string;
  mode?: string;
  q: string;
  minGoldens: string;
  strict?: boolean;
  json?: boolean;
  pairwise?: string;
  pairwiseJudge?: string;
  pairwiseReference?: string;
};

/** Registers `driftbench compare`. */
export function registerCompareCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: ReportDeps = defaultReportDeps,
): void {
  program
    .command('compare')
    .description(
      'Compare a candidate campaign with a baseline on the goldens both ran. Exit 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input.',
    )
    .requiredOption('--baseline <campaign>', 'the baseline campaign id')
    .requiredOption('--candidate <campaign>', 'the candidate campaign id')
    .requiredOption('--store <file>', 'the store that holds both campaigns')
    .option(
      '--margin <points|auto>',
      'the largest drop in pass rate tolerated, in percentage points, such as 2; auto: the smallest margin at which the baseline compared with itself is non-inferior',
      'auto',
    )
    .option(
      '--min-goldens <n>',
      'a gating criterion decided on fewer goldens is underpowered and left out of the parity test',
      String(MIN_GOLDENS),
    )
    .option('--strict', 'underpowered criteria gate too')
    .option('--mode <modes>', 'compare only these modes, such as F or T,F; default every mode both ran')
    .option('--q <rate>', 'false discovery rate of Benjamini-Hochberg across criteria', '0.05')
    .option('--json', 'print one JSON document')
    .option(
      '--pairwise <criterion.yaml>',
      'also judge, reply by reply, which of the two campaigns better meets this criterion, in both orders; the blocks both ran',
    )
    .option(
      '--pairwise-judge <kind>',
      'the judge of the pairwise calls: openai, anthropic or google',
      'openai',
    )
    .option(
      '--pairwise-reference <file>',
      'judge which reply matches this reference answer better, instead of which reply is better; the file holds the text',
    )
    .action(async (options: CompareCommandOptions) => {
      setExit(await compareCommand(options, io, deps));
    });
}

/** `driftbench compare`: 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input. */
export async function compareCommand(
  options: CompareCommandOptions,
  io: Io,
  deps: ReportDeps,
): Promise<number> {
  const gate = parseGate(options, io);
  const q = parseRate(options.q, '--q', io);
  const modes = options.mode === undefined ? undefined : parseModes(options.mode, io);
  if (gate === undefined || q === undefined || modes === null) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const baseline = await loadReported(store, options.baseline, io);
    const candidate = baseline ? await loadReported(store, options.candidate, io) : undefined;
    if (!baseline || !candidate) return 2;
    let result: ReturnType<typeof compareCampaigns>;
    try {
      const shared = {
        q,
        minGoldens: gate.minGoldens,
        strict: gate.strict,
        ...(modes ? { modes } : {}),
      };
      const margin = resolveMargin(gate, baseline, shared, options.json ? undefined : io);
      result = compareCampaigns(baseline, candidate, { ...shared, margin });
    } catch (cause) {
      io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
    let pairwise: PairwiseLine | undefined;
    if (options.pairwise !== undefined) {
      pairwise = await runPairwise(options, baseline, candidate, deps, io);
      if (pairwise === undefined) return 2;
    }
    if (options.json) {
      const body =
        pairwise === undefined ? compareJson(result) : { ...compareJson(result), pairwise: pairwise.json };
      io.out(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      io.out(compareText(result));
      if (pairwise !== undefined) io.out(`${pairwise.line}\n`);
    }
    return result.verdict === 'non-inferior' ? 0 : 1;
  } finally {
    await store.close();
  }
}

type PairwiseLine = { line: string; json: Record<string, number> };

/** The stimulus a block sent, as the text the pairwise judge reads it against. Empty when it has none. */
function stimulusText(when: Stimulus | undefined): string {
  if (when === undefined) return '';
  if ('user' in when) return when.user;
  if ('burst' in when) return when.burst.join(' / ');
  return when.injection.user;
}

/**
 * Judges each reply pair of the two campaigns with the criterion, in both orders. A judge that gives no answer
 * fails the command with its reason; it is never counted as a tie.
 */
async function runPairwise(
  options: CompareCommandOptions,
  baseline: CampaignData,
  candidate: CampaignData,
  deps: ReportDeps,
  io: Io,
): Promise<PairwiseLine | undefined> {
  let criterion: Awaited<ReturnType<typeof readPairwiseCriterion>>;
  let judge: JudgeClient;
  let reference: string | undefined;
  try {
    criterion = await readPairwiseCriterion(resolve(io.cwd, options.pairwise ?? ''));
    if (options.pairwiseReference !== undefined) {
      reference = (await readFile(resolve(io.cwd, options.pairwiseReference), 'utf8')).trim();
    }
    judge = (deps.pairwiseClient ?? defaultPairwiseClient)(options.pairwiseJudge ?? 'openai');
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
  const stimulusOf = (run: RunResult, index: number): string => {
    const loaded = baseline.specs.get(`${run.specId}@${run.specHash}`);
    return stimulusText(loaded?.ok ? loaded.spec.blocks[index]?.when : undefined);
  };
  const pairs = replyPairs(baseline.runs, candidate.runs, stimulusOf);
  try {
    const report = await comparePairwise(pairs, (pair) =>
      judgePairwise(
        judge,
        criterion,
        pair.stimulus === '' ? [] : [{ role: 'user', text: pair.stimulus }],
        pair.first,
        pair.second,
        reference === undefined ? {} : { reference },
      ),
    );
    const { tally } = report;
    const line = `Pairwise: ${pairs.length} pairs, baseline ${tally.baseline}, candidate ${tally.candidate}, tie ${tally.tie}, inconsistent ${tally.inconsistent}, position bias ${tally.positionBias}.`;
    return { line, json: { ...tally, pairs: pairs.length } };
  } catch (cause) {
    io.err(`pairwise judge gave no answer: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

/** The comparison with its maps and sets written as plain objects and lists. */
export function compareJson(result: ReturnType<typeof compareCampaigns>) {
  return {
    ...result,
    pairs: result.pairs.map((pair) => ({
      ...pair,
      baseline: sideJson(pair.baseline),
      candidate: sideJson(pair.candidate),
    })),
  };
}

function sideJson(side: ReturnType<typeof compareCampaigns>['pairs'][number]['baseline']) {
  return { ...side, criteria: Object.fromEntries(side.criteria), flags: [...side.flags].sort() };
}

export async function openReported(deps: ReportDeps, path: string, io: Io): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

export async function loadReported(
  store: Store,
  campaignId: string | undefined,
  io: Io,
): Promise<CampaignData | undefined> {
  try {
    return await loadCampaign(store, campaignId);
  } catch (cause) {
    if (cause instanceof ReportInputError) {
      io.err(`${cause.message}\n`);
      return undefined;
    }
    throw cause;
  }
}

/** The gate flags every comparing command takes: the margin (points or auto), the minimum goldens, strict. */
export type Gate = { margin: number | 'auto'; minGoldens: number; strict: boolean };

/** Parses --margin (points or auto), --min-goldens and --strict; undefined after printing why. */
export function parseGate(
  options: { margin: string; minGoldens: string; strict?: boolean },
  io: Io,
): Gate | undefined {
  const minGoldens = Number(options.minGoldens);
  if (!Number.isInteger(minGoldens) || minGoldens < 1) {
    io.err(`--min-goldens takes a whole number of at least 1, not "${options.minGoldens}".\n`);
    return undefined;
  }
  const margin = options.margin === 'auto' ? 'auto' : parseMargin(options.margin, io);
  if (margin === undefined) return undefined;
  return { margin, minGoldens, strict: options.strict === true };
}

/**
 * The margin a comparison runs at: the one given, or with auto the smallest margin at which the baseline
 * compared with itself is non-inferior. With `io`, the auto margin and any warning are printed.
 */
export function resolveMargin(
  gate: Gate,
  baseline: CampaignData,
  options: Omit<Parameters<typeof compareCampaigns>[2], 'margin'>,
  io?: Io,
): number {
  if (gate.margin !== 'auto') return gate.margin;
  const auto = autoMargin(baseline, options);
  io?.out(
    `Margin auto: ${(auto.margin * 100).toFixed(1)} points, the smallest half point at which the baseline compared with itself is non-inferior (set by ${auto.limitedBy}, ${(auto.needed * 100).toFixed(1)} points).\n`,
  );
  if (auto.warning) io?.out(`Warning: ${auto.warning}.\n`);
  return auto.margin;
}

/** A margin in points, such as 2, as a proportion; undefined after printing why it is not one. */
export function parseMargin(text: string, io: Io): number | undefined {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 100) {
    io.err(`--margin takes a number of points above 0 and below 100, such as 2, not "${text}".\n`);
    return undefined;
  }
  return value / 100;
}

function parseRate(text: string, flag: string, io: Io): number | undefined {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    io.err(`${flag} takes a number between 0 and 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

/** Modes separated by commas; null after printing an unknown one. */
export function parseModes(text: string, io: Io): RunMode[] | null {
  const modes: RunMode[] = [];
  for (const part of text.split(',').map((entry) => entry.trim())) {
    if (part !== 'T' && part !== 'F' && part !== 'P') {
      io.err(`Unknown mode "${part}". The modes are T, F and P, alone or separated by commas.\n`);
      return null;
    }
    if (!modes.includes(part)) modes.push(part);
  }
  return modes;
}

import { resolve } from 'node:path';
import type { RunMode, Store } from '@driftbench/core';
import { type CampaignData, compareCampaigns, compareText, loadCampaign, ReportInputError } from '@driftbench/report';
import { openStore } from '@driftbench/store';
import type { Command } from 'commander';
import type { Io } from '../io';

/** What compare and report open stores with. Tests pass their own. */
export type ReportDeps = {
  openStore(path: string): Promise<Store>;
};

export const defaultReportDeps: ReportDeps = {
  openStore: async (path) => openStore(path),
};

type CompareCommandOptions = {
  baseline: string;
  candidate: string;
  store: string;
  margin: string;
  mode?: string;
  q: string;
  json?: boolean;
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
    .requiredOption('--margin <points>', 'the largest drop in pass rate tolerated, in percentage points, such as 2')
    .option('--mode <modes>', 'compare only these modes, such as F or T,F; default every mode both ran')
    .option('--q <rate>', 'false discovery rate of Benjamini-Hochberg across criteria', '0.05')
    .option('--json', 'print one JSON document')
    .action(async (options: CompareCommandOptions) => {
      setExit(await compareCommand(options, io, deps));
    });
}

/** `driftbench compare`: 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input. */
export async function compareCommand(options: CompareCommandOptions, io: Io, deps: ReportDeps): Promise<number> {
  const margin = parseMargin(options.margin, io);
  const q = parseRate(options.q, '--q', io);
  const modes = options.mode === undefined ? undefined : parseModes(options.mode, io);
  if (margin === undefined || q === undefined || modes === null) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const baseline = await loadReported(store, options.baseline, io);
    const candidate = baseline ? await loadReported(store, options.candidate, io) : undefined;
    if (!baseline || !candidate) return 2;
    let result: ReturnType<typeof compareCampaigns>;
    try {
      result = compareCampaigns(baseline, candidate, { margin, q, ...(modes ? { modes } : {}) });
    } catch (cause) {
      io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      return 2;
    }
    if (options.json) io.out(`${JSON.stringify(compareJson(result), null, 2)}\n`);
    else io.out(compareText(result));
    return result.verdict === 'non-inferior' ? 0 : 1;
  } finally {
    await store.close();
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

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { RunMode } from '@driftbench/core';
import {
  buildScorecard,
  type CampaignData,
  type PilotReport,
  ReportInputError,
  readPilotReport,
  renderHtml,
  renderJunit,
} from '@driftbench/report';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  compareJson,
  defaultReportDeps,
  loadReported,
  openReported,
  parseMargin,
  parseModes,
  type ReportDeps,
} from './compare';

type ReportCommandOptions = {
  store: string;
  out: string;
  junit?: string;
  baseline?: string;
  margin: string;
  pilot?: string;
  by?: string;
  spreadMode?: string;
  maxRuns: string;
  json?: boolean;
};

/** Registers `driftbench report`. */
export function registerReportCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: ReportDeps = defaultReportDeps,
): void {
  program
    .command('report')
    .description(
      'Write the scorecard of a stored campaign as one HTML file, and its JUnit XML. Exit 0 when written, 2 on bad input.',
    )
    .argument('[campaign]', 'the campaign id; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .requiredOption('--out <file.html>', 'where to write the scorecard')
    .option('--junit <file.xml>', 'also write JUnit XML: one test suite per golden, one test case per run')
    .option('--baseline <campaign>', 'a baseline campaign in the same store: adds the compare diff')
    .option('--margin <points>', 'the non-inferiority margin in percentage points', '2')
    .option('--pilot <path>', 'a pilot report, pilot-report.json or its folder, rendered in the spread view')
    .option('--by <dimensions>', 'the generated-cell dimensions that name a spread cell, separated by commas')
    .option('--spread-mode <mode>', 'the mode the spread view reads; default F when the campaign ran it')
    .option('--max-runs <n>', 'runs in the drilldown, failing runs first', '200')
    .option('--json', 'also print the scorecard as one JSON document')
    .action(async (campaignId: string | undefined, options: ReportCommandOptions) => {
      setExit(await reportCommand(campaignId, options, io, deps));
    });
}

/** `driftbench report`: 0 when the files are written, 2 on bad input. */
export async function reportCommand(
  campaignId: string | undefined,
  options: ReportCommandOptions,
  io: Io,
  deps: ReportDeps,
): Promise<number> {
  const margin = parseMargin(options.margin, io);
  const maxRuns = Number(options.maxRuns);
  if (!Number.isInteger(maxRuns) || maxRuns < 0) {
    io.err(`--max-runs takes a whole number of 0 or more, not "${options.maxRuns}".\n`);
    return 2;
  }
  let spreadMode: RunMode | undefined;
  if (options.spreadMode !== undefined) {
    const modes = parseModes(options.spreadMode, io);
    if (modes === null) return 2;
    if (modes.length !== 1) {
      io.err(`--spread-mode takes one mode, not "${options.spreadMode}".\n`);
      return 2;
    }
    spreadMode = modes[0];
  }
  if (margin === undefined) return 2;
  let pilot: PilotReport | undefined;
  if (options.pilot !== undefined) {
    try {
      pilot = readPilotReport(resolve(io.cwd, options.pilot));
    } catch (cause) {
      if (!(cause instanceof ReportInputError)) throw cause;
      io.err(`${cause.message}\n`);
      return 2;
    }
  }
  const by = options.by
    ?.split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  let data: CampaignData | undefined;
  let baseline: CampaignData | undefined;
  try {
    data = await loadReported(store, campaignId, io);
    if (!data) return 2;
    if (options.baseline !== undefined) {
      baseline = await loadReported(store, options.baseline, io);
      if (!baseline) return 2;
    }
  } finally {
    await store.close();
  }

  let card: ReturnType<typeof buildScorecard>;
  try {
    card = buildScorecard(data, {
      margin,
      maxRuns,
      ...(baseline ? { baseline } : {}),
      ...(pilot ? { pilot } : {}),
      ...(by && by.length > 0 ? { by } : {}),
      ...(spreadMode ? { spreadMode } : {}),
    });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    io.err(`${cause.message}\n`);
    return 2;
  }
  const out = resolve(io.cwd, options.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderHtml(card));
  const written = [show(io, out)];
  if (options.junit !== undefined) {
    const junit = resolve(io.cwd, options.junit);
    await mkdir(dirname(junit), { recursive: true });
    await writeFile(junit, renderJunit(data));
    written.push(show(io, junit));
  }
  if (options.json) {
    io.out(
      `${JSON.stringify({ ...card, ...(card.compare ? { compare: compareJson(card.compare) } : {}) }, null, 2)}\n`,
    );
  } else {
    const c = card.campaign;
    io.out(
      `Campaign ${c.campaignId}: ${c.runs} runs, ${c.passing} pass, ${c.failing} fail, ${c.broken} did not complete.\n`,
    );
    if (card.compare) {
      io.out(
        `Against baseline ${card.compare.baseline.campaignId}: ${card.compare.verdict}, margin ${(margin * 100).toFixed(1)} points.\n`,
      );
    }
    io.out(`Wrote ${written.join(' and ')}.\n`);
  }
  return 0;
}

function show(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

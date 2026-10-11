import { relative, resolve } from 'node:path';
import { type Campaign, type RunResult, runsByCell, type Store } from '@driftbench/core';
import { cusum, ksTest, mean, pageHinkley, sampleVariance } from '@driftbench/stats';
import type { Command } from 'commander';
import type { Io } from '../io';
import { type CampaignDeps, defaultDeps } from './campaign';
import { runPasses } from './ci';

export const METRICS = ['pass_rate', 'cost', 'latency'] as const;
export type Metric = (typeof METRICS)[number];

/** The family-wise level of the KS scan: each split is tested at KS_ALPHA divided by the number of splits. */
export const KS_ALPHA = 0.05;
/** CUSUM allowance and threshold, and the Page-Hinkley delta and lambda, all in in-control sd units. */
export const ALLOWANCE_SD = 0.5;
export const THRESHOLD_SD = 5;
/**
 * Detectors that must alarm for a shift. One alone false-alarms too often on a short warmup (the in-control
 * mean is itself an estimate); two of three keep the detection. Measured rates: docs in examples/acme/ci.
 */
export const VOTES_NEEDED = 2;
/** Campaigns that set the in-control level, and the length of each KS segment. */
export const DEFAULT_WINDOW = 20;

/**
 * The smallest in-control sd a metric is given, so a flat warmup (every campaign at 100%) does not make
 * every later wobble an alarm: the larger of an absolute floor and 1% of the in-control mean.
 */
const SD_FLOOR: Record<Metric, number> = { pass_rate: 0.005, cost: 1e-6, latency: 1 };

type MonitorCommandOptions = {
  store: string;
  metric: string;
  window: string;
  series?: boolean;
  json?: boolean;
};

export type SeriesPoint = {
  index: number;
  campaignId: string;
  createdAt: string;
  runs: number;
  value: number;
  /**
   * The standard error of the value from its own runs: sqrt(p (1 - p) / n) for pass_rate, the sample sd of
   * the runs over sqrt(n) for cost and latency. It keeps a quiet warmup from understating the noise.
   */
  se?: number;
};

export type MonitorAlarm = {
  index: number;
  campaignId: string;
  direction: 'up' | 'down';
  /** CUSUM only: the first point of the run of non-zero sums that led to the alarm. */
  start?: number;
};

export type MonitorReport = {
  metric: Metric;
  store: string;
  window: number;
  campaigns: number;
  /** Campaigns with no run: left out of the series. */
  skipped: string[];
  inControl: {
    mean: number;
    /** The sd every detector uses: the largest of the three below. */
    sd: number;
    /** The sample sd of the first `window` campaign values. */
    sdBetween: number;
    /** The root mean square of their standard errors from their own runs. */
    sdWithin: number;
    /** The smallest sd the metric is given. */
    sdFloor: number;
    source: 'between' | 'within' | 'floor';
  };
  series: Array<SeriesPoint & { cusumUp: number; cusumDown: number; phUp: number; phDown: number }>;
  cusum: { alarms: MonitorAlarm[] };
  pageHinkley: { alarms: MonitorAlarm[] };
  ks:
    | {
        index: number;
        campaignId: string;
        statistic: number;
        pValue: number;
        /** The level each split is tested at: KS_ALPHA over the number of splits scanned. */
        alpha: number;
        change: boolean;
      }
    | undefined;
  /** How many of the three detectors alarmed anywhere in the series. */
  votes: number;
  /** A shift: at least VOTES_NEEDED detectors alarmed. */
  alarm: boolean;
};

/**
 * Registers `driftbench monitor`: CUSUM, Page-Hinkley and a sliding two-sample KS test over one metric of
 * every campaign in a store, ordered by creation time. Exit 1 when two of the three alarm, 0 otherwise, 2 on
 * bad input.
 */
export function registerMonitorCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: Pick<CampaignDeps, 'openStore'> = defaultDeps,
): void {
  program
    .command('monitor')
    .description(
      'Watch one metric across the campaigns of a store for a shift: CUSUM, Page-Hinkley and a sliding KS test. Exit 1 when two of the three alarm.',
    )
    .requiredOption('--store <file>', 'the store whose campaigns form the series')
    .requiredOption('--metric <metric>', `the metric per campaign: ${METRICS.join(', ')}`)
    .option(
      '--window <n>',
      'campaigns that set the in-control level (CUSUM warmup, Page-Hinkley minimum) and the length of each KS segment',
      String(DEFAULT_WINDOW),
    )
    .option('--series', 'also print every point of the series with its statistics')
    .option('--json', 'print one JSON document')
    .action(async (options: MonitorCommandOptions) => {
      setExit(await monitorCommand(options, io, deps));
    });
}

export async function monitorCommand(
  options: MonitorCommandOptions,
  io: Io,
  deps: Pick<CampaignDeps, 'openStore'>,
): Promise<number> {
  if (!(METRICS as readonly string[]).includes(options.metric)) {
    io.err(`--metric takes ${METRICS.join(', ')}, not "${options.metric}".\n`);
    return 2;
  }
  const metric = options.metric as Metric;
  const window = Number(options.window);
  if (!Number.isInteger(window) || window < 2) {
    io.err(`--window takes a whole number of at least 2, not "${options.window}".\n`);
    return 2;
  }
  const path = resolve(io.cwd, options.store);
  let store: Store;
  try {
    store = await deps.openStore(path);
  } catch (cause) {
    io.err(
      `Cannot open the store at ${display(path, io)}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }
  let points: SeriesPoint[];
  let skipped: string[];
  let campaigns: number;
  try {
    const ordered = [...(await store.listCampaigns())].sort(byCreation);
    campaigns = ordered.length;
    ({ points, skipped } = await seriesOf(store, ordered, metric));
  } finally {
    await store.close();
  }
  if (points.length < 2 * window) {
    io.err(
      `The store holds ${count(points.length, 'campaign')} with runs; --window ${window} needs at least ${2 * window}.\n`,
    );
    return 2;
  }
  const report = monitor(points, metric, window, { store: display(path, io), campaigns, skipped });
  if (options.json) io.out(`${JSON.stringify(report, null, 2)}\n`);
  else io.out(monitorText(report, options.series === true));
  return report.alarm ? 1 : 0;
}

function byCreation(a: Campaign, b: Campaign): number {
  return a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.campaignId.localeCompare(b.campaignId);
}

/** The metric of each campaign over the runs that stand for its cells. */
async function seriesOf(
  store: Store,
  campaigns: readonly Campaign[],
  metric: Metric,
): Promise<{ points: SeriesPoint[]; skipped: string[] }> {
  const points: SeriesPoint[] = [];
  const skipped: string[] = [];
  for (const campaign of campaigns) {
    const runs = [...(await runsByCell(store, campaign.campaignId)).values()];
    if (runs.length === 0) {
      skipped.push(campaign.campaignId);
      continue;
    }
    points.push({
      index: points.length,
      campaignId: campaign.campaignId,
      createdAt: campaign.createdAt,
      runs: runs.length,
      value: metricOf(runs, metric),
      se: standardErrorOf(runs, metric),
    });
  }
  return { points, skipped };
}

/** pass_rate: the share of runs that pass; cost: mean USD per run; latency: mean milliseconds per run. */
export function metricOf(runs: readonly RunResult[], metric: Metric): number {
  if (metric === 'pass_rate') return runs.filter(runPasses).length / runs.length;
  if (metric === 'cost') return mean(runs.map((run) => run.cost));
  return mean(runs.map((run) => run.latencyMs));
}

/** The standard error of a campaign's value from its own runs; 0 for a single run of cost or latency. */
export function standardErrorOf(runs: readonly RunResult[], metric: Metric): number {
  const n = runs.length;
  if (metric === 'pass_rate') {
    const p = metricOf(runs, metric);
    return Math.sqrt((p * (1 - p)) / n);
  }
  if (n < 2) return 0;
  const values = runs.map((run) => (metric === 'cost' ? run.cost : run.latencyMs));
  return Math.sqrt(sampleVariance(values) / n);
}

/** The three detectors over a series, with the in-control level taken from its first `window` points. */
export function monitor(
  points: readonly SeriesPoint[],
  metric: Metric,
  window: number,
  meta: { store: string; campaigns: number; skipped: string[] },
  tuning: { threshold?: number } = {},
): MonitorReport {
  const h = tuning.threshold ?? THRESHOLD_SD;
  const values = points.map((point) => point.value);
  const head = values.slice(0, window);
  const target = mean(head);
  const sdBetween = Math.sqrt(sampleVariance(head));
  const sdWithin = Math.sqrt(mean(points.slice(0, window).map((point) => (point.se ?? 0) ** 2)));
  const sdFloor = Math.max(SD_FLOOR[metric], 0.01 * Math.abs(target));
  const sd = Math.max(sdBetween, sdWithin, sdFloor);
  const source = sd === sdBetween ? 'between' : sd === sdWithin ? 'within' : 'floor';

  const cs = cusum(values, { target, sd, k: ALLOWANCE_SD, h, warmup: window });
  const ph = pageHinkley(values, {
    delta: ALLOWANCE_SD * sd,
    threshold: h * sd,
    minInstances: window,
  });
  const campaignAt = (index: number) => (points[index] as SeriesPoint).campaignId;

  let ks: MonitorReport['ks'];
  const splits = values.length - 2 * window + 1;
  const alpha = KS_ALPHA / splits;
  for (let index = window; index + window <= values.length; index += 1) {
    const result = ksTest(values.slice(index - window, index), values.slice(index, index + window));
    if (ks === undefined || result.statistic > ks.statistic) {
      ks = {
        index,
        campaignId: campaignAt(index),
        statistic: result.statistic,
        pValue: result.pValue,
        alpha,
        change: result.pValue < alpha,
      };
    }
  }

  const cusumAlarms = cs.alarms.map((alarm): MonitorAlarm => {
    const sums = alarm.direction === 'up' ? cs.upper : cs.lower;
    let start = alarm.index;
    while (start > 0 && (sums[start - 1] as number) > 0) start -= 1;
    return { index: alarm.index, campaignId: campaignAt(alarm.index), direction: alarm.direction, start };
  });
  const phAlarms = ph.alarms.map(
    (alarm): MonitorAlarm => ({
      index: alarm.index,
      campaignId: campaignAt(alarm.index),
      direction: alarm.direction,
    }),
  );
  const votes = [cusumAlarms.length > 0, phAlarms.length > 0, ks?.change === true].filter(Boolean).length;
  return {
    metric,
    store: meta.store,
    window,
    campaigns: meta.campaigns,
    skipped: meta.skipped,
    inControl: { mean: target, sd, sdBetween, sdWithin, sdFloor, source },
    series: points.map((point, index) => ({
      ...point,
      cusumUp: cs.upper[index] as number,
      cusumDown: cs.lower[index] as number,
      phUp: ph.up[index] as number,
      phDown: ph.down[index] as number,
    })),
    cusum: { alarms: cusumAlarms },
    pageHinkley: { alarms: phAlarms },
    ks,
    votes,
    alarm: votes >= VOTES_NEEDED,
  };
}

const SOURCE: Record<MonitorReport['inControl']['source'], string> = {
  between: 'the spread of the campaign values',
  within: 'the standard error of each campaign from its runs',
  floor: 'the floor of the metric',
};

export function monitorText(report: MonitorReport, withSeries: boolean): string {
  const lines: string[] = [];
  const show = (value: number) => format(report.metric, value);
  lines.push(
    `driftbench monitor: ${report.metric} over ${count(report.series.length, 'campaign')} of ${report.store}, oldest first. Window ${report.window}.`,
  );
  if (report.skipped.length > 0) lines.push(`Left out, no run: ${report.skipped.join(', ')}.`);
  lines.push(
    `In control (the first ${report.window}): mean ${show(report.inControl.mean)}, sd ${show(report.inControl.sd)} (${SOURCE[report.inControl.source]}). CUSUM k ${ALLOWANCE_SD} sd, h ${THRESHOLD_SD} sd; Page-Hinkley delta ${ALLOWANCE_SD} sd, lambda ${THRESHOLD_SD} sd; KS segments of ${report.window}, alpha ${KS_ALPHA} over the splits scanned.`,
  );
  const at = (index: number) => report.series[index] as MonitorReport['series'][number];
  const rows: string[][] = [['detector', 'first alarm', 'campaign', 'created', 'direction', 'detail']];
  const first = report.cusum.alarms[0];
  rows.push(
    first
      ? [
          'CUSUM',
          String(first.index),
          first.campaignId,
          at(first.index).createdAt,
          first.direction,
          `shift began at ${first.start}; ${count(report.cusum.alarms.length, 'alarm')} in all`,
        ]
      : ['CUSUM', 'none', '', '', '', ''],
  );
  const ph = report.pageHinkley.alarms[0];
  rows.push(
    ph
      ? [
          'Page-Hinkley',
          String(ph.index),
          ph.campaignId,
          at(ph.index).createdAt,
          ph.direction,
          `${count(report.pageHinkley.alarms.length, 'alarm')} in all`,
        ]
      : ['Page-Hinkley', 'none', '', '', '', ''],
  );
  const ks = report.ks;
  if (ks?.change) {
    const before = mean(report.series.slice(ks.index - report.window, ks.index).map((point) => point.value));
    const after = mean(report.series.slice(ks.index, ks.index + report.window).map((point) => point.value));
    rows.push([
      'KS',
      String(ks.index),
      ks.campaignId,
      at(ks.index).createdAt,
      after > before ? 'up' : 'down',
      `D ${ks.statistic.toFixed(2)}, p ${ks.pValue.toPrecision(2)}`,
    ]);
  } else {
    rows.push([
      'KS',
      'none',
      '',
      '',
      '',
      ks ? `largest D ${ks.statistic.toFixed(2)} at ${ks.index}, p ${ks.pValue.toPrecision(2)}` : '',
    ]);
  }
  lines.push(...table(rows));
  if (withSeries) {
    lines.push('');
    lines.push(
      ...table([
        ['index', 'campaign', 'created', report.metric, 'runs', 'cusum up', 'cusum down', 'ph up', 'ph down'],
        ...report.series.map((point) => [
          String(point.index),
          point.campaignId,
          point.createdAt,
          show(point.value),
          String(point.runs),
          point.cusumUp.toFixed(2),
          point.cusumDown.toFixed(2),
          show(point.phUp),
          show(point.phDown),
        ]),
      ]),
    );
  }
  lines.push('');
  lines.push(
    report.alarm
      ? `Shift detected: ${report.votes} of 3 detectors alarmed. Exit 1.`
      : `No shift: ${report.votes} of 3 detectors alarmed, ${VOTES_NEEDED} needed. Exit 0.`,
  );
  return `${lines.join('\n')}\n`;
}

function format(metric: Metric, value: number): string {
  if (metric === 'pass_rate') return `${(value * 100).toFixed(1)}%`;
  if (metric === 'cost') return `$${value.toFixed(4)}`;
  return `${value.toFixed(0)} ms`;
}

function display(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
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

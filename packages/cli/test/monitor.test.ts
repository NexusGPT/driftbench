import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Campaign, RunResult } from '@agent-nexus/driftbench-core';
import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, describe, expect, it } from 'vitest';
import { type MonitorReport, monitor, type SeriesPoint } from '../src/commands/monitor';
import { type Io, main } from '../src/index';

/** Fictional data only: synthetic Acme campaigns, no agent runs. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SLOW = 60_000;
/** The counts the rate test measured: see it. */
const MEASURED = { falseAlarms: 16, anyDetector: 41, placed: 193 };

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function tempFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-monitor-'));
  made.push(dir);
  return dir;
}

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), out, err };
}

/** One synthetic run: one block that passes or not, with its cost and latency. */
function syntheticRun(
  campaign: number,
  repeat: number,
  pass: boolean,
  cost: number,
  latencyMs: number,
): RunResult {
  const startedAt = new Date(Date.UTC(2026, 0, 1 + campaign, 9, 0, repeat)).toISOString();
  return {
    runId: `run-${campaign}-${repeat}`,
    specId: 'acme-plan-upgrade',
    specHash: 'abc123abc123',
    target: { adapter: 'function', agent: 'acme-sales' },
    mode: 'F',
    repeat,
    status: 'completed',
    blocks: [
      {
        index: 0,
        givenHash: 'given-0',
        observed: {
          segments: [],
          text: 'Acme Fiber 500 is $45 a month.',
          toolCalls: [],
          cost: {},
          latencyMs,
        },
        verdicts: [],
        ledgerCheck: { ok: true, contradictions: [] },
        drift: [],
        pass,
      },
    ],
    succession: {
      driftCount: pass ? 0 : 1,
      driftRate: pass ? 0 : 1,
      longestClean: pass ? 1 : 0,
      minOverBlocks: pass,
    },
    cost,
    latencyMs,
    startedAt,
    finishedAt: startedAt,
    cacheHit: false,
  };
}

type Plant = {
  campaigns?: number;
  runs?: number;
  /** Probability a run passes before and from the planted index. */
  pass?: [number, number];
  /** Mean cost per run before and from the planted index (sd 5% of the first). */
  cost?: [number, number];
  /** Mean latency per run before and from the planted index (sd 5% of the first). */
  latency?: [number, number];
  at: number;
  seed: number;
  /** Write the campaigns in this order of their index (time order is set by createdAt alone). */
  order?: number[];
  /** Campaign indexes written with no run. */
  empty?: number[];
};

/** A store of synthetic campaigns, one a day, with a shift planted at `at`. */
async function plantedStore(plant: Plant): Promise<string> {
  const n = plant.campaigns ?? 60;
  const runs = plant.runs ?? 20;
  const random = mulberry32(plant.seed);
  const gauss = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const path = join(await tempFolder(), 'monitor.db');
  const store = openStore(path);
  try {
    const order = plant.order ?? [...Array(n).keys()];
    for (const index of order) {
      const after = index >= plant.at ? 1 : 0;
      const campaign: Campaign = {
        campaignId: `c-day-${String(index).padStart(2, '0')}`,
        specs: [{ id: 'acme-plan-upgrade', hash: 'abc123abc123' }],
        targets: [{ adapter: 'function', agent: 'acme-sales' }],
        modes: ['F'],
        repeats: { T: 0, F: runs, P: 0 },
        budgetUsd: 0,
        judge: { mode: 'system1', judges: [] },
        createdAt: new Date(Date.UTC(2026, 0, 1 + index, 9)).toISOString(),
      };
      await store.putCampaign(campaign);
      if (plant.empty?.includes(index)) continue;
      const passP = plant.pass?.[after] ?? 0.9;
      const costMean = plant.cost?.[after] ?? 0.02;
      const costSd = 0.05 * (plant.cost?.[0] ?? 0.02);
      const latencyMean = plant.latency?.[after] ?? 1200;
      const latencySd = 0.05 * (plant.latency?.[0] ?? 1200);
      for (let repeat = 0; repeat < runs; repeat += 1) {
        await store.putRun(
          campaign.campaignId,
          syntheticRun(
            index,
            repeat,
            random() < passP,
            Math.max(0, costMean + costSd * gauss()),
            Math.max(0, latencyMean + latencySd * gauss()),
          ),
        );
      }
    }
  } finally {
    await store.close();
  }
  return path;
}

async function monitorJson(path: string, metric: string, extra: string[] = []) {
  const result = await cli(['monitor', '--store', path, '--metric', metric, '--json', ...extra]);
  expect(result.err).toBe('');
  return { code: result.code, report: JSON.parse(result.out) as MonitorReport };
}

/**
 * The shift is found at the planted index: at least two of the three detectors place it within 3 points
 * (CUSUM and Page-Hinkley alarm at or after it, KS splits within 3 either side), the vote exits 1, and
 * neither sequential detector alarms before it.
 */
function expectDetectedAt(report: MonitorReport, at: number, direction: 'up' | 'down') {
  const cusum = report.cusum.alarms[0];
  const ph = report.pageHinkley.alarms[0];
  const within = (alarm: { index: number; direction: string } | undefined) =>
    alarm !== undefined && alarm.direction === direction && alarm.index >= at && alarm.index <= at + 3;
  const ks = report.ks?.change === true && Math.abs(report.ks.index - at) <= 3;
  const placed = [within(cusum), within(ph), ks].filter(Boolean).length;
  expect(placed, JSON.stringify({ cusum, ph, ks: report.ks })).toBeGreaterThanOrEqual(2);
  expect(report.cusum.alarms.every((alarm) => alarm.index >= at)).toBe(true);
  expect(report.pageHinkley.alarms.every((alarm) => alarm.index >= at)).toBe(true);
  expect(report.votes).toBeGreaterThanOrEqual(2);
  expect(report.alarm).toBe(true);
}

describe('driftbench monitor on 60 synthetic campaigns', () => {
  it.each([1, 2, 3, 4, 5])(
    'detects a pass rate drop from 90% to 60% planted at campaign 30 within 3 points (seed %i)',
    async (seed) => {
      const path = await plantedStore({ pass: [0.9, 0.6], at: 30, seed });
      const { code, report } = await monitorJson(path, 'pass_rate');
      expect(code).toBe(1);
      expect(report.series).toHaveLength(60);
      expectDetectedAt(report, 30, 'down');
    },
    SLOW,
  );

  it(
    'detects a latency rise planted at campaign 38 and a cost rise planted at campaign 33',
    async () => {
      const latency = await monitorJson(
        await plantedStore({ latency: [1200, 1500], at: 38, seed: 7 }),
        'latency',
      );
      expect(latency.code).toBe(1);
      expectDetectedAt(latency.report, 38, 'up');
      const cost = await monitorJson(await plantedStore({ cost: [0.02, 0.026], at: 33, seed: 8 }), 'cost');
      expect(cost.code).toBe(1);
      expectDetectedAt(cost.report, 33, 'up');
    },
    SLOW,
  );

  it.each([11, 12, 13, 14, 15])(
    'raises no alarm on a pass rate series with no shift (seed %i)',
    async (seed) => {
      const path = await plantedStore({ pass: [0.9, 0.9], at: 60, seed });
      const { code, report } = await monitorJson(path, 'pass_rate');
      expect(report.votes).toBeLessThan(2);
      expect(report.alarm).toBe(false);
      expect(code).toBe(0);
    },
    SLOW,
  );

  it(
    'orders the series by creation time, not by the order the campaigns were written',
    async () => {
      const order = [...Array(60).keys()].sort((a, b) => ((a * 37) % 60) - ((b * 37) % 60));
      expect(order.slice(0, 5)).not.toEqual([0, 1, 2, 3, 4]);
      const path = await plantedStore({ pass: [0.9, 0.6], at: 30, seed: 1, order });
      const { report } = await monitorJson(path, 'pass_rate');
      expect(report.series.map((point) => point.campaignId)).toEqual(
        [...Array(60).keys()].map((index) => `c-day-${String(index).padStart(2, '0')}`),
      );
      expectDetectedAt(report, 30, 'down');
    },
    SLOW,
  );

  it(
    'leaves out a campaign with no run and says so',
    async () => {
      const path = await plantedStore({ pass: [0.9, 0.6], at: 30, seed: 2, empty: [5] });
      const { report } = await monitorJson(path, 'pass_rate');
      expect(report.campaigns).toBe(60);
      expect(report.skipped).toEqual(['c-day-05']);
      expect(report.series).toHaveLength(59);
      // Campaign 30 is now point 29 of the series.
      expectDetectedAt(report, 29, 'down');
      const printed = await cli(['monitor', '--store', path, '--metric', 'pass_rate']);
      expect(printed.out).toContain('Left out, no run: c-day-05.');
    },
    SLOW,
  );

  it(
    'prints the detector table, and the series with --series',
    async () => {
      const path = await plantedStore({ pass: [0.9, 0.6], at: 30, seed: 1 });
      const { report } = await monitorJson(path, 'pass_rate');
      const printed = await cli(['monitor', '--store', path, '--metric', 'pass_rate']);
      expect(printed.code).toBe(1);
      const cusum = report.cusum.alarms[0] as MonitorReport['cusum']['alarms'][number];
      expect(printed.out).toMatch(
        new RegExp(`CUSUM +${cusum.index} +${cusum.campaignId} +\\S+ +down +shift began at ${cusum.start}`),
      );
      expect(printed.out).toMatch(/Page-Hinkley +3\d +c-day-3\d/);
      expect(printed.out).toMatch(/KS +3\d +c-day-3\d +\S+ +down +D \d\.\d\d, p /);
      expect(printed.out).toMatch(/Shift detected: [23] of 3 detectors alarmed\. Exit 1\./);
      expect(printed.out).not.toContain('c-day-00');
      const series = await cli(['monitor', '--store', path, '--metric', 'pass_rate', '--series']);
      const firstDay = new Date(Date.UTC(2026, 0, 1, 9)).toISOString().replace(/\./g, '\\.');
      expect(series.out).toMatch(new RegExp(`^ {2}0 +c-day-00 +${firstDay} +\\d+\\.\\d% +20 `, 'm'));
      expect(series.out.match(/c-day-\d\d +2026/g)).toHaveLength(60 + 3);
    },
    SLOW,
  );
});

describe('monitor()', () => {
  const points = (values: number[]): SeriesPoint[] =>
    values.map((value, index) => ({
      index,
      campaignId: `c-${index}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`,
      runs: 10,
      value,
    }));

  it('floors the in-control sd of a flat warmup, so a one point wobble is no alarm but a drop is', () => {
    const flat = monitor(points([...Array(20).fill(1), 0.99, ...Array(19).fill(1)]), 'pass_rate', 10, {
      store: 's',
      campaigns: 40,
      skipped: [],
    });
    expect(flat.inControl).toMatchObject({ mean: 1, sdBetween: 0, sdWithin: 0, source: 'floor' });
    expect(flat.inControl.sd).toBeCloseTo(0.01, 12);
    expect(flat.votes).toBe(0);
    expect(flat.alarm).toBe(false);
    const drop = monitor(points([...Array(20).fill(1), ...Array(20).fill(0.9)]), 'pass_rate', 10, {
      store: 's',
      campaigns: 40,
      skipped: [],
    });
    expect(drop.cusum.alarms[0]).toMatchObject({ index: 20, direction: 'down', start: 20 });
    expect(drop.pageHinkley.alarms[0]?.index).toBe(20);
    expect(drop.ks).toMatchObject({ index: 20, statistic: 1, change: true });
    expect(drop.ks?.alpha).toBeCloseTo(0.05 / 21, 12);
    expect(drop.votes).toBe(3);
    // Tied splits keep the first: on a flat series every D is 0 and the KS change sits at the first split.
    const level = monitor(points(Array(40).fill(0.9)), 'pass_rate', 10, {
      store: 's',
      campaigns: 40,
      skipped: [],
    });
    expect(level.ks).toMatchObject({ index: 10, statistic: 0, change: false });
    // A smaller drop takes three points to cross h; the CUSUM dates its start back to the first of them.
    const slow = monitor(points([...Array(20).fill(1), ...Array(20).fill(0.975)]), 'pass_rate', 10, {
      store: 's',
      campaigns: 40,
      skipped: [],
    });
    expect(slow.cusum.alarms[0]).toMatchObject({ index: 22, direction: 'down', start: 20 });
  });

  it('takes the in-control sd from the runs when the warmup campaigns happen to agree', () => {
    const quiet = monitor(
      points(Array(40).fill(0.9)).map((point) => ({ ...point, se: 0.067 })),
      'pass_rate',
      20,
      { store: 's', campaigns: 40, skipped: [] },
    );
    expect(quiet.inControl).toMatchObject({ sdBetween: 0, source: 'within' });
    expect(quiet.inControl.sdWithin).toBeCloseTo(0.067, 12);
    expect(quiet.inControl.sd).toBe(quiet.inControl.sdWithin);
  });

  /**
   * The rates behind VOTES_NEEDED, on 200 synthetic series of 60 campaigns of 20 runs each (pass rate 90%,
   * binomial noise, seeds 1 to 200, default window 20). Measured 2026-10-11 on this code.
   */
  it('false-alarms on few no-shift series and places a 30 point drop within 3 points on most', () => {
    const binomial = (seed: number, after: number, at: number): SeriesPoint[] => {
      const random = mulberry32(seed);
      return [...Array(60).keys()].map((index) => {
        let passing = 0;
        for (let run = 0; run < 20; run += 1) if (random() < (index >= at ? after : 0.9)) passing += 1;
        const value = passing / 20;
        return {
          index,
          campaignId: `c-${index}`,
          createdAt: `t-${index}`,
          runs: 20,
          value,
          se: Math.sqrt((value * (1 - value)) / 20),
        };
      });
    };
    const meta = { store: 's', campaigns: 60, skipped: [] };
    let falseAlarms = 0;
    let anyDetector = 0;
    let placed = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const quiet = monitor(binomial(seed, 0.9, 99), 'pass_rate', 20, meta);
      if (quiet.alarm) falseAlarms += 1;
      if (quiet.votes > 0) anyDetector += 1;
      const drop = monitor(binomial(seed + 1000, 0.6, 30), 'pass_rate', 20, meta);
      const within = (alarm?: { index: number }) =>
        alarm !== undefined && alarm.index >= 30 && alarm.index <= 33;
      const ks = drop.ks?.change === true && Math.abs(drop.ks.index - 30) <= 3;
      if (
        drop.alarm &&
        [within(drop.cusum.alarms[0]), within(drop.pageHinkley.alarms[0]), ks].filter(Boolean).length >= 2
      )
        placed += 1;
    }
    expect({ falseAlarms, anyDetector, placed }).toEqual(MEASURED);
    expect(falseAlarms).toBeLessThan(anyDetector);
  });
});

describe('driftbench monitor input', () => {
  it(
    'exits 2 on an unknown metric, a window under 2, and a store with too few campaigns',
    async () => {
      const path = await plantedStore({ pass: [0.9, 0.9], at: 60, seed: 1, campaigns: 15 });
      const metric = await cli(['monitor', '--store', path, '--metric', 'accuracy']);
      expect(metric.code).toBe(2);
      expect(metric.err).toContain('--metric takes pass_rate, cost, latency, not "accuracy"');
      const window = await cli(['monitor', '--store', path, '--metric', 'cost', '--window', '1']);
      expect(window.code).toBe(2);
      expect(window.err).toContain('--window takes a whole number of at least 2, not "1"');
      const short = await cli(['monitor', '--store', path, '--metric', 'cost']);
      expect(short.code).toBe(2);
      expect(short.err).toContain('The store holds 15 campaigns with runs; --window 20 needs at least 40.');
      const half = await cli(['monitor', '--store', path, '--metric', 'cost', '--window', '10']);
      expect(half.code).toBe(2);
      expect(half.err).toContain('The store holds 15 campaigns with runs; --window 10 needs at least 20.');
      const fits = await cli(['monitor', '--store', path, '--metric', 'cost', '--window', '5']);
      expect(fits.err).toBe('');
      expect(fits.code).toBe(0);
    },
    SLOW,
  );

  it(
    'says what to do when the store is too small for the window: a window that fits, or how many campaigns to gather',
    async () => {
      const fifteen = await plantedStore({ pass: [0.9, 0.9], at: 60, seed: 1, campaigns: 15 });
      const short = await cli(['monitor', '--store', fifteen, '--metric', 'pass_rate']);
      expect(short.code).toBe(2);
      expect(short.err).toBe(
        'The store holds 15 campaigns with runs; --window 20 needs at least 40. Nothing is wrong with the store: the monitor cannot decide on so few points. Run more campaigns into it, or pass a window that fits: --window 7 at most.\n',
      );
      const three = await plantedStore({ pass: [0.9, 0.9], at: 60, seed: 1, campaigns: 3 });
      const tiny = await cli(['monitor', '--store', three, '--metric', 'pass_rate']);
      expect(tiny.code).toBe(2);
      expect(tiny.err).toBe(
        'The store holds 3 campaigns with runs; --window 20 needs at least 40. Nothing is wrong with the store: the monitor cannot decide on so few points. Run more campaigns into it: the smallest window, --window 2, needs 4.\n',
      );
    },
    SLOW,
  );
});

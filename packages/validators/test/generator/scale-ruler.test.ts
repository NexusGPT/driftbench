import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

type Spawned = { kind: 'calibration' | 'child'; env?: Record<string, string> };
const state = vi.hoisted(() => ({
  samples: [] as number[],
  raw: 40_000,
  events: [] as Spawned[],
}));

// The calibration processes answer from a queue; the timed child answers with a report built from the calibration it was
// handed. Nothing real runs: the test reads the order of the processes and the numbers the parent derives from them.
vi.mock('node:child_process', () => ({
  spawn: (_exe: string, args: string[], options: { env?: Record<string, string> }) => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    const isCalibration = args.some((arg) => arg.endsWith('/scale-calibrate.ts'));
    let line: string;
    if (isCalibration) {
      state.events.push({ kind: 'calibration' });
      line = String(state.samples.shift());
    } else {
      const env = options.env ?? {};
      state.events.push({ kind: 'child', env });
      const calibration = Number(env.DRIFTBENCH_SCALE_CALIBRATION_MS);
      line = JSON.stringify({
        factor: 100,
        budgetMs: 120_000,
        ms: state.raw,
        calibrationMs: calibration,
        referenceMs: 250,
        normalisedMs: (state.raw * 250) / calibration,
        creditCapped: false,
        invalid: 0,
        lint: 0,
        bytesSame: true,
        graphOk: true,
        graphDetail: 'ok',
        twiseShare: 1,
        boundaryOk: true,
        boundaryMissing: 0,
        deviationOk: true,
        deviationMissing: 0,
        unwalked: 0,
        completeShare: 1,
        followerPass: 1,
        followerTotal: 1,
      });
    }
    queueMicrotask(() => {
      proc.stdout.emit('data', `${line}\n`);
      proc.emit('close', 0);
    });
    return proc;
  },
}));

import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { scaleReport } from '../../src/ladders/generator/scale';
import { calibrationOf, normalisedMs } from '../../src/ladders/generator/scale-calibration';

async function timeVerdict(report: Awaited<ReturnType<typeof scaleReport>>) {
  const item = bankItems().find((entry) => entry.id === 'scale.100x.time');
  if (!item) throw new Error('no scale.100x.time item');
  return item.check(new SeedData(1, {}, async () => report));
}

function measure(samples: number[], raw: number, left: number[] = []) {
  state.samples = [...samples, ...left];
  state.raw = raw;
  state.events = [];
  return scaleReport(100, 1);
}

/**
 * The ruler is not moved by what it measures, and a noise fix does not widen what passes. Each case is a sequence of
 * five calibration samples and a raw time of the product. The "old" verdict is the one the first sample alone gives.
 */
describe('the scale time never becomes easier than with the first sample alone', () => {
  for (const draw of [
    { raw: 40_000, samples: [100, 200, 200, 200, 200] },
    { raw: 70_000, samples: [100, 100, 300, 300, 300] },
  ]) {
    it(`keeps the failure on the samples ${draw.samples.join(', ')}`, async () => {
      const report = await measure(draw.samples, draw.raw);
      expect(report.error).toBeUndefined();
      expect(report.calibrationRunsMs).toEqual(draw.samples);
      const old = {
        ...report,
        calibrationMs: draw.samples[0] as number,
        normalisedMs: normalisedMs(draw.raw, draw.samples[0] as number),
      };
      expect((await timeVerdict(old)).pass).toBe(false);
      expect(report.normalisedMs).toBeGreaterThanOrEqual(old.normalisedMs);
      const verdict = await timeVerdict(report);
      expect(verdict.pass, verdict.detail).toBe(false);
    });
  }

  // codex probe 39969203478: the decision uses the exact samples, never samples rounded to a tenth
  for (const draw of [
    { raw: 60_000, samples: [249.96, 250, 250, 250, 250], old: 60_010, rounded: 60_000 },
    { raw: 24_015, samples: [100.06, 100.06, 100.06, 100.06, 100.06], old: 60_001, rounded: 59_978 },
  ]) {
    it(`keeps the failure of ${draw.old} ms normalised on the samples ${draw.samples.join(', ')} (rounded to a tenth it would be ${draw.rounded})`, async () => {
      const report = await measure(draw.samples, draw.raw);
      expect(report.error).toBeUndefined();
      expect(report.calibrationRunsMs).toEqual(draw.samples);
      expect(report.calibrationMs).toBe(draw.samples[0]);
      expect(report.normalisedMs).toBe(draw.old);
      const child = state.events.find((event) => event.kind === 'child');
      expect(Number(child?.env?.DRIFTBENCH_SCALE_CALIBRATION_MS)).toBe(draw.samples[0]);
      const verdict = await timeVerdict(report);
      expect(verdict.pass, verdict.detail).toBe(false);
    });
  }

  it('on 300 random sequences, never lowers the normalised time and never flips a failure to a pass', async () => {
    let seed = 424_242;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    let lowered = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      // samples with decimals, as the calibration process prints them, and a raw time with decimals
      const samples = Array.from({ length: 5 }, () => 60 + next() * 500);
      const raw = 20_000 + next() * 100_000;
      const report = await measure(samples, raw);
      const old = normalisedMs(raw, samples[0] as number);
      expect(report.normalisedMs, `trial ${trial}: ${samples.join(', ')} raw ${raw}`).toBeGreaterThanOrEqual(
        old,
      );
      expect(report.calibrationMs).toBe(calibrationOf(samples));
      if (report.normalisedMs > old) lowered += 1;
      const failedBefore = old > 60_000;
      if (failedBefore) expect((await timeVerdict(report)).pass, `trial ${trial}`).toBe(false);
    }
    // the rule is not a no-op: on some sequences the median pulled the first sample down
    expect(lowered).toBeGreaterThan(0);
  });
});

describe('every calibration is taken before the product starts, none after', () => {
  it('spawns five calibrations, then the timed child, then nothing', async () => {
    await measure([250, 250, 250, 250, 250], 50_000);
    expect(state.events.map((event) => event.kind)).toEqual([
      'calibration',
      'calibration',
      'calibration',
      'calibration',
      'calibration',
      'child',
    ]);
  });

  it('hands the timed child the calibration of the run, the one the report is normalised with', async () => {
    const report = await measure([100, 200, 200, 200, 200], 40_000);
    const child = state.events.find((event) => event.kind === 'child');
    expect(Number(child?.env?.DRIFTBENCH_SCALE_CALIBRATION_MS)).toBe(report.calibrationMs);
    expect(report.calibrationMs).toBe(100);
  });

  it('is not moved by a product that leaves a busy process behind: samples queued for after the run are never taken', async () => {
    // a busy leftover would inflate later samples. Two such samples wait in the queue behind the five that count.
    const report = await measure([250, 250, 250, 250, 250], 50_000, [900, 900]);
    expect(state.samples).toEqual([900, 900]);
    expect(report.calibrationRunsMs).toEqual([250, 250, 250, 250, 250]);
    expect(report.calibrationMs).toBe(250);
    expect(report.normalisedMs).toBe(normalisedMs(50_000, 250));
  });

  it('takes one calibration when asked for one, and still none after the run', async () => {
    state.samples = [250, 900];
    state.raw = 50_000;
    state.events = [];
    const report = await scaleReport(100, 1, 120_000, { calibrations: 1 });
    expect(state.events.map((event) => event.kind)).toEqual(['calibration', 'child']);
    expect(report.calibrationRunsMs).toEqual([250]);
    expect(state.samples).toEqual([900]);
  });
});

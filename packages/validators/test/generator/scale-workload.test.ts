import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { SCALE_BASE_BEHAVIOURS, scaledSpec, scaleReport } from '../../src/ladders/generator/scale';
import {
  CALIBRATION_COUNT,
  calibrationOf,
  medianOf,
  normalisedMs,
} from '../../src/ladders/generator/scale-calibration';

const SEEDS = Array.from({ length: 21 }, (_, index) => index + 1);

/** The scaling before the workload was pinned: `factor` times the behaviours the seed drew. */
function unpinned(seed: number, factor: number) {
  const spec = hiddenSpec(seed);
  const extra = spec.behaviours.length * (factor - 1);
  for (let index = 0; index < extra; index += 1) {
    const id = `B-${String(1000 + index)}`;
    spec.behaviours.push({ id, title: `Keep generic rule number ${index + 1} of the scaled agent` });
    spec.phrases.push({
      dimension: 'behaviour',
      value: id,
      text: `Please keep generic rule number ${index + 1}.`,
      lang: spec.lang,
      intent: { kind: 'behaviour', behaviour: id },
    });
    spec.flows[index % spec.flows.length]?.behaviours.push(id);
  }
  return spec;
}

/**
 * The 100x time of the generator grows about as the square of the behaviours, and a seed draws 4 to 6 of them. Scaling
 * each seed to 100 times its own number made the same product pass on a 4-behaviour seed (about 51 s) and fail on a
 * 6-behaviour one (about 121 s). Every seed now scales to the same number of behaviours.
 */
describe('the scale workload is the same size for every seed', () => {
  it('draws 4 to 6 behaviours, and the base of a scale is the most', () => {
    const drawn = SEEDS.map((seed) => hiddenSpec(seed).behaviours.length);
    expect(Math.min(...drawn)).toBeLessThan(SCALE_BASE_BEHAVIOURS);
    expect(Math.max(...drawn)).toBe(SCALE_BASE_BEHAVIOURS);
    expect(SCALE_BASE_BEHAVIOURS).toBe(6);
  });

  it.each([1, 10, 100])('gives every seed %i times the base behaviours', (factor) => {
    for (const seed of SEEDS)
      expect(scaledSpec(seed, factor).behaviours.length, `seed ${seed}`).toBe(SCALE_BASE_BEHAVIOURS * factor);
  });

  it('never gives a seed fewer behaviours than times its own', () => {
    for (const seed of SEEDS)
      expect(scaledSpec(seed, 100).behaviours.length).toBeGreaterThanOrEqual(
        hiddenSpec(seed).behaviours.length * 100,
      );
  });

  it('leaves the seed with the most behaviours exactly as it was', () => {
    const sixes = SEEDS.filter((seed) => hiddenSpec(seed).behaviours.length === SCALE_BASE_BEHAVIOURS);
    expect(sixes.length).toBeGreaterThan(0);
    for (const seed of sixes) expect(scaledSpec(seed, 100)).toEqual(unpinned(seed, 100));
  });

  it('adds to a seed with fewer behaviours the generic rules, each with a phrase and a flow', () => {
    const seed = SEEDS.find((candidate) => hiddenSpec(candidate).behaviours.length < SCALE_BASE_BEHAVIOURS);
    expect(seed).toBeDefined();
    const base = hiddenSpec(seed as number);
    const scaled = scaledSpec(seed as number, 100);
    expect(scaled.behaviours.slice(0, base.behaviours.length)).toEqual(base.behaviours);
    const extra = scaled.behaviours.slice(base.behaviours.length);
    expect(extra.length).toBe(SCALE_BASE_BEHAVIOURS * 100 - base.behaviours.length);
    expect(extra[0]?.id).toBe('B-1000');
    expect(scaled.phrases.length).toBe(base.phrases.length + extra.length);
    const owned = new Set(scaled.flows.flatMap((flow) => flow.behaviours));
    for (const behaviour of extra) expect(owned.has(behaviour.id), behaviour.id).toBe(true);
  });
});

describe('medianOf', () => {
  it('is the middle value, or the mean of the two middle ones', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([7])).toBe(7);
    expect(medianOf([170, 250, 160, 240, 900])).toBe(240);
  });

  it('is NaN for no value', () => {
    expect(medianOf([])).toBeNaN();
  });
});

describe('a scale report carries the calibrations it was normalised with', () => {
  it('normalises with the calibration of the samples measured before the run', async () => {
    const seed = SEEDS.find(
      (candidate) => hiddenSpec(candidate).behaviours.length < SCALE_BASE_BEHAVIOURS,
    ) as number;
    const report = await scaleReport(1, seed, 8_000, { calibrations: 3 });
    expect(report.error).toBeUndefined();
    const runs = report.calibrationRunsMs ?? [];
    expect(runs).toHaveLength(3);
    expect(report.calibrationMs).toBe(calibrationOf(runs));
    expect(report.calibrationMs).toBeLessThanOrEqual(runs[0] as number);
    expect(report.normalisedMs).toBe(normalisedMs(report.ms, report.calibrationMs));
    // the workload is the pinned one, whatever the seed drew
    expect(report.behaviours).toBe(SCALE_BASE_BEHAVIOURS);
  }, 180_000);

  it('measures one calibration when asked for one', async () => {
    const report = await scaleReport(1, 1, 8_000, { calibrations: 1 });
    expect(report.calibrationRunsMs).toEqual([report.calibrationMs]);
  }, 180_000);
});

/**
 * The scale item of the ladder takes five calibrations, not one: a time verdict rests on the median of five, and a later
 * `calibrations: 1` on the path CI takes would bring back the noise this removed. The tests may pass 1 for speed; the
 * code of the ladder may not.
 */
describe('the scale item of the ladder takes the default number of calibrations', () => {
  const folder = fileURLToPath(new URL('../../src/ladders/generator/', import.meta.url));
  const sources = readdirSync(folder)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(`${folder}${name}`, 'utf8') }));

  it('is five', () => {
    expect(CALIBRATION_COUNT).toBe(5);
  });

  it('is the default of scaleReport, which asks for no other number', () => {
    const scale = sources.find(({ name }) => name === 'scale.ts')?.text ?? '';
    expect(scale).toContain('options.calibrations ?? CALIBRATION_COUNT');
  });

  it('is what every call of scaleReport in the ladder asks for: none names a number of calibrations', () => {
    const calls = sources.flatMap(({ name, text }) =>
      [...text.matchAll(/\bscaleReport\(([^)]*)\)/g)]
        .filter(() => name !== 'scale.ts')
        .map((match) => ({ name, call: match[0] })),
    );
    // the ladder calls it in index.ts (twice) and bank-run.ts: a call is found, and none sets the option
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const { name, call } of calls) expect(call, name).not.toContain('calibrations');
  });

  it('takes five calibrations in a real run with no option', async () => {
    const report = await scaleReport(1, 1, 8_000);
    expect(report.error).toBeUndefined();
    expect(report.calibrationRunsMs).toHaveLength(CALIBRATION_COUNT);
  }, 180_000);
});

/**
 * The calibration of a run is the lower of the first sample and the median of the samples taken before the product
 * started. The normalised time falls as the calibration rises, so on every sequence of samples it is at least what the
 * first sample alone gives: the noise fix can make a product fail what it passed by a lucky first sample, never the
 * reverse.
 */
describe('calibrationOf', () => {
  it('is the lower of the first sample and the median', () => {
    expect(calibrationOf([100, 200, 200, 200, 200])).toBe(100);
    expect(calibrationOf([300, 200, 200, 250, 260])).toBe(250);
    expect(calibrationOf([250])).toBe(250);
    expect(calibrationOf([240, 250])).toBe(240);
  });

  it('keeps the exact value of a sample, rounds nothing, and is NaN for no sample', () => {
    expect(calibrationOf([250.04, 250.06, 250.2])).toBe(250.04);
    expect(calibrationOf([249.96, 250, 250, 250, 250])).toBe(249.96);
    expect(calibrationOf([100.06, 100.06, 100.06, 100.06, 100.06])).toBe(100.06);
    expect(calibrationOf([])).toBeNaN();
  });

  it('never exceeds the first sample, nor falls under the lowest one, on fractional samples', () => {
    let state = 12_345;
    const next = () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    };
    for (let trial = 0; trial < 2_000; trial += 1) {
      const samples = Array.from({ length: 1 + Math.floor(next() * 7) }, () => 40 + next() * 700);
      const ruler = calibrationOf(samples);
      expect(ruler, `trial ${trial}`).toBeLessThanOrEqual(samples[0] as number);
      expect(ruler, `trial ${trial}`).toBeGreaterThanOrEqual(Math.min(...samples));
    }
  });

  it('gives a normalised time at least that of the exact first sample, on fractional samples and raw times', () => {
    let state = 987_654;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let trial = 0; trial < 20_000; trial += 1) {
      // samples and raw times with decimals, some of them within a hundredth of each other
      const base = 20 + next() * 1_000;
      const samples = Array.from({ length: 5 }, () =>
        next() < 0.4 ? base + (next() - 0.5) * 0.1 : 20 + next() * 1_000,
      );
      const raw = 10_000 + next() * 200_000;
      const old = normalisedMs(raw, samples[0] as number);
      const now = normalisedMs(raw, calibrationOf(samples));
      expect(now, `trial ${trial}: ${samples.join(', ')} raw ${raw}`).toBeGreaterThanOrEqual(old);
    }
  });

  it('keeps the failure of 60,010 ms normalised when the first sample is 249.96 (a sample of 250 is not the sample)', () => {
    // codex probe 39969203478, case 1: rounding 249.96 to 250.0 turned 60,010 (a failure) into 60,000 (a pass)
    const samples = [249.96, 250, 250, 250, 250];
    expect(normalisedMs(60_000, samples[0] as number)).toBe(60_010);
    expect(normalisedMs(60_000, calibrationOf(samples))).toBe(60_010);
    expect(normalisedMs(60_000, 250)).toBe(60_000);
  });

  it('keeps the failure of 60,001 ms normalised when the first sample is 100.06 (rounded, 100.1 gives 59,978)', () => {
    // codex probe 39969203478, case 2
    const samples = [100.06, 100.06, 100.06, 100.06, 100.06];
    expect(normalisedMs(24_015, samples[0] as number)).toBe(60_001);
    expect(normalisedMs(24_015, calibrationOf(samples))).toBe(60_001);
    expect(normalisedMs(24_015, 100.1)).toBe(59_978);
  });

  it('fixes the sequences a median alone made easier', () => {
    // 100 is the first sample: a raw 40,000 ms is 100,000 normalised, a failure; the median 200 would have made it 50,000.
    const old = normalisedMs(40_000, 100);
    expect(old).toBe(100_000);
    expect(normalisedMs(40_000, calibrationOf([100, 200, 200, 200, 200]))).toBe(old);
    expect(normalisedMs(40_000, medianOf([100, 200, 200, 200, 200]))).toBe(50_000);
    expect(normalisedMs(70_000, calibrationOf([100, 100, 300, 300, 300]))).toBe(175_000);
  });
});

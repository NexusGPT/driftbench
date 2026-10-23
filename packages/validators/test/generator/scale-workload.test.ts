import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { SCALE_BASE_BEHAVIOURS, scaledSpec, scaleReport } from '../../src/ladders/generator/scale';
import { CALIBRATION_COUNT, medianOf, normalisedMs } from '../../src/ladders/generator/scale-calibration';

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
  it('normalises with the median of every calibration measured around the run', async () => {
    const seed = SEEDS.find(
      (candidate) => hiddenSpec(candidate).behaviours.length < SCALE_BASE_BEHAVIOURS,
    ) as number;
    const report = await scaleReport(1, seed, 8_000, { calibrations: 3 });
    expect(report.error).toBeUndefined();
    const runs = report.calibrationRunsMs ?? [];
    expect(runs).toHaveLength(3);
    expect(report.calibrationMs).toBe(Math.round(medianOf(runs) * 10) / 10);
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

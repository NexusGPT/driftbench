import {
  aboutPercent,
  chaoCoverage,
  completeness,
  effectiveSampleSize,
  goodTuringDiscovery,
  hillNumbers,
  quantile,
  seededRandom,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { at, map, spec } from './support';

/** One stage dimension of four values: four interaction classes. */
const STAGES = map({
  version: '1',
  agent: 'sample',
  dimensions: [
    {
      id: 'stage',
      title: 'Stage',
      kind: 'stage',
      values: ['v1', 'v2', 'v3', 'v4'].map((id) => ({ id, title: id })),
    },
  ],
  constraints: [],
  prior: { kind: 'declared' },
});

const conversation = (id: string, ...stages: string[]) =>
  spec({ id, blocks: stages.map((stage) => at(stage)) });

/**
 * Six conversations. v1 appears in u1, u2, u3 and u6 (4 times), v2 in u3 and u4 (twice), v3 in u5 (once),
 * v4 never. So n = 6, f1 = 1 (v3), f2 = 1 (v2), 3 cells seen of 4.
 *   C = 1 - (1 / 6) * [5 * 1 / (5 * 1 + 2 * 1)] = 1 - 5 / 42 = 37 / 42
 *   U = 1 / 6
 */
const SAMPLE = [
  conversation('u1', 'v1'),
  conversation('u2', 'v1'),
  conversation('u3', 'v1', 'v2'),
  conversation('u4', 'v2'),
  conversation('u5', 'v3'),
  conversation('u6', 'v1'),
];

describe('the completeness line', () => {
  const result = completeness(STAGES, SAMPLE);

  it('counts the conversations, the cells seen, f1 and f2', () => {
    expect(result).toMatchObject({
      t: 1,
      full: true,
      cells: 4,
      conversations: 6,
      unplaced: [],
      seen: 3,
      f1: 1,
      f2: 1,
      printable: true,
    });
  });

  it('gives the sample coverage in the Chao form and the Good-Turing discovery probability', () => {
    expect(result.coverage?.estimate).toBeCloseTo(37 / 42, 12);
    expect(result.discovery?.estimate).toBeCloseTo(1 / 6, 12);
  });

  it('prints the sentence of the design with both figures', () => {
    expect(result.sentence).toBe(
      'About 88 percent of the interaction classes have appeared; the chance that the next conversation shows a new one is about 17 percent.',
    );
  });

  it('gives Hill numbers over the cells seen, weighted by how many conversations show each', () => {
    const shares = [4 / 7, 2 / 7, 1 / 7];
    expect(result.hill.q0).toBe(3);
    expect(result.hill.q1).toBeCloseTo(Math.exp(-shares.reduce((sum, p) => sum + p * Math.log(p), 0)), 12);
    expect(result.hill.q2).toBeCloseTo(49 / 21, 12);
  });

  it('gives a seeded percentile bootstrap interval over conversations', () => {
    expect(result.bootstrap).toEqual({ iterations: 2000, seed: 1, level: 0.95 });
    for (const interval of [result.coverage, result.discovery]) {
      expect(interval?.lower).toBeGreaterThanOrEqual(0);
      expect(interval?.upper).toBeLessThanOrEqual(1);
      expect(interval?.lower ?? 1).toBeLessThanOrEqual(interval?.upper ?? 0);
    }
    expect(completeness(STAGES, SAMPLE)).toEqual(result);
  });

  it('collapses the interval when every conversation shows the same cells', () => {
    const one = map({
      ...STAGES,
      dimensions: [{ ...STAGES.dimensions[0], values: [{ id: 'v1', title: 'v1' }] }],
    });
    const same = completeness(
      one,
      [1, 2, 3, 4].map((index) => conversation(`same${index}`, 'v1')),
    );
    expect(same.coverage).toEqual({ estimate: 1, lower: 1, upper: 1 });
    expect(same.discovery).toEqual({ estimate: 0, lower: 0, upper: 0 });
  });

  it('says why it cannot print with fewer conversations than cells, and gives no estimate', () => {
    const short = completeness(STAGES, SAMPLE.slice(0, 3));
    expect(short).toMatchObject({ conversations: 3, cells: 4, printable: false });
    expect(short.reason).toBe(
      'the estimate needs at least as many conversations as cells, and there are 3 for 4',
    );
    expect(short.coverage).toBeUndefined();
    expect(short.sentence).toBeUndefined();
  });

  it('leaves out a conversation that falls in no cell, and says so', () => {
    const silent = spec({ id: 'silent', blocks: [{ user: 'hi', expect: { must: ['x'] } }] });
    const withSilent = completeness(STAGES, [...SAMPLE, silent]);
    expect(withSilent.unplaced).toEqual(['silent']);
    expect(withSilent.conversations).toBe(6);
    expect(withSilent.coverage?.estimate).toBeCloseTo(37 / 42, 12);
  });

  it('reads classes at a lower strength with t', () => {
    const two = map({
      ...STAGES,
      dimensions: [
        STAGES.dimensions[0],
        { id: 'channel', title: 'Channel', kind: 'channel', values: [{ id: 'chat', title: 'Chat' }] },
      ],
    });
    const onChat = SAMPLE.map((result) => (result.ok ? spec({ ...result.spec, channel: 'chat' }) : result));
    expect(completeness(two, onChat, { t: 1 })).toMatchObject({
      t: 1,
      full: false,
      cells: 5,
      seen: 4,
      f1: 1,
      f2: 1,
    });
  });
});

describe('mutations the completeness tests catch', () => {
  it('mutation: counting an unseen cell as a singleton (f1 = 2) changes both figures', () => {
    expect(completeness(STAGES, SAMPLE).f1).toBe(1);
    expect(chaoCoverage(2, 1, 6)).not.toBeCloseTo(37 / 42, 6);
    expect(goodTuringDiscovery(2, 6)).not.toBeCloseTo(1 / 6, 6);
  });

  it('mutation: missing the one singleton (f1 = 0) claims full coverage', () => {
    expect(chaoCoverage(0, 1, 6)).toBe(1);
    expect(chaoCoverage(1, 1, 6)).not.toBe(1);
  });
});

describe('the estimators', () => {
  it('chaoCoverage: 1 with no singleton, 0 for one conversation with one cell, refuses impossible counts', () => {
    expect(chaoCoverage(0, 3, 10)).toBe(1);
    expect(chaoCoverage(1, 0, 1)).toBe(0);
    expect(() => chaoCoverage(1, 0, 0)).toThrow(RangeError);
    expect(() => chaoCoverage(5, 0, 4)).toThrow('f1 must be a whole number from 0 to n');
    expect(() => chaoCoverage(1, -1, 4)).toThrow(RangeError);
    expect(() => chaoCoverage(1.5, 0, 4)).toThrow(RangeError);
  });

  it('goodTuringDiscovery: f1 / n', () => {
    expect(goodTuringDiscovery(3, 10)).toBe(0.3);
    expect(() => goodTuringDiscovery(11, 10)).toThrow(RangeError);
  });

  it('hillNumbers: zero for no count, the count of cells when they are even', () => {
    expect(hillNumbers([])).toEqual({ q0: 0, q1: 0, q2: 0 });
    expect(hillNumbers([0, 5, 0])).toEqual({ q0: 1, q1: 1, q2: 1 });
    const even = hillNumbers([2, 2, 2, 2]);
    expect(even.q0).toBe(4);
    expect(even.q1).toBeCloseTo(4, 12);
    expect(even.q2).toBeCloseTo(4, 12);
  });

  it('effectiveSampleSize: n for equal weights, 1 for one weight, 0 for none', () => {
    expect(effectiveSampleSize([1, 1, 1])).toBe(3);
    expect(effectiveSampleSize([0.2, 0, 0])).toBe(1);
    expect(effectiveSampleSize([])).toBe(0);
    expect(effectiveSampleSize([0, 0])).toBe(0);
  });

  it('quantile: linear between ranks, the default of R and NumPy', () => {
    const values = [1, 2, 3, 4];
    expect([0, 0.25, 0.5, 1].map((q) => quantile(values, q))).toEqual([1, 1.75, 2.5, 4]);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile(values, 1.5)).toThrow(RangeError);
  });

  it('seededRandom: the same seed gives the same numbers, all in [0, 1)', () => {
    const first = seededRandom(7);
    const second = seededRandom(7);
    const draws = Array.from({ length: 100 }, () => first());
    expect(draws).toEqual(Array.from({ length: 100 }, () => second()));
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('aboutPercent: whole percents, never a 0 or a 100 the data do not show', () => {
    expect([0, 1, 0.88095, 1 / 6, 0.004, 0.0004, 0.9996].map(aboutPercent)).toEqual([
      '0',
      '100',
      '88',
      '17',
      '0.4',
      '0.1',
      '99.9',
    ]);
  });
});

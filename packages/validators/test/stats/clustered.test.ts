import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  CLUSTERED_COVERAGE,
  clusteredLevel,
  clusterOutcomes,
  generator,
  StatsDesignsSchema,
} from '../../src/ladders/stats/index';
import { committedDesigns, designsWith, real, SLOW } from './support';

describe('the planted clusters', { timeout: SLOW }, () => {
  it('pass at the planted rate and agree inside a cluster as the planted rho says', () => {
    const rng = generator(11, 1);
    const pairs: Array<[number, number]> = [];
    let passed = 0;
    let units = 0;
    for (let cluster = 0; cluster < 20000; cluster += 1) {
      const out = clusterOutcomes(rng, 2, 0.3, 0.4);
      pairs.push([out[0] as number, out[1] as number]);
      passed += (out[0] as number) + (out[1] as number);
      units += 2;
    }
    const rate = passed / units;
    const both = pairs.filter(([a, b]) => a === 1 && b === 1).length / pairs.length;
    const correlation = (both - rate * rate) / (rate * (1 - rate));
    expect(rate).toBeCloseTo(0.3, 2);
    expect(Math.abs(correlation - 0.4)).toBeLessThan(0.03);
  });

  it('the committed designs file holds the schema', () => {
    expect(StatsDesignsSchema.safeParse(committedDesigns()).success).toBe(true);
  });
});

describe('level 3: clustered bootstrap coverage', { timeout: SLOW }, () => {
  it(
    'passes on the committed designs, with the naive interval below the bar on every design',
    () => {
      const measure = clusteredLevel(1, real, committedDesigns().clustered);
      expect(measure.items).toEqual([]);
      expect(measure.value).toBeGreaterThanOrEqual(CLUSTERED_COVERAGE);
      expect(measure.value).toBeLessThan(0.97);
    },
    SLOW,
  );

  it('draws the same on a repeat and differently on another seed', () => {
    const plan = designsWith((d) => {
      d.clustered.draws = 60;
    }).clustered;
    const estimates = (seed: number): number[] => {
      const seen: number[] = [];
      const recording: typeof stats.bootstrapCI = (values, options) => {
        const ci = stats.bootstrapCI(values, options);
        seen.push(ci.estimate);
        return ci;
      };
      clusteredLevel(seed, { ...real, bootstrapCI: recording }, plan);
      return seen;
    };
    const a = estimates(4);
    expect(a).toHaveLength(180);
    expect(estimates(4)).toEqual(a);
    expect(estimates(5)).not.toEqual(a);
  });

  it(
    'fails when the bootstrap ignores the clusters, naming the design, the truth, the estimate and the interval',
    () => {
      const plan = designsWith((d) => {
        d.clustered.draws = 150;
        d.clustered.designs = [d.clustered.designs[0] as (typeof d.clustered.designs)[number]];
      }).clustered;
      const ignoring: typeof stats.bootstrapCI = (values, options = {}) =>
        stats.bootstrapCI(values, { ...options, clusters: undefined });
      const measure = clusteredLevel(1, { ...real, bootstrapCI: ignoring }, plan);
      expect(measure.value).toBeLessThan(CLUSTERED_COVERAGE);
      expect(measure.items.map((item) => item.id)).toEqual(['clustered-c80x8-rho0.2']);
      expect(measure.items[0]?.component).toBe('packages/stats/src/intervals.ts');
      expect(measure.items[0]?.detail).toMatch(
        /^estimator bootstrapCI \(clustered by conversation\), seed 1, design c80x8-rho0\.2 \(80 conversations of 8 blocks, rho 0\.2\): \d+ of 150 intervals contain the truth \(coverage [\d.]+\); first misses: draw \d+: truth [\d.]+, estimate [\d.]+, interval \[[\d.]+, [\d.]+\]/,
      );
    },
    SLOW,
  );

  it('scores 0 when the planted data do not cluster, since the naive interval then reaches the bar', () => {
    const plan = designsWith((d) => {
      d.clustered.draws = 300;
      d.clustered.designs = [{ id: 'flat', clusters: 40, size: 4, rho: 0 }];
    }).clustered;
    const measure = clusteredLevel(1, real, plan);
    expect(measure.value).toBe(0);
    const naive = measure.items.find((item) => item.id === 'naive-flat');
    expect(naive?.component).toBe('packages/validators/fixtures/stats/designs.json');
    expect(naive?.detail).toMatch(/^estimator wilson over every block as independent, seed 1/);
  });
});

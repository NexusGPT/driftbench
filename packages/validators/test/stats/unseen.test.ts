import { completeness } from '@agent-nexus/driftbench-space';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import {
  type CompletenessLine,
  plantPopulation,
  UNSEEN_ERROR,
  unseenLevel,
} from '../../src/ladders/stats/index';
import { committedDesigns, designsWith, real, SLOW } from './support';

describe('the planted population', { timeout: SLOW }, () => {
  it('holds the planted number of classes with the planted tail, as a valid map', () => {
    const population = plantPopulation(60, 5);
    expect(population.probabilities).toHaveLength(60);
    expect(population.probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
    expect((population.probabilities[0] as number) / (population.probabilities[59] as number)).toBeCloseTo(
      5,
      9,
    );
    expect(population.specs).toHaveLength(60);
    expect(population.cumulative[59]).toBeCloseTo(1, 12);
    const line = completeness(population.map, population.specs.slice(0, 10), { iterations: 1 });
    expect(line).toMatchObject({ cells: 60, conversations: 10, printable: false });
  });
});

describe('level 5: unseen mass', { timeout: SLOW }, () => {
  it('passes on the committed designs: errors below 10 percent above the class count, a warning below it', () => {
    const measure = unseenLevel(1, real, committedDesigns().unseen);
    expect(measure.items).toEqual([]);
    expect(measure.value).toBeLessThanOrEqual(UNSEEN_ERROR);
    expect(measure.value).toBeGreaterThan(0.01);
  });

  const small = designsWith((d) => {
    d.unseen.draws = 40;
    d.unseen.warningDraws = 5;
    d.unseen.populations = [d.unseen.populations[0] as (typeof d.unseen.populations)[number]];
  }).unseen;

  it('scores 1 when the completeness line prints below the class count, naming the population and size', () => {
    const silent: CompletenessLine = (map, specs, options) => {
      const result = completeness(map, specs, options);
      if (result.printable) return result;
      return {
        ...result,
        printable: true,
        reason: undefined,
        coverage: { estimate: 0.5, lower: 0.4, upper: 0.6 },
      };
    };
    const measure = unseenLevel(1, real, small, silent);
    expect(measure.value).toBe(1);
    expect(measure.items.map((item) => item.id)).toEqual([
      'warning-s60-spread5-n30',
      'warning-s60-spread5-n57',
    ]);
    expect(measure.items[0]?.component).toBe('packages/space/src/complete.ts');
    expect(measure.items[0]?.detail).toBe(
      'estimator completeness, seed 1, population s60-spread5 (60 classes, the rarest 5 times rarer than the commonest), 30 conversations, fewer than classes: no warning on 5 of 5 draws; first draw 0: estimate 0.5 printed without the warning',
    );
  });

  it('fails when the Chao coverage of the completeness line ignores the classes seen once', () => {
    const full: CompletenessLine = (map, specs, options) => {
      const result = completeness(map, specs, options);
      return result.coverage ? { ...result, coverage: { estimate: 1, lower: 1, upper: 1 } } : result;
    };
    const measure = unseenLevel(1, real, small, full);
    expect(measure.value).toBeGreaterThan(UNSEEN_ERROR);
    expect(measure.items.map((item) => item.id)).toEqual(['unseen-chao-form-s60-spread5-n90']);
    expect(measure.items[0]?.detail).toMatch(
      /^estimator completeness coverage \(Chao form\), seed 1, population s60-spread5 \(60 classes, the rarest 5 times rarer than the commonest\), 90 conversations: mean error [\d.]+ over 40 draws against the true coverage \(the probability of the classes seen\); worst draw \d+: truth [\d.]+, estimate 1, interval \[1, 1\]$/,
    );
  });

  it('fails when the statistics package Chao coverage is wrong, pointing at its source file', () => {
    const wrong: typeof stats.chaoCoverage = (counts) => ({ ...stats.chaoCoverage(counts), coverage: 1 });
    const measure = unseenLevel(1, { ...real, chaoCoverage: wrong }, small);
    expect(measure.value).toBeGreaterThan(UNSEEN_ERROR);
    expect(measure.items.map((item) => [item.id, item.component])).toEqual([
      ['unseen-chao-stats-s60-spread5-n90', 'packages/stats/src/coverage.ts'],
    ]);
    expect(measure.items[0]?.detail).toContain(', no interval');
  });
});

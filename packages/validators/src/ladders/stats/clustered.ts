import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import type { ClusteredDesigns } from './designs';
import { STATS_DESIGNS } from './designs';
import { clusterOutcomes, generator, salt } from './draw';
import type { StatsImpl } from './reference';

/**
 * Level 3 of the statistics validator: the clustered bootstrap covers the true rate on data that clusters,
 * and the naive interval, which treats every block as independent, does not on the same data. The second half
 * proves the clustering matters: without it the level would pass on data a plain interval also covers.
 */

export const CLUSTERED_COVERAGE = 0.93;

/** The component an interval miss points at. */
export const CLUSTERED_COMPONENT = 'packages/stats/src/intervals.ts';

/**
 * For each design: `draws` true rates uniform on the design range, then `clusters` conversations of `size`
 * blocks each, outcomes correlated inside a conversation with the design's rho (see `clusterOutcomes`). Each
 * draw gets the clustered bootstrap (`bootstrapCI` with the conversation as cluster, default options) and the
 * naive Wilson interval over every block. The observed value is the clustered coverage pooled over the designs,
 * or 0 when the naive interval reaches the bar on a design.
 */
export function clusteredLevel(seed: number, s: StatsImpl, plan: ClusteredDesigns): Measure {
  const low: Item[] = [];
  const naive: Item[] = [];
  let contained = 0;
  let computed = 0;
  plan.designs.forEach((design, index) => {
    const rng = generator(seed, salt(3, index));
    let hits = 0;
    let naiveHits = 0;
    const misses: string[] = [];
    for (let draw = 0; draw < plan.draws; draw += 1) {
      const truth = plan.rates.low + (plan.rates.high - plan.rates.low) * rng();
      const values: number[] = [];
      const clusters: number[] = [];
      for (let cluster = 0; cluster < design.clusters; cluster += 1) {
        for (const value of clusterOutcomes(rng, design.size, truth, design.rho)) {
          values.push(value);
          clusters.push(cluster);
        }
      }
      const ci = s.bootstrapCI(values, { clusters, seed: Math.floor(rng() * 4294967296) });
      if (ci.lower <= truth && truth <= ci.upper) hits += 1;
      else if (misses.length < 3) {
        misses.push(
          `draw ${draw}: truth ${showNumber(truth)}, estimate ${showNumber(ci.estimate)}, interval [${showNumber(ci.lower)}, ${showNumber(ci.upper)}]`,
        );
      }
      const passed = values.reduce((sum, value) => sum + value, 0);
      const plain = s.wilson(passed, values.length);
      if (plain.lower <= truth && truth <= plain.upper) naiveHits += 1;
    }
    contained += hits;
    computed += plan.draws;
    const coverage = hits / plan.draws;
    const naiveCoverage = naiveHits / plan.draws;
    const what = `${design.clusters} conversations of ${design.size} blocks, rho ${design.rho}`;
    if (coverage < CLUSTERED_COVERAGE) {
      low.push({
        id: `clustered-${design.id}`,
        component: CLUSTERED_COMPONENT,
        detail: `estimator bootstrapCI (clustered by conversation), seed ${seed}, design ${design.id} (${what}): ${hits} of ${plan.draws} intervals contain the truth (coverage ${showNumber(coverage)}); first misses: ${misses.join('; ')}`,
      });
    }
    if (naiveCoverage >= CLUSTERED_COVERAGE) {
      naive.push({
        id: `naive-${design.id}`,
        component: STATS_DESIGNS,
        detail: `estimator wilson over every block as independent, seed ${seed}, design ${design.id} (${what}): ${naiveHits} of ${plan.draws} intervals contain the truth (coverage ${showNumber(naiveCoverage)}), at or above the bar ${CLUSTERED_COVERAGE}, so the planted data do not show that the clustering matters`,
      });
    }
  });
  const coverage = contained / computed;
  // A design below the bar is named only when the pooled coverage fails; a naive design always fails the level.
  const items = [...(coverage < CLUSTERED_COVERAGE ? low : []), ...naive];
  return { value: naive.length > 0 ? 0 : coverage, items };
}

import { type LoadResult, validateSpec } from '@agent-nexus/driftbench-core';
import { completeness, type SpaceMap, validateSpaceMap } from '@agent-nexus/driftbench-space';
import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import type { UnseenDesigns } from './designs';
import { generator, salt } from './draw';
import type { StatsImpl } from './reference';

/**
 * Level 5 of the statistics validator: what was not seen. A planted population holds a known number of classes
 * with a known tail (class i weighs spread^(-i / (classes - 1)), so the rarest class is `spread` times rarer
 * than the commonest). Each conversation shows one class drawn from it. Above the class count, the sample
 * coverage estimates (the completeness line's Chao form and its Good-Turing figure, and the statistics
 * package's Chao form) are scored against the true coverage: the probability mass of the classes seen. Below
 * the class count, the completeness line must refuse the estimate and say why, on every draw.
 */

export const UNSEEN_ERROR = 0.1;

/** The components an item points at. */
export const UNSEEN_COMPONENTS = {
  completeness: 'packages/space/src/complete.ts',
  chao: 'packages/stats/src/coverage.ts',
} as const;

/** The completeness line the level scores. Tests replace it to plant a fault. */
export type CompletenessLine = typeof completeness;

/** A planted population: its class probabilities, the map whose one dimension holds its classes, a spec per class. */
export type Population = {
  probabilities: number[];
  cumulative: number[];
  map: SpaceMap;
  specs: LoadResult[];
};

/** Builds the planted population: the class probabilities and the map and specs the completeness line reads. */
export function plantPopulation(classes: number, spread: number): Population {
  const weights = Array.from({ length: classes }, (_, i) => spread ** (-i / (classes - 1)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const probabilities = weights.map((weight) => weight / total);
  const cumulative: number[] = [];
  let running = 0;
  for (const p of probabilities) {
    running += p;
    cumulative.push(running);
  }
  const ids = probabilities.map((_, i) => `class-${String(i + 1).padStart(3, '0')}`);
  const raw = {
    version: '1',
    agent: 'planted',
    dimensions: [
      {
        id: 'class',
        title: 'Planted class',
        kind: 'stage',
        values: ids.map((id, i) => ({ id, title: id, weight: weights[i] as number })),
      },
    ],
    constraints: [],
    prior: { kind: 'declared' },
  };
  const checked = validateSpaceMap(raw);
  if (!checked.ok) throw new TypeError(`the planted map is invalid: ${JSON.stringify(checked.errors[0])}`);
  const specs = ids.map((id) => {
    const spec = validateSpec(
      { id: `shows-${id}`, blocks: [{ user: 'next', expect: { stage: id } }] },
      `specs/shows-${id}.yaml`,
    );
    if (!spec.ok) throw new TypeError(`the planted spec of ${id} is invalid`);
    return spec;
  });
  return { probabilities, cumulative, map: checked.map, specs };
}

/** The class of one conversation: a draw from the population. */
function drawClass(rng: () => number, cumulative: readonly number[]): number {
  const u = rng();
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (u < (cumulative[mid] as number)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** One draw of n conversations: the count per class and the spec each conversation is. */
function drawSample(rng: () => number, population: Population, n: number) {
  const counts = new Array<number>(population.probabilities.length).fill(0);
  const specs: LoadResult[] = [];
  for (let unit = 0; unit < n; unit += 1) {
    const cls = drawClass(rng, population.cumulative);
    counts[cls] = (counts[cls] as number) + 1;
    specs.push(population.specs[cls] as LoadResult);
  }
  const truth = population.probabilities.reduce((sum, p, i) => sum + ((counts[i] as number) > 0 ? p : 0), 0);
  return { counts, specs, truth };
}

/** The estimators scored: the item id key, the name items print and the component a miss points at. */
const ESTIMATORS = [
  { key: 'chao-form', name: 'completeness coverage (Chao form)', component: UNSEEN_COMPONENTS.completeness },
  {
    key: 'good-turing',
    name: 'completeness coverage (Good-Turing)',
    component: UNSEEN_COMPONENTS.completeness,
  },
  { key: 'chao-stats', name: 'chaoCoverage', component: UNSEEN_COMPONENTS.chao },
] as const;
type Estimator = (typeof ESTIMATORS)[number]['key'];

/**
 * For each population and each multiple of its class count above 1: `draws` samples, each estimator's mean
 * relative error against the true coverage. For each multiple below 1: `warningDraws` samples, each of which
 * the completeness line must refuse. The observed value is the largest mean error, or 1 when a draw below the
 * class count got estimates or a draw above it got none.
 */
export function unseenLevel(
  seed: number,
  s: StatsImpl,
  plan: UnseenDesigns,
  line: CompletenessLine = completeness,
): Measure {
  const items: Item[] = [];
  let worst = 0;
  let broken = false;
  plan.populations.forEach((design, p) => {
    const population = plantPopulation(design.classes, design.spread);
    const what = `population ${design.id} (${design.classes} classes, the rarest ${design.spread} times rarer than the commonest)`;
    plan.above.forEach((multiple, m) => {
      const n = Math.round(multiple * design.classes);
      const rng = generator(seed, salt(5, 100 * p + m));
      const sums = new Map<Estimator, number>(ESTIMATORS.map(({ key }) => [key, 0]));
      const worstDraw = new Map<
        Estimator,
        { draw: number; error: number; truth: number; estimate: number }
      >();
      const samples: ReturnType<typeof drawSample>[] = [];
      let refused = 0;
      for (let draw = 0; draw < plan.draws; draw += 1) {
        const sample = drawSample(rng, population, n);
        samples.push(sample);
        const result = line(population.map, sample.specs, { iterations: 1 });
        const estimates: Record<Estimator, number> = {
          'chao-form': result.coverage?.estimate ?? Number.NaN,
          'good-turing': result.discovery ? 1 - result.discovery.estimate : Number.NaN,
          'chao-stats': s.chaoCoverage(sample.counts).coverage,
        };
        if (!result.printable) refused += 1;
        for (const { key } of ESTIMATORS) {
          const estimate = estimates[key];
          const error = Number.isFinite(estimate) ? Math.abs(estimate - sample.truth) / sample.truth : 1;
          sums.set(key, (sums.get(key) as number) + error);
          if (error > (worstDraw.get(key)?.error ?? -1)) {
            worstDraw.set(key, { draw, error, truth: sample.truth, estimate });
          }
        }
      }
      if (refused > 0) {
        broken = true;
        items.push({
          id: `refused-${design.id}-n${n}`,
          component: UNSEEN_COMPONENTS.completeness,
          detail: `estimator completeness, seed ${seed}, ${what}, ${n} conversations: the line refused the estimate on ${refused} of ${plan.draws} draws although conversations exceed classes`,
        });
      }
      for (const { key, name, component } of ESTIMATORS) {
        const error = (sums.get(key) as number) / plan.draws;
        worst = Math.max(worst, error);
        if (error <= UNSEEN_ERROR) continue;
        const example = worstDraw.get(key);
        const sample = example ? samples[example.draw] : undefined;
        let interval = 'no interval';
        if (sample && key !== 'chao-stats') {
          const full = line(population.map, sample.specs);
          const range =
            key === 'chao-form'
              ? full.coverage
              : full.discovery && { lower: 1 - full.discovery.upper, upper: 1 - full.discovery.lower };
          if (range) interval = `interval [${showNumber(range.lower)}, ${showNumber(range.upper)}]`;
        }
        items.push({
          id: `unseen-${key}-${design.id}-n${n}`,
          component,
          detail: `estimator ${name}, seed ${seed}, ${what}, ${n} conversations: mean error ${showNumber(error)} over ${plan.draws} draws against the true coverage (the probability of the classes seen); worst draw ${example?.draw}: truth ${showNumber(example?.truth ?? Number.NaN)}, estimate ${showNumber(example?.estimate ?? Number.NaN)}, ${interval}`,
        });
      }
    });
    plan.below.forEach((multiple, m) => {
      const n = Math.max(1, Math.floor(multiple * design.classes));
      const rng = generator(seed, salt(5, 100 * p + 50 + m));
      let silent = 0;
      let first: { draw: number; coverage: number | undefined } | undefined;
      for (let draw = 0; draw < plan.warningDraws; draw += 1) {
        const sample = drawSample(rng, population, n);
        const result = line(population.map, sample.specs, { iterations: 1 });
        if (result.printable || !result.reason) {
          silent += 1;
          first ??= { draw, coverage: result.coverage?.estimate };
        }
      }
      if (silent > 0) {
        broken = true;
        items.push({
          id: `warning-${design.id}-n${n}`,
          component: UNSEEN_COMPONENTS.completeness,
          detail: `estimator completeness, seed ${seed}, ${what}, ${n} conversations, fewer than classes: no warning on ${silent} of ${plan.warningDraws} draws; first draw ${first?.draw}: estimate ${first?.coverage === undefined ? 'none' : showNumber(first.coverage)} printed without the warning`,
        });
      }
    });
  });
  return { value: broken ? 1 : worst, items };
}

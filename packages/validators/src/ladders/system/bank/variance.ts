import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type Observed,
  planCampaign,
  runCampaign,
  type Spec,
  type TargetRef,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import * as stats from '@agent-nexus/driftbench-stats';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { SYSTEM_COMPONENTS } from '../components';
import {
  CLUSTER_RATE,
  CLUSTER_RHO,
  CLUSTER_SIZE,
  CLUSTERS,
  DEFF_ALPHA,
  type DesignEffectLaw,
  type DesignEffectOracle,
  designEffectCalibration,
  parityLevel,
  runEffect,
  wilsonCalibration,
} from '../effect';
import type { Behaviour, RawSpec } from '../plant';
import { between, rngFor } from '../random';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';
import { adapterFor, FAST_RETRY } from './world';

/**
 * Level 7: variance reported within its interval. Clustered campaigns whose pass counts per spec are planted
 * exactly run through the campaign runner and the store; the correlation, the design effect and the
 * intervals the statistics give on the stored runs are compared with a closed-form reference computed from
 * the plant (a differential item: a second implementation of one-way ANOVA). Three Monte Carlo items carry
 * the old calibration and parity levels at their design point.
 */

const TARGET: TargetRef = { adapter: 'function', agent: 'planted-variance' };

/** One-way ANOVA intraclass correlation of balanced groups, truncated at zero as variance components are. */
export function referenceIcc(groups: readonly (readonly number[])[]): number {
  const k = groups.length;
  const m = groups[0]?.length ?? 0;
  const all = groups.flat();
  const grand = all.reduce((sum, value) => sum + value, 0) / all.length;
  const means = groups.map((group) => group.reduce((sum, value) => sum + value, 0) / m);
  const msb = (m * means.reduce((sum, mean) => sum + (mean - grand) ** 2, 0)) / (k - 1);
  const msw =
    groups.reduce(
      (sum, group, index) => sum + group.reduce((s, value) => s + (value - (means[index] as number)) ** 2, 0),
      0,
    ) /
    (k * (m - 1));
  const between_ = Math.max(0, (msb - msw) / m);
  const within = Math.max(0, msw);
  return between_ + within > 0 ? between_ / (between_ + within) : 0;
}

/**
 * The exact finite-sample law of the design effect 1 + (m - 1) rho with rho from referenceIcc, on one clustered
 * campaign of the plant, as its outcomes with their probabilities: `clusters` specs of `size` runs, each spec
 * passing with probability rate plus or minus delta (one half each), delta squared over rate times one minus
 * rate being the correlation. Every histogram of pass counts over the specs is enumerated with its multinomial
 * probability, so the law is exact.
 */
export function designEffectOutcomes(
  clusters = CLUSTERS,
  size = CLUSTER_SIZE,
  rate = CLUSTER_RATE,
  rho = CLUSTER_RHO,
): Array<[probability: number, designEffect: number]> {
  const delta = Math.sqrt(rho * rate * (1 - rate));
  const choose = (n: number, k: number) => {
    let out = 1;
    for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
    return out;
  };
  const binomial = (c: number, p: number) => {
    const q = Math.min(1, Math.max(0, p));
    return choose(size, c) * q ** c * (1 - q) ** (size - c);
  };
  const perCount = Array.from(
    { length: size + 1 },
    (_, c) => (binomial(c, rate + delta) + binomial(c, rate - delta)) / 2,
  );
  const logFactorial = [0];
  for (let i = 1; i <= clusters; i += 1) logFactorial.push((logFactorial[i - 1] as number) + Math.log(i));
  const outcomes: Array<[number, number]> = [];
  const histogram: number[] = [];
  const walk = (count: number, left: number) => {
    if (count === size) {
      histogram.push(left);
      let logP = logFactorial[clusters] as number;
      histogram.forEach((specs, c) => {
        if (specs > 0) logP += specs * Math.log(perCount[c] as number) - (logFactorial[specs] as number);
      });
      const groups = histogram.flatMap((specs, c) =>
        Array.from({ length: specs }, () => Array.from({ length: size }, (_, r) => (r < c ? 1 : 0))),
      );
      outcomes.push([Math.exp(logP), 1 + (size - 1) * referenceIcc(groups)]);
      histogram.pop();
      return;
    }
    for (let specs = 0; specs <= left; specs += 1) {
      histogram.push(specs);
      walk(count + 1, left - specs);
      histogram.pop();
    }
  };
  walk(0, clusters);
  return outcomes;
}

/** The mean, standard deviation and skewness of designEffectOutcomes. */
export function exactDesignEffectLaw(
  clusters = CLUSTERS,
  size = CLUSTER_SIZE,
  rate = CLUSTER_RATE,
  rho = CLUSTER_RHO,
): DesignEffectLaw {
  const outcomes = designEffectOutcomes(clusters, size, rate, rho);
  const total = outcomes.reduce((sum, [p]) => sum + p, 0);
  const mean = outcomes.reduce((sum, [p, value]) => sum + p * value, 0) / total;
  const moment = (k: number) =>
    outcomes.reduce((sum, [p, value]) => sum + p * (value - mean) ** k, 0) / total;
  const sd = Math.sqrt(moment(2));
  return { mean, sd, skew: moment(3) / sd ** 3 };
}

let law: DesignEffectLaw | undefined;
/** The oracle of the design-effect calibration item: the exact law of the plant and one-way ANOVA. */
export function designEffectOracle(): DesignEffectOracle {
  law ??= exactDesignEffectLaw();
  return { law, icc: referenceIcc };
}

type Design = { clusters: number; size: number };
const DESIGNS: Design[] = [
  { clusters: 5, size: 2 },
  { clusters: 10, size: 3 },
  { clusters: 20, size: 4 },
  { clusters: 8, size: 5 },
  { clusters: 30, size: 2 },
  { clusters: 12, size: 6 },
];
const PATTERNS = ['spread', 'polarized', 'seeded'] as const;

/** The planted pass count of each cluster: spread evenly, all or nothing, or drawn from the seed. */
function counts(seed: number, design: Design, pattern: (typeof PATTERNS)[number]): number[] {
  const rng = rngFor(seed, `variance-${design.clusters}-${design.size}-${pattern}`);
  return Array.from({ length: design.clusters }, (_, index) => {
    if (pattern === 'spread') return index % (design.size + 1);
    if (pattern === 'polarized') return index % 2 === 0 ? design.size : 0;
    return between(rng, 0, design.size);
  });
}

/** The clustered campaign through the chain; returns the pass flag of each run, by spec then repeat. */
async function clusteredFlags(
  seed: number,
  design: Design,
  planted: number[],
  tag: string,
): Promise<boolean[][]> {
  const behaviours = new Map<string, Behaviour>();
  const loaded: Array<{ spec: Spec; hash: string }> = [];
  planted.forEach((passing, j) => {
    const code = `R-${1000 + j}`;
    const id = `var-${tag}-${seed}-s${j}`;
    const text = `Which reference do I need for case ${j}? (${id})`;
    const raw: RawSpec = {
      id,
      kind: 'conversation',
      stages: ['answer'],
      blocks: [{ when: { user: text }, expect: { stage: 'answer', must: [`\\b${code}\\b`] } }],
    };
    const result = validateSpec(raw, 'bank');
    if (!result.ok) throw new Error('a variance spec does not load');
    loaded.push({ spec: result.spec, hash: result.hash });
    let answered = 0;
    behaviours.set(text, () => {
      const pass = answered < passing;
      answered += 1;
      const reply = `The reference is ${pass ? code : 'R-0000'}.`;
      const observed: Observed = {
        segments: [{ type: 'text', text: reply }],
        text: reply,
        toolCalls: [],
        runtime: { stages: [{ name: 'answer' }] },
        cost: {},
        latencyMs: 0,
      };
      return observed;
    });
  });
  const store = openMemoryStore();
  try {
    await store.putCampaign({
      campaignId: 'c-var',
      specs: loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash })),
      targets: [TARGET],
      modes: ['F'],
      repeats: { T: 0, F: design.size, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    });
    const cells = planCampaign(loaded, [TARGET], ['F'], design.size).cells;
    const byHash = new Map(loaded.map((entry) => [entry.hash, entry.spec] as const));
    await runCampaign({
      campaignId: 'c-var',
      cells,
      specFor: (cell) => byHash.get(cell.specHash) as Spec,
      adapterFor: () => adapterFor('function', behaviours),
      driver: () => createScriptedDriver(),
      checks: defaultChecks(),
      store,
      retry: FAST_RETRY,
      concurrency: 1,
    });
    const runs = await store.listRuns({ campaignId: 'c-var' });
    return loaded.map((entry) => {
      const mine = runs.filter((run) => run.specId === entry.spec.id).sort((a, b) => a.repeat - b.repeat);
      return mine.map((run) => run.status === 'completed' && run.blocks.every((block) => block.pass));
    });
  } finally {
    await store.close();
  }
}

function observationsOf(flags: boolean[][]) {
  return flags.flatMap((runs, spec) => runs.map((value) => ({ value, path: [`spec-${spec}`] })));
}

export function varianceItems(): BankItem[] {
  const out: Draft[] = [];
  for (const design of DESIGNS) {
    for (const pattern of PATTERNS) {
      const id = `variance/icc/${design.clusters}x${design.size}/${pattern}`;
      out.push({
        id,
        family: 'variance',
        tier: (pattern === 'seeded' ? 3 : 2) as Tier,
        level: 7,
        component: SYSTEM_COMPONENTS.designEffect,
        source: 'differential',
        title: `the correlation of ${design.clusters} specs by ${design.size} runs (${pattern}) read from the stored runs equals one-way ANOVA on the plant`,
        async check({ seed }) {
          const planted = counts(seed, design, pattern);
          const flags = await clusteredFlags(
            seed,
            design,
            planted,
            `${design.clusters}x${design.size}-${pattern}`,
          );
          const groups = planted.map((passing) =>
            Array.from({ length: design.size }, (_, r) => (r < passing ? 1 : 0)),
          );
          const stored = flags.map((runs) => runs.filter(Boolean).length);
          if (stored.join() !== planted.join())
            return fail(`stored pass counts ${stored.join(',')}, planted ${planted.join(',')}`);
          const want = referenceIcc(groups);
          const got = Math.max(
            0,
            stats.icc(stats.varianceComponents(observationsOf(flags), { levels: ['spec'] }))[0]?.icc ??
              Number.NaN,
          );
          return Math.abs(got - want) < 1e-9 ? PASS : fail(`icc ${got}, reference ${want}`);
        },
      });
    }
  }
  for (const design of DESIGNS) {
    const id = `variance/design-effect/${design.clusters}x${design.size}`;
    out.push({
      id,
      family: 'variance',
      tier: 2,
      level: 7,
      component: SYSTEM_COMPONENTS.designEffect,
      source: 'differential',
      title: `the design effect of ${design.clusters} specs by ${design.size} runs is 1 + (m - 1) rho with rho from the stored runs, and the effective sample size divides by it`,
      async check({ seed }) {
        const planted = counts(seed, design, 'seeded');
        const flags = await clusteredFlags(seed, design, planted, `deff-${design.clusters}x${design.size}`);
        const groups = planted.map((passing) =>
          Array.from({ length: design.size }, (_, r) => (r < passing ? 1 : 0)),
        );
        const rho = referenceIcc(groups);
        const n = design.clusters * design.size;
        return expectAll([
          [
            Math.abs(stats.designEffect(design.size, rho) - (1 + (design.size - 1) * rho)) < 1e-12,
            'designEffect is not 1 + (m - 1) rho',
          ],
          [
            Math.abs(stats.effectiveSampleSize(n, design.size, rho) - n / (1 + (design.size - 1) * rho)) <
              1e-9,
            'effectiveSampleSize is not n over the design effect',
          ],
          [flags.flat().length === n, `${flags.flat().length} runs stored, ${n} planted`],
        ]);
      },
    });
  }
  for (const design of DESIGNS.slice(0, 4)) {
    const id = `variance/clustered-wider/${design.clusters}x${design.size}`;
    out.push({
      id,
      family: 'variance',
      tier: 3,
      level: 7,
      component: SYSTEM_COMPONENTS.wilson,
      source: 'research',
      title: `on polarized specs the clustered bootstrap interval holds the stored pass rate and is wider than the naive Wilson interval (${design.clusters} by ${design.size})`,
      async check({ seed }) {
        const planted = counts(seed, design, 'polarized');
        const flags = await clusteredFlags(seed, design, planted, `wide-${design.clusters}x${design.size}`);
        const values: number[] = flags.flat().map((flag) => (flag ? 1 : 0));
        const clusters = flags.flatMap((runs, spec) => runs.map(() => spec));
        const rate = values.reduce((sum, value) => sum + value, 0) / values.length;
        const clustered = stats.bootstrapCI(values, { clusters, seed, iterations: 2000 });
        const naive = stats.wilson(values.filter(Boolean).length, values.length);
        return expectAll([
          [
            clustered.lower <= rate && rate <= clustered.upper,
            `the clustered interval [${clustered.lower}, ${clustered.upper}] misses ${rate}`,
          ],
          [
            clustered.upper - clustered.lower > naive.upper - naive.lower,
            `clustered width ${clustered.upper - clustered.lower} is not above naive ${naive.upper - naive.lower}`,
          ],
        ]);
      },
    });
  }
  out.push({
    id: 'variance/wilson-calibration',
    family: 'variance',
    tier: 5,
    level: 7,
    component: SYSTEM_COMPONENTS.wilson,
    source: 'research',
    title:
      'at least 93 of 100 Wilson intervals on the stored baseline pass rate hold the true rate 0.93 (50 pairs per campaign)',
    async check({ seed }) {
      const measure = wilsonCalibration(await effectFor(seed), seed, stats);
      return measure.value >= 0.93
        ? PASS
        : fail(
            `coverage ${measure.value}: ${measure.items
              .slice(0, 3)
              .map((item) => item.detail)
              .join('; ')}`,
          );
    },
  });
  out.push({
    id: 'variance/design-effect-calibration',
    family: 'variance',
    tier: 5,
    level: 7,
    component: SYSTEM_COMPONENTS.designEffect,
    source: 'research',
    title: `on each of 100 clustered campaigns the design effect estimated on the stored runs equals one-way ANOVA on those runs, and their mean (m ${CLUSTER_SIZE}, rho ${CLUSTER_RHO}) lies in the ${1 - DEFF_ALPHA} interval of its exact finite-sample law, and the bootstrap interval of that mean has the width and centre of its level`,
    async check({ seed }) {
      const measure = designEffectCalibration(await effectFor(seed), seed, stats, designEffectOracle());
      if (measure.value === 1) return PASS;
      return fail(
        measure.items
          .slice(0, 3)
          .map((item) => item.detail)
          .join('; '),
      );
    },
  });
  out.push({
    id: 'variance/parity-power',
    family: 'variance',
    tier: 5,
    level: 7,
    component: SYSTEM_COMPONENTS.parity,
    source: 'research',
    title:
      'the parity verdict detects a planted 20 point drop in at least 95 of 100 campaigns and false-alarms in at most 5 of 100 with no drop',
    async check({ seed }) {
      const measure = parityLevel(await effectFor(seed), seed, stats);
      return measure.value >= 0.95
        ? PASS
        : fail(
            `value ${measure.value}: ${measure.items
              .slice(0, 3)
              .map((item) => item.detail)
              .join('; ')}`,
          );
    },
  });
  return withCauses(out, (item) =>
    item.id.startsWith('variance/icc/')
      ? 'the correlation of stored runs by spec equals one-way ANOVA'
      : item.id.startsWith('variance/design-effect/')
        ? 'the design effect is 1 + (m - 1) rho with rho from the stored runs'
        : item.id.startsWith('variance/clustered-wider/')
          ? 'the clustered bootstrap interval holds the stored rate and is wider than Wilson on polarized specs'
          : undefined,
  );
}

/** The planted effect of the last seed asked for: three items share it, and seeds run one after another. */
let held: { seed: number; effect: ReturnType<typeof runEffect> } | undefined;
function effectFor(seed: number): ReturnType<typeof runEffect> {
  if (held?.seed !== seed) held = { seed, effect: runEffect(seed) };
  return held.effect;
}

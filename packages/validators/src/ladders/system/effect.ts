import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type Campaign,
  type CellOutcome,
  type LoadedSpec,
  type Observed,
  type PlannedCell,
  planCampaign,
  type RunMode,
  type RunResult,
  runCampaign,
  type Store,
  type TargetRef,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import * as stats from '@agent-nexus/driftbench-stats';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import { plantedAdapter } from './agent';
import { SYSTEM_COMPONENTS } from './components';
import { wrongCode } from './family';
import type { Behaviour, RawSpec } from './plant';
import { between, rngFor } from './random';

/**
 * The planted effect of the system bank (variance items): two agent versions with a chosen pass-rate gap
 * over 100 seeded campaigns, and 100 clustered campaigns with a planted correlation, run through the
 * campaign runner and the store. The calibration and parity measures read the stored runs.
 */

/** Every planted run goes to this target; the variant names the agent version in levels 6 and 7. */
export const PLANTED_TARGET: TargetRef = { adapter: 'function', agent: 'planted-system' };

/** One fixed clock, so two runs of a seed write the same records. */
const CLOCK = new Date('2026-10-11T00:00:00.000Z');
const now = () => CLOCK;

/** Raw specs through the loader, keyed by hash. A spec the loader refuses throws, naming it. */
export function loadSpecs(raw: readonly RawSpec[]): LoadedSpec[] {
  return raw.map((spec) => {
    const loaded = validateSpec(spec, `plant:${spec.id}`);
    if (!loaded.ok) {
      const errors = loaded.errors.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`);
      throw new Error(`the plant built a spec the loader refuses, ${spec.id}: ${errors.join('; ')}`);
    }
    return loaded;
  });
}

function campaignRecord(
  campaignId: string,
  loaded: readonly LoadedSpec[],
  targets: readonly TargetRef[],
  mode: RunMode,
  repeats: number,
): Campaign {
  return {
    campaignId,
    specs: loaded.map((spec) => ({ id: spec.spec.id, hash: spec.hash })),
    targets: [...targets],
    modes: [mode],
    repeats: { T: 0, F: mode === 'F' ? repeats : 0, P: mode === 'P' ? repeats : 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CLOCK.toISOString(),
  };
}

type CampaignInput = {
  campaignId: string;
  loaded: readonly LoadedSpec[];
  cells: readonly PlannedCell[];
  adapter: AgentAdapter;
  store: Store;
  cache?: Store;
  mode: RunMode;
};

function runCells(input: CampaignInput): Promise<CellOutcome[]> {
  const byHash = new Map(input.loaded.map((spec) => [spec.hash, spec.spec] as const));
  const scripted = createScriptedDriver();
  return runCampaign({
    campaignId: input.campaignId,
    cells: input.cells,
    specFor: (cell) => {
      const spec = byHash.get(cell.specHash);
      if (!spec) throw new Error(`no planted spec has the hash ${cell.specHash}`);
      return spec;
    },
    adapterFor: () => input.adapter,
    driver: () => scripted,
    checks: defaultChecks(),
    store: input.store,
    ...(input.cache ? { cache: input.cache } : {}),
    now,
    concurrency: 1,
  });
}

/**
 * Levels 6 and 7: the planted effect. Each of EFFECT_CAMPAIGNS campaigns runs EFFECT_PAIRS one-block specs on
 * three versions of a threshold agent. Spec i of campaign c has a seeded difficulty u; a version of ability
 * a passes it when u < a. The baseline and its rerun (`same`) have ability BASELINE_RATE; the candidate with
 * the planted drop (`drop`) has BASELINE_RATE - PLANTED_DROP. So the true rates are known, the pairs are
 * paired by difficulty, and the rerun has no drop.
 *
 * The design point is chosen where the Wilson interval's exact coverage is high, so a correct chain passes
 * level 6 on almost every seed: see packages/validators/fixtures/system/design.json, which a test recomputes.
 */
export const EFFECT_CAMPAIGNS = 100;
export const EFFECT_PAIRS = 50;
export const BASELINE_RATE = 0.93;
export const PLANTED_DROP = 0.2;
/** The non-inferiority margin of the parity verdict, set before the campaigns run. */
export const PARITY_MARGIN = 0.1;
/**
 * Level 6: at least 93 of 100 Wilson intervals hold the truth. Level 7: at least 95 of 100 campaigns detect
 * the drop and at most 5 of 100 false-alarm, which is one bar on the lower of the detection share and the
 * share without a false alarm.
 */
export const CALIBRATION_BAR = 0.93;
export const DETECTION_BAR = 0.95;

/** Level 6, design effect: clusters (specs) per campaign, runs per cluster, planted rate and correlation. */
export const CLUSTERS = 20;
export const CLUSTER_SIZE = 4;
export const CLUSTER_RATE = 0.8;
export const CLUSTER_RHO = 0.25;
/** The level of the bootstrap interval on the mean estimated design effect: 1 - alpha. */
export const DEFF_ALPHA = 0.001;
/**
 * The level of the acceptance interval of the mean estimated design effect against its exact law: 1 - alpha. A
 * correct chain misses it on one seed in 2 million, where 0.001 missed about one folded seed in 1000, and the hidden
 * seed of every commit is one of 9000 folded seeds (itemSeed), so the old level failed about one commit in 1000.
 */
export const DEFF_LAW_ALPHA = 1e-6;
/**
 * Clustered campaigns per seed. The old item held the mean to the 0.999 interval over 100 campaigns. At 1 - 1e-6 the
 * interval is wider, so the count rises until the item rejects a chain whose correlation is off by 0.02 at least as
 * often as the old one did, computed exactly from the law of the mean: at rho 0.23 the old item rejected 5.048
 * percent and at 0.27 0.262 percent; at 1740 campaigns the new one rejects 97.07 and 0.264 percent (lattice step
 * 1e-3 for both; fixtures/system/design.json, clustered.power). 1735 gives 0.261 at 0.27, which is under the old.
 */
export const CLUSTERED_CAMPAIGNS = 1740;

export const VERSIONS = ['baseline', 'same', 'drop'] as const;
export type Version = (typeof VERSIONS)[number];

export function abilityOf(version: string | undefined): number {
  return version === 'drop' ? BASELINE_RATE - PLANTED_DROP : BASELINE_RATE;
}

/** A one-block spec whose reply passes when it states the code. */
function oneBlock(id: string, text: string, code: string): RawSpec {
  return {
    id,
    kind: 'conversation',
    stages: ['answer'],
    blocks: [{ id: 'b0', when: { user: text }, expect: { stage: 'answer', must: [`\\b${code}\\b`] } }],
  };
}

function oneBlockReply(code: string, pass: boolean): Observed {
  const text = `The reference you need is ${pass ? code : wrongCode(code)}.`;
  return {
    segments: [{ type: 'text', text }],
    text,
    toolCalls: [],
    runtime: { stages: [{ name: 'answer' }] },
    cost: { usd: 0 },
    latencyMs: 0,
  };
}

export type EffectCampaign = { index: number; specs: RawSpec[]; difficulty: number[] };
export type ClusterCampaign = { index: number; specs: RawSpec[]; clusterRate: number[] };

export type EffectPlant = {
  effect: EffectCampaign[];
  clustered: ClusterCampaign[];
  behaviours: Map<string, Behaviour>;
};

/**
 * The planted effect and the clustered campaigns. In a clustered campaign spec j has a pass probability of
 * CLUSTER_RATE plus or minus delta (each with probability one half), delta chosen so the correlation of two
 * runs of one spec is exactly CLUSTER_RHO: delta squared over rate times one minus rate. Run r of spec j
 * passes with that probability; the agent counts the runs of each spec it has answered, so the r-th run
 * draws the r-th number (campaigns run their cells in order, one at a time).
 */
export function plantEffect(
  seed: number,
  campaigns = EFFECT_CAMPAIGNS,
  clusteredCampaigns = CLUSTERED_CAMPAIGNS,
  rho = CLUSTER_RHO,
): EffectPlant {
  const behaviours = new Map<string, Behaviour>();
  const effect: EffectCampaign[] = [];
  const clustered: ClusterCampaign[] = [];
  const delta = Math.sqrt(rho * CLUSTER_RATE * (1 - CLUSTER_RATE));
  for (let c = 0; c < campaigns; c += 1) {
    const rng = rngFor(seed, `effect-${c}`);
    const specs: RawSpec[] = [];
    const difficulty: number[] = [];
    for (let i = 0; i < EFFECT_PAIRS; i += 1) {
      const u = rng();
      const code = `R-${between(rng, 1000, 9999)}`;
      const id = `eff-${seed}-c${c}-s${i}`;
      const text = `Set ${c}, question ${i}: which reference do I need? (${id})`;
      difficulty.push(u);
      specs.push(oneBlock(id, text, code));
      behaviours.set(text, (target) => oneBlockReply(code, u < abilityOf(target.variant)));
    }
    effect.push({ index: c, specs, difficulty });
  }
  for (let c = 0; c < clusteredCampaigns; c += 1) {
    const crng = rngFor(seed, `cluster-${c}`);
    const cspecs: RawSpec[] = [];
    const clusterRate: number[] = [];
    for (let j = 0; j < CLUSTERS; j += 1) {
      const rate = crng() < 0.5 ? CLUSTER_RATE + delta : CLUSTER_RATE - delta;
      const code = `R-${between(crng, 1000, 9999)}`;
      const id = `clu-${seed}-c${c}-s${j}`;
      const text = `Cluster set ${c}, question ${j}: which reference do I need? (${id})`;
      const draws = rngFor(seed, `cluster-${c}-${j}`);
      clusterRate.push(rate);
      cspecs.push(oneBlock(id, text, code));
      behaviours.set(text, () => oneBlockReply(code, draws() < rate));
    }
    clustered.push({ index: c, specs: cspecs, clusterRate });
  }
  return { effect, clustered, behaviours };
}

/** Levels 6 and 7: every planted-effect run, read back from the store, by campaign. */
export type EffectState = {
  plant: EffectPlant;
  /** Pass flag per spec, per version, per effect campaign: flags[c][version][i]. */
  flags: Array<Record<(typeof VERSIONS)[number], boolean[]>>;
  /** Pass flag per run of each cluster, per clustered campaign: clusters[c][j][r]. */
  clusters: boolean[][][];
  /** Runs that did not complete or were missing from the store, as `campaign spec version`. */
  problems: string[];
};

/** Whether a stored run passed: completed, and every block passed. */
export function runPassed(run: RunResult): boolean {
  return run.status === 'completed' && run.blocks.length > 0 && run.blocks.every((block) => block.pass);
}

/**
 * The planted effect through the chain, in an in-memory store: each effect campaign runs its specs on the
 * three versions (one cell per spec and version), each clustered campaign runs its specs CLUSTER_SIZE times.
 * The flags come from the runs the store gives back, never from the plant.
 */
export async function runEffect(seed: number, campaigns?: number): Promise<EffectState> {
  const plant = plantEffect(seed, campaigns);
  const adapter = plantedAdapter(plant.behaviours, `planted-effect-${seed}`);
  const store = openMemoryStore();
  const problems: string[] = [];
  const flags: EffectState['flags'] = [];
  const clusters: boolean[][][] = [];
  try {
    const targets = VERSIONS.map((variant): TargetRef => ({ ...PLANTED_TARGET, variant }));
    for (const campaign of plant.effect) {
      const loaded = loadSpecs(campaign.specs);
      const campaignId = `effect-${seed}-${campaign.index}`;
      await store.putCampaign(campaignRecord(campaignId, loaded, targets, 'F', 1));
      const cells = planCampaign(loaded, targets, ['F'], 1).cells;
      await runCells({ campaignId, loaded, cells, adapter, store, mode: 'F' });
      const runs = await store.listRuns({ campaignId });
      const byKey = new Map(runs.map((each) => [`${each.specId} ${each.target.variant}`, each] as const));
      const entry = { baseline: [] as boolean[], same: [] as boolean[], drop: [] as boolean[] };
      for (const spec of loaded) {
        for (const version of VERSIONS) {
          const stored = byKey.get(`${spec.spec.id} ${version}`);
          if (stored?.status !== 'completed') problems.push(`${campaignId} ${spec.spec.id} ${version}`);
          entry[version].push(stored ? runPassed(stored) : false);
        }
      }
      flags.push(entry);
    }
    const clusterTarget: TargetRef = { ...PLANTED_TARGET, variant: 'clustered' };
    for (const campaign of plant.clustered) {
      const loaded = loadSpecs(campaign.specs);
      const campaignId = `clustered-${seed}-${campaign.index}`;
      await store.putCampaign(campaignRecord(campaignId, loaded, [clusterTarget], 'F', CLUSTER_SIZE));
      const cells = planCampaign(loaded, [clusterTarget], ['F'], CLUSTER_SIZE).cells;
      await runCells({ campaignId, loaded, cells, adapter, store, mode: 'F' });
      const runs = await store.listRuns({ campaignId });
      const bySpec = new Map<string, boolean[]>();
      for (const each of runs) {
        const list = bySpec.get(each.specId) ?? [];
        list[each.repeat] = runPassed(each);
        bySpec.set(each.specId, list);
      }
      clusters.push(
        loaded.map((spec) => {
          const list = bySpec.get(spec.spec.id) ?? [];
          if (list.length !== CLUSTER_SIZE)
            problems.push(`${campaignId} ${spec.spec.id}: ${list.length} of ${CLUSTER_SIZE} runs stored`);
          return list;
        }),
      );
    }
  } finally {
    await store.close();
  }
  return { plant, flags, clusters, problems };
}

/** The statistics the levels use. Tests replace one to plant a fault. */
export type SystemStats = Pick<
  typeof stats,
  'wilson' | 'varianceComponents' | 'icc' | 'designEffect' | 'bootstrapCI' | 'nonInferiority'
>;

function ratio(good: number, total: number): number {
  return total === 0 ? 1 : good / total;
}

/**
 * Wilson calibration: the share of effect campaigns whose Wilson interval on the baseline pass rate holds the
 * true rate. Reported on its own, so a design-effect miss never hides the coverage (and the reverse).
 */
export function wilsonCalibration(effect: EffectState, seed: number, s: SystemStats): Measure {
  const items: Item[] = problemItems(effect);
  let contained = 0;
  effect.flags.forEach((flags, campaign) => {
    const k = flags.baseline.filter(Boolean).length;
    const ci = s.wilson(k, EFFECT_PAIRS);
    if (ci.lower <= BASELINE_RATE && BASELINE_RATE <= ci.upper) contained += 1;
    else
      items.push({
        id: `wilson/c${campaign}`,
        component: SYSTEM_COMPONENTS.wilson,
        detail: `seed ${seed}, campaign ${campaign}: ${k} of ${EFFECT_PAIRS} baseline runs pass; Wilson [${showNumber(ci.lower)}, ${showNumber(ci.upper)}] misses the true rate ${BASELINE_RATE}`,
      });
  });
  const coverage = ratio(contained, effect.flags.length);
  return { value: effect.problems.length > 0 ? 0 : coverage, items };
}

/**
 * The exact finite-sample law of the design effect estimated on one clustered campaign: its mean, standard
 * deviation and skewness over every histogram of cluster pass counts the plant can produce. The truncation of
 * the correlation at zero makes the mean differ from the population value 1 + (m - 1) rho.
 */
export type DesignEffectLaw = { mean: number; sd: number; skew: number };

/**
 * The acceptance interval of the mean estimated design effect over n campaigns at level 1 - alpha: the
 * Cornish-Fisher quantiles of the mean (normal quantiles corrected for its skewness, skew over root n), so each
 * tail carries at most alpha / 2 of the exact law, where the plain normal interval puts more in the upper tail.
 */
export function designEffectInterval(law: DesignEffectLaw, n: number, alpha: number): [number, number] {
  const z = stats.normalQuantile(1 - alpha / 2);
  const shift = ((z * z - 1) * (law.skew / Math.sqrt(n))) / 6;
  const se = law.sd / Math.sqrt(n);
  return [law.mean + (-z + shift) * se, law.mean + (z + shift) * se];
}

/**
 * What the design-effect item is held against, none of it from the statistics under test: the exact law of the
 * estimate on one campaign, and a second implementation of the intraclass correlation of balanced 0/1 groups.
 */
export type DesignEffectOracle = {
  law: DesignEffectLaw;
  icc: (groups: readonly (readonly number[])[]) => number;
};

/** The most per-campaign misses the measure names; the rest are counted in the last one. */
const NAMED_MISSES = 3;

/**
 * Design-effect calibration, 1 or 0. Three conditions, all against the oracle:
 * 1. per campaign, the design effect the statistics give on the stored runs equals 1 + (m - 1) rho with rho from
 *    the oracle's correlation of those runs, to 1e-9: a constant, scaled or shifted estimate fails here;
 * 2. the statistics' design effect at the planted correlation equals 1 + (m - 1) CLUSTER_RHO;
 * 3. the mean of the oracle's design effects over the campaigns lies in the DEFF_LAW_ALPHA interval of the exact
 *    finite-sample law: the runs the chain stored follow the plant;
 * 4. the bootstrap interval of that mean behaves as an interval at its level (bootstrapShape).
 */
export function designEffectCalibration(
  effect: EffectState,
  seed: number,
  s: SystemStats,
  oracle: DesignEffectOracle,
): Measure {
  const items: Item[] = problemItems(effect);
  if (effect.problems.length > 0) return { value: 0, items };
  const component = SYSTEM_COMPONENTS.designEffect;
  const references: number[] = [];
  let misses = 0;
  effect.clusters.forEach((clusters, campaign) => {
    const observations = clusters.flatMap((runs, spec) =>
      runs.map((value) => ({ value, path: [`spec-${spec}`] })),
    );
    const components = s.varianceComponents(observations, { levels: ['spec'] });
    const rho = Math.max(0, s.icc(components)[0]?.icc ?? 0);
    const estimate = s.designEffect(CLUSTER_SIZE, rho);
    const reference =
      1 + (CLUSTER_SIZE - 1) * oracle.icc(clusters.map((runs) => runs.map((pass) => (pass ? 1 : 0))));
    references.push(reference);
    if (Math.abs(estimate - reference) < 1e-9) return;
    misses += 1;
    if (misses <= NAMED_MISSES)
      items.push({
        id: `design-effect/c${campaign}`,
        component,
        detail: `seed ${seed}, campaign ${campaign}: the design effect estimated on the stored runs is ${showNumber(estimate)}, one-way ANOVA on the same runs gives ${showNumber(reference)} (m ${CLUSTER_SIZE})`,
      });
  });
  if (misses > NAMED_MISSES)
    items.push({
      id: 'design-effect/campaigns',
      component,
      detail: `seed ${seed}: the estimated design effect differs from one-way ANOVA on the stored runs in ${misses} of ${effect.clusters.length} clustered campaigns`,
    });
  const planted = 1 + (CLUSTER_SIZE - 1) * CLUSTER_RHO;
  const stated = s.designEffect(CLUSTER_SIZE, CLUSTER_RHO);
  const formula = Math.abs(stated - planted) < 1e-12;
  if (!formula)
    items.push({
      id: 'design-effect/formula',
      component,
      detail: `the design effect at m ${CLUSTER_SIZE} and rho ${CLUSTER_RHO} is ${showNumber(stated)}, 1 + (m - 1) rho is ${showNumber(planted)}`,
    });
  const mean = stats.mean(references);
  const [lower, upper] = designEffectInterval(oracle.law, references.length, DEFF_LAW_ALPHA);
  const inside = lower <= mean && mean <= upper;
  if (!inside)
    items.push({
      id: 'design-effect',
      component,
      detail: `seed ${seed}: the mean design effect of the stored runs over ${references.length} clustered campaigns is ${showNumber(mean)}, outside the ${1 - DEFF_LAW_ALPHA} interval [${showNumber(lower)}, ${showNumber(upper)}] of its exact finite-sample law (mean ${showNumber(oracle.law.mean)}, sd ${showNumber(oracle.law.sd)}, m ${CLUSTER_SIZE}, rho ${CLUSTER_RHO})`,
    });
  const shape = bootstrapShape(references, seed, s);
  if (shape)
    items.push({
      id: 'design-effect/bootstrap',
      component: SYSTEM_COMPONENTS.wilson,
      detail: `seed ${seed}: ${shape}`,
    });
  return { value: misses === 0 && formula && inside && !shape ? 1 : 0, items };
}

/**
 * Bands of the bootstrap interval of a mean, in units an implementation cannot move: the standard error
 * sd / root n computed here. With 2000 resamples the 0.025 quantile sits 50 order statistics in, with a
 * binomial spread of 7, which is 0.06 standard errors at each end. So the width at alpha 0.05 over
 * 2 z(0.05) standard errors has a spread near 0.022 and the centre a spread near 0.05 standard errors; the
 * bands are about 8 spreads wide (3000 seeds of the plant gave 0.91 to 1.07 and -0.15 to 0.20). The DEFF_ALPHA
 * bounds are the outermost resample means, so their width over the 0.05 width is near z(0.001) / z(0.05) = 1.68
 * with a wider spread (1.40 to 1.98 on the same seeds).
 */
export const BOOTSTRAP_WIDTH = [0.8, 1.2] as const;
export const BOOTSTRAP_CENTRE = 0.4;
export const BOOTSTRAP_WIDENING = [1.2, 2.4] as const;
const BOOTSTRAP_ALPHA = 0.05;

/**
 * What is wrong with the bootstrap interval of the mean of the values, or undefined. The old item asked whether
 * the DEFF_ALPHA bootstrap interval holds the population design effect; a correct interval misses even the exact
 * expected value on about 4 seeds in 1000, so the item asks instead what a single seed can decide: the interval
 * has a positive width and holds the mean, the DEFF_ALPHA interval strictly holds the 0.05 one, and the widths and
 * the centre lie in the bands above.
 */
export function bootstrapShape(values: readonly number[], seed: number, s: SystemStats): string | undefined {
  const mean = stats.mean(values);
  const se = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0)) / values.length;
  const inner = s.bootstrapCI(values, { alpha: BOOTSTRAP_ALPHA, seed });
  const outer = s.bootstrapCI(values, { alpha: DEFF_ALPHA, seed });
  const show = (ci: { lower: number; upper: number }) => `[${showNumber(ci.lower)}, ${showNumber(ci.upper)}]`;
  const said = `the bootstrap interval of the mean ${showNumber(mean)} of ${values.length} design effects`;
  for (const [alpha, ci] of [
    [BOOTSTRAP_ALPHA, inner],
    [DEFF_ALPHA, outer],
  ] as const) {
    if (!(ci.lower < mean && mean < ci.upper))
      return `${said} at ${1 - alpha} is ${show(ci)}, which has no width or does not hold the mean`;
  }
  if (!(outer.lower < inner.lower && inner.upper < outer.upper))
    return `${said} at ${1 - DEFF_ALPHA} is ${show(outer)}, which does not strictly hold the one at ${1 - BOOTSTRAP_ALPHA}, ${show(inner)}`;
  const width = (inner.upper - inner.lower) / (2 * stats.normalQuantile(1 - BOOTSTRAP_ALPHA / 2) * se);
  if (!(BOOTSTRAP_WIDTH[0] <= width && width <= BOOTSTRAP_WIDTH[1]))
    return `${said} at ${1 - BOOTSTRAP_ALPHA} is ${show(inner)}, ${showNumber(width)} times the width of its level (standard error ${showNumber(se)}), outside ${BOOTSTRAP_WIDTH.join(' to ')}`;
  const centre = ((inner.upper + inner.lower) / 2 - mean) / se;
  if (Math.abs(centre) > BOOTSTRAP_CENTRE)
    return `${said} at ${1 - BOOTSTRAP_ALPHA} is ${show(inner)}, centred ${showNumber(centre)} standard errors from the mean, beyond ${BOOTSTRAP_CENTRE}`;
  const widening = (outer.upper - outer.lower) / (inner.upper - inner.lower);
  if (!(BOOTSTRAP_WIDENING[0] <= widening && widening <= BOOTSTRAP_WIDENING[1]))
    return `${said} at ${1 - DEFF_ALPHA} is ${show(outer)}, ${showNumber(widening)} times as wide as at ${1 - BOOTSTRAP_ALPHA}, outside ${BOOTSTRAP_WIDENING.join(' to ')}`;
  return undefined;
}

function problemItems(effect: EffectState): Item[] {
  return effect.problems.slice(0, 20).map((problem) => ({
    id: `run/${problem.split(' ').slice(0, 2).join('/')}`,
    component: SYSTEM_COMPONENTS.runner,
    detail: `a planted-effect run is missing from the store or did not complete: ${problem}`,
  }));
}

/**
 * Level 7: the parity verdict. The share of effect campaigns where the verdict on (baseline, drop) is not
 * non-inferior (the drop is detected), and the share where the verdict on (baseline, same) stays
 * non-inferior (no false alarm). The value is the lower of the two.
 */
export function parityLevel(effect: EffectState, seed: number, s: SystemStats): Measure {
  const items: Item[] = problemItems(effect);
  let detected = 0;
  let quiet = 0;
  effect.flags.forEach((flags, campaign) => {
    const drop = s.nonInferiority({ baseline: flags.baseline, candidate: flags.drop, margin: PARITY_MARGIN });
    const same = s.nonInferiority({ baseline: flags.baseline, candidate: flags.same, margin: PARITY_MARGIN });
    const rate = (list: boolean[]) => showNumber(list.filter(Boolean).length / list.length);
    if (!drop.nonInferior) detected += 1;
    else
      items.push({
        id: `parity-miss/c${campaign}`,
        component: SYSTEM_COMPONENTS.parity,
        detail: `seed ${seed}, campaign ${campaign}: the planted drop went undetected; pass rates ${rate(flags.baseline)} and ${rate(flags.drop)}, discordant regressed ${drop.discordant.regressed} improved ${drop.discordant.improved}, effect ${showNumber(drop.effect.estimate)} [${showNumber(drop.effect.lower)}, ${showNumber(drop.effect.upper)}]: ${drop.reason}`,
      });
    if (same.nonInferior) quiet += 1;
    else
      items.push({
        id: `parity-alarm/c${campaign}`,
        component: SYSTEM_COMPONENTS.parity,
        detail: `seed ${seed}, campaign ${campaign}: a false alarm with no drop; pass rates ${rate(flags.baseline)} and ${rate(flags.same)}, discordant regressed ${same.discordant.regressed} improved ${same.discordant.improved}, effect ${showNumber(same.effect.estimate)} [${showNumber(same.effect.lower)}, ${showNumber(same.effect.upper)}]: ${same.reason}`,
      });
  });
  const value = Math.min(ratio(detected, effect.flags.length), ratio(quiet, effect.flags.length));
  return { value: effect.problems.length > 0 ? 0 : value, items };
}

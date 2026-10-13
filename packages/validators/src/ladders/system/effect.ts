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
export function plantEffect(seed: number, campaigns = EFFECT_CAMPAIGNS): EffectPlant {
  const behaviours = new Map<string, Behaviour>();
  const effect: EffectCampaign[] = [];
  const clustered: ClusterCampaign[] = [];
  const delta = Math.sqrt(CLUSTER_RHO * CLUSTER_RATE * (1 - CLUSTER_RATE));
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
 * Level 6: calibration. The share of effect campaigns whose Wilson interval on the baseline pass rate holds
 * the true rate, and whether the true design effect lies in the bootstrap interval of the mean estimated
 * design effect over the clustered campaigns (1 or 0). The value is the lower of the two.
 */
export function calibrationLevel(effect: EffectState, seed: number, s: SystemStats): Measure {
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
  const estimates = effect.clusters.map((clusters) => {
    const observations = clusters.flatMap((runs, spec) =>
      runs.map((value) => ({ value, path: [`spec-${spec}`] })),
    );
    const components = s.varianceComponents(observations, { levels: ['spec'] });
    const rho = Math.max(0, s.icc(components)[0]?.icc ?? 0);
    return s.designEffect(CLUSTER_SIZE, rho);
  });
  const truth = s.designEffect(CLUSTER_SIZE, CLUSTER_RHO);
  const ci = s.bootstrapCI(estimates, { alpha: DEFF_ALPHA, seed });
  const inside = ci.lower <= truth && truth <= ci.upper ? 1 : 0;
  if (inside === 0)
    items.push({
      id: 'design-effect',
      component: SYSTEM_COMPONENTS.designEffect,
      detail: `seed ${seed}: the mean estimated design effect over ${estimates.length} clustered campaigns is ${showNumber(stats.mean(estimates))}, bootstrap interval at ${1 - DEFF_ALPHA} [${showNumber(ci.lower)}, ${showNumber(ci.upper)}], which misses the true design effect ${showNumber(truth)} (m ${CLUSTER_SIZE}, rho ${CLUSTER_RHO})`,
    });
  const value = Math.min(coverage, inside);
  return { value: effect.problems.length > 0 ? 0 : value, items };
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

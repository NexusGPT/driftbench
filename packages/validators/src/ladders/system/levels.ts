import { canonicalJson, type DriftClass, RunResult } from '@driftbench/core';
import * as stats from '@driftbench/stats';
import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import { type ChainState, type EffectState, type StoredCampaign, verdictProjection } from './chain';
import { CHECK_COMPONENTS, driftComponent, recoveryComponent, SYSTEM_COMPONENTS } from './components';
import { OPERATORS } from './family';
import {
  BASELINE_RATE,
  CLUSTER_RHO,
  CLUSTER_SIZE,
  DEFF_ALPHA,
  EFFECT_PAIRS,
  PARITY_MARGIN,
  type PlantedDefect,
  SAFE_ACTION_CLASSES,
} from './plant';

/**
 * The eight levels of the system validator (docs/validators.md section 5). Each reads what the chain
 * stored and compares it with the plant. The statistics the levels compute come from @driftbench/stats,
 * so a fault in them shows at the level that uses them.
 */

/** The statistics the levels use. Tests replace one to plant a fault. */
export type SystemStats = Pick<
  typeof stats,
  'wilson' | 'varianceComponents' | 'icc' | 'designEffect' | 'bootstrapCI' | 'nonInferiority'
>;

function ratio(good: number, total: number): number {
  return total === 0 ? 1 : good / total;
}

function failingVerdicts(run: RunResult, index: number): string {
  const block = run.blocks.find((each) => each.index === index);
  if (!block) return 'the run has no such block';
  const shown = block.verdicts.map((verdict) => `${verdict.id} ${verdict.outcome}`);
  return shown.length === 0 ? 'no check ran' : shown.join(', ');
}

function familyOf(verdictId: string): string {
  return verdictId.split('.', 1)[0] ?? verdictId;
}

/** Level 1: every run stored and loadable, every spec loadable, and the resume reused the first half. */
export function storedLevel(state: ChainState): Measure {
  const items: Item[] = [];
  let planned = 0;
  let good = 0;
  const check = (campaign: StoredCampaign, resumeCheck: boolean) => {
    const loadable = new Map(campaign.specs.map((spec) => [spec.hash, spec] as const));
    const liveRuns = new Map<string, number>();
    if (resumeCheck) {
      for (const cell of campaign.cells) {
        if (!state.resume.before.has(cell.cellId))
          liveRuns.set(cell.specId, (liveRuns.get(cell.specId) ?? 0) + 1);
      }
    }
    for (const cell of campaign.cells) {
      planned += 1;
      const problems: string[] = [];
      let component: string = SYSTEM_COMPONENTS.store;
      const stored = campaign.stored.get(cell.cellId);
      const outcome = campaign.outcomes.get(cell.cellId);
      if (!stored) problems.push('the reopened store holds no run for this cell');
      else {
        const parsed = RunResult.safeParse(stored);
        if (!parsed.success)
          problems.push(`the stored run does not parse: ${parsed.error.issues[0]?.message ?? ''}`);
        if (stored.status !== 'completed') {
          problems.push(`the run ${stored.status}: ${stored.error ?? 'no error recorded'}`);
          component = SYSTEM_COMPONENTS.runner;
        }
        if (outcome?.run && canonicalJson(outcome.run) !== canonicalJson(stored)) {
          problems.push('the stored run differs from the run the campaign returned');
        }
      }
      if (!outcome?.run) problems.push('the campaign returned no run for this cell');
      if (loadable.get(cell.specHash)?.loadable !== true)
        problems.push(`the store cannot give back spec ${cell.specId}`);
      if (resumeCheck && outcome) {
        const before = state.resume.before.has(cell.cellId);
        if (before && !outcome.reused) {
          problems.push('run before the interruption, yet the resume ran it again');
          component = SYSTEM_COMPONENTS.campaign;
        }
        if (!before && outcome.reused) {
          problems.push('never run before the interruption, yet the resume reports it reused');
          component = SYSTEM_COMPONENTS.campaign;
        }
        const sent = state.resume.startsAfter.get(cell.specId) ?? 0;
        const expected = liveRuns.get(cell.specId) ?? 0;
        if (sent !== expected) {
          problems.push(
            `after the interruption the agent started ${sent} runs of ${cell.specId}, ${expected} expected`,
          );
          component = SYSTEM_COMPONENTS.campaign;
        }
      }
      if (problems.length === 0) good += 1;
      else
        items.push({
          id: `${campaign.campaignId}/${cell.specId}/r${cell.repeat}${cell.perturbationId ? `/${cell.perturbationId}` : ''}`,
          component,
          detail: `cell ${cell.cellId}: ${problems.join('; ')}`,
        });
    }
    for (const problem of campaign.problems) {
      items.push({ id: `${campaign.campaignId}/store`, component: SYSTEM_COMPONENTS.store, detail: problem });
    }
  };
  check(state.defectCampaign, true);
  check(state.recoveryCampaign, false);
  const value = ratio(good, planned);
  return {
    value:
      state.defectCampaign.problems.length + state.recoveryCampaign.problems.length > 0
        ? Math.min(value, 0)
        : value,
    items,
  };
}

type PlantedRun = { defect: PlantedDefect; run: RunResult | undefined; repeat: number };

/** Every planted defect beside each stored run of its spec. */
function plantedRuns(state: ChainState): PlantedRun[] {
  const out: PlantedRun[] = [];
  for (const cell of state.defectCampaign.cells) {
    const run = state.defectCampaign.stored.get(cell.cellId);
    for (const defect of state.defects.defects) {
      if (defect.specId === cell.specId) out.push({ defect, run, repeat: cell.repeat });
    }
  }
  return out;
}

function defectId(entry: PlantedRun): string {
  return `${entry.defect.specId}/r${entry.repeat}/b${entry.defect.block}/${entry.defect.faultId}`;
}

/** Level 2: every planted defect produces a failing block at the planted index. */
export function recallLevel(state: ChainState): Measure {
  const items: Item[] = [];
  const planted = plantedRuns(state).filter((entry) => entry.defect.kind !== 'control');
  let found = 0;
  for (const entry of planted) {
    const operator = OPERATORS[entry.defect.class];
    const block = entry.run?.blocks.find((each) => each.index === entry.defect.block);
    if (block && !block.pass) {
      found += 1;
      continue;
    }
    items.push({
      id: defectId(entry),
      component: entry.run
        ? (CHECK_COMPONENTS[operator?.check ?? ''] ?? SYSTEM_COMPONENTS.runner)
        : SYSTEM_COMPONENTS.store,
      detail: entry.run
        ? `block ${entry.defect.block} passed; planted ${entry.defect.faultId} (${entry.defect.class}: ${operator?.does ?? 'no operator'}), which the ${operator?.check ?? '?'} check must catch; checks that ran: ${failingVerdicts(entry.run, entry.defect.block)}`
        : 'no stored run for this cell',
    });
  }
  return { value: ratio(found, planted.length), items };
}

/** Level 3: no failing block without a planted defect. A control is no defect. */
export function precisionLevel(state: ChainState): Measure {
  const items: Item[] = [];
  const planted = new Map(
    state.defects.defects.map((defect) => [`${defect.specId} ${defect.block}`, defect] as const),
  );
  let failing = 0;
  let explained = 0;
  for (const cell of state.defectCampaign.cells) {
    const run = state.defectCampaign.stored.get(cell.cellId);
    for (const block of run?.blocks ?? []) {
      if (block.pass) continue;
      failing += 1;
      const defect = planted.get(`${cell.specId} ${block.index}`);
      if (defect && defect.kind !== 'control') {
        explained += 1;
        continue;
      }
      const failed = block.verdicts.filter((verdict) => verdict.gating && verdict.outcome !== 'pass');
      const first = failed[0];
      items.push({
        id: `${cell.specId}/r${cell.repeat}/b${block.index}`,
        component: first
          ? (CHECK_COMPONENTS[familyOf(first.id)] ?? SYSTEM_COMPONENTS.runner)
          : SYSTEM_COMPONENTS.runner,
        detail: `block ${block.index} fails with no planted defect${defect ? ` (the control ${defect.faultId} sits here and changes nothing)` : ''}: ${failed.map((verdict) => `${verdict.id} ${verdict.outcome}: ${verdict.evidence}`).join('; ')}`,
      });
    }
  }
  return { value: ratio(explained, failing), items };
}

/** Level 4: every failing planted block carries the drift class of its fault. */
export function classLevel(state: ChainState, root: string): Measure {
  const items: Item[] = [];
  let failing = 0;
  let right = 0;
  for (const entry of plantedRuns(state)) {
    if (entry.defect.kind === 'control') continue;
    const block = entry.run?.blocks.find((each) => each.index === entry.defect.block);
    if (!block || block.pass) continue;
    failing += 1;
    const expected = OPERATORS[entry.defect.class]?.drift as DriftClass;
    if (block.drift.includes(expected)) {
      right += 1;
      continue;
    }
    const failed = block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome === 'fail')
      .map((verdict) => verdict.id);
    items.push({
      id: defectId(entry),
      component: driftComponent(root),
      detail: `planted ${entry.defect.faultId} (${entry.defect.class}) must carry ${expected}; the block carries ${block.drift.length === 0 ? 'no class' : block.drift.join(', ')}; failing verdicts: ${failed.join(', ')}; the class comes from the mapping of check family to drift class (${failed.map(familyOf).join(', ')})`,
    });
  }
  return { value: ratio(right, failing), items };
}

/** The recovery record the plant implies, by docs/concepts/recovery.md. */
function plantedRecord(recovery: ChainState['recoveries']['recoveries'][number]): Record<string, unknown> {
  const label = recovery.turns === undefined ? 'never' : recovery.turns === 0 ? 'immediate' : 'late';
  return {
    injectedAt: recovery.injectedAt,
    turnsToRecover: recovery.turns ?? null,
    label,
    collateral: recovery.collateral,
    ...(SAFE_ACTION_CLASSES.has(recovery.class) ? { safeAction: !recovery.unsafe } : {}),
  };
}

/** Level 5: every perturbed run's recovery record equals the plant. */
export function recoveryLevel(state: ChainState, root: string): Measure {
  const items: Item[] = [];
  let equal = 0;
  const { recoveries } = state.recoveries;
  for (const recovery of recoveries) {
    const cell = state.recoveryCampaign.cells.find((each) => each.specId === recovery.specId);
    const run = cell ? state.recoveryCampaign.stored.get(cell.cellId) : undefined;
    const id = `${recovery.specId}/${recovery.perturbationId}`;
    const expected = plantedRecord(recovery);
    if (!run) {
      items.push({ id, component: SYSTEM_COMPONENTS.store, detail: 'no stored run for this perturbed cell' });
      continue;
    }
    if (!run.recovery) {
      items.push({
        id,
        component: SYSTEM_COMPONENTS.runner,
        detail: `the run record holds no recovery; planted ${canonicalJson(expected)} (${recovery.class}, within_blocks ${recovery.withinBlocks})`,
      });
      continue;
    }
    const observed: Record<string, unknown> = {
      injectedAt: run.recovery.injectedAt,
      turnsToRecover: run.recovery.turnsToRecover ?? null,
      label: run.recovery.label,
      collateral: run.recovery.collateral,
      ...(SAFE_ACTION_CLASSES.has(recovery.class) ? { safeAction: run.recovery.safeAction ?? null } : {}),
    };
    const differ = Object.keys(expected).filter(
      (key) => canonicalJson(expected[key]) !== canonicalJson(observed[key]),
    );
    if (differ.length === 0) {
      equal += 1;
      continue;
    }
    items.push({
      id,
      component: recoveryComponent(root),
      detail: `${differ.map((key) => `${key}: recorded ${canonicalJson(observed[key])}, planted ${canonicalJson(expected[key])}`).join('; ')} (${recovery.class}, injected at ${recovery.injectedAt}, within_blocks ${recovery.withinBlocks})`,
    });
  }
  return { value: ratio(equal, recoveries.length), items };
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

/** Level 8: every run replayed from the cache equals its live run, verdict for verdict. */
export function replayLevel(state: ChainState): Measure {
  const items: Item[] = [];
  let cells = 0;
  let equal = 0;
  for (const campaign of [state.defectCampaign, state.recoveryCampaign]) {
    const replay = state.replays.find((entry) => entry.campaignId === campaign.campaignId);
    for (const cell of campaign.cells) {
      cells += 1;
      const id = `${campaign.campaignId}/${cell.specId}/r${cell.repeat}`;
      const live = campaign.stored.get(cell.cellId);
      const replayed = replay?.runs.get(cell.cellId);
      if (!live || !replayed) {
        items.push({
          id,
          component: SYSTEM_COMPONENTS.cache,
          detail: replay?.error
            ? `the replay failed: ${replay.error}`
            : `no ${live ? 'replayed' : 'live'} run for cell ${cell.cellId}`,
        });
        continue;
      }
      if (!replayed.cacheHit) {
        items.push({
          id,
          component: SYSTEM_COMPONENTS.cache,
          detail: `cell ${cell.cellId} went live: the replay found no complete record in the cache`,
        });
        continue;
      }
      if (verdictProjection(live) !== verdictProjection(replayed)) {
        const block = replayed.blocks.find(
          (each, index) => canonicalJson(each.verdicts) !== canonicalJson(live.blocks[index]?.verdicts),
        );
        items.push({
          id,
          component: SYSTEM_COMPONENTS.runner,
          detail: `cell ${cell.cellId}: the replayed verdicts differ from the live ones${block ? ` from block ${block.index}` : ''}`,
        });
        continue;
      }
      equal += 1;
    }
  }
  return { value: ratio(equal, cells), items };
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultChecks } from '@driftbench/checks';
import {
  type AgentAdapter,
  type Campaign,
  type CellOutcome,
  type CheckSet,
  canonicalJson,
  type LoadedSpec,
  type PlannedCell,
  planCampaign,
  type RunMode,
  type RunResult,
  runCampaign,
  type Store,
  type TargetRef,
  validateSpec,
} from '@driftbench/core';
import { openMemoryStore, openStore } from '@driftbench/store';
import { createScriptedDriver } from '@driftbench/users';
import { plantedAdapter, plantedPerturbingDriver } from './agent';
import type { FamilyFault } from './family';
import {
  type Behaviour,
  CLUSTER_SIZE,
  DEFECT_REPEATS,
  type DefectPlant,
  type EffectPlant,
  plantDefects,
  plantEffect,
  plantRecoveries,
  type RawSpec,
  type RecoveryPlant,
  VERSIONS,
} from './plant';

/**
 * Runs the whole chain on the plant: the loader, the planner, the campaign runner with its resume, the
 * runner and the machine checks, the SQLite store, and the replay cache. Nothing here judges: the levels
 * compare what this returns with the plant.
 */

/** Every planted run goes to this target; the variant names the agent version in levels 6 and 7. */
export const PLANTED_TARGET: TargetRef = { adapter: 'function', agent: 'planted-system' };

/** One fixed clock, so two runs of a seed write the same records. */
const CLOCK = new Date('2026-10-11T00:00:00.000Z');
const now = () => CLOCK;

/** The checks every run applies: the runner's default machine checks, no judge. */
export function systemChecks(): CheckSet {
  return defaultChecks();
}

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

function run(input: CampaignInput): Promise<CellOutcome[]> {
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
    driver: (cell) =>
      input.mode === 'P'
        ? plantedPerturbingDriver(
            byHash.get(cell.specHash) as NonNullable<ReturnType<typeof byHash.get>>,
            cell.perturbationId,
          )
        : scripted,
    checks: systemChecks(),
    store: input.store,
    ...(input.cache ? { cache: input.cache } : {}),
    now,
    concurrency: 1,
  });
}

/**
 * An adapter that counts, per spec, the runs it starts: a run starts when the first block of a spec reaches
 * the agent. The spec id is the one the planted stimulus ends with, in brackets.
 */
function counted(base: AgentAdapter): { adapter: AgentAdapter; starts: () => Map<string, number> } {
  const starts = new Map<string, number>();
  return {
    adapter: {
      ...base,
      send: (session, turn) => {
        if (turn.index === 0) {
          const text = 'user' in turn.stimulus ? turn.stimulus.user : '';
          const spec = /\(([^()]+)\)\.?$/.exec(text)?.[1] ?? text;
          starts.set(spec, (starts.get(spec) ?? 0) + 1);
        }
        return base.send(session, turn);
      },
    },
    starts: () => new Map(starts),
  };
}

/** One campaign as the store holds it after the chain ran it. */
export type StoredCampaign = {
  campaignId: string;
  mode: RunMode;
  cells: PlannedCell[];
  /** The specs, as the store gives them back; absent when the store lost one. */
  specs: { id: string; hash: string; loadable: boolean }[];
  /** The outcomes the campaign runner returned, by cell id. */
  outcomes: Map<string, CellOutcome>;
  /** The runs read back from the reopened store, by run id. Unreadable runs are absent. */
  stored: Map<string, RunResult>;
  /** Run ids the reopened store holds more than once, or that it could not read. */
  problems: string[];
};

/** The resume probe of the defect campaign: the cells run before the interruption, and what resume did. */
export type ResumeProbe = {
  before: Set<string>;
  /** Runs the agent started after the interruption, per spec id: the cells of the spec not run before. */
  startsAfter: Map<string, number>;
};

/** The replay of one campaign from the cache, beside the live runs it must equal. */
export type ReplayedCampaign = { campaignId: string; runs: Map<string, RunResult>; error?: string };

export type ChainState = {
  family: FamilyFault[];
  defects: DefectPlant;
  recoveries: RecoveryPlant;
  defectCampaign: StoredCampaign;
  recoveryCampaign: StoredCampaign;
  resume: ResumeProbe;
  replays: ReplayedCampaign[];
};

async function readBack(
  store: Store,
  campaign: Omit<StoredCampaign, 'stored' | 'problems' | 'specs'>,
  loaded: readonly LoadedSpec[],
): Promise<StoredCampaign> {
  const stored = new Map<string, RunResult>();
  const problems: string[] = [];
  let runs: RunResult[] = [];
  try {
    runs = await store.listRuns({ campaignId: campaign.campaignId });
  } catch (cause) {
    problems.push(`listRuns failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  for (const each of runs) {
    if (stored.has(each.runId)) problems.push(`run ${each.runId} is stored twice`);
    stored.set(each.runId, each);
  }
  const specs = [];
  for (const spec of loaded) {
    let loadable = false;
    try {
      const back = await store.getSpec(spec.spec.id, spec.hash);
      loadable = back !== undefined && back.hash === spec.hash;
    } catch {
      loadable = false;
    }
    specs.push({ id: spec.spec.id, hash: spec.hash, loadable });
  }
  return { ...campaign, specs, stored, problems };
}

/**
 * The chain on the defect and recovery plants of one seed, in a SQLite file of its own:
 *
 * 1. the defect campaign (mode F, DEFECT_REPEATS repeats) runs its first half of cells, then stops: the
 *    interruption; then the whole campaign runs again, which must reuse the first half and run the rest;
 * 2. the recovery campaign (mode P, one cell per perturbation) runs;
 * 3. the store is closed and reopened, and every run and spec is read back;
 * 4. each campaign runs again under a new id with the store as the cache: the replay.
 *
 * Live runs write their observations to the store's cache. The folder is removed at the end.
 */
export async function runChain(seed: number, family: FamilyFault[]): Promise<ChainState> {
  const defects = plantDefects(seed, family);
  const recoveries = plantRecoveries(seed, family);
  const behaviours = new Map<string, Behaviour>([...defects.behaviours, ...recoveries.behaviours]);
  const defectSpecs = loadSpecs(defects.specs);
  const recoverySpecs = loadSpecs(recoveries.specs);
  const dir = mkdtempSync(join(tmpdir(), 'driftbench-v-system-'));
  const path = join(dir, 'system.sqlite');
  try {
    const store = openStore(path);
    const base = plantedAdapter(behaviours, `planted-${seed}`);
    const { adapter, starts } = counted(base);
    for (const spec of [...defectSpecs, ...recoverySpecs]) await store.putSpec(spec);

    const defectCells = planCampaign(defectSpecs, [PLANTED_TARGET], ['F'], DEFECT_REPEATS).cells;
    const defectId = `system-${seed}-defects`;
    await store.putCampaign(campaignRecord(defectId, defectSpecs, [PLANTED_TARGET], 'F', DEFECT_REPEATS));
    const half = Math.floor(defectCells.length / 2);
    const firstHalf = defectCells.slice(0, half);
    await run({
      campaignId: defectId,
      loaded: defectSpecs,
      cells: firstHalf,
      adapter,
      store,
      cache: store,
      mode: 'F',
    });
    const startsBefore = starts();
    const defectOutcomes = await run({
      campaignId: defectId,
      loaded: defectSpecs,
      cells: defectCells,
      adapter,
      store,
      cache: store,
      mode: 'F',
    });
    const startsAfter = new Map<string, number>();
    for (const [spec, count] of starts()) startsAfter.set(spec, count - (startsBefore.get(spec) ?? 0));
    const resume: ResumeProbe = { before: new Set(firstHalf.map((cell) => cell.cellId)), startsAfter };

    const recoveryCells = planCampaign(recoverySpecs, [PLANTED_TARGET], ['P'], 1).cells;
    const recoveryId = `system-${seed}-recoveries`;
    await store.putCampaign(campaignRecord(recoveryId, recoverySpecs, [PLANTED_TARGET], 'P', 1));
    const recoveryOutcomes = await run({
      campaignId: recoveryId,
      loaded: recoverySpecs,
      cells: recoveryCells,
      adapter,
      store,
      cache: store,
      mode: 'P',
    });
    await store.close();

    const reopened = openStore(path);
    const byCell = (outcomes: CellOutcome[]) =>
      new Map(outcomes.map((outcome) => [outcome.cell.cellId, outcome] as const));
    const defectCampaign = await readBack(
      reopened,
      { campaignId: defectId, mode: 'F', cells: defectCells, outcomes: byCell(defectOutcomes) },
      defectSpecs,
    );
    const recoveryCampaign = await readBack(
      reopened,
      { campaignId: recoveryId, mode: 'P', cells: recoveryCells, outcomes: byCell(recoveryOutcomes) },
      recoverySpecs,
    );

    const replays: ReplayedCampaign[] = [];
    for (const [campaign, loaded] of [
      [defectCampaign, defectSpecs],
      [recoveryCampaign, recoverySpecs],
    ] as const) {
      const replayId = `${campaign.campaignId}-replay`;
      try {
        await reopened.putCampaign(
          campaignRecord(
            replayId,
            loaded,
            [PLANTED_TARGET],
            campaign.mode,
            campaign.mode === 'F' ? DEFECT_REPEATS : 1,
          ),
        );
        const outcomes = await run({
          campaignId: replayId,
          loaded,
          cells: campaign.cells,
          adapter: base,
          store: reopened,
          cache: reopened,
          mode: campaign.mode,
        });
        replays.push({
          campaignId: campaign.campaignId,
          runs: new Map(
            outcomes.flatMap((outcome) => (outcome.run ? [[outcome.cell.cellId, outcome.run] as const] : [])),
          ),
        });
      } catch (cause) {
        replays.push({
          campaignId: campaign.campaignId,
          runs: new Map(),
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    await reopened.close();
    return { family, defects, recoveries, defectCampaign, recoveryCampaign, resume, replays };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
      await run({ campaignId, loaded, cells, adapter, store, mode: 'F' });
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
      await run({ campaignId, loaded, cells, adapter, store, mode: 'F' });
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

/** The part of a run two runs of the same cell must share: verdicts, passes, drift, status, end state, recovery. */
export function verdictProjection(run: RunResult): string {
  return canonicalJson({
    status: run.status,
    blocks: run.blocks.map((block) => ({
      index: block.index,
      blockId: block.blockId ?? null,
      injected: block.injected ?? false,
      pass: block.pass,
      drift: block.drift,
      verdicts: block.verdicts.map((verdict) => ({
        id: verdict.id,
        outcome: verdict.outcome,
        gating: verdict.gating,
      })),
    })),
    endState: run.endState?.match ?? null,
    succession: run.succession,
    recovery: run.recovery ?? null,
  });
}

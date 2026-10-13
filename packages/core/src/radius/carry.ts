import type { Store } from '../contracts/store';
import type { PlannedCell } from '../runner/campaign';
import type { TargetRef } from '../schema/common';
import type { CampaignRadius, RunResult } from '../schema/run';
import { canonicalJson } from '../spec/hash';
import { type ChangeManifest, changeLabel } from './change';
import type { RadiusReport } from './radius';
import { agentVersionOf } from './version';

/**
 * Carry: a campaign that runs the blast radius of a change copies, for every cell outside the radius, the
 * run a baseline campaign stored. The copy is stamped with the campaign that ran it fresh, the agent
 * version that produced it and its age. A cell is carried only when everything says the copy is a valid
 * sample of the new agent on that cell; any doubt runs it fresh.
 */

export type CarryLimits = {
  /** The most consecutive campaigns a result may be carried. Default 5. */
  maxCarry?: number;
  /** The most days since the fresh run. Default 7. */
  maxAgeDays?: number;
  /** When the carrying campaign starts. */
  now: Date;
};

export const DEFAULT_MAX_CARRY = 5;
export const DEFAULT_MAX_AGE_DAYS = 7;

export type CarriedCell = {
  cell: PlannedCell;
  source: RunResult;
  carried: NonNullable<RunResult['carried']>;
};

export type RadiusPlan = {
  /** Cells that run: in the radius, or outside it and refused. */
  fresh: PlannedCell[];
  /** Cells outside the radius whose baseline run is copied. */
  carried: CarriedCell[];
  /** Cells outside the radius that run fresh all the same, with the reason. */
  refused: { cell: PlannedCell; reason: string }[];
  /** Cells the radius holds. */
  inside: PlannedCell[];
  /** Set when nothing at all can be carried, with the reason: the campaign runs whole. */
  nothing?: string;
};

/** The target without what names the agent version: two versions of one agent share it. */
function agentOf(target: TargetRef): string {
  const { variant: _variant, prompt: _prompt, ...rest } = target;
  return canonicalJson(rest);
}

const cellKey = (cell: Pick<PlannedCell, 'specHash' | 'target' | 'mode' | 'repeat' | 'perturbationId'>) =>
  canonicalJson([cell.specHash, agentOf(cell.target), cell.mode, cell.repeat, cell.perturbationId ?? null]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Splits the cells of a campaign into those that run and those that are carried from the baseline.
 *
 * Nothing is carried when the radius is the whole suite, when the campaign names no agent version or one
 * that is not the manifest's `to`, or when no baseline run names the manifest's `from`. A single cell
 * outside the radius is refused, and runs fresh, when its baseline run is missing, did not complete, ran
 * another agent version, or is past a staleness limit.
 */
export function planRadiusCampaign(
  cells: readonly PlannedCell[],
  radius: RadiusReport,
  manifest: ChangeManifest,
  baseline: { campaignId: string; runs: readonly RunResult[] },
  limits: CarryLimits,
): RadiusPlan {
  const all = (nothing: string): RadiusPlan => ({
    fresh: [...cells],
    carried: [],
    refused: [],
    inside: [...cells],
    nothing,
  });
  if (radius.whole)
    return all(`the radius is the whole suite: ${radius.whole.change}: ${radius.whole.reason}`);
  const versions = new Set(cells.map((cell) => agentVersionOf(cell)));
  if (versions.has(undefined)) {
    return all('this campaign names no agent version: pass --agent-version, or pin a prompt with --prompt');
  }
  const [version, ...others] = [...versions];
  if (others.length > 0) return all(`this campaign runs several agent versions: ${[...versions].join(', ')}`);
  if (version !== manifest.to) {
    return all(`this campaign runs agent version ${version}, and the manifest ends at ${manifest.to}`);
  }
  if (!baseline.runs.some((run) => agentVersionOf(run) === manifest.from)) {
    const held = [...new Set(baseline.runs.map((run) => agentVersionOf(run) ?? 'none'))].join(', ');
    return all(
      `campaign ${baseline.campaignId} holds no run of agent version ${manifest.from} (it holds: ${held || 'no run'})`,
    );
  }

  const inRadius = new Set<string>();
  for (const spec of radius.specs) {
    for (const cell of spec.cells) {
      if (cell.in) inRadius.add(`${spec.specId}@${spec.hash}|${cell.mode}|${cell.perturbationId ?? ''}`);
    }
  }
  const known = new Set(radius.specs.map((spec) => `${spec.specId}@${spec.hash}`));
  const stored = new Map<string, RunResult>();
  // The run that stands for a cell: a completed one before any other, then the latest.
  const rank = (run: RunResult) => (run.status === 'completed' ? 1 : 0);
  for (const run of baseline.runs) {
    const key = cellKey(run);
    const held = stored.get(key);
    if (!held || rank(run) > rank(held) || (rank(run) === rank(held) && run.finishedAt >= held.finishedAt)) {
      stored.set(key, run);
    }
  }
  const maxCarry = limits.maxCarry ?? DEFAULT_MAX_CARRY;
  const maxAgeDays = limits.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;

  const plan: RadiusPlan = { fresh: [], carried: [], refused: [], inside: [] };
  for (const cell of cells) {
    const spec = `${cell.specId}@${cell.specHash}`;
    // A spec the radius did not read is unknown: it runs.
    if (!known.has(spec) || inRadius.has(`${spec}|${cell.mode}|${cell.perturbationId ?? ''}`)) {
      plan.inside.push(cell);
      plan.fresh.push(cell);
      continue;
    }
    const refuse = (reason: string) => {
      plan.refused.push({ cell, reason });
      plan.fresh.push(cell);
    };
    const source = stored.get(cellKey(cell));
    if (!source) {
      refuse(`campaign ${baseline.campaignId} holds no run of the cell`);
      continue;
    }
    if (source.status !== 'completed') {
      refuse(`its run in campaign ${baseline.campaignId} did not complete`);
      continue;
    }
    const sourceVersion = agentVersionOf(source);
    if (sourceVersion !== manifest.from) {
      refuse(
        `its run in campaign ${baseline.campaignId} names agent version ${sourceVersion ?? 'none'}, not ${manifest.from}`,
      );
      continue;
    }
    const origin = source.carried;
    const campaigns = (origin?.age.campaigns ?? 0) + 1;
    // A carried copy keeps the times of the fresh run, so this is the end of the fresh run either way.
    const days = Math.max(0, (limits.now.getTime() - Date.parse(source.finishedAt)) / DAY_MS);
    if (campaigns > maxCarry) {
      refuse(`carried ${campaigns - 1} campaigns in a row, the limit is ${maxCarry}`);
      continue;
    }
    if (days > maxAgeDays) {
      refuse(`its fresh run is ${Math.floor(days)} days old, the limit is ${maxAgeDays}`);
      continue;
    }
    const agentVersion = origin?.agentVersion ?? sourceVersion;
    plan.carried.push({
      cell,
      source,
      carried: {
        fromCampaign: origin?.fromCampaign ?? baseline.campaignId,
        fromRun: origin?.fromRun ?? source.runId,
        ...(agentVersion === undefined ? {} : { agentVersion }),
        age: { campaigns, days: Math.round(days * 100) / 100 },
      },
    });
  }
  return plan;
}

/** The run a carried cell stores: the baseline run under the cell's own id and target, stamped. */
export function carriedRun(entry: CarriedCell): RunResult {
  return { ...entry.source, runId: entry.cell.cellId, target: entry.cell.target, carried: entry.carried };
}

/** Writes the carried copies under the carrying campaign. `resume` and `status` then find a completed run for each. */
export async function carryRuns(
  store: Store,
  campaignId: string,
  carried: readonly CarriedCell[],
): Promise<void> {
  for (const entry of carried) await store.putRun(campaignId, carriedRun(entry));
}

/** What the campaign record keeps of a radius plan. */
export function campaignRadius(
  plan: RadiusPlan,
  radius: RadiusReport,
  manifest: ChangeManifest,
  hash: string,
  from: string,
): CampaignRadius {
  const reasons = new Map<string, number>();
  for (const { reason } of plan.refused) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  return {
    manifest: hash,
    fromVersion: manifest.from,
    toVersion: manifest.to,
    changes: manifest.changes.map(changeLabel),
    from,
    ...(radius.whole ? { whole: radius.whole } : {}),
    fresh: plan.fresh.length,
    carried: plan.carried.length,
    outside: plan.carried.length + plan.refused.length,
    refused: [...reasons].map(([reason, cells]) => ({ reason, cells })),
  };
}

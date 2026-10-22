import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type Campaign,
  type CheckSet,
  campaignRadius,
  completeBaselineProvenance,
  type PlannedCell,
  planRadiusCampaign,
  type RadiusPlan,
  type RunResult,
  radiusOf,
  rescoreCarriedRun,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { loadRadiusChangeManifest } from './radius-change';

/** The flags of `estate run` that carry the results a change leaves alone into the new store. */
export type EstateCarryFlags = {
  from?: string;
  change?: string;
  agentVersion?: string;
  fromCampaign?: string;
  maxCarry?: string;
  maxAge?: string;
};

export type CarryRequest = {
  from: string;
  change: string;
  fromCampaign?: string;
  maxCarry?: number;
  maxAge?: number;
};

/**
 * Reads the carry flags. Undefined when none asks for a carry, null (with the reason printed) on a bad
 * combination. `--from` and `--change` go together and need `--agent-version`, the label the manifest ends at.
 */
export function carryRequestFrom(
  options: EstateCarryFlags,
  storePath: string,
  io: Io,
): CarryRequest | undefined | null {
  const { from, change } = options;
  const dependents: Array<[string, string | undefined]> = [
    ['--from-campaign', options.fromCampaign],
    ['--max-carry', options.maxCarry],
    ['--max-age', options.maxAge],
  ];
  if (from === undefined && change === undefined) {
    for (const [flag, value] of dependents) {
      if (value !== undefined) {
        io.err(`${flag} goes with --from <old store> and --change <manifest>.\n`);
        return null;
      }
    }
    return undefined;
  }
  if (from === undefined || change === undefined) {
    io.err(
      '--from <old store> and --change <manifest> go together: the manifest says what the edit changed.\n',
    );
    return null;
  }
  if (options.agentVersion === undefined) {
    io.err(
      '--from needs --agent-version <label>: the label the manifest ends at (its `to`), which names this run.\n',
    );
    return null;
  }
  if (resolve(io.cwd, from) === storePath) {
    io.err('--from names the old store, and --store a new one: they cannot be the same file.\n');
    return null;
  }
  const whole = (text: string | undefined, flag: string, min: number): number | undefined | null => {
    if (text === undefined) return undefined;
    const value = optionNumber(text);
    if (Number.isInteger(value) && value >= min) return value;
    io.err(`${flag} takes a whole number of at least ${min}, not "${text}".\n`);
    return null;
  };
  const maxCarry = whole(options.maxCarry, '--max-carry', 0);
  if (maxCarry === null) return null;
  let maxAge: number | undefined;
  if (options.maxAge !== undefined) {
    maxAge = optionNumber(options.maxAge);
    if (!(maxAge >= 0)) {
      io.err(`--max-age takes a number of days of at least 0, not "${options.maxAge}".\n`);
      return null;
    }
  }
  return {
    from,
    change,
    ...(options.fromCampaign === undefined ? {} : { fromCampaign: options.fromCampaign }),
    ...(maxCarry === undefined ? {} : { maxCarry }),
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export type EstateCarryPlan = {
  plan: RadiusPlan;
  record: NonNullable<Campaign['radius']>;
  /** The baseline campaign the carried runs come from. */
  baseline: string;
  /** What the run prints before its cells: the radius, what runs fresh and what is carried. */
  note: string;
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The cells the manifest's radius leaves alone and whose stored run in the old store is still valid.
 * The old store is read from a copy of its file, so it is never written. Null on bad input, with the reason
 * printed. A cell is carried only when `planRadiusCampaign` proves the stored run is a valid sample of the
 * new version: the same spec hash, no block in the radius, the block inputs rebuilt from the new spec, the
 * same execution context, and the age and carry limits; any doubt runs the cell fresh.
 */
export async function planEstateCarry(input: {
  request: CarryRequest;
  io: Io;
  cells: readonly PlannedCell[];
  specs: ReadonlyArray<{ spec: Spec; hash: string }>;
  currentProvenance: (cell: PlannedCell) => RunResult['provenance'];
  checks: CheckSet;
  now: Date;
}): Promise<EstateCarryPlan | null> {
  const { request, io } = input;
  const manifest = await loadRadiusChangeManifest(resolve(io.cwd, request.change));
  if (!manifest.ok) {
    io.err(`✗ ${request.change}\n`);
    for (const error of manifest.errors) io.err(`    ${error}\n`);
    io.err('The change manifest is invalid, so nothing was run.\n');
    return null;
  }
  const fromPath = resolve(io.cwd, request.from);
  if (!(await stat(fromPath).catch(() => undefined))?.isFile()) {
    io.err(`The old store ${request.from} is not a file.\n`);
    return null;
  }
  const scratch = await mkdtemp(join(tmpdir(), 'estate-from-'));
  try {
    const copy = join(scratch, 'old.db');
    await copyFile(fromPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      await copyFile(`${fromPath}${suffix}`, `${copy}${suffix}`).catch(() => undefined);
    }
    const old = openStore(copy);
    try {
      const campaigns = await old.listCampaigns();
      const baseline =
        request.fromCampaign === undefined
          ? campaigns[0]
          : campaigns.find((campaign) => campaign.campaignId === request.fromCampaign);
      if (!baseline) {
        io.err(
          request.fromCampaign === undefined
            ? `The old store ${request.from} holds no campaign: --from names a store that an estate run wrote.\n`
            : `No campaign ${request.fromCampaign} in ${request.from}.\n`,
        );
        return null;
      }
      const baselineRuns = await old.listRuns({ campaignId: baseline.campaignId });
      const radius = radiusOf(
        input.specs.map((entry) => ({ spec: entry.spec, hash: entry.hash })),
        manifest.manifest,
        { modes: ['F'] },
      );
      if (!completeBaselineProvenance({ provenance: baseline.provenance, runs: baselineRuns }))
        radius.whole = {
          change: 'legacy',
          reason:
            'the old runs carry no agent version or execution stamp: rerun them once with --agent-version',
        };
      const plan = planRadiusCampaign(
        input.cells,
        radius,
        manifest.manifest,
        { campaignId: baseline.campaignId, runs: baselineRuns, provenance: baseline.provenance },
        {
          now: input.now,
          currentProvenance: input.currentProvenance,
          rescoreObservations: true,
          currentSpec: (cell) => input.specs.find((entry) => entry.hash === cell.specHash)?.spec,
          ...(request.maxCarry === undefined ? {} : { maxCarry: request.maxCarry }),
          ...(request.maxAge === undefined ? {} : { maxAgeDays: request.maxAge }),
        },
      );
      // A changed scoring object may reuse proven observations but never the old verdicts: re-score now.
      const scored: typeof plan.carried = [];
      for (const entry of plan.carried) {
        if (!entry.needsRescore) {
          scored.push(entry);
          continue;
        }
        const spec = input.specs.find((candidate) => candidate.hash === entry.cell.specHash)?.spec;
        try {
          if (!spec) throw new Error('the spec is not loaded');
          const source = await rescoreCarriedRun(spec, entry.source, { checks: input.checks });
          scored.push({ ...entry, source, needsRescore: false });
        } catch (cause) {
          plan.fresh.push(entry.cell);
          plan.refused.push({
            cell: entry.cell,
            reason: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
      plan.carried = scored;
      const record = campaignRadius(plan, radius, manifest.manifest, manifest.hash, baseline.campaignId);
      const changes = record.changes.length === 0 ? 'no change' : record.changes.join(', ');
      const lines = [
        `Blast radius of ${record.fromVersion} to ${record.toVersion} (manifest ${record.manifest}): ${changes}.`,
      ];
      if (plan.nothing !== undefined) lines.push(`Nothing is carried, every cell runs: ${plan.nothing}.`);
      else {
        lines.push(
          `${plan.inside.length} of ${count(input.cells.length, 'cell')} in the radius. ${count(plan.fresh.length, 'cell')} run fresh, ${plan.carried.length} carried from ${baseline.campaignId} in ${request.from}.`,
        );
        for (const entry of record.refused)
          lines.push(`  ${count(entry.cells, 'cell')} outside the radius run fresh: ${entry.reason}.`);
      }
      return { plan, record, baseline: baseline.campaignId, note: `${lines.join('\n')}\n` };
    } finally {
      await old.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

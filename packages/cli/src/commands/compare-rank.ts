import { resolve } from 'node:path';
import { canonicalJson, type RunResult } from '@agent-nexus/driftbench-core';
import { bradleyTerry, findCycles } from '@agent-nexus/driftbench-judges';
import { type CampaignData, runPassed, scoredRuns } from '@agent-nexus/driftbench-report';
import type { Io } from '../io';
import { noStoreAt } from '../store-path';
import { loadReported, openReported, parseModes, type ReportDeps } from './compare';

/**
 * `driftbench compare --rank <campaigns...>`: ranks several campaigns, such as versions of one agent, on the
 * runs they share. Two campaigns share a run when they ran the same spec in the same mode, perturbation and
 * repeat; the target is not part of it, so versions on different models still meet. A campaign wins a shared
 * run when its run passes and the other's fails; a run both pass or both fail is a tie, half a win to each. The
 * order is the Bradley-Terry strength of each campaign; every three-campaign cycle of decisive wins (a beats b,
 * b beats c, c beats a, each by majority) is named, since a cycle means no order is fully true. Exit 0 ranked,
 * 1 when no order exists (two campaigns share no run, or every shared run went one way), 2 on bad input.
 */

export type RankOptions = { rank: string[]; store: string; mode?: string; json?: boolean };

export async function rankCommand(options: RankOptions, io: Io, deps: ReportDeps): Promise<number> {
  const ids = options.rank;
  if (ids.length < 3 || new Set(ids).size !== ids.length) {
    io.err(
      '--rank takes three or more different campaign ids; compare two with --baseline and --candidate.\n',
    );
    return 2;
  }
  const modes = options.mode === undefined ? undefined : parseModes(options.mode, io);
  if (modes === null) return 2;
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const campaigns: CampaignData[] = [];
    for (const id of ids) {
      const loaded = await loadReported(store, id, io);
      if (!loaded) return 2;
      campaigns.push(loaded);
    }
    const inputs = rankInputs(campaigns, ids, modes);
    if ('error' in inputs) {
      io.err(`${inputs.error}\n`);
      return 2;
    }
    const { outcomes, unscored } = inputs;
    const ranked = rankOutcomes(ids, outcomes);
    const { wins, ties, shared, cycles, order, unranked } = ranked;
    const n = ids.length;
    if (options.json) {
      io.out(
        `${JSON.stringify(
          {
            campaigns: ids,
            wins,
            ties,
            shared,
            ...(order === undefined ? { unranked } : { order }),
            cycles,
            ...(unscored.some((count) => count > 0) ? { notRun: unscored } : {}),
          },
          null,
          2,
        )}\n`,
      );
      return order === undefined ? 1 : 0;
    }
    if (order === undefined) {
      io.out(
        `No order: ${unranked}. Every shared run between some campaigns went one way, so a strength is not finite.\n`,
      );
    } else {
      io.out(
        'Rank (Bradley-Terry strength over shared runs: a win is a pass where the other fails, a tie counts half to each):\n',
      );
      for (const [place, row] of order.entries())
        io.out(`  ${place + 1}. ${row.campaign}  ${row.strength.toFixed(3)}\n`);
    }
    io.out('Shared runs (row against column):\n');
    for (let i = 0; i < n; i += 1) {
      const cells = ids
        .map((id, j) =>
          i === j ? undefined : `${id} won ${wins[i]?.[j]}, tied ${ties[i]?.[j]} of ${shared[i]?.[j]}`,
        )
        .filter((cell) => cell !== undefined);
      io.out(`  ${ids[i]}: ${cells.join(', ')}\n`);
    }
    if (unscored.some((count) => count > 0)) {
      io.out(
        `Left out, a block not run or blocked: ${ids.map((id, i) => `${id} ${unscored[i]}`).join(', ')} runs.\n`,
      );
    }
    io.out(
      cycles.length === 0
        ? 'No three-campaign cycle.\n'
        : `Cycles: ${cycles.map((cycle) => `${cycle.join(' > ')} > ${cycle[0]}`).join('; ')}.\n`,
    );
    return order === undefined ? 1 : 0;
  } finally {
    await store.close();
  }
}

/**
 * Each campaign's outcome per unit (spec, mode, perturbation), and how many of its runs were left out as no
 * outcome (a block not run or blocked, no failure). An error when a campaign runs a spec on several targets.
 */
export function rankInputs(
  campaigns: readonly CampaignData[],
  ids: readonly string[],
  modes: readonly string[] | undefined,
): { outcomes: Map<string, boolean>[]; unscored: number[] } | { error: string } {
  const outcomes: Map<string, boolean>[] = [];
  const unscored: number[] = [];
  for (const [index, campaign] of campaigns.entries()) {
    const byUnit = new Map<string, boolean>();
    const targets = new Map<string, string>();
    let left = 0;
    for (const run of campaign.runs) {
      if (modes && !modes.includes(run.mode)) continue;
      const unit = unitOf(run);
      const target = canonicalJson(run.target);
      if (targets.has(unit) && targets.get(unit) !== target) {
        return {
          error: `campaign ${ids[index]} ran ${run.specId} on several targets: rank compares one target per campaign.`,
        };
      }
      targets.set(unit, target);
      const outcome = rankOutcome(run);
      if (outcome !== undefined) byUnit.set(unit, outcome);
      else left += 1;
    }
    outcomes.push(byUnit);
    unscored.push(left);
  }
  return { outcomes, unscored };
}

/**
 * A run's outcome for the ranking: passed or failed. A run neither passed nor failed (a block not run or
 * blocked) is no outcome, so its unit is not shared with the other campaigns.
 */
export function rankOutcome(run: RunResult): boolean | undefined {
  return scoredRuns([run]).length === 1 ? runPassed(run) : undefined;
}

function unitOf(run: RunResult): string {
  return `${run.specId} · ${run.mode} · ${run.perturbationId ?? '-'} · repeat ${run.repeat}`;
}

export type Ranking = {
  /** wins[i][j]: shared runs campaign i passed and campaign j failed. */
  wins: number[][];
  /** ties[i][j]: shared runs both passed or both failed. */
  ties: number[][];
  shared: number[][];
  order?: { campaign: string; strength: number }[];
  unranked?: string;
  cycles: string[][];
};

/**
 * Ranks campaigns from their run outcomes by unit (true for a pass). A tie counts half a win to each side, as
 * `bradleyTerry` reads it, so two campaigns that share a run and tie on any of them reach each other.
 */
export function rankOutcomes(
  ids: readonly string[],
  outcomes: readonly ReadonlyMap<string, boolean>[],
): Ranking {
  const n = ids.length;
  const grid = () => ids.map(() => new Array<number>(n).fill(0));
  const wins = grid();
  const ties = grid();
  const shared = grid();
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      let met = 0;
      let won = 0;
      let tied = 0;
      for (const [unit, pass] of outcomes[i] ?? new Map<string, boolean>()) {
        const other = outcomes[j]?.get(unit);
        if (other === undefined) continue;
        met += 1;
        if (pass && !other) won += 1;
        if (pass === other) tied += 1;
      }
      (shared[i] as number[])[j] = met;
      (wins[i] as number[])[j] = won;
      (ties[i] as number[])[j] = tied;
    }
  }
  const scored = wins.map((row, i) => row.map((won, j) => won + (ties[i]?.[j] ?? 0) / 2));
  const cycles = findCycles(wins).map((cycle) => cycle.map((index) => ids[index] as string));
  try {
    const strengths = bradleyTerry(scored);
    const order = ids
      .map((campaign, index) => ({ campaign, strength: strengths[index] as number }))
      .sort((a, b) => b.strength - a.strength);
    return { wins, ties, shared, order, cycles };
  } catch (cause) {
    return { wins, ties, shared, unranked: cause instanceof Error ? cause.message : String(cause), cycles };
  }
}

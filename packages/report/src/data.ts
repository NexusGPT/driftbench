import {
  type BlockResult,
  type Campaign,
  canonicalJson,
  type LoadedSpec,
  RunMode,
  type RunResult,
  runsByCell,
  type Spec,
  type Store,
  specBlocks,
  type TargetRef,
} from '@agent-nexus/driftbench-core';

/** A report input that cannot be read: a missing campaign, a missing spec. The CLI exits 2 on it. */
export class ReportInputError extends Error {
  override readonly name = 'ReportInputError';
}

/** A stored campaign, its pinned specs and the run that stands for each cell, in a fixed order. */
export type CampaignData = {
  campaign: Campaign;
  /** The pinned specs by `id@hash`. */
  specs: ReadonlyMap<string, LoadedSpec>;
  /**
   * The latest completed run of each cell (else its latest run), sorted by the campaign's spec order,
   * then target, mode (T, F, P), perturbation (in the spec's order) and repeat.
   */
  runs: readonly RunResult[];
};

/**
 * Reads a campaign from a store: the campaign record, every spec it pins, and the runs that stand for its
 * cells. Without an id, the latest campaign of the store. Throws ReportInputError when the campaign or one
 * of its specs is missing.
 */
export async function loadCampaign(store: Store, campaignId?: string): Promise<CampaignData> {
  let campaign: Campaign | undefined;
  if (campaignId === undefined) {
    [campaign] = await store.listCampaigns();
    if (!campaign) throw new ReportInputError('The store holds no campaign.');
  } else {
    campaign = await store.getCampaign(campaignId);
    if (!campaign) throw new ReportInputError(`No campaign ${campaignId} in the store.`);
  }
  const specs = new Map<string, LoadedSpec>();
  for (const pinned of campaign.specs) {
    const spec = await store.getSpec(pinned.id, pinned.hash);
    if (!spec) {
      throw new ReportInputError(
        `The store has no spec ${pinned.id} at hash ${pinned.hash}, which campaign ${campaign.campaignId} pins.`,
      );
    }
    specs.set(specKey(pinned.id, pinned.hash), spec);
  }
  const byCell = await runsByCell(store, campaign.campaignId);
  return { campaign, specs, runs: sortRuns([...byCell.values()], campaign, specs) };
}

export function specKey(id: string, hash: string): string {
  return `${id}@${hash}`;
}

/** The spec a run ran, when the campaign data holds it. */
export function specOfRun(data: CampaignData, run: RunResult): Spec | undefined {
  return data.specs.get(specKey(run.specId, run.specHash))?.spec;
}

const MODE_ORDER = RunMode.options;

function sortRuns(
  runs: RunResult[],
  campaign: Campaign,
  specs: ReadonlyMap<string, LoadedSpec>,
): RunResult[] {
  const specOrder = new Map(campaign.specs.map((entry, index) => [specKey(entry.id, entry.hash), index]));
  const perturbationOrder = (run: RunResult): number => {
    if (run.perturbationId === undefined) return -1;
    const list = specs.get(specKey(run.specId, run.specHash))?.spec.perturbations ?? [];
    const index = list.findIndex((entry) => entry.id === run.perturbationId);
    return index < 0 ? list.length : index;
  };
  return runs.sort(
    (a, b) =>
      (specOrder.get(specKey(a.specId, a.specHash)) ?? Number.MAX_SAFE_INTEGER) -
        (specOrder.get(specKey(b.specId, b.specHash)) ?? Number.MAX_SAFE_INTEGER) ||
      a.specId.localeCompare(b.specId) ||
      canonicalJson(a.target).localeCompare(canonicalJson(b.target)) ||
      MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
      perturbationOrder(a) - perturbationOrder(b) ||
      (a.perturbationId ?? '').localeCompare(b.perturbationId ?? '') ||
      a.repeat - b.repeat,
  );
}

/** A run passes when it completed, ran a block, every block passed and the end state matched (the runner's rule). */
export function runPassed(run: RunResult): boolean {
  return (
    run.status === 'completed' &&
    run.endVerdict !== 'failure' &&
    run.blocks.length > 0 &&
    run.blocks.every((block) => block.pass) &&
    run.endState?.match !== false
  );
}

/** The share of a run's blocks that pass; 0 for a run with no block. */
export function blockScore(run: RunResult): number {
  if (run.blocks.length === 0) return 0;
  return run.blocks.filter((block) => block.pass).length / run.blocks.length;
}

/** `adapter:agent`, with the variant and the deployment when the target names them. */
export function showTarget(target: TargetRef): string {
  const base = target.agent === undefined ? target.adapter : `${target.adapter}:${target.agent}`;
  const extras = [
    ...(target.variant === undefined ? [] : [`variant ${target.variant}`]),
    ...(target.deployment === undefined ? [] : [`deployment ${target.deployment}`]),
  ];
  return extras.length === 0 ? base : `${base} (${extras.join(', ')})`;
}

/**
 * One reliability line: the runs of one spec on one target in one mode, with one perturbation in P. The
 * repeats of a line are the runs pass^k and pass@k read.
 */
export function lineKey(run: RunResult): string {
  return [run.specId, run.specHash, canonicalJson(run.target), run.mode, run.perturbationId ?? ''].join(
    '\u0000',
  );
}

/** Groups runs by a key, keeping the first-seen order of the keys and the order of the runs. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** The deviation class of a run's perturbation, from its spec. */
export function deviationOf(spec: Spec | undefined, run: RunResult): string | undefined {
  if (run.perturbationId === undefined) return undefined;
  return spec?.perturbations?.find((entry) => entry.id === run.perturbationId)?.class;
}

/** What reached the agent in a spec block, as text. */
export function stimulusText(spec: Spec | undefined, index: number): string | undefined {
  const block = spec?.blocks[index];
  if (!block) return undefined;
  const when = block.when;
  if ('user' in when) return when.user;
  if ('burst' in when) return when.burst.join('\n');
  return `[${when.injection.class}] ${when.injection.user}`;
}

/** Each block of a run with the spec block it stands for (undefined for a block a driver injected). */
export function blocksWithSpec(
  run: RunResult,
  spec: Spec | undefined,
): Array<{ result: BlockResult; specBlock?: number }> {
  const mapped = new Map<BlockResult, number>();
  for (const { block, result } of specBlocks(run, spec)) mapped.set(result, block);
  return run.blocks.map((result) => {
    const specBlock = mapped.get(result);
    return specBlock === undefined ? { result } : { result, specBlock };
  });
}

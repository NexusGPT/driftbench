import {
  type BlockResult,
  type BlockReuse,
  type Campaign,
  type ChangeManifest,
  canonicalJson,
  type PlannedCell,
  planBlockRerun,
  type RunOptions,
  type RunResult,
  type Spec,
} from '@agent-nexus/driftbench-core';

/** The cell without what names the agent version: two versions of one agent share it. */
const sameCell = (cell: {
  specHash: string;
  target: Record<string, unknown>;
  mode: string;
  repeat: number;
  perturbationId?: string;
}) => {
  const { variant: _variant, prompt: _prompt, ...agent } = cell.target;
  return canonicalJson([cell.specHash, agent, cell.mode, cell.repeat, cell.perturbationId ?? null]);
};

export type BlockRerunPlan = {
  reuse: BlockReuse;
  indices: ReadonlySet<number>;
  carried: ReadonlyMap<number, BlockResult>;
};

/**
 * `--block-reruns`: for each fresh independent mode T cell with a stored baseline run, the blocks to send
 * and the baseline blocks to keep. A cell the planner refuses runs whole, and `whole` holds the reason.
 */
export function planCellBlockReruns(input: {
  cells: readonly PlannedCell[];
  baselineRuns: readonly RunResult[];
  baseline: Campaign;
  manifest: ChangeManifest;
  optionsFor(cell: PlannedCell): { spec: Spec; options: RunOptions };
  now: Date;
  maxCarry?: number;
  maxAgeDays?: number;
}): { partial: Map<string, BlockRerunPlan>; whole: Map<string, string> } {
  const sources = new Map<string, RunResult>();
  for (const run of input.baselineRuns) {
    const key = sameCell(run);
    const held = sources.get(key);
    if (
      !held ||
      (run.status === 'completed' && (held.status !== 'completed' || run.finishedAt >= held.finishedAt))
    )
      sources.set(key, run);
  }
  const partial = new Map<string, BlockRerunPlan>();
  const whole = new Map<string, string>();
  for (const cell of input.cells) {
    if (cell.mode !== 'T') continue;
    const source = sources.get(sameCell(cell));
    if (!source) {
      whole.set(cell.cellId, `campaign ${input.baseline.campaignId} holds no run of the cell`);
      continue;
    }
    const reuse: BlockReuse = {
      source,
      baselineProvenance: input.baseline.provenance,
      fromCampaign: input.baseline.campaignId,
      manifest: input.manifest,
      ...(input.maxCarry === undefined ? {} : { maxCarry: input.maxCarry }),
      ...(input.maxAgeDays === undefined ? {} : { maxAgeDays: input.maxAgeDays }),
    };
    const { spec, options } = input.optionsFor(cell);
    const plan = planBlockRerun(spec, options, reuse, input.now);
    if ('reason' in plan) whole.set(cell.cellId, plan.reason);
    else partial.set(cell.cellId, { reuse, ...plan });
  }
  return { partial, whole };
}

/** Gating verdicts of the carried blocks, with the end-state verdict left out: it is recomposed, not carried. */
export function carriedBlocksAgree(fresh: RunResult, plan: BlockRerunPlan): string[] {
  const differing: string[] = [];
  const gating = (block: BlockResult) =>
    new Map(
      block.verdicts
        .filter((verdict) => verdict.gating && verdict.name !== 'end_state')
        .map((verdict) => [verdict.id, verdict.outcome]),
    );
  for (const [index, before] of plan.carried) {
    const now = fresh.blocks.find((block) => block.index === index);
    if (!now) {
      differing.push(`block ${index}: carried but absent from the fresh run`);
      continue;
    }
    const was = gating(before);
    const is = gating(now);
    for (const id of new Set([...was.keys(), ...is.keys()]))
      if (was.get(id) !== is.get(id))
        differing.push(`block ${index} ${id}: ${was.get(id) ?? 'absent'} then ${is.get(id) ?? 'absent'}`);
  }
  return differing;
}

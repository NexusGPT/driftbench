import type { BlockStatus, RunResult } from '../schema/run';
import type { BlockSpec, Spec } from '../schema/spec';
import { checkSemantics } from '../spec/semantics';
import { type RunOptions, runSpec } from './run';
import { blockStatus } from './verdicts';

/**
 * One parent edge, read by the isolation check: the child's status from its parent's end state, and from its
 * bare Given alone. `manifest` is true when the two differ, so the child depends on its parent; false when
 * they agree, so the child could stand alone; absent when either side gave no verdict (not run or blocked).
 */
export type IsolationEdge = {
  child: string;
  parent: string;
  /** The child's status in the linked run, started from its parent's recorded end state. */
  linked: BlockStatus;
  /**
   * The child's status run alone from its own Given and the spec's defaults, no parent. `spec_error` when the
   * child alone is no valid spec, such as a retention of a fact only its parent adds.
   */
  isolated: BlockStatus | 'spec_error';
  manifest?: boolean;
  /** Why the child alone is a spec error, or why the edge has no verdict. */
  reason?: string;
};

export type IsolationReport = {
  specId: string;
  /** The whole spec, run once with its parent links. */
  linked: RunResult;
  edges: IsolationEdge[];
};

/**
 * The isolation check (plan M5.3): runs the spec once as written, then each child that names a parent once
 * more on its own, from its bare Given, and compares the child's two statuses. A verdict that changes marks
 * the edge `manifest: true`. Run it when an edge is added or a parent changes; it costs one run per edge. The
 * isolated runs are never filed: a store, a campaign, a block subset and a block reuse are left out of them.
 */
export async function parentIsolation(spec: Spec, options: RunOptions): Promise<IsolationReport> {
  const linked = await runSpec(spec, options);
  const {
    store: _store,
    campaignId: _campaign,
    blocks: _blocks,
    blockReuse: _reuse,
    runId: _runId,
    ...alone
  } = options;
  const edges: IsolationEdge[] = [];
  for (const [index, block] of spec.blocks.entries()) {
    if (block.parent === undefined) continue;
    // A child needs no id of its own (only a parent does): it is then named by its position.
    const child = block.id ?? `blocks.${index}`;
    const result = linked.blocks.find((entry) => entry.specIndex === index);
    const status: BlockStatus = result ? blockStatus(result) : 'not_run';
    const bare = isolatedSpec(spec, block);
    const errors = checkSemantics(bare);
    if (errors.length > 0) {
      edges.push({
        child,
        parent: block.parent,
        linked: status,
        isolated: 'spec_error',
        ...(scored(status) ? { manifest: true } : {}),
        reason: errors.map((issue) => `${issue.code}: ${issue.message}`).join('; '),
      });
      continue;
    }
    const run = await runSpec(bare, { ...alone, runId: `${linked.runId}#isolated:${child}` });
    // The isolated spec holds the child alone: its only block.
    const own = run.blocks[0];
    const isolated: BlockStatus = own ? blockStatus(own) : 'not_run';
    const decided = scored(status) && scored(isolated);
    edges.push({
      child,
      parent: block.parent,
      linked: status,
      isolated,
      ...(decided ? { manifest: status !== isolated } : {}),
      ...(decided
        ? {}
        : {
            reason: `no verdict to compare: linked ${status}, isolated ${isolated}${
              own?.notRun ? ` (${own.notRun.check}: ${own.notRun.got})` : ''
            }`,
          }),
    });
  }
  return { specId: spec.id, linked, edges };
}

/** The child alone: its own block without the parent link, under the spec's own defaults, no perturbation. */
function isolatedSpec(spec: Spec, child: BlockSpec): Spec {
  const { parent: _parent, ...own } = child;
  const { perturbations: _perturbations, ...rest } = spec;
  return { ...rest, blocks: [own] };
}

function scored(status: BlockStatus): boolean {
  return status === 'pass' || status === 'fail';
}

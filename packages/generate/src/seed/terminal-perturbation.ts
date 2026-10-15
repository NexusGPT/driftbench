import type { Spec } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { SpecDraft } from './assemble';
import { TOOL_FAILURE } from './deviation';
import type { PreparedMap } from './map';
import { recoveryFor, stageAfter } from './relations';
import { hasPaths, pad, type SeedContext, scenarioDraft } from './seed-drafts';

/**
 * Perturbations a clean walk cannot hold: a class whose recovery moves the conversation elsewhere (a goal shift
 * goes back to intake) leaves every later turn of the walk starting from a stage the conversation has left, so
 * no clean walk declares it, and a perturbed run never sees an agent that ignores it. After coverage, each such
 * class no complete spec declares gets one walk of its flow cut at the latest stage before the last where it
 * can be said; the perturbation is said after the walk's last turn, with the recovery as its Then. The caller
 * renders each draft and observes it only when complete, before resuming this iterator.
 */
export class TerminalPerturbations {
  private readonly declared = new Set<string>();

  constructor(private readonly prepared: PreparedMap) {}

  /**
   * A declared perturbation counts when its recovery leaves the stage the walk had reached: one that stays
   * (a goal shift said at the stage that owns the goal) passes an agent that ignores it.
   */
  observe(spec: Spec): void {
    for (const perturbation of spec.perturbations ?? []) {
      const after = perturbation.recovery?.stage_after ?? perturbation.expect?.stage;
      const at = perturbation.inject_at ?? 0;
      const reached = at > 0 ? spec.blocks[at - 1]?.expect?.stage : undefined;
      if (after !== undefined && reached !== undefined && after !== reached)
        this.declared.add(perturbation.class);
    }
  }

  *drafts(context: SeedContext): Generator<SpecDraft> {
    const dimension = this.prepared.deviation;
    if (dimension === undefined || !hasPaths(this.prepared)) return;
    const relations = this.prepared.relations;
    let added = 0;
    for (const value of this.prepared.space.dimensions[dimension]?.values ?? []) {
      const classId = value.id;
      if (classId === NONE || classId === TOOL_FAILURE || this.declared.has(classId)) continue;
      if (added >= context.max) return;
      const places = relations.paths.flatMap((path) => {
        const own = recoveryFor(relations, classId, path.flow);
        if (!own) return [];
        // The latest stage first: the walk covers as much of its path as it can before the class is said.
        return path.stages
          .flatMap((stage, index) => {
            if (index + 1 >= path.stages.length) return [];
            const after = stageAfter(own, stage);
            return after !== undefined && after !== stage ? [{ path, stage }] : [];
          })
          .reverse();
      });
      for (const { path, stage } of places) {
        const id = `gen-deviation-cut-${pad(added + 1)}`;
        const built = scenarioDraft(
          this.prepared,
          context,
          id,
          'deviation',
          `Stage path cut for ${classId}`,
          [],
          { preferred: [path], others: [] },
          { perturb: { classId, stage } },
        );
        if (!('draft' in built)) continue;
        added += 1;
        yield built.draft;
        if (this.declared.has(classId)) break;
      }
    }
  }
}

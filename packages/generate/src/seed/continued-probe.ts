import type { Spec } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { SpecDraft } from './assemble';
import { TOOL_FAILURE } from './deviation';
import type { PreparedMap } from './map';
import { recoveryFor, stageAfter } from './relations';
import { hasPaths, pad, type SeedContext, scenarioDraft } from './seed-drafts';

/**
 * A recovery is followed by the rest of the flow. A probe of a class whose recovery moves the conversation elsewhere
 * ends its walk, so the probes of such a class can all be last blocks, and no spec shows the agent going on after the
 * recovery. After coverage, each class no complete spec goes on after gets one probe at a stage where its recovery
 * stays and a move of the path follows. The caller renders each draft and observes it only when complete, before
 * resuming this iterator.
 */
export class ContinuedProbes {
  private readonly continued = new Set<string>();

  constructor(private readonly prepared: PreparedMap) {}

  observe(spec: Spec): void {
    spec.blocks.forEach((block, index) => {
      if ('injection' in block.when && index < spec.blocks.length - 1)
        this.continued.add(block.when.injection.class);
    });
  }

  *drafts(context: SeedContext): Generator<SpecDraft> {
    const dimension = this.prepared.deviation;
    if (dimension === undefined || !hasPaths(this.prepared)) return;
    const relations = this.prepared.relations;
    let added = 0;
    for (const value of this.prepared.space.dimensions[dimension]?.values ?? []) {
      const classId = value.id;
      if (classId === NONE || classId === TOOL_FAILURE || this.continued.has(classId)) continue;
      const places = relations.paths.flatMap((path) => {
        const own = recoveryFor(relations, classId, path.flow);
        if (!own) return [];
        return path.stages.flatMap((stage, index) => {
          if (index + 1 >= path.stages.length) return [];
          const after = stageAfter(own, stage);
          return after === undefined || after === stage ? [{ path, stage, index }] : [];
        });
      });
      for (const { path, stage, index } of places) {
        if (added >= context.max) return;
        const built = scenarioDraft(
          this.prepared,
          context,
          `gen-deviation-continue-${pad(added + 1)}`,
          'deviation',
          `Probe of ${classId} the flow goes on after`,
          [],
          { preferred: [path], others: [] },
          { probe: { classId, stage, index } },
        );
        if (!('draft' in built)) continue;
        added += 1;
        yield built.draft;
        if (this.continued.has(classId)) break;
      }
    }
  }
}

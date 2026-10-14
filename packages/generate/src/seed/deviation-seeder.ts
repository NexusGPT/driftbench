/** The deviation seeder: probes that steer a conversation off its path at a chosen stage. */

import { NONE } from '@agent-nexus/driftbench-space';
import { type BlockDraft, choosePhrase, draftCriterion, type Pick, pickOf, type SpecDraft } from './assemble';
import { TOOL_FAILURE } from './deviation';
import { draftOutput } from './draft-output';
import { type Edge, type StageGraph, stageGraph } from './graph';
import { dimensionId, type PreparedMap, phraseKey, valueId } from './map';
import { pick, rngFor, streamSeed } from './random';
import {
  addDeviation,
  contextAxes,
  edgeBlock,
  hasPaths,
  pad,
  phrasedRoute,
  type SeedContext,
  scenarioDraft,
  withReasons,
} from './seed-drafts';

// Deviation probes -------------------------------------------------------------------------------------

export type DeviationSummary = {
  classes: number;
  probes: Array<{ class: string; stage: string | null; spec: string; phrase: boolean }>;
};

/** Stages a probe can be anchored at: the start, and every stage a route of phrased edges reaches. */
export function anchorStages(
  prepared: PreparedMap,
  graph: StageGraph | undefined,
): Array<{ stage: string; route: Edge[] }> {
  if (!graph || graph.start === undefined) return [];
  return graph.stages.flatMap((stage) => {
    const route = phrasedRoute(prepared, graph, stage);
    return route ? [{ stage, route }] : [];
  });
}

/** The flows of the inventory that require a class, as picks of the map's behaviour values. */
function flowsRequiring(prepared: PreparedMap, classId: string): Pick[] {
  const flows = (prepared.inventory?.flows ?? []).filter((flow) =>
    (flow.deviations ?? []).includes(classId as never),
  );
  const out: Pick[] = [];
  for (const flow of flows) {
    prepared.space.dimensions.forEach((dimension, index) => {
      if (dimension.kind !== 'behaviour') return;
      const value = dimension.index.get(flow.id);
      if (value !== undefined) out.push([index, value]);
    });
  }
  return out;
}

/**
 * One probe per deviation class of the map, injected at a stage where the constraints allow the class:
 * the stage is drawn among the stages a route of phrased edges reaches (always the start). The flows the
 * inventory requires the class in ride along in `covers`, when the constraints allow them there.
 */
export function deviationSeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: DeviationSummary } {
  const output = draftOutput(context);
  const drafts = output.drafts;
  const probes: DeviationSummary['probes'] = [];
  const dimension = prepared.deviation;
  if (dimension === undefined) return { drafts, summary: { classes: 0, probes } };
  const graph = stageGraph(prepared);
  const anchors = anchorStages(prepared, graph);
  const classes = prepared.space.dimensions[dimension]?.values.filter((value) => value.id !== NONE) ?? [];
  for (const value of classes) {
    if (output.count >= context.max) break;
    const deviation: Pick = [dimension, prepared.space.dimensions[dimension]?.index.get(value.id) ?? 0];
    const id = `gen-deviation-${pad(output.count + 1)}`;
    if (hasPaths(prepared)) {
      const required = new Set(
        (prepared.inventory?.flows ?? [])
          .filter((flow) => (flow.deviations ?? []).includes(value.id as never))
          .map((flow) => flow.id),
      );
      const built = scenarioDraft(
        prepared,
        context,
        id,
        'deviation',
        `Deviation probe ${value.id}`,
        [],
        {
          preferred: prepared.relations.paths.filter((path) => required.has(path.flow)),
          others: prepared.relations.paths.filter((path) => !required.has(path.flow)),
        },
        { probe: { classId: value.id } },
      );
      const phrase =
        (prepared.phrasesOf.get(phraseKey(dimensionId(prepared, dimension), value.id)) ?? []).length > 0;
      if ('draft' in built) {
        built.draft.cell.push(deviation);
        output.push(built.draft);
        const injected = built.draft.blocks.findIndex((block) => block.injection === value.id);
        const path = built.path.stages;
        const first = injected < 0 ? null : (path[injected] ?? null);
        probes.push({ class: value.id, stage: first, spec: id, phrase });
        // The class again at the latest other stage a path allows: a recovery that goes to the goal stage
        // looks the same as staying when the probe is already at the goal, so one stage proves nothing.
        const stages = prepared.space.dimensions[prepared.stage ?? -1]?.values.map((entry) => entry.id) ?? [];
        for (const stage of [...stages].reverse()) {
          if (stage === first || output.count >= context.max) continue;
          const again = `gen-deviation-${pad(output.count + 1)}`;
          const other = scenarioDraft(
            prepared,
            context,
            again,
            'deviation',
            `Deviation probe ${value.id} at ${stage}`,
            [],
            {
              preferred: prepared.relations.paths.filter((path) => required.has(path.flow)),
              others: prepared.relations.paths.filter((path) => !required.has(path.flow)),
            },
            { probe: { classId: value.id, stage } },
          );
          if (!('draft' in other)) continue;
          other.draft.cell.push(deviation);
          output.push(other.draft);
          break;
        }
        continue;
      }
      const fallback = probeDraft(prepared, context, id, 'deviation', deviation, anchors);
      output.push(withReasons(fallback.draft, built.reasons));
      probes.push({ class: value.id, stage: null, spec: id, phrase });
      continue;
    }
    const probe = probeDraft(prepared, context, id, 'deviation', deviation, anchors);
    output.push(probe.draft);
    probes.push({
      class: value.id,
      stage: probe.anchor,
      spec: id,
      phrase:
        (prepared.phrasesOf.get(phraseKey(dimensionId(prepared, dimension), value.id)) ?? []).length > 0,
    });
  }
  return { drafts, summary: { classes: classes.length, probes } };
}

export function probeDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  seeder: SpecDraft['seeder'],
  deviation: Pick,
  anchors: Array<{ stage: string; route: Edge[] }>,
  fixed?: { stimulus: BlockDraft['stimulus'] },
): { draft: SpecDraft; anchor: string | null } {
  const rng = rngFor(context.seed, id);
  const classId = valueId(prepared, deviation[0], deviation[1]);
  const stageOf = (stage: string): Pick | undefined => {
    const value =
      prepared.stage === undefined ? undefined : prepared.space.dimensions[prepared.stage]?.index.get(stage);
    return prepared.stage === undefined || value === undefined ? undefined : [prepared.stage, value];
  };
  const phrases = prepared.phrasesOf.get(phraseKey(dimensionId(prepared, deviation[0]), classId)) ?? [];
  // A tool failure with no phrase is a world change: it needs a turn after it that reaches a tool. Anchored
  // at a stage, that turn is a phrased edge leaving the stage, and the failure goes in just before it.
  const worldOnly = classId === TOOL_FAILURE && phrases.length === 0;
  const phrasedOut = (stage: string) =>
    stageGraph(prepared)?.edges.filter(
      (edge) =>
        edge.from === stage &&
        (prepared.phrasesOf.get(phraseKey(dimensionId(prepared, prepared.transition ?? -1), edge.id)) ?? [])
          .length > 0,
    ) ?? [];
  const allowedAt = anchors.filter(({ stage }) => {
    const at = stageOf(stage);
    if (at === undefined || !prepared.feasibility.allowed([deviation, at])) return false;
    return !worldOnly || phrasedOut(stage).length > 0;
  });
  const anchor = pick(rng, allowedAt);
  const atStage = anchor ? stageOf(anchor.stage) : undefined;
  const flows = flowsRequiring(prepared, classId).filter((flow) =>
    prepared.feasibility.allowed(atStage ? [deviation, atStage, flow] : [deviation, flow]),
  );
  const cell: Pick[] = [deviation, ...flows];
  cell.push(...contextAxes(prepared, atStage ? [...cell, atStage] : cell, rng));
  const route = [...(anchor?.route ?? [])];
  const next = worldOnly && anchor ? pick(rng, phrasedOut(anchor.stage)) : undefined;
  const walked = next ? [...route, next] : route;
  const blocks: BlockDraft[] = walked.map((edge, position) =>
    edgeBlock(prepared, rng, edge, `b${position + 1}-${edge.id}`),
  );
  if (prepared.transition !== undefined) {
    for (const edge of walked) cell.push([prepared.transition, edge.value]);
  }
  const where = anchor ? ` at stage ${anchor.stage}` : worldOnly ? ' before the opening turn' : '';
  const draft: SpecDraft = {
    id,
    seeder,
    title: `Deviation probe ${classId}${where}`,
    stream: streamSeed(context.seed, id),
    cell,
    blocks,
    criteria: [],
  };
  if (worldOnly && !anchor) {
    // No phrased edge leaves a reachable stage: open with a flow the inventory requires the class in.
    const opener = choosePhrase(prepared, rng, flows.length > 0 ? flows : cell);
    const carried = opener.kind === 'phrase' ? pickOf(prepared, opener.phrase) : undefined;
    draft.blocks.push({ id: 'b1-open', stimulus: opener, carries: carried ? [carried] : [] });
    for (const flow of flows) draft.criteria.push(draftCriterion(prepared, flow));
    const first = draft.blocks[0];
    if (first && flows.length > 0) first.criteria = flows.map((flow) => draftCriterion(prepared, flow).name);
  }
  if (fixed) {
    const before = draft.blocks.length;
    addDeviation(prepared, rng, draft, deviation, anchor?.stage);
    const added = draft.blocks[before];
    if (added) added.stimulus = fixed.stimulus;
  } else {
    addDeviation(prepared, rng, draft, deviation, anchor?.stage);
  }
  return { draft, anchor: anchor?.stage ?? null };
}

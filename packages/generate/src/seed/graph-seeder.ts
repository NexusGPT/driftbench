/** The stage-graph seeder: one spec per walk of the stage graph, and one per phrased path. */

import type { Pick, SpecDraft } from './assemble';
import { draftOutput } from './draft-output';
import { type StageGraph, stageGraph, walkGraph } from './graph';
import type { PreparedMap } from './map';
import { rngFor, streamSeed } from './random';
import {
  contextAxes,
  edgeBlock,
  hasPaths,
  MAX_PATH_LENGTH,
  pad,
  type SeedContext,
  scenarioDraft,
} from './seed-drafts';

// The stage graph --------------------------------------------------------------------------------------

export type GraphSummary = {
  stages: number;
  start: string | null;
  edges: number;
  covered: number;
  paths: number;
  unreachable: string[];
  blocked: string[];
  unparsed: string[];
  /** Approved paths the generator could not walk in any cell, with why. */
  unwalked?: Array<{ path: string; reasons: string[] }>;
};

export function graphSeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: GraphSummary } {
  const graph = stageGraph(prepared);
  if (!graph || prepared.stage === undefined) {
    const summary = {
      stages: 0,
      start: null,
      edges: 0,
      covered: 0,
      paths: 0,
      unreachable: [],
      blocked: [],
      unparsed: [],
    };
    return { drafts: [], summary };
  }
  if (hasPaths(prepared)) return pathSeeder(prepared, context, graph);
  const walk = walkGraph(prepared, graph, rngFor(context.seed, 'graph'), {
    maxLength: MAX_PATH_LENGTH,
    maxPaths: context.max,
  });
  const output = draftOutput(context);
  walk.paths.forEach((path, index) => {
    const id = `gen-graph-${pad(index + 1)}`;
    const rng = rngFor(context.seed, id);
    const blocks = path.edges.map((edge, position) =>
      edgeBlock(prepared, rng, edge, `b${position + 1}-${edge.id}`),
    );
    const cell: Pick[] = [...path.context];
    const reached: Pick[] = [];
    for (const edge of path.edges) {
      if (prepared.transition !== undefined) reached.push([prepared.transition, edge.value]);
      const stage = prepared.space.dimensions[prepared.stage ?? -1]?.index.get(edge.to);
      if (prepared.stage !== undefined && stage !== undefined) reached.push([prepared.stage, stage]);
    }
    cell.push(...contextAxes(prepared, path.context, rng, reached));
    if (prepared.transition !== undefined) {
      for (const edge of path.edges) cell.push([prepared.transition, edge.value]);
    }
    output.push({
      id,
      seeder: 'graph',
      title: `Stage path ${index + 1}: ${[graph.start, ...path.edges.map((edge) => edge.to)].join(' > ')}`,
      stream: streamSeed(context.seed, id),
      cell,
      blocks,
      criteria: [],
    });
  });
  const summary: GraphSummary = {
    stages: graph.stages.length,
    start: graph.start ?? null,
    edges: graph.edges.length,
    covered: walk.covered.length,
    paths: walk.paths.length,
    unreachable: walk.unreachable,
    blocked: walk.blocked,
    unparsed: graph.unparsed,
  };
  return { drafts: output.drafts, summary };
}

/**
 * With approved paths, the stage graph is walked along them: one spec per path, in a cell its `when`
 * allows, so every edge a path takes is covered by a conversation the agent can actually have. An edge no
 * approved path takes is reported as blocked.
 */
function pathSeeder(
  prepared: PreparedMap,
  context: SeedContext,
  graph: StageGraph,
): { drafts: SpecDraft[]; summary: GraphSummary } {
  const output = draftOutput(context);
  const drafts = output.drafts;
  const covered = new Set<string>();
  const unwalked: Array<{ path: string; reasons: string[] }> = [];
  for (const path of prepared.relations.paths) {
    if (output.count >= context.max) break;
    const id = `gen-graph-${pad(output.count + 1)}`;
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'graph',
      `Stage path ${output.count + 1}`,
      [],
      { preferred: [path], others: [] },
      { perturbEvery: true },
    );
    if ('draft' in built) {
      for (let index = 0; index + 1 < path.stages.length; index += 1) {
        covered.add(`${path.stages[index]}-to-${path.stages[index + 1]}`);
      }
      output.push(built.draft);
    } else {
      unwalked.push({ path: path.id, reasons: built.reasons });
    }
  }
  const edges = graph.edges.map((edge) => edge.id);
  return {
    drafts,
    summary: {
      stages: graph.stages.length,
      start: graph.start ?? null,
      edges: graph.edges.length,
      covered: edges.filter((edge) => covered.has(edge)).length,
      paths: output.count,
      unreachable: [],
      blocked: edges.filter((edge) => !covered.has(edge)),
      unparsed: graph.unparsed,
      ...(unwalked.length > 0 ? { unwalked } : {}),
    },
  };
}

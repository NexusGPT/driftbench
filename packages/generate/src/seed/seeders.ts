import type { PerturbationSpec, ToolExpect, WorldState } from '@driftbench/core';
import { NONE } from '@driftbench/space';
import {
  type BlockDraft,
  choosePhrase,
  deviationCriterion,
  draftCriterion,
  type Pick,
  pickOf,
  type SpecDraft,
} from './assemble';
import { DETOURS, MAX_CALLS_AFTER_FAILURE, TOOL_FAILURE, TOOL_FAILURE_ERROR } from './deviation';
import { type Edge, type StageGraph, stageGraph, walkGraph } from './graph';
import { dimensionId, type PreparedMap, partitionOf, phraseKey, valueId } from './map';
import { pick, type Rng, rngFor, streamSeed } from './random';
import { coveringArray } from './twise';
import { concreteValue, INVALID_PARTITIONS, inputAssertion, toolAnswer } from './values';

/**
 * The five seeders. Each one is deterministic code over the approved map: the stage graph walk, the
 * t-wise covering array, the boundary values of every data dimension, one probe per deviation class and
 * the metamorphic families of phrasings. A seeder returns drafts; `renderDraft` writes them as specs.
 */

export type SeedContext = { seed: number; t: number; max: number };

/** The most edges in one graph path: a path is one spec, and a reader follows it block by block. */
export const MAX_PATH_LENGTH = 12;

const pad = (n: number) => String(n).padStart(3, '0');

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
  const walk = walkGraph(prepared, graph, rngFor(context.seed, 'graph'), {
    maxLength: MAX_PATH_LENGTH,
    maxPaths: context.max,
  });
  const drafts = walk.paths.map((path, index): SpecDraft => {
    const id = `gen-graph-${pad(index + 1)}`;
    const rng = rngFor(context.seed, id);
    const blocks = path.edges.map((edge, position) =>
      edgeBlock(prepared, rng, edge, `b${position + 1}-${edge.id}`),
    );
    const cell: Pick[] = [...path.context];
    if (prepared.transition !== undefined) {
      for (const edge of path.edges) cell.push([prepared.transition, edge.value]);
    }
    return {
      id,
      seeder: 'graph',
      title: `Stage path ${index + 1}: ${[graph.start, ...path.edges.map((edge) => edge.to)].join(' > ')}`,
      stream: streamSeed(context.seed, id),
      cell,
      blocks,
      criteria: [],
    };
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
  return { drafts, summary };
}

/** One block per edge: the phrase of the transition (or of the stage it reaches), the stage it reaches. */
function edgeBlock(prepared: PreparedMap, rng: Rng, edge: Edge, id: string): BlockDraft {
  const candidates: Pick[] = [];
  if (prepared.transition !== undefined) candidates.push([prepared.transition, edge.value]);
  const stage =
    prepared.stage === undefined ? undefined : prepared.space.dimensions[prepared.stage]?.index.get(edge.to);
  if (prepared.stage !== undefined && stage !== undefined) candidates.push([prepared.stage, stage]);
  return {
    id,
    stimulus: choosePhrase(prepared, rng, candidates),
    stage: edge.to,
    carries: candidates.slice(0, 1),
  };
}

/** The shortest route from the start to a stage over edges that all have an approved phrase. */
function phrasedRoute(prepared: PreparedMap, graph: StageGraph, target: string): Edge[] | undefined {
  if (graph.start === undefined) return undefined;
  const phrased = graph.edges.filter(
    (edge) =>
      (prepared.phrasesOf.get(phraseKey(dimensionId(prepared, prepared.transition ?? -1), edge.id)) ?? [])
        .length > 0,
  );
  const back = new Map<string, Edge>();
  const seen = new Set([graph.start]);
  const queue = [graph.start];
  for (let stage = queue.shift(); stage !== undefined; stage = queue.shift()) {
    if (stage === target) {
      const route: Edge[] = [];
      for (let at = stage; at !== graph.start; ) {
        const edge = back.get(at);
        if (!edge) break;
        route.unshift(edge);
        at = edge.from;
      }
      return route;
    }
    for (const edge of phrased.filter((candidate) => candidate.from === stage)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      back.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  return undefined;
}

// The t-wise covering array ----------------------------------------------------------------------------

export type TwiseSummary = {
  t: number;
  dimensions: string[];
  rows: number;
  allowed: number;
  covered: number;
  share: number;
};

/** The dimensions the covering array spans: every dimension but the stage graph's (stage, transitions). */
export function twiseDimensions(prepared: PreparedMap): number[] {
  return prepared.space.dimensions
    .map((_, index) => index)
    .filter((index) => index !== prepared.stage && index !== prepared.transition);
}

export function twiseSeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: TwiseSummary } {
  const dimensions = twiseDimensions(prepared);
  const sizes = prepared.space.dimensions.map((dimension) => dimension.values.length);
  const t = Math.min(context.t, dimensions.length);
  const array = coveringArray(
    prepared.feasibility,
    sizes,
    dimensions,
    t,
    rngFor(context.seed, 'twise'),
    context.max,
  );
  const drafts = array.rows.map((row, index) => {
    const id = `gen-twise-${pad(index + 1)}`;
    const cell: Pick[] = dimensions.map((dimension) => [dimension, row[dimension] ?? 0]);
    return carrierDraft(
      prepared,
      context,
      id,
      'twise',
      `t-wise row ${index + 1} of ${array.rows.length}`,
      cell,
    );
  });
  const summary: TwiseSummary = {
    t,
    dimensions: dimensions.map((dimension) => dimensionId(prepared, dimension)),
    rows: array.rows.length,
    allowed: array.allowed,
    covered: array.covered,
    share: array.allowed === 0 ? 0 : array.covered / array.allowed,
  };
  return { drafts, summary };
}

/**
 * A conversation over one cell of the non-stage dimensions: the tool answers its data values state, an
 * opening turn from the approved phrases of its values, and its deviation, when it has one, as the next
 * block. The Then is what the map supports for such a cell: the deviation's expectation, and the cell's
 * behaviour values as judged criteria drafted from their approved titles.
 */
function carrierDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  seeder: SpecDraft['seeder'],
  title: string,
  cell: Pick[],
  fixed?: { stimulus: BlockDraft['stimulus'] },
): SpecDraft {
  const rng = rngFor(context.seed, id);
  const deviation = cell.find(([dimension]) => dimension === prepared.deviation);
  const openers = cell.filter(([dimension]) => dimension !== prepared.deviation);
  const stimulus = fixed?.stimulus ?? choosePhrase(prepared, rng, openers);
  const carried = stimulus.kind === 'phrase' ? pickOf(prepared, stimulus.phrase) : undefined;
  const behaviours = cell.filter(([dimension]) => prepared.space.dimensions[dimension]?.kind === 'behaviour');
  const criteria = behaviours.map((entry) => draftCriterion(prepared, entry));
  const blocks: BlockDraft[] = [
    {
      id: 'b1-open',
      stimulus,
      carries: carried ? [carried] : [],
      ...(criteria.length > 0 ? { criteria: criteria.map((criterion) => criterion.name) } : {}),
    },
  ];
  const { world } = worldFor(prepared, cell);
  const draft: SpecDraft = {
    id,
    seeder,
    title,
    stream: streamSeed(context.seed, id),
    cell,
    blocks,
    ...(world ? { world } : {}),
    criteria,
  };
  if (deviation && valueId(prepared, deviation[0], deviation[1]) !== NONE) {
    addDeviation(prepared, rng, draft, deviation, undefined);
  }
  return draft;
}

/**
 * Adds the deviation of a cell after the blocks already drafted: an injection block with the class's
 * approved phrase, or for a tool failure without one, a perturbation that makes a tool fail.
 */
function addDeviation(
  prepared: PreparedMap,
  rng: Rng,
  draft: SpecDraft,
  deviation: Pick,
  anchor: string | undefined,
): void {
  const classId = valueId(prepared, deviation[0], deviation[1]);
  const criterion = deviationCriterion(classId);
  draft.criteria.push(criterion);
  const phrases = prepared.phrasesOf.get(phraseKey(dimensionId(prepared, deviation[0]), classId)) ?? [];
  if (classId === TOOL_FAILURE && phrases.length === 0) {
    const tool = failingTool(prepared, rng, draft.cell);
    if (tool === undefined) return;
    const perturbation: PerturbationSpec = {
      id: `p1-${classId}`,
      class: TOOL_FAILURE,
      inject_at: Math.max(0, draft.blocks.length - 1),
      world: { tools: { [tool]: { error: TOOL_FAILURE_ERROR } } },
      expect: {
        tools: [{ label: tool, count: { max: MAX_CALLS_AFTER_FAILURE } }],
        criteria: [criterion.name],
      },
      recovery: { within_blocks: 1 },
    };
    draft.perturbations = [...(draft.perturbations ?? []), perturbation];
    return;
  }
  const block: BlockDraft = {
    id: `b${draft.blocks.length + 1}-${classId}`,
    stimulus: choosePhrase(prepared, rng, [deviation]),
    injection: classId,
    carries: [deviation],
    criteria: [criterion.name],
  };
  if (anchor !== undefined && DETOURS.has(classId)) block.stage = anchor;
  if (classId === 'D5_language_switch') {
    const declared = draft.blocks.find((candidate) => candidate.stimulus.kind === 'phrase');
    const lang = declared?.stimulus.kind === 'phrase' ? declared.stimulus.phrase.lang : undefined;
    const bank = lang ?? mostFrequentLang(prepared);
    if (bank) block.lang = bank.toUpperCase();
  }
  if (classId === 'D7_silence_or_burst') draft.rules = { ...(draft.rules ?? {}), one_message_per_turn: true };
  draft.blocks.push(block);
}

function mostFrequentLang(prepared: PreparedMap): string | undefined {
  const counts = new Map<string, number>();
  for (const phrase of prepared.phrases) counts.set(phrase.lang, (counts.get(phrase.lang) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The tool a generated failure hits. A map can name it as data (a dimension whose values are tool names,
 * such as Acme's failing_tool): a value of the cell that names a tool wins; else one of those values the
 * constraints allow with the cell, by the stream, joins the cell; else a tool with an output schema.
 */
function failingTool(prepared: PreparedMap, rng: Rng, cell: Pick[]): string | undefined {
  const names = prepared.tools.map((tool) => tool.name);
  const named = cell
    .map(([dimension, value]) => valueId(prepared, dimension, value))
    .find((id) => names.includes(id));
  if (named) return named;
  const candidates: Pick[] = [];
  prepared.space.dimensions.forEach((dimension, index) => {
    if (dimension.kind !== 'data' || cell.some(([at]) => at === index)) return;
    dimension.values.forEach((value, position) => {
      if (names.includes(value.id) && prepared.feasibility.allowed([...cell, [index, position]])) {
        candidates.push([index, position]);
      }
    });
  });
  const chosen = pick(rng, candidates);
  if (chosen) {
    cell.push(chosen);
    return valueId(prepared, chosen[0], chosen[1]);
  }
  return pick(
    rng,
    prepared.tools.filter((tool) => tool.output).map((tool) => tool.name),
  );
}

/** The tool answers a cell's output values state, as `world.tools.<tool>.result`. */
export function worldFor(
  prepared: PreparedMap,
  cell: readonly Pick[],
): { world?: WorldState; unsupported: string[] } {
  const byTool = new Map<
    string,
    Array<{ path: string[]; schema: Record<string, unknown>; partition: string }>
  >();
  for (const [dimension, value] of cell) {
    const found = prepared.toolDimensions.get(dimension);
    if (found?.direction !== 'out') continue;
    const partition = partitionOf(dimensionId(prepared, dimension), valueId(prepared, dimension, value));
    byTool.set(found.tool.name, [
      ...(byTool.get(found.tool.name) ?? []),
      { path: found.path, schema: found.schema, partition },
    ]);
  }
  if (byTool.size === 0) return { unsupported: [] };
  const tools: NonNullable<WorldState['tools']> = {};
  const unsupported: string[] = [];
  for (const tool of prepared.tools) {
    const partitions = byTool.get(tool.name);
    if (!partitions) continue;
    const answer = toolAnswer(tool, partitions);
    tools[tool.name] = { result: answer.answer as never };
    unsupported.push(...answer.unsupported.map((entry) => `${tool.name}.out.${entry}`));
  }
  return { world: { tools }, unsupported };
}

// Boundary and equivalence values ----------------------------------------------------------------------

export type BoundarySummary = { values: number; tools: number; unsupported: string[] };

/**
 * One spec per value of every data dimension. On a tool's output, the tool answers with the value (its
 * other output values completed under the constraints) and the block expects the call; on a tool's input,
 * a valid value is asserted on the call and an invalid one forbids the call (a correct agent never sends
 * it). The concrete value is computed from the schema.
 */
export function boundarySeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: BoundarySummary } {
  const drafts: SpecDraft[] = [];
  const unsupported: string[] = [];
  let toolValues = 0;
  prepared.space.dimensions.forEach((dimension, index) => {
    if (dimension.kind !== 'data') return;
    dimension.values.forEach((value, position) => {
      if (value.id === NONE || drafts.length >= context.max) return;
      const id = `gen-boundary-${pad(drafts.length + 1)}`;
      const rng = rngFor(context.seed, id);
      const target: Pick = [index, position];
      const found = prepared.toolDimensions.get(index);
      const partition = partitionOf(dimension.id, value.id);
      const cell: Pick[] = [target];
      const tools: ToolExpect[] = [];
      const concrete: Record<string, unknown> = {};
      if (found) {
        toolValues += 1;
        const shown = concreteValue(found.schema, partition);
        if (shown.kind === 'value') concrete[value.id] = shown.value;
        else if (shown.kind === 'absent') concrete[value.id] = '(absent)';
        else unsupported.push(`${value.id}: ${shown.why}`);
        if (found.direction === 'out') {
          const full = prepared.feasibility.complete([target], rng);
          for (const [other, otherValue] of full?.entries() ?? []) {
            const sibling = prepared.toolDimensions.get(other);
            if (other !== index && sibling?.tool.name === found.tool.name && sibling.direction === 'out') {
              cell.push([other, otherValue]);
            }
          }
          tools.push({ label: found.tool.name, count: { min: 1 } });
        } else if (INVALID_PARTITIONS.has(partition)) {
          tools.push({ label: found.tool.name, count: 0 });
        } else {
          const assertion = inputAssertion(found.path, found.schema, partition);
          const name = found.path[0];
          tools.push({
            label: found.tool.name,
            count: { min: 1 },
            ...(assertion !== undefined && name !== undefined ? { input: { [name]: assertion } } : {}),
          });
        }
      }
      const world = worldFor(prepared, cell);
      unsupported.push(...world.unsupported.filter((entry) => !unsupported.includes(entry)));
      const criteria = found ? [] : [draftCriterion(prepared, target)];
      drafts.push({
        id,
        seeder: 'boundary',
        title: `Boundary value ${value.id}: ${value.title}`,
        stream: streamSeed(context.seed, id),
        cell,
        blocks: [
          {
            id: 'b1-value',
            stimulus: choosePhrase(prepared, rng, [target]),
            carries: [target],
            ...(tools.length > 0 ? { tools } : {}),
            ...(criteria.length > 0 ? { criteria: criteria.map((criterion) => criterion.name) } : {}),
          },
        ],
        ...(world.world ? { world: world.world } : {}),
        criteria,
        ...(Object.keys(concrete).length > 0 ? { concrete } : {}),
      });
    });
  });
  return { drafts, summary: { values: drafts.length, tools: toolValues, unsupported } };
}

// Deviation probes -------------------------------------------------------------------------------------

export type DeviationSummary = {
  classes: number;
  probes: Array<{ class: string; stage: string | null; spec: string; phrase: boolean }>;
};

/** Stages a probe can be anchored at: the start, and every stage a route of phrased edges reaches. */
function anchorStages(
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
  const drafts: SpecDraft[] = [];
  const probes: DeviationSummary['probes'] = [];
  const dimension = prepared.deviation;
  if (dimension === undefined) return { drafts, summary: { classes: 0, probes } };
  const graph = stageGraph(prepared);
  const anchors = anchorStages(prepared, graph);
  const classes = prepared.space.dimensions[dimension]?.values.filter((value) => value.id !== NONE) ?? [];
  for (const value of classes) {
    if (drafts.length >= context.max) break;
    const deviation: Pick = [dimension, prepared.space.dimensions[dimension]?.index.get(value.id) ?? 0];
    const id = `gen-deviation-${pad(drafts.length + 1)}`;
    const probe = probeDraft(prepared, context, id, 'deviation', deviation, anchors);
    drafts.push(probe.draft);
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

function probeDraft(
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

// Metamorphic families ---------------------------------------------------------------------------------

export type MetamorphicSummary = { families: number; specs: number; values: string[] };

/**
 * The same cell through each approved phrasing of one value (CheckList's invariance test): every value
 * with two or more approved phrases gets a family of specs that differ only in that user turn, with the
 * same Then. The relation: the observed outcome is identical across the family.
 */
export function metamorphicSeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: MetamorphicSummary } {
  const drafts: SpecDraft[] = [];
  const values: string[] = [];
  const graph = stageGraph(prepared);
  const anchors = anchorStages(prepared, graph);
  const dimensions = twiseDimensions(prepared);
  let families = 0;
  for (const [key, phrases] of prepared.phrasesOf) {
    if (phrases.length < 2 || drafts.length >= context.max) continue;
    const target = pickOf(prepared, phrases[0] as (typeof phrases)[number]);
    if (!target || target[0] === prepared.stage || target[0] === prepared.transition) continue;
    families += 1;
    values.push(key);
    const family = `gen-metamorphic-${pad(families)}`;
    const rng = rngFor(context.seed, family);
    const full = prepared.feasibility.complete([target], rng);
    phrases.forEach((phrase, variant) => {
      const id = `${family}-${variant + 1}`;
      const stimulus = { kind: 'phrase' as const, phrase };
      const contextFor: SeedContext = { ...context };
      const draft =
        target[0] === prepared.deviation
          ? probeDraft(prepared, contextFor, family, 'metamorphic', target, anchors, { stimulus }).draft
          : carrierDraft(
              prepared,
              contextFor,
              family,
              'metamorphic',
              '',
              dimensions.map((dimension): Pick => [dimension, full?.[dimension] ?? 0]),
              { stimulus },
            );
      drafts.push({
        ...draft,
        id,
        title: `Metamorphic ${key}, phrasing ${variant + 1} of ${phrases.length}`,
        metamorphic: { family, variant: variant + 1, of: phrases.length, relation: 'same observed outcome' },
      });
    });
  }
  return { drafts, summary: { families, specs: drafts.length, values } };
}

import type { PerturbationSpec, ToolExpect, WorldState } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { PathRelation, ProposalPhrase } from '../extract/proposal';
import {
  type BlockDraft,
  choosePhrase,
  deviationCriterion,
  draftCriterion,
  type Pick,
  pickOf,
  type SpecDraft,
} from './assemble';
import { enumerateCells, selectBudget, slicedLhs } from './budget';
import {
  DETOURS,
  MAX_CALLS_AFTER_FAILURE,
  OPENING_CLASSES,
  TOOL_FAILURE,
  TOOL_FAILURE_ERROR,
} from './deviation';
import { Feasibility } from './feasible';
import { type Edge, type StageGraph, stageGraph, walkGraph } from './graph';
import { dimensionId, type PreparedMap, partitionOf, phraseKey, valueId } from './map';
import { impossibleConstraints } from './possible';
import { pick, type Rng, range, rngFor, shuffle, streamSeed } from './random';
import { slotsOf } from './relations';
import { buildScenario, type ProbeRequest, type ScenarioRequest } from './scenario';
import { type AllowedCheck, coveringArray } from './twise';
import { concreteValue, INVALID_PARTITIONS, inputAssertion, toolAnswer } from './values';

/**
 * The five seeders. Each one is deterministic code over the approved map: the stage graph walk, the
 * t-wise covering array, the boundary values of every data dimension, one probe per deviation class and
 * the metamorphic families of phrasings. A seeder returns drafts; `renderDraft` writes them as specs.
 *
 * When the map holds approved paths (relations), each seeder builds its specs as scenarios on them
 * (`buildScenario`): a t-wise row walks a path of a flow its behaviour belongs to, a boundary value walks a
 * path that needs it, a probe is injected on a path whose flow has a recovery for the class, a metamorphic
 * variant forces one phrasing on the same walk. Every block then carries a machine Then derived from the
 * map. A cell no path fits goes to incomplete/ with the reason.
 */

export type SeedContext = { seed: number; t: number; max: number };

/** The most edges in one graph path: a path is one spec, and a reader follows it block by block. */
export const MAX_PATH_LENGTH = 12;

const pad = (n: number) => String(n).padStart(3, '0');

// Scenarios on the map's paths ----------------------------------------------------------------------------

/** True when the map holds approved paths: the seeders then build scenarios. */
export function hasPaths(prepared: PreparedMap): boolean {
  return prepared.relations.paths.length > 0;
}

/** The flows a behaviour belongs to, by the inventory, by id. A flow value is its own flow. */
export function flowsOfBehaviour(prepared: PreparedMap, behaviour: string): string[] {
  const flows = (prepared.inventory?.flows ?? [])
    .filter((flow) => flow.id === behaviour || (flow.behaviours ?? []).includes(behaviour as never))
    .map((flow) => flow.id);
  const own = prepared.relations.paths.some((path) => path.flow === behaviour);
  return own && !flows.includes(behaviour) ? [behaviour, ...flows] : flows;
}

type PathTry = { draft: SpecDraft; path: PathRelation } | { reasons: string[] };

/**
 * Tries the candidate paths in a seeded order, the preferred ones first, and returns the first scenario
 * that builds, as a draft; else every reason a path gave.
 */
function scenarioDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  seeder: SpecDraft['seeder'],
  prefix: string,
  fixed: readonly Pick[],
  candidates: { preferred: PathRelation[]; others: PathRelation[] },
  options: {
    probe?: ProbeRequest;
    force?: ProposalPhrase;
    rngLabel?: string;
    turn?: ScenarioRequest['turn'];
  } = {},
): PathTry {
  const rng = rngFor(context.seed, options.rngLabel ?? id);
  const order = [...shuffle(rng, candidates.preferred), ...shuffle(rng, candidates.others)];
  const reasons: string[] = [];
  for (const path of order) {
    const built = buildScenario(prepared, rng, {
      path,
      fixed,
      ...(options.probe ? { probe: options.probe } : {}),
      ...(options.force ? { force: options.force } : {}),
      ...(options.turn ? { turn: options.turn } : {}),
    });
    if (!built.ok) {
      reasons.push(built.reason);
      continue;
    }
    // The context is drawn with every stage the walk reaches: a value the walk's stages rule out (a coverage
    // result on a flow that checks no coverage) is never drawn.
    const reached: Pick[] =
      prepared.stage === undefined
        ? []
        : built.blocks.flatMap((block): Pick[] => {
            const at =
              block.stage === undefined
                ? undefined
                : prepared.space.dimensions[prepared.stage as number]?.index.get(block.stage);
            return at === undefined ? [] : [[prepared.stage as number, at]];
          });
    const cell = [...built.cell, ...contextAxes(prepared, built.cell, rng, reached)];
    const behaviours = cell.filter(
      ([dimension]) =>
        prepared.space.dimensions[dimension]?.kind === 'behaviour' && dimension !== prepared.transition,
    );
    const criteria = behaviours.map((entry) => draftCriterion(prepared, entry));
    // Only reply-bound outputs need an injected answer. Other output partitions can describe
    // a real fixture's business state without being synthetic JSON Schema partitions.
    const world = worldFor(prepared, built.replyData, { useBindings: true });
    if (world.unsupported.length > 0) {
      reasons.push(...world.unsupported);
      continue;
    }
    const blocks = built.blocks;
    const first = blocks[0];
    if (first && criteria.length > 0) first.criteria = criteria.map((criterion) => criterion.name);
    if (options.probe) {
      const probeCriterion = deviationCriterion(options.probe.classId);
      criteria.push(probeCriterion);
      const injected = blocks.find((block) => block.injection === options.probe?.classId);
      if (injected) injected.criteria = [...(injected.criteria ?? []), probeCriterion.name];
    }
    return {
      path,
      draft: {
        id,
        seeder,
        title: `${prefix}: ${built.title}`,
        stream: streamSeed(context.seed, options.rngLabel ?? id),
        cell,
        blocks,
        criteria,
        path: path.id,
        ...(world.world ? { world: world.world } : {}),
        ...(built.rules ? { rules: built.rules } : {}),
        ...(built.endState ? { end_state: built.endState } : {}),
        ...(built.perturbations ? { perturbations: built.perturbations } : {}),
      },
    };
  }
  return { reasons: reasons.length > 0 ? reasons : ['no approved path fits'] };
}

/** Splits paths into those that list a behaviour and the rest. */
function preferring(paths: PathRelation[], behaviour: string | undefined) {
  const preferred = paths.filter(
    (path) => behaviour !== undefined && (path.behaviours ?? []).includes(behaviour),
  );
  return { preferred, others: paths.filter((path) => !preferred.includes(path)) };
}

/** The probe a cell's deviation asks for, or undefined for none. */
function probeOf(prepared: PreparedMap, cell: readonly Pick[]): ProbeRequest | undefined {
  const deviation = cell.find(([dimension]) => dimension === prepared.deviation);
  if (!deviation) return undefined;
  const classId = valueId(prepared, deviation[0], deviation[1]);
  return classId === NONE ? undefined : { classId };
}

/** An incomplete draft: the old carrier, its blocks with judged criteria only, and why no path fits. */
function withReasons(draft: SpecDraft, reasons: string[]): SpecDraft {
  return { ...draft, reasons: [...new Set(reasons)].slice(0, 6) };
}

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
  const drafts = walk.paths.map((path, index): SpecDraft => {
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
  const drafts: SpecDraft[] = [];
  const covered = new Set<string>();
  const unwalked: Array<{ path: string; reasons: string[] }> = [];
  for (const path of prepared.relations.paths) {
    if (drafts.length >= context.max) break;
    const id = `gen-graph-${pad(drafts.length + 1)}`;
    const built = scenarioDraft(prepared, context, id, 'graph', `Stage path ${drafts.length + 1}`, [], {
      preferred: [path],
      others: [],
    });
    if ('draft' in built) {
      for (let index = 0; index + 1 < path.stages.length; index += 1) {
        covered.add(`${path.stages[index]}-to-${path.stages[index + 1]}`);
      }
      drafts.push(built.draft);
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
      paths: drafts.length,
      unreachable: [],
      blocked: edges.filter((edge) => !covered.has(edge)),
      unparsed: graph.unparsed,
      ...(unwalked.length > 0 ? { unwalked } : {}),
    },
  };
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
  /** Pairs of the array's dimensions no path of the map reaches, so the target leaves them out. */
  unreachable: string[];
};

/**
 * The dimensions the covering array spans: the axes, but the stage graph's (stage, transitions). Details
 * are chosen inside each row's cell, never crossed.
 */
export function twiseDimensions(prepared: PreparedMap): number[] {
  // A task setting (a task axis) belongs to a code-agent task, never to a conversation: its values come
  // from the task families, not from the covering array.
  return [...prepared.axes]
    .sort((a, b) => a - b)
    .filter((index) => index !== prepared.stage && index !== prepared.transition)
    .filter((index) => prepared.space.dimensions[index]?.kind !== 'task');
}

/** Axis kinds that set the context of a conversation: who talks, on which channel, with which data. */
const CONTEXT_KINDS: ReadonlySet<string> = new Set(['persona', 'channel', 'data']);

/**
 * The context axes of a spec whose seeder fixes only some values (a graph path, a probe, a boundary value):
 * a seeded allowed completion of the fixed values, with no deviation, kept only when every stage and
 * transition the spec reaches stays allowed with it. Behaviour axes are left out: a context draw is not a
 * claim that the spec covers a behaviour.
 */
function contextAxes(
  prepared: PreparedMap,
  fixed: readonly Pick[],
  rng: Rng,
  reached: readonly Pick[] = [],
): Pick[] {
  // One value per dimension is fixed; a second value of the same dimension (a spec covering two flows)
  // must stay allowed with the draw, like a stage the spec reaches.
  const base: Pick[] = [];
  const also: Pick[] = [...reached];
  for (const entry of fixed) {
    if (base.some(([at]) => at === entry[0])) also.push(entry);
    else base.push(entry);
  }
  const none =
    prepared.deviation === undefined
      ? undefined
      : prepared.space.dimensions[prepared.deviation]?.index.get(NONE);
  if (
    prepared.deviation !== undefined &&
    none !== undefined &&
    !base.some(([at]) => at === prepared.deviation)
  ) {
    base.push([prepared.deviation, none]);
  }
  // A conversation holds no task setting: every task axis stays at its `none`, as the spec places it.
  for (const index of prepared.axes) {
    const dimension = prepared.space.dimensions[index];
    const empty = dimension?.index.get(NONE);
    if (dimension?.kind === 'task' && empty !== undefined && !base.some(([at]) => at === index))
      base.push([index, empty]);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const full = prepared.feasibility.complete(base, rng);
    if (!full) return [];
    const picks: Pick[] = [...prepared.axes]
      .sort((a, b) => a - b)
      .filter((index) => CONTEXT_KINDS.has(prepared.space.dimensions[index]?.kind ?? ''))
      .filter((index) => !base.some(([at]) => at === index))
      .map((index) => [index, full[index] ?? 0]);
    if (
      also.every((entry) =>
        prepared.feasibility.allowed([...base.filter(([at]) => at !== entry[0]), ...picks, entry]),
      )
    ) {
      return picks;
    }
  }
  return [];
}

/** The details of a cell: a seeded allowed completion, the stage graph's dimensions left out. */
function withDetails(prepared: PreparedMap, cell: readonly Pick[], rng: Rng): Pick[] {
  const full = prepared.feasibility.complete(cell, rng);
  if (!full) return [...cell];
  const fixed = new Set(cell.map(([dimension]) => dimension));
  const details: Pick[] = full.flatMap((value, dimension): Pick[] =>
    fixed.has(dimension) || dimension === prepared.stage || dimension === prepared.transition
      ? []
      : [[dimension, value]],
  );
  return [...cell, ...details];
}

/**
 * The feasibility the t-wise target is counted with: the written constraints plus the pairs no path of the
 * map can reach, so the report counts only the tuples a possible cell holds.
 */
export function reachableFeasibility(prepared: PreparedMap): Feasibility {
  const extra = unreachablePairs(prepared);
  if (extra.length === 0) return prepared.feasibility;
  return new Feasibility({ ...prepared.space, constraints: [...prepared.space.constraints, ...extra] });
}

const unreachableMemo = new WeakMap<PreparedMap, ReturnType<typeof impossibleConstraints>>();

function unreachablePairs(prepared: PreparedMap): ReturnType<typeof impossibleConstraints> {
  let known = unreachableMemo.get(prepared);
  if (!known) {
    known = impossibleConstraints(prepared, flowsOfBehaviour);
    unreachableMemo.set(prepared, known);
  }
  return known;
}

/**
 * The conversation drafts of a set of rows: one cell per row, its path (when the map holds approved
 * paths), or a carrier when no path builds. `label` names the rows in their titles.
 */
export function rowDrafts(
  prepared: PreparedMap,
  context: SeedContext,
  cells: readonly (readonly Pick[])[],
  label: string,
): SpecDraft[] {
  return cells.map((cell, index) => {
    const id = `gen-twise-${pad(index + 1)}`;
    const title = `${label} row ${index + 1} of ${cells.length}`;
    if (!hasPaths(prepared)) return carrierDraft(prepared, context, id, 'twise', title, [...cell]);
    const behaviour = cell
      .filter(
        ([dimension]) =>
          prepared.axes.has(dimension) && prepared.space.dimensions[dimension]?.kind === 'behaviour',
      )
      .map(([dimension, value]) => valueId(prepared, dimension, value))[0];
    const flows = behaviour === undefined ? [] : flowsOfBehaviour(prepared, behaviour);
    const paths = prepared.relations.paths.filter((path) => flows.includes(path.flow));
    const probe = probeOf(prepared, cell);
    const fixed = cell.filter(([dimension]) => dimension !== prepared.deviation);
    // The behaviour's own paths first; when none of them builds (no path, or its flows give no recovery
    // from the row's deviation), a path of another flow keeps the row's cell complete.
    const own = preferring(paths, behaviour);
    const elsewhere = prepared.relations.paths.filter((path) => !flows.includes(path.flow));
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'twise',
      title,
      fixed,
      { preferred: own.preferred, others: [...own.others, ...elsewhere] },
      { ...(probe ? { probe } : {}) },
    );
    if ('draft' in built) {
      const deviation = cell.find(([dimension]) => dimension === prepared.deviation);
      if (deviation) built.draft.cell.push(deviation);
      return built.draft;
    }
    const reasons =
      paths.length === 0
        ? [`no approved path belongs to a flow of ${behaviour ?? 'the row'} (${flows.join(', ') || 'none'})`]
        : built.reasons;
    return withReasons(carrierDraft(prepared, context, id, 'twise', title, [...cell]), reasons);
  });
}

/** The conversation's cell of each row: the twise dimensions, the task axes held at their `none`. */
function conversationOf(prepared: PreparedMap): {
  dimensions: number[];
  sizes: number[];
  allowed: AllowedCheck;
} {
  const dimensions = twiseDimensions(prepared);
  const sizes = prepared.space.dimensions.map((dimension) => dimension.values.length);
  // A row is a conversation: it holds no task setting, so every task axis stays at its `none`.
  const taskNones: Pick[] = [...prepared.axes].flatMap((index): Pick[] => {
    const dimension = prepared.space.dimensions[index];
    const empty = dimension?.index.get(NONE);
    return dimension?.kind === 'task' && empty !== undefined ? [[index, empty]] : [];
  });
  const reachable = reachableFeasibility(prepared);
  return {
    dimensions,
    sizes,
    allowed: { allowed: (picks: readonly Pick[]) => reachable.allowed([...picks, ...taskNones]) },
  };
}

export function twiseSeeder(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: TwiseSummary } {
  const { dimensions, sizes, allowed } = conversationOf(prepared);
  const t = Math.min(context.t, dimensions.length);
  const array = coveringArray(allowed, sizes, dimensions, t, rngFor(context.seed, 'twise'), context.max);
  const cells = array.rows.map((row) =>
    dimensions.map((dimension): Pick => [dimension, row[dimension] ?? 0]),
  );
  const drafts = rowDrafts(prepared, context, cells, 't-wise');
  const summary: TwiseSummary = {
    t,
    dimensions: dimensions.map((dimension) => dimensionId(prepared, dimension)),
    rows: array.rows.length,
    allowed: array.allowed,
    covered: array.covered,
    share: array.allowed === 0 ? 0 : array.covered / array.allowed,
    unreachable: unreachablePairs(prepared)
      .filter((pair) => pair.every(([dimension]) => dimensions.includes(dimension)))
      .map((pair) =>
        pair
          .map(
            ([dimension, value]) =>
              `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
          )
          .join(' & '),
      ),
  };
  return { drafts, summary };
}

/** The budget seeder's account of its picks: pair coverage and the value balance per dimension. */
export type BudgetSummary = {
  budget: number;
  seed: number;
  dimensions: string[];
  /** Allowed cells of the pool. */
  pool: number;
  /** Rows picked: the budget, or the pool limit when numeric settings are absent. */
  picked: number;
  /** Selection stopped at the distinct-cell pool limit; always false with numeric settings. */
  capped: boolean;
  pairs: { allowed: number; covered: number; share: number };
  values: Array<{
    dimension: string;
    allowed: number;
    values: Array<{ value: string; count: number; fair: number; deviation: number }>;
  }>;
  /** The largest |count - fair share| over every value of every dimension. */
  maxDeviation: number;
  /** Numeric quantiles are Latin globally and within each categorical cell. Integer values may repeat. */
  numeric?: {
    settings: Array<{ id: string; min: number; max: number; integer: boolean; unit?: string }>;
    rows: Array<{
      spec: string;
      cell: Record<string, string>;
      quantiles: Record<string, number>;
      vars: Record<string, number>;
    }>;
  };
};

/**
 * Budget mode: N conversations placed by the budget rules (seed/budget.ts) over the twise dimensions. Pair
 * coverage is the hard rule, the Latin hypercube balance breaks ties. Each picked cell is drafted as a
 * twise row is, so the rest of the pipeline is the same.
 */
export function budgetSeeder(
  prepared: PreparedMap,
  context: SeedContext,
  options: { budget: number },
): { drafts: SpecDraft[]; summary: TwiseSummary; budget: BudgetSummary } {
  const { dimensions, sizes, allowed } = conversationOf(prepared);
  const settings = prepared.numericSettings ?? [];
  const reuse = settings.length > 0;
  const pool =
    reuse && dimensions.length === 0 && allowed.allowed([])
      ? [[]]
      : enumerateCells(
          sizes.filter((_, index) => dimensions.includes(index)),
          (cell) =>
            allowed.allowed(cell.map((value, index) => [dimensions[index] as number, value] as const)),
        );
  const selection = selectBudget(
    pool,
    dimensions.map((dimension) => sizes[dimension] ?? 0),
    options.budget,
    rngFor(context.seed, 'budget'),
    reuse,
  );
  const cells = selection.picked.map((index) =>
    dimensions.map((dimension, column): Pick => [dimension, pool[index]?.[column] ?? 0]),
  );
  const drafts = rowDrafts(prepared, context, cells, 'budget');
  const picked = selection.picked.length;
  let numeric: BudgetSummary['numeric'];
  if (reuse) {
    if (picked === 0) throw new RangeError('numeric budget has no allowed categorical cell');
    const slices = selection.picked.map((index) => JSON.stringify(pool[index]));
    const rows = drafts.map((draft, index) => ({
      spec: draft.id,
      cell: Object.fromEntries(
        (cells[index] ?? []).map(([dimension, value]) => [
          dimensionId(prepared, dimension),
          valueId(prepared, dimension, value),
        ]),
      ),
      quantiles: {} as Record<string, number>,
      vars: {} as Record<string, number>,
    }));
    for (const setting of settings) {
      const quantiles = slicedLhs(rngFor(context.seed, `budget:numeric:${setting.id}`), 0, 1, picked, slices);
      quantiles.forEach((quantile, index) => {
        const row = rows[index];
        if (!row) return;
        row.quantiles[setting.id] = quantile;
        row.vars[setting.id] = setting.integer
          ? Math.ceil(setting.min) +
            Math.floor(quantile * (Math.floor(setting.max) - Math.ceil(setting.min) + 1))
          : setting.min + quantile * (setting.max - setting.min);
      });
    }
    drafts.forEach((draft, index) => {
      draft.vars = rows[index]?.vars;
    });
    numeric = {
      settings: settings.map(({ id, min, max, integer, unit }) => ({
        id,
        min,
        max,
        integer: integer ?? false,
        ...(unit === undefined ? {} : { unit }),
      })),
      rows,
    };
  }
  const share = selection.pairs.allowed === 0 ? 0 : selection.pairs.covered / selection.pairs.allowed;
  const summary: TwiseSummary = {
    t: 2,
    dimensions: dimensions.map((dimension) => dimensionId(prepared, dimension)),
    rows: picked,
    allowed: selection.pairs.allowed,
    covered: selection.pairs.covered,
    share,
    unreachable: unreachablePairs(prepared)
      .filter((pair) => pair.every(([dimension]) => dimensions.includes(dimension)))
      .map((pair) =>
        pair
          .map(
            ([dimension, value]) =>
              `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
          )
          .join(' & '),
      ),
  };
  const values = dimensions.map((dimension, column) => {
    const allowedCount = selection.allowedValues[column] ?? 0;
    const fair = allowedCount === 0 ? 0 : picked / allowedCount;
    const present = (value: number) => (pool.some((row) => row[column] === value) ? value : -1);
    const rows = range(sizes[dimension] ?? 0)
      .map(present)
      .filter((value) => value >= 0)
      .map((value) => {
        const count = selection.counts[column]?.[value] ?? 0;
        return {
          value: valueId(prepared, dimension, value),
          count,
          fair,
          deviation: count - fair,
        };
      });
    return { dimension: dimensionId(prepared, dimension), allowed: allowedCount, values: rows };
  });
  const maxDeviation = Math.max(
    0,
    ...values.flatMap((entry) => entry.values.map((value) => Math.abs(value.deviation))),
  );
  const budget: BudgetSummary = {
    budget: options.budget,
    seed: context.seed,
    dimensions: summary.dimensions,
    pool: pool.length,
    picked,
    capped: !reuse && options.budget > pool.length,
    pairs: { ...selection.pairs, share },
    values,
    maxDeviation,
    ...(numeric === undefined ? {} : { numeric }),
  };
  return { drafts, summary, budget };
}

/**
 * A conversation over one cell: the given values, completed with a seeded allowed choice of every other
 * value but the stage graph's (the details inside the cell), the tool answers its data values state, an
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
  cell = withDetails(prepared, cell, rng);
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
    // The reply stays in the language the map fixes for every reply; without that rule, in the language the
    // conversation declared. Never the language of the switched message.
    const declared = draft.blocks.find((candidate) => candidate.stimulus.kind === 'phrase');
    const lang = declared?.stimulus.kind === 'phrase' ? declared.stimulus.phrase.lang : undefined;
    const bank = prepared.relations.replyLanguage ?? lang ?? mostFrequentLang(prepared);
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
  options: { useBindings?: boolean } = {},
): { world?: WorldState; unsupported: string[] } {
  const byTool = new Map<
    string,
    Array<{ path: string[]; schema: Record<string, unknown>; partition: string; bindings?: string[] }>
  >();
  for (const [dimension, value] of cell) {
    const found = prepared.toolDimensions.get(dimension);
    if (found?.direction !== 'out') continue;
    const partition = partitionOf(dimensionId(prepared, dimension), valueId(prepared, dimension, value));
    byTool.set(found.tool.name, [
      ...(byTool.get(found.tool.name) ?? []),
      {
        path: found.path,
        schema: found.schema,
        partition,
        ...(options.useBindings
          ? {
              bindings: Object.values(
                prepared.relations.binds.get(
                  `${dimensionId(prepared, dimension)}=${valueId(prepared, dimension, value)}`,
                ) ?? {},
              ),
            }
          : {}),
      },
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
 * One spec per value of every detail data dimension, inside a cell of context axes. On a tool's output, the tool answers with the value (its
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
  // A tool a path names as its end-state source changes the world: the map calls it on a move of a flow,
  // never on a request alone.
  const sideEffecting = new Set(
    prepared.relations.paths.flatMap((path) =>
      path.end_state ? [path.end_state.source.replace(/^tool:/, '')] : [],
    ),
  );
  prepared.space.dimensions.forEach((dimension, index) => {
    if (dimension.kind !== 'data' || prepared.axes.has(index)) return;
    dimension.values.forEach((value, position) => {
      if (value.id === NONE || drafts.length >= context.max) return;
      const id = `gen-boundary-${pad(drafts.length + 1)}`;
      const rng = rngFor(context.seed, id);
      const target: Pick = [index, position];
      const found = prepared.toolDimensions.get(index);
      if (hasPaths(prepared) && !found) {
        const built = boundaryScenario(prepared, context, id, dimension.id, value.id, target);
        if ('draft' in built) {
          drafts.push(built.draft);
          return;
        }
        const old = oldBoundary(prepared, context, id, rng, index, position, value.title);
        drafts.push(withReasons(old, built.reasons));
        return;
      }
      const partition = partitionOf(dimension.id, value.id);
      const cell: Pick[] = [target];
      const tools: ToolExpect[] = [];
      const concrete: Record<string, unknown> = {};
      const effect = found !== undefined && sideEffecting.has(found.tool.name);
      if (effect && hasPaths(prepared)) {
        // The value on a path that calls the tool on its move, when a path reads it; the spec records the
        // concrete value as every boundary spec does.
        const built = boundaryScenario(prepared, context, id, dimension.id, value.id, target);
        if ('draft' in built) {
          const shown = concreteValue((found as NonNullable<typeof found>).schema, partition);
          if (shown.kind === 'value') built.draft.concrete = { [value.id]: shown.value };
          else if (shown.kind === 'absent') built.draft.concrete = { [value.id]: '(absent)' };
          toolValues += 1;
          drafts.push(built.draft);
          return;
        }
      }
      if (found?.direction === 'out' && hasPaths(prepared)) {
        // A returned value the map says a reply states: the walk's turn that calls the tool answers with
        // the value, and its Then states it. A call with no reply, or a reply with another value, fails.
        const built = statedScenario(prepared, context, id, rng, dimension.id, value.id, target);
        if ('draft' in built) {
          const shown = concreteValue(found.schema, partition);
          if (shown.kind === 'value') built.draft.concrete = { [value.id]: shown.value };
          toolValues += 1;
          drafts.push(built.draft);
          return;
        }
      }
      if (found && effect) {
        toolValues += 1;
        const shown = concreteValue(found.schema, partition);
        if (shown.kind === 'value') concrete[value.id] = shown.value;
        else if (shown.kind === 'absent') concrete[value.id] = '(absent)';
        else unsupported.push(`${value.id}: ${shown.why}`);
        // Asked for alone, the side-effecting tool never runs.
        tools.push({ label: found.tool.name, count: 0 });
      } else if (found) {
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
      // Every other tool of the map is expected 0 times: the turn asks for one tool and nothing else.
      if (found) {
        for (const other of prepared.tools) {
          if (other.name !== found.tool.name) tools.push({ label: other.name, count: 0 });
        }
      }
      const world = worldFor(prepared, cell);
      cell.push(...contextAxes(prepared, cell, rng));
      unsupported.push(...world.unsupported.filter((entry) => !unsupported.includes(entry)));
      const criteria = found ? [] : [draftCriterion(prepared, target)];
      // A block whose every call count is 0 asserts nothing a reply that does nothing fails: a constant,
      // an echo and a copy of the Given all pass it. The map supplies no word or stage for a refusal, so
      // the spec has no machine Then and goes to incomplete/.
      const forbidsOnly = found !== undefined && tools.length > 0 && tools.every((tool) => tool.count === 0);
      if (forbidsOnly && hasPaths(prepared)) {
        // A request that only forbids calls is passed by a reply that does nothing. Said after the walk's
        // first move, the conversation must also stay on the stage it reached: a reply that does nothing
        // for the walk fails.
        const built = scenarioDraft(
          prepared,
          context,
          id,
          'boundary',
          `Boundary value ${value.id}`,
          [target],
          { preferred: prepared.relations.paths.filter((path) => path.stages.length >= 3), others: [] },
          { turn: { stimulus: choosePhrase(prepared, rng, [target]), carries: [target], tools } },
        );
        if ('draft' in built) {
          if (Object.keys(concrete).length > 0) built.draft.concrete = concrete;
          drafts.push(built.draft);
          return;
        }
      }
      const draft: SpecDraft = {
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
            ...(prepared.relations.replyLanguage === undefined
              ? {}
              : { lang: prepared.relations.replyLanguage }),
            ...(criteria.length > 0 ? { criteria: criteria.map((criterion) => criterion.name) } : {}),
          },
        ],
        ...(world.world ? { world: world.world } : {}),
        criteria,
        ...(Object.keys(concrete).length > 0 ? { concrete } : {}),
      };
      drafts.push(
        forbidsOnly
          ? withReasons(draft, [
              `${value.id}: the block only forbids tool calls, which a reply that does nothing passes`,
            ])
          : draft,
      );
    });
  });
  return { drafts, summary: { values: drafts.length, tools: toolValues, unsupported } };
}

/**
 * A data value on the map's paths: a path whose `when` needs the value, walked with it; a value that names a
 * tool the map recovers from, as that tool's failure on a path of a flow with the recovery.
 */
function boundaryScenario(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  dimension: string,
  value: string,
  target: Pick,
): PathTry {
  const title = `Boundary value ${dimension}=${value}`;
  const tool = prepared.tools.some((entry) => entry.name === value)
    ? prepared.relations.recoveries.some((entry) => entry.class === TOOL_FAILURE && entry.tool === value)
    : false;
  if (tool) {
    const flows = new Set(
      prepared.relations.recoveries
        .filter((entry) => entry.class === TOOL_FAILURE && entry.tool === value)
        .flatMap((entry) => entry.flows),
    );
    return scenarioDraft(
      prepared,
      context,
      id,
      'boundary',
      title,
      [target],
      { preferred: prepared.relations.paths.filter((path) => flows.has(path.flow)), others: [] },
      { probe: { classId: TOOL_FAILURE, tool: value } },
    );
  }
  const needing = prepared.relations.paths.filter((path) => path.when?.[dimension]?.includes(value));
  if (needing.length === 0) return { reasons: [`no approved path needs ${dimension}=${value}`] };
  return scenarioDraft(prepared, context, id, 'boundary', title, [target], {
    preferred: needing,
    others: [],
  });
}

/**
 * A tool output value on a path whose reply states it: a path of a flow with a `states` relation that reads a
 * slot the value binds, walked through that relation's move, with the tool's other outputs drawn under the
 * constraints so every stated slot is bound.
 */
function statedScenario(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  rng: Rng,
  dimension: string,
  value: string,
  target: Pick,
): PathTry {
  const bound = Object.keys(prepared.relations.binds.get(`${dimension}=${value}`) ?? {});
  const stating = prepared.relations.states.filter(
    (entry) =>
      entry.subject.dimension === 'flow' &&
      slotsOf([entry.must, entry.must_not]).some((slot) => bound.includes(slot)),
  );
  if (stating.length === 0) return { reasons: [`no approved reply states ${dimension}=${value}`] };
  const crosses = (path: PathRelation) =>
    stating.some(
      (entry) =>
        entry.subject.value === path.flow &&
        path.stages.some(
          (stage, index) =>
            stage === entry.stage && (entry.to === undefined || path.stages[index + 1] === entry.to),
        ),
    );
  const tool = prepared.toolDimensions.get(target[0])?.tool.name;
  const fixed: Pick[] = [target];
  for (const [other, otherValue] of prepared.feasibility.complete([target], rng)?.entries() ?? []) {
    const sibling = prepared.toolDimensions.get(other);
    if (other !== target[0] && sibling?.tool.name === tool && sibling?.direction === 'out')
      fixed.push([other, otherValue]);
  }
  return scenarioDraft(prepared, context, id, 'boundary', `Boundary value ${value}`, fixed, {
    preferred: prepared.relations.paths.filter(crosses),
    others: [],
  });
}

/** A data value the paths cannot place: one block with its phrase, or a placeholder, and judged criteria. */
function oldBoundary(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  rng: Rng,
  index: number,
  position: number,
  title: string,
): SpecDraft {
  const target: Pick = [index, position];
  const cell: Pick[] = [target, ...contextAxes(prepared, [target], rng)];
  const criterion = draftCriterion(prepared, target);
  return {
    id,
    seeder: 'boundary',
    title: `Boundary value ${valueId(prepared, index, position)}: ${title}`,
    stream: streamSeed(context.seed, id),
    cell,
    blocks: [
      {
        id: 'b1-value',
        stimulus: choosePhrase(prepared, rng, [target]),
        carries: [target],
        criteria: [criterion.name],
      },
    ],
    criteria: [criterion],
  };
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
        drafts.push(built.draft);
        const injected = built.draft.blocks.findIndex((block) => block.injection === value.id);
        const path = built.path.stages;
        const first = injected < 0 ? null : (path[injected] ?? null);
        probes.push({ class: value.id, stage: first, spec: id, phrase });
        // The class again at the latest other stage a path allows: a recovery that goes to the goal stage
        // looks the same as staying when the probe is already at the goal, so one stage proves nothing.
        const stages = prepared.space.dimensions[prepared.stage ?? -1]?.values.map((entry) => entry.id) ?? [];
        for (const stage of [...stages].reverse()) {
          if (stage === first || drafts.length >= context.max) continue;
          const again = `gen-deviation-${pad(drafts.length + 1)}`;
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
          drafts.push(other.draft);
          break;
        }
        continue;
      }
      const fallback = probeDraft(prepared, context, id, 'deviation', deviation, anchors);
      drafts.push(withReasons(fallback.draft, built.reasons));
      probes.push({ class: value.id, stage: null, spec: id, phrase });
      continue;
    }
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
  let families = 0;
  if (hasPaths(prepared)) return metamorphicOnPaths(prepared, context);
  for (const [key, phrases] of prepared.phrasesOf) {
    if (phrases.length < 2 || drafts.length >= context.max) continue;
    const target = pickOf(prepared, phrases[0] as (typeof phrases)[number]);
    if (!target || target[0] === prepared.stage || target[0] === prepared.transition) continue;
    families += 1;
    values.push(key);
    const family = `gen-metamorphic-${pad(families)}`;
    phrases.forEach((phrase, variant) => {
      const id = `${family}-${variant + 1}`;
      const stimulus = { kind: 'phrase' as const, phrase };
      const contextFor: SeedContext = { ...context };
      const draft =
        target[0] === prepared.deviation
          ? probeDraft(prepared, contextFor, family, 'metamorphic', target, anchors, { stimulus }).draft
          : carrierDraft(prepared, contextFor, family, 'metamorphic', '', [target], { stimulus });
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

/**
 * Metamorphic families on the map's paths: the phrasings of one value that fit the same cells and state the
 * same slot values form a family; each variant walks the same path, in the same cell, with the same draws,
 * and says that value with its own phrasing. The Then is the same by construction; the gate checks that the
 * agent's outcome is too.
 */
function metamorphicOnPaths(
  prepared: PreparedMap,
  context: SeedContext,
): { drafts: SpecDraft[]; summary: MetamorphicSummary } {
  const drafts: SpecDraft[] = [];
  const values: string[] = [];
  let families = 0;
  const transitionKey =
    prepared.transition === undefined ? undefined : dimensionId(prepared, prepared.transition);
  const deviationKey =
    prepared.deviation === undefined ? undefined : dimensionId(prepared, prepared.deviation);
  for (const [key, phrases] of prepared.phrasesOf) {
    if (drafts.length >= context.max) break;
    const groups = new Map<string, ProposalPhrase[]>();
    for (const phrase of phrases) {
      const group = JSON.stringify([phrase.when ?? null, phrase.binds ?? null]);
      groups.set(group, [...(groups.get(group) ?? []), phrase]);
    }
    for (const members of groups.values()) {
      if (members.length < 2 || drafts.length >= context.max) continue;
      const first = members[0] as ProposalPhrase;
      const target = pickOf(prepared, first);
      if (!target || target[0] === prepared.stage) continue;
      let candidates: PathRelation[] = [];
      let probe: ProbeRequest | undefined;
      if (first.dimension === transitionKey) {
        candidates = prepared.relations.paths.filter((path) =>
          path.stages.some((stage, index) => `${stage}-to-${path.stages[index + 1]}` === first.value),
        );
      } else if (first.dimension === deviationKey) {
        candidates = prepared.relations.paths;
        probe = { classId: first.value };
      } else if (first.dimension === 'flow') {
        // A flow phrase opens a path of its flow: the first turn says it in place of the opening move.
        candidates = prepared.relations.paths.filter((path) => path.flow === first.value);
      }
      families += 1;
      values.push(key);
      const family = `gen-metamorphic-${pad(families)}`;
      members.forEach((phrase, variant) => {
        const id = `${family}-${variant + 1}`;
        const title = `Metamorphic ${key}, phrasing ${variant + 1} of ${members.length}`;
        const built =
          candidates.length === 0
            ? { reasons: [`no approved path says ${key}`] }
            : scenarioDraft(
                prepared,
                context,
                id,
                'metamorphic',
                title,
                [],
                { preferred: candidates, others: [] },
                { force: phrase, rngLabel: family, ...(probe ? { probe } : {}) },
              );
        const metamorphic = {
          family,
          variant: variant + 1,
          of: members.length,
          relation: 'same observed outcome',
        };
        if ('draft' in built) {
          drafts.push({ ...built.draft, metamorphic });
          return;
        }
        const old = carrierDraft(prepared, { ...context }, family, 'metamorphic', '', [target], {
          stimulus: { kind: 'phrase', phrase },
        });
        drafts.push(withReasons({ ...old, id, title, metamorphic }, built.reasons));
      });
    }
  }
  // Context families, CheckList's invariance over the context axes: one path walked with the same data
  // values and each allowed value of a persona or channel axis. The relation: the same observed outcome.
  const contextual = [...prepared.axes]
    .sort((a, b) => a - b)
    .filter((index) => ['persona', 'channel'].includes(prepared.space.dimensions[index]?.kind ?? ''));
  const indexOf = (id: string) => prepared.space.dimensions.findIndex((dimension) => dimension.id === id);
  for (const path of prepared.relations.paths) {
    for (const axis of contextual) {
      if (drafts.length >= context.max) break;
      const dimension = prepared.space.dimensions[axis];
      if (!dimension) continue;
      const family = `gen-metamorphic-${pad(families + 1)}`;
      const one = { preferred: [path], others: [] };
      const base = scenarioDraft(prepared, context, `${family}-base`, 'metamorphic', '', [], one, {
        rngLabel: family,
      });
      if (!('draft' in base)) continue;
      const read = Object.keys(path.when ?? {}).map(indexOf);
      const data = base.draft.cell.filter(([at]) => read.includes(at));
      const members = dimension.values
        .map((_, value) => value)
        .filter((value) => prepared.feasibility.allowed([...data, [axis, value]]));
      if (members.length < 2) continue;
      const built = members.map((value, variant) =>
        scenarioDraft(
          prepared,
          context,
          `${family}-${variant + 1}`,
          'metamorphic',
          '',
          [...data, [axis, value]],
          one,
          {
            rngLabel: family,
          },
        ),
      );
      if (!built.every((entry) => 'draft' in entry)) continue;
      families += 1;
      values.push(`${path.id}@${dimension.id}`);
      built.forEach((entry, variant) => {
        if (!('draft' in entry)) return;
        drafts.push({
          ...entry.draft,
          id: `${family}-${variant + 1}`,
          title: `Metamorphic ${path.id} over ${dimension.id}, value ${variant + 1} of ${members.length}: ${entry.draft.title}`,
          metamorphic: {
            family,
            variant: variant + 1,
            of: members.length,
            relation: 'same observed outcome',
          },
        });
      });
    }
  }
  return { drafts, summary: { families, specs: drafts.length, values } };
}

/**
 * One scenario aimed at one allowed cell of the axis map (a pair or a triple of values) that no complete spec
 * covers. Every value of the cell is fixed in the scenario's cell except the stage and the deviation: a
 * deviation is a probe, at the cell's stage when the cell names one; a stage alone is reached by a path that
 * passes it. The start stage is placed only by an event said there, so a stage-only cell on a start stage
 * takes a probe of a class a first message can carry. Returns the draft, or every reason no path fits.
 */
export function coverDraft(
  prepared: PreparedMap,
  context: SeedContext,
  id: string,
  values: Readonly<Record<string, string>>,
): PathTry {
  const fixed: Pick[] = [];
  let stage: string | undefined;
  let deviation: string | undefined;
  let behaviour: string | undefined;
  for (const [dimensionKey, value] of Object.entries(values)) {
    const index = prepared.space.dimensions.findIndex((dimension) => dimension.id === dimensionKey);
    const dimension = prepared.space.dimensions[index];
    if (!dimension) return { reasons: [`${dimensionKey} is not a dimension of the map`] };
    if (index === prepared.stage || dimension.kind === 'stage') {
      stage = value;
      continue;
    }
    if (index === prepared.deviation) {
      if (value !== NONE) deviation = value;
      continue;
    }
    const at = dimension.index.get(value);
    if (at === undefined) return { reasons: [`${dimensionKey}=${value} is not a value of the map`] };
    if (dimension.kind === 'behaviour') behaviour = value;
    fixed.push([index, at]);
  }
  const key = Object.entries(values)
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(', ');
  const paths = prepared.relations.paths.filter((path) => {
    if (stage === undefined) return true;
    const position = path.stages.indexOf(stage);
    // A probe goes in before a move, so its stage is never the last of the path; a walk reaches any
    // stage after the first.
    if (deviation !== undefined) return position >= 0;
    return position >= 0;
  });
  const startOnly =
    stage !== undefined &&
    deviation === undefined &&
    paths.length > 0 &&
    paths.every((path) => path.stages.indexOf(stage as string) === 0);
  const classes =
    deviation !== undefined
      ? [deviation]
      : startOnly
        ? [...OPENING_CLASSES].filter((cls) =>
            prepared.space.dimensions[prepared.deviation ?? -1]?.index.has(cls),
          )
        : [undefined];
  const reasons: string[] = [];
  /** The cell values a phrase of the class needs (its `when`, the stage and the flow left out), one set each. */
  const needs = (classId: string | undefined): Pick[][] => {
    if (classId === undefined || prepared.deviation === undefined) return [[]];
    const phraseOf = phraseKey(dimensionId(prepared, prepared.deviation), classId);
    const sets: Pick[][] = [[]];
    for (const phrase of prepared.phrasesOf.get(phraseOf) ?? []) {
      let options: Pick[][] = [[]];
      for (const [dimensionKey, values] of Object.entries(phrase.when ?? {})) {
        if (dimensionKey === 'stage' || dimensionKey === 'flow') continue;
        const index = prepared.space.dimensions.findIndex((dimension) => dimension.id === dimensionKey);
        if (index < 0 || fixed.some(([at]) => at === index)) continue;
        options = options.flatMap((set) =>
          values.flatMap((value) => {
            const at = prepared.space.dimensions[index]?.index.get(value);
            return at === undefined ? [] : [[...set, [index, at] as Pick]];
          }),
        );
      }
      for (const set of options) if (set.length > 0) sets.push(set);
    }
    return sets;
  };
  const attempts = classes.flatMap((classId) => needs(classId).map((extra) => ({ classId, extra })));
  for (const { classId, extra } of attempts) {
    const built = scenarioDraft(
      prepared,
      context,
      id,
      'cover',
      `Cell ${key}`,
      [...fixed, ...extra],
      preferring(paths, behaviour),
      {
        ...(classId === undefined ? {} : { probe: { classId, ...(stage ? { stage } : {}) } }),
      },
    );
    if ('draft' in built) {
      if (classId !== undefined) {
        const dimension = prepared.deviation as number;
        built.draft.cell.push([dimension, prepared.space.dimensions[dimension]?.index.get(classId) ?? 0]);
      }
      return built;
    }
    reasons.push(...built.reasons);
  }
  if (paths.length === 0) reasons.push(`no approved path passes the stage ${stage}`);
  return { reasons: reasons.length > 0 ? reasons : [`no approved path fits the cell ${key}`] };
}

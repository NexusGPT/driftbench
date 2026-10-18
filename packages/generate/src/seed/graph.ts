import type { Partial } from './feasible';
import { type PreparedMap, valueId } from './map';
import { pick, type Rng } from './random';

/**
 * The stage graph and its edge-covering walk (GraphWalker's model-based testing with the stop condition
 * edge_coverage(100)). Vertices are the values of the stage dimension; edges are the values of the
 * `stage_transition` dimension, `<from>-to-<to>`. The walk starts at the stage no edge enters (the first
 * in map order when several do), and builds paths until every edge reachable from it is on a path.
 *
 * The constraint list rides along: a path is a spec, and a spec places each of its transitions with each
 * of its stages (space placement rules), so a path keeps only the edges for which some value of every
 * dimension the constraints tie to the stage or the transition (in Acme: the flow) allows the whole path.
 */

export type Edge = {
  /** The transition value id, such as `identify-to-offer`. */
  id: string;
  from: string;
  to: string;
  /** The value index in the transition dimension. */
  value: number;
};

export type StageGraph = {
  stages: string[];
  start: string | undefined;
  edges: Edge[];
  /** Transition values whose id names no `<stage>-to-<stage>` pair of the map. */
  unparsed: string[];
};

export type GraphPath = {
  edges: Edge[];
  /** The values chosen for the dimensions the constraints tie to the stage graph. */
  context: Array<readonly [dimension: number, value: number]>;
};

export type GraphWalk = {
  paths: GraphPath[];
  covered: string[];
  /** Edges no path from the start reaches. */
  unreachable: string[];
  /** Reachable edges no path could take without breaking a constraint. */
  blocked: string[];
};

/** The graph read from the map. Undefined when the map has no stage dimension. */
export function stageGraph(prepared: PreparedMap): StageGraph | undefined {
  if (prepared.stage === undefined) return undefined;
  const stages = prepared.space.dimensions[prepared.stage]?.values.map((value) => value.id) ?? [];
  const edges: Edge[] = [];
  const unparsed: string[] = [];
  const transition = prepared.transition;
  const values = transition === undefined ? [] : (prepared.space.dimensions[transition]?.values ?? []);
  // A transition id is `<from>-to-<to>`. Stage ids may hold `-to-` themselves, so every split is tried;
  // the pair kept is the first in stage order (from, then to), read through an index instead of crossing
  // every stage with every stage for each transition.
  const order = new Map(stages.map((stage, index) => [stage, index]));
  values.forEach((value, index) => {
    let pair: { from: string; to: string } | undefined;
    let rank: [number, number] | undefined;
    for (let at = value.id.indexOf('-to-'); at >= 0; at = value.id.indexOf('-to-', at + 1)) {
      const from = value.id.slice(0, at);
      const to = value.id.slice(at + 4);
      const a = order.get(from);
      const b = order.get(to);
      if (a === undefined || b === undefined) continue;
      if (rank === undefined || a < rank[0] || (a === rank[0] && b < rank[1])) {
        pair = { from, to };
        rank = [a, b];
      }
    }
    if (pair) edges.push({ id: value.id, from: pair.from, to: pair.to, value: index });
    else unparsed.push(value.id);
  });
  const entered = new Set(edges.filter((edge) => edge.from !== edge.to).map((edge) => edge.to));
  const start = stages.find((stage) => !entered.has(stage)) ?? stages[0];
  return { stages, start, edges, unparsed };
}

/** Walks the graph until every reachable edge is covered, or `maxLength` edges per path, `maxPaths` paths. */
export function walkGraph(
  prepared: PreparedMap,
  graph: StageGraph,
  rng: Rng,
  limits: { maxLength: number; maxPaths: number },
): GraphWalk {
  const start = graph.start;
  const reachable = new Set<string>();
  if (start !== undefined) {
    const seen = new Set([start]);
    const queue = [start];
    for (let stage = queue.shift(); stage !== undefined; stage = queue.shift()) {
      for (const edge of graph.edges.filter((candidate) => candidate.from === stage)) {
        reachable.add(edge.id);
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
  }
  const unreachable = graph.edges.filter((edge) => !reachable.has(edge.id)).map((edge) => edge.id);
  const uncovered = new Set(graph.edges.filter((edge) => reachable.has(edge.id)).map((edge) => edge.id));
  const contexts = contextsOf(prepared);
  const paths: GraphPath[] = [];
  const covered: string[] = [];

  while (start !== undefined && uncovered.size > 0 && paths.length < limits.maxPaths) {
    let alive = contexts.filter((context) => fits(prepared, context, [start], []));
    const edges: Edge[] = [];
    let current = start;
    let progressed = false;
    while (edges.length < limits.maxLength) {
      const stages = [start, ...edges.map((edge) => edge.to)];
      const extend = (edge: Edge) =>
        alive.filter((context) => fits(prepared, context, [...stages, edge.to], [...edges, edge]));
      const options = graph.edges.filter((edge) => edge.from === current && extend(edge).length > 0);
      let next = pick(
        rng,
        options.filter((edge) => uncovered.has(edge.id)),
      );
      if (!next) {
        const route = routeToUncovered(graph, current, uncovered);
        const first = route?.[0];
        next = first && options.some((edge) => edge.id === first.id) ? first : undefined;
      }
      if (!next) break;
      alive = extend(next);
      edges.push(next);
      current = next.to;
      if (uncovered.delete(next.id)) {
        covered.push(next.id);
        progressed = true;
      }
    }
    if (!progressed) break;
    const context = pick(rng, alive) ?? [];
    paths.push({ edges, context: [...context] });
  }
  return { paths, covered, unreachable, blocked: [...uncovered] };
}

/** Every combination of values of the dimensions a constraint ties to the stage or the transition. */
function contextsOf(prepared: PreparedMap): Partial[] {
  const graphDimensions = [prepared.stage, prepared.transition].filter(
    (dimension): dimension is number => dimension !== undefined,
  );
  const tied = new Set<number>();
  for (const constraint of prepared.space.constraints) {
    const dimensions = constraint.map(([dimension]) => dimension);
    if (!dimensions.some((dimension) => graphDimensions.includes(dimension))) continue;
    for (const dimension of dimensions) if (!graphDimensions.includes(dimension)) tied.add(dimension);
  }
  let contexts: Array<Array<[number, number]>> = [[]];
  for (const dimension of [...tied].sort((a, b) => a - b)) {
    const size = prepared.space.dimensions[dimension]?.values.length ?? 0;
    contexts = contexts.flatMap((context) =>
      Array.from({ length: size }, (_, value) => [...context, [dimension, value] as [number, number]]),
    );
    if (contexts.length > 10_000) throw new RangeError('too many value combinations tie to the stage graph');
  }
  return contexts;
}

/** True when the context allows every stage of the path with every transition of it, and each alone. */
function fits(prepared: PreparedMap, context: Partial, stages: string[], edges: Edge[]): boolean {
  const stage = prepared.stage;
  const transition = prepared.transition;
  const stageValue = (id: string) => prepared.space.dimensions[stage ?? -1]?.index.get(id);
  for (const id of new Set(stages)) {
    const value = stageValue(id);
    if (stage === undefined || value === undefined) continue;
    const base: Array<readonly [number, number]> = [...context, [stage, value]];
    if (!prepared.feasibility.allowed(base)) return false;
    for (const edge of edges) {
      if (transition === undefined) continue;
      if (!prepared.feasibility.allowed([...base, [transition, edge.value]])) return false;
    }
  }
  return true;
}

/** The shortest route from a stage to an edge still uncovered, ignoring constraints; undefined when none. */
function routeToUncovered(
  graph: StageGraph,
  from: string,
  uncovered: ReadonlySet<string>,
): Edge[] | undefined {
  const back = new Map<string, Edge>();
  const seen = new Set([from]);
  const queue = [from];
  for (let stage = queue.shift(); stage !== undefined; stage = queue.shift()) {
    const out = graph.edges.filter((edge) => edge.from === stage);
    const target = out.find((edge) => uncovered.has(edge.id));
    if (target) {
      const route = [target];
      for (let at = stage; at !== from; ) {
        const edge = back.get(at);
        if (!edge) break;
        route.unshift(edge);
        at = edge.from;
      }
      return route;
    }
    for (const edge of out) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      back.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  return undefined;
}

/** The value ids of a path's context, as dimension id to value id. */
export function contextValues(prepared: PreparedMap, path: GraphPath): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dimension, value] of path.context) {
    const id = prepared.space.dimensions[dimension]?.id;
    if (id) out[id] = valueId(prepared, dimension, value);
  }
  return out;
}

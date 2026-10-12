import { describe, expect, it } from 'vitest';
import { stageGraph, walkGraph } from '../../src/seed/graph';
import { prepareMap } from '../../src/seed/map';
import { rngFor } from '../../src/seed/random';
import { ZED_TOOLS, zedPrepared, zedProposal } from '../enumerate/support';

describe('stageGraph', () => {
  it('reads stages as vertices and stage_transition values as edges', () => {
    const graph = stageGraph(zedPrepared());
    expect(graph?.stages).toEqual(['greet', 'verify', 'help', 'lost']);
    expect(graph?.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual([
      'greet>verify',
      'verify>verify',
      'verify>help',
      'help>verify',
      'lost>help',
    ]);
    // greet and lost have no incoming edge; greet comes first in the map.
    expect(graph?.start).toBe('greet');
    expect(graph?.unparsed).toEqual(['greet-to-nowhere']);
  });
});

describe('stageGraph on stage ids that hold -to- themselves', () => {
  it('splits each transition at every -to- and keeps the first pair in stage order', () => {
    const prepared = zedPrepared();
    const stage = prepared.space.dimensions[prepared.stage ?? -1];
    const transition = prepared.space.dimensions[prepared.transition ?? -1];
    if (!stage || !transition) throw new Error('no stage dimensions');
    const ids = ['a', 'a-to-b', 'b', 'b-to-c', 'c'];
    stage.values = ids.map((id) => ({ ...stage.values[0], id })) as typeof stage.values;
    transition.values = ['a-to-b-to-c', 'a-to-b', 'b-to-c-to-a', 'x-to-y'].map((id) => ({
      ...transition.values[0],
      id,
    })) as typeof transition.values;
    const graph = stageGraph(prepared);
    expect(graph?.edges.map((edge) => [edge.id, edge.from, edge.to])).toEqual([
      ['a-to-b-to-c', 'a', 'b-to-c'],
      ['a-to-b', 'a', 'b'],
      ['b-to-c-to-a', 'b-to-c', 'a'],
    ]);
    expect(graph?.unparsed).toEqual(['x-to-y']);
  });
});

describe('walkGraph', () => {
  it('covers every edge reachable from the start, and names the unreachable one', () => {
    const prepared = zedPrepared();
    const graph = stageGraph(prepared);
    if (!graph) throw new Error('no graph');
    const walk = walkGraph(prepared, graph, rngFor(1, 'graph'), { maxLength: 12, maxPaths: 100 });
    expect([...walk.covered].sort()).toEqual([
      'greet-to-verify',
      'help-to-verify',
      'verify-to-help',
      'verify-to-verify',
    ]);
    expect(walk.unreachable).toEqual(['lost-to-help']);
    expect(walk.blocked).toEqual([]);
    for (const path of walk.paths) {
      expect(path.edges[0]?.from).toBe('greet');
      path.edges.slice(1).forEach((edge, index) => {
        expect(edge.from).toBe(path.edges[index]?.to);
      });
    }
  });

  it('keeps a path inside the constraints: a path that reaches help never carries the card flow', () => {
    const prepared = zedPrepared();
    const graph = stageGraph(prepared);
    if (!graph) throw new Error('no graph');
    const flow = prepared.space.dimensions.findIndex((dimension) => dimension.id === 'flow');
    for (const seed of [1, 2, 3, 4, 5]) {
      const walk = walkGraph(prepared, graph, rngFor(seed, 'graph'), { maxLength: 12, maxPaths: 100 });
      for (const path of walk.paths) {
        const reachesHelp = path.edges.some((edge) => edge.to === 'help');
        const chosen = path.context.find(([dimension]) => dimension === flow)?.[1];
        expect(chosen).toBeDefined();
        if (reachesHelp) expect(prepared.space.dimensions[flow]?.values[chosen ?? 0]?.id).toBe('balance');
      }
    }
  });

  it('reports an edge no value of the tied dimensions allows as blocked', () => {
    // Forbid help with the balance flow too: no flow can reach help any more.
    const proposal = zedProposal();
    proposal.constraints.push({
      forbid: { flow: 'balance', stage: 'help' },
      reason: 'test',
      evidence: { source: 'prompt.md', quote: 'Stages, in order: greet, verify, help.' },
      produced_by: 'model',
      approved: true,
    });
    const prepared = prepareMap(proposal, { tools: ZED_TOOLS });
    const graph = stageGraph(prepared);
    if (!graph) throw new Error('no graph');
    const walk = walkGraph(prepared, graph, rngFor(1, 'graph'), { maxLength: 12, maxPaths: 100 });
    expect(walk.blocked.sort()).toEqual(['help-to-verify', 'verify-to-help']);
    expect([...walk.covered].sort()).toEqual(['greet-to-verify', 'verify-to-verify']);
  });

  it('stops at maxPaths', () => {
    const prepared = zedPrepared();
    const graph = stageGraph(prepared);
    if (!graph) throw new Error('no graph');
    const walk = walkGraph(prepared, graph, rngFor(1, 'graph'), { maxLength: 1, maxPaths: 1 });
    expect(walk.paths).toHaveLength(1);
    expect(walk.paths[0]?.edges).toHaveLength(1);
    expect(walk.blocked.length).toBe(3);
  });
});

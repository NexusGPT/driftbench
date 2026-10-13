/** The boundary seeder: specs at the edges of each tool value. */

import type { ToolExpect } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import { choosePhrase, draftCriterion, type Pick, type SpecDraft } from './assemble';
import { TOOL_FAILURE } from './deviation';
import { type PreparedMap, partitionOf, valueId } from './map';
import { type Rng, rngFor, streamSeed } from './random';
import {
  contextAxes,
  hasPaths,
  type PathTry,
  pad,
  type SeedContext,
  scenarioDraft,
  withReasons,
  worldFor,
} from './seed-drafts';
import { concreteValue, INVALID_PARTITIONS, inputAssertion } from './values';

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

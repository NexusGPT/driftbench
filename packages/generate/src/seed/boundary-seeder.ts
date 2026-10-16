/** The boundary seeder: specs at the edges of each tool value. */

import { type Assertion, isPlainObject, type ToolExpect } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { PathRelation } from '../extract/proposal';
import { choosePhrase, draftCriterion, type Pick, type SpecDraft } from './assemble';
import { TOOL_FAILURE } from './deviation';
import { draftOutput } from './draft-output';
import { type PreparedMap, partitionOf, type ToolSchema, valueId } from './map';
import { type Rng, rngFor, streamSeed } from './random';
import { slotsOf } from './relations';
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
  const output = draftOutput(context);
  const drafts = output.drafts;
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
      if (value.id === NONE || output.count >= context.max) return;
      const id = `gen-boundary-${pad(output.count + 1)}`;
      const rng = rngFor(context.seed, id);
      const target: Pick = [index, position];
      const found = prepared.toolDimensions.get(index);
      if (hasPaths(prepared) && !found) {
        const built = boundaryScenario(prepared, context, id, dimension.id, value.id, target);
        if ('draft' in built) {
          output.push(built.draft);
          return;
        }
        const old = oldBoundary(prepared, context, id, rng, index, position, value.title);
        output.push(withReasons(old, built.reasons));
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
          output.push(built.draft);
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
          output.push(built.draft);
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
        // The values a run of the tool returns, completed with the cell: they join the cell.
        const returned = (tool: string) => {
          const full = prepared.feasibility.complete(cell, rng);
          for (const [other, otherValue] of full?.entries() ?? []) {
            const sibling = prepared.toolDimensions.get(other);
            if (other !== index && sibling?.tool.name === tool && sibling.direction === 'out') {
              cell.push([other, otherValue]);
            }
          }
        };
        if (found.direction === 'out') {
          returned(found.tool.name);
          // Asked to run the tool and report a returned value: one run, as a map's call is made once, with
          // each argument the user does not name at its schema default; closed when that names every one.
          const defaults = schemaDefaults(found.tool);
          tools.push({
            label: found.tool.name,
            count: 1,
            ...(Object.keys(defaults).length > 0 ? { input: defaults, input_closed: true } : {}),
          });
        } else if (INVALID_PARTITIONS.has(partition)) {
          tools.push({ label: found.tool.name, count: 0 });
        } else {
          // A request for one run of a tool calls it once, as a map's call is made once unless it says
          // otherwise. Its other arguments take their schema default; the input is closed when that names
          // every argument of the schema (assemble.ts closeKnownInputs).
          const assertion = inputAssertion(found.path, found.schema, partition);
          const name = found.path[0];
          // The run answers from the Given: the tool's returned values join the cell, so its reply has
          // facts a Then reads.
          returned(found.tool.name);
          tools.push({
            label: found.tool.name,
            count: 1,
            ...(assertion !== undefined && name !== undefined
              ? { input: { ...schemaDefaults(found.tool), [name]: assertion }, input_closed: true }
              : {}),
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
      const asked = tools.find((tool) => tool.label === found?.tool.name && tool.count !== 0);
      const field = found?.path[0];
      // Only an argument value is said after the move that calls the tool; a returned-value request carries
      // the schema defaults, which name no value of its own.
      if (found?.direction === 'in' && asked?.input && field !== undefined && hasPaths(prepared)) {
        // A request that makes a call is said right after the walk's move that calls the tool: the call
        // carries the arguments that move gives it, with this value in its field, and is made once.
        const calling = new Set(
          prepared.relations.usesTools
            .filter((use) => use.tool === found.tool.name && use.subject.dimension === 'flow')
            .map((use) => use.subject.value),
        );
        const built = scenarioDraft(
          prepared,
          context,
          id,
          'boundary',
          `Boundary value ${value.id}`,
          [target],
          {
            preferred: prepared.relations.paths.filter((path) => calling.has(path.flow)),
            others: [],
          },
          {
            turn: {
              stimulus: choosePhrase(prepared, rng, [target]),
              carries: [target],
              tools: tools.filter((tool) => tool !== asked),
              call: { tool: found.tool.name, field, value: asked.input[field] as Assertion },
            },
          },
        );
        if ('draft' in built) {
          if (Object.keys(concrete).length > 0) built.draft.concrete = concrete;
          output.push(built.draft);
          return;
        }
      }
      if (found !== undefined && hasPaths(prepared)) {
        // A request that only forbids calls is passed by a reply that does nothing. Said after the walk's
        // first move, the conversation must also stay on the stage it reached: a reply that does nothing
        // for the walk fails. A request that makes a call is said there too, so the turn checks the stage
        // it stays at and that the runtime reports it.
        const built = scenarioDraft(
          prepared,
          context,
          id,
          'boundary',
          `Boundary value ${value.id}`,
          // The tool's returned values go with the value, so the run answers with them.
          [
            target,
            ...cell.filter(
              ([at]) =>
                at !== index &&
                prepared.toolDimensions.get(at)?.tool.name === found.tool.name &&
                prepared.toolDimensions.get(at)?.direction === 'out',
            ),
          ],
          { preferred: prepared.relations.paths.filter((path) => path.stages.length >= 3), others: [] },
          {
            turn: {
              stimulus: choosePhrase(prepared, rng, [target]),
              carries: [target],
              tools,
              // A turn that runs the tool: its reply states the tool's returned fields.
              ...(asked ? { report: found.tool.name } : {}),
            },
          },
        );
        if ('draft' in built) {
          if (Object.keys(concrete).length > 0) built.draft.concrete = concrete;
          output.push(built.draft);
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
      output.push(
        forbidsOnly
          ? withReasons(draft, [
              `${value.id}: the block only forbids tool calls, which a reply that does nothing passes`,
            ])
          : draft,
      );
    });
  });
  return { drafts, summary: { values: output.count, tools: toolValues, unsupported } };
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

/** The top-level input arguments whose schema gives a `default`, at that default. */
function schemaDefaults(tool: ToolSchema): Record<string, Assertion> {
  const properties = tool.input?.properties;
  if (!isPlainObject(properties)) return {};
  const out: Record<string, Assertion> = {};
  for (const [key, schema] of Object.entries(properties)) {
    if (!isPlainObject(schema) || !Object.hasOwn(schema, 'default')) continue;
    const value = schema.default;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      out[key] = value as Assertion;
  }
  return out;
}

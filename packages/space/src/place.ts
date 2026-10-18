import type { Spec } from '@agent-nexus/driftbench-core';
import type { CompiledSpace } from './grid';
import { type DimensionKind, NONE } from './schema';

/**
 * Where a spec falls in the grid. A spec is cut into events: one per block and one per perturbation. A
 * spec covers a cell when one of its events places on every value of the cell. The placement rule per
 * dimension kind:
 *
 * - stage (per event): a block places on its `expect.stage`. A deviation (an injection block or a
 *   perturbation) places on the stage the conversation has reached when it arrives: the `expect.stage` of
 *   the nearest earlier block that declares one; when no earlier block does, its own `expect.stage`, and
 *   for a perturbation then its `recovery.stage_after`.
 * - deviation (per event): an injection block or a perturbation places on its class; any other block
 *   carries no deviation.
 * - behaviour (per spec): every id in `covers`.
 * - channel (per spec): `channel`.
 * - persona, data, task (per spec): the tags `persona:<id>`, `data:<id>` and `task:<id>`.
 *
 * A spec or event that names no value of a dimension places on its `none` value when the map lists one,
 * and nowhere on that dimension otherwise. A value the map does not list places nowhere, is reported, and
 * keeps its spec or event off `none` on every dimension of that kind, since it may belong to any of them.
 * Spec-level values combine with every event. `covers` names behaviours for the whole spec, so a spec
 * counts each of its behaviours at every stage it reaches: behaviour by stage cells are overstated until a
 * spec can tie a behaviour to a block.
 */

/** One block or perturbation of a spec, and the values it places on. */
export type PlacementEvent = {
  /** `blocks.<n>` or `perturbations.<n>`, counted from 0, like the loader's issue paths. */
  path: string;
  /** For each dimension of the map, in order: the indices of the values the event places on. */
  values: number[][];
};

/** A value a spec names that the map does not list, with where the spec names it. */
export type UnknownValue = { kind: DimensionKind; value: string; path: string };

export type SpecPlacement = { id: string; events: PlacementEvent[]; unknown: UnknownValue[] };

const TAG_KINDS = ['persona', 'data', 'task'] as const;
type TagKind = (typeof TAG_KINDS)[number];

/** The values a spec names on one kind, with the path where each is named. */
type Named = Array<{ value: string; path: string }>;

/** Places one valid spec on a compiled map. Pure: reads nothing, never throws. */
export function placeSpec(space: CompiledSpace, spec: Spec): SpecPlacement {
  const unknown: UnknownValue[] = [];
  const kinds = new Set(space.dimensions.map((dimension) => dimension.kind));

  const named = new Map<DimensionKind, Named>();
  named.set(
    'behaviour',
    (spec.covers ?? []).map((value, index) => ({ value, path: `covers.${index}` })),
  );
  named.set('channel', spec.channel === undefined ? [] : [{ value: spec.channel, path: 'channel' }]);
  for (const kind of TAG_KINDS) named.set(kind, tagged(spec, kind));

  // Spec-level kinds resolve once; stage and deviation resolve per event.
  const unlisted = new Set<DimensionKind>();
  for (const [kind, values] of named) {
    if (!kinds.has(kind)) continue;
    for (const { value, path } of values) {
      const listed = space.dimensions.some(
        (dimension) => dimension.kind === kind && dimension.index.has(value),
      );
      if (listed) continue;
      unknown.push({ kind, value, path });
      unlisted.add(kind);
    }
  }
  const fixed = space.dimensions.map((dimension) => {
    if (dimension.kind === 'stage' || dimension.kind === 'deviation') return [];
    return resolve(dimension.index, named.get(dimension.kind) ?? [], unlisted.has(dimension.kind));
  });

  const reached = spec.blocks.map((block) => block.expect?.stage);
  const arrival = (before: number): string | undefined => {
    for (let index = Math.min(before, reached.length) - 1; index >= 0; index -= 1) {
      const stage = reached[index];
      if (stage !== undefined) return stage;
    }
    return undefined;
  };

  const event = (path: string, stage: string | undefined, deviation: string | undefined): PlacementEvent => {
    const values = space.dimensions.map((dimension, index) => {
      if (dimension.kind !== 'stage' && dimension.kind !== 'deviation') return fixed[index] ?? [];
      const value = dimension.kind === 'stage' ? stage : deviation;
      const at = dimension.kind === 'stage' ? `${path}.stage` : `${path}.class`;
      const listed = value === undefined || dimension.index.has(value);
      if (!listed && value !== undefined) unknown.push({ kind: dimension.kind, value, path: at });
      return resolve(dimension.index, value === undefined ? [] : [{ value, path: at }], !listed);
    });
    return { path, values };
  };

  const events: PlacementEvent[] = [];
  spec.blocks.forEach((block, index) => {
    const path = `blocks.${index}`;
    if ('injection' in block.when) {
      events.push(event(path, arrival(index) ?? block.expect?.stage, block.when.injection.class));
    } else {
      events.push(event(path, block.expect?.stage, undefined));
    }
  });
  spec.perturbations?.forEach((perturbation, index) => {
    const stage =
      arrival(perturbation.inject_at) ?? perturbation.expect?.stage ?? perturbation.recovery?.stage_after;
    events.push(event(`perturbations.${index}`, stage, perturbation.class));
  });

  return { id: spec.id, events, unknown: dedupe(unknown) };
}

/** The listed values named, else `none` when the map lists it and nothing unlisted was named. */
function resolve(index: ReadonlyMap<string, number>, values: Named, unlisted: boolean): number[] {
  const out: number[] = [];
  for (const { value } of values) {
    const position = index.get(value);
    if (position !== undefined && !out.includes(position)) out.push(position);
  }
  if (out.length > 0 || unlisted) return out;
  const none = index.get(NONE);
  return none === undefined ? [] : [none];
}

function tagged(spec: Spec, kind: TagKind): Named {
  const prefix = `${kind}:`;
  const out: Named = [];
  (spec.tags ?? []).forEach((tag, index) => {
    if (tag.startsWith(prefix)) out.push({ value: tag.slice(prefix.length), path: `tags.${index}` });
  });
  return out;
}

function dedupe(values: UnknownValue[]): UnknownValue[] {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = `${entry.kind}\u0000${entry.value}\u0000${entry.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

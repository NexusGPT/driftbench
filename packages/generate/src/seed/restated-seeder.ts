/** Restated slots: a user asks for one value first and states another in the move that uses it. */

import { NONE } from '@agent-nexus/driftbench-space';
import type { SpecDraft } from './assemble';
import { dimensionId, type PreparedMap } from './map';
import { slotsOf } from './relations';
import { hasPaths, type SeedContext, scenarioDraft } from './seed-drafts';

/**
 * One spec per tool input a move fills from a slot, when the slot's data dimension has two values and one has
 * an approved phrase. Just before the move, the user asks for the tool with that value (the call carries the
 * move's arguments with it, the reply reports the returned fields); then the move's turn states the other
 * value and the move expects it: the latest value the user gave holds. An agent that keeps the value it
 * heard first fails the move.
 */
export function restatedDrafts(prepared: PreparedMap, context: SeedContext, first: number): SpecDraft[] {
  if (!hasPaths(prepared)) return [];
  const drafts: SpecDraft[] = [];
  const seen = new Set<string>();
  const sideEffecting = new Set(
    prepared.relations.paths.flatMap((path) =>
      path.end_state ? [path.end_state.source.replace(/^tool:/, '')] : [],
    ),
  );
  const transition =
    prepared.transition === undefined ? undefined : dimensionId(prepared, prepared.transition);
  for (const use of prepared.relations.usesTools) {
    if (first + drafts.length >= context.max) break;
    // A side-effecting tool never runs on a request alone, and a move with no stated destination has no
    // phrase to read the slot from.
    if (sideEffecting.has(use.tool) || use.to === undefined || transition === undefined) continue;
    const move = prepared.phrasesOf.get(`${transition}=${use.stage}-to-${use.to}`) ?? [];
    for (const [field, assertion] of Object.entries(use.input ?? {})) {
      const slots = slotsOf(assertion);
      if (slots.length !== 1) continue;
      const slot = slots[0] as string;
      // Every phrase of the move states the slot, so the move's turn restates it whichever phrase is drawn.
      if (move.length === 0 || !move.every((phrase) => slotsOf(phrase.text).includes(slot))) continue;
      // The data dimension whose values bind the slot, with the values a phrase asks for.
      const dimension = prepared.space.dimensions.findIndex((entry, index) => {
        const found = prepared.toolDimensions.get(index);
        return found?.tool.name === use.tool && found.direction === 'in' && found.path[0] === field
          ? entry.values.some(
              (value) => prepared.relations.binds.get(`${entry.id}=${value.id}`)?.[slot] !== undefined,
            )
          : false;
      });
      if (dimension < 0) continue;
      const key = `${use.tool}.${field}`;
      if (seen.has(key)) continue;
      const values = (prepared.space.dimensions[dimension]?.values ?? [])
        .map((value, position) => ({ value, position }))
        .filter(({ value }) => value.id !== NONE)
        .filter(
          ({ value }) =>
            prepared.relations.binds.get(`${dimensionId(prepared, dimension)}=${value.id}`)?.[slot] !==
            undefined,
        );
      const asked = values.find(({ value }) =>
        (prepared.phrasesOf.get(`${dimensionId(prepared, dimension)}=${value.id}`) ?? []).some(
          (phrase) => slotsOf(phrase.text).length === 0,
        ),
      );
      const stated = values.find((entry) => entry !== asked);
      if (!asked || !stated) continue;
      const phrase = (
        prepared.phrasesOf.get(`${dimensionId(prepared, dimension)}=${asked.value.id}`) ?? []
      ).find((entry) => slotsOf(entry.text).length === 0);
      const askedValue = prepared.relations.binds.get(
        `${dimensionId(prepared, dimension)}=${asked.value.id}`,
      )?.[slot];
      if (!phrase || askedValue === undefined) continue;
      const flows = new Set(
        prepared.relations.usesTools
          .filter(
            (entry) =>
              entry.tool === use.tool && entry.stage === use.stage && entry.subject.dimension === 'flow',
          )
          .map((entry) => entry.subject.value),
      );
      const id = `gen-restated-${String(first + drafts.length + 1).padStart(3, '0')}`;
      const built = scenarioDraft(
        prepared,
        context,
        id,
        'boundary',
        `Restated ${key}: ${asked.value.id} then ${stated.value.id}`,
        [[dimension, stated.position]],
        { preferred: prepared.relations.paths.filter((path) => flows.has(path.flow)), others: [] },
        {
          before: {
            stage: use.stage,
            to: use.to,
            stimulus: { kind: 'phrase', phrase },
            carries: [[dimension, asked.position]],
            call: { tool: use.tool, field, value: askedValue },
          },
        },
      );
      if (!('draft' in built)) continue;
      seen.add(key);
      drafts.push(built.draft);
    }
  }
  return drafts;
}

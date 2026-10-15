/** Phrases no complete spec says: each said once at the stage after the walk's first move. */

import type { ToolExpect } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import { FLOW_DIMENSION, type PathRelation } from '../extract/proposal';
import { type Pick, pickOf, type SpecDraft } from './assemble';
import { dimensionId, type PreparedMap } from './map';
import { slotsOf } from './relations';
import { hasPaths, type SeedContext, scenarioDraft } from './seed-drafts';

/** The dimensions whose phrases ask for something without moving the walk: a behaviour, a flow. */
const ASKING = new Set(['behaviour', FLOW_DIMENSION]);

/**
 * One spec per approved phrase of a behaviour, flow or data value that no complete spec says yet. The walk's
 * moves reach a stage, then the user says the phrase there; the Then is that stage, the conversation
 * staying where it was. A phrase about a side-effecting tool expects no run of it (it runs after its own move
 * only); a phrase asking for another tool's returned value expects one run. A phrase that states slot
 * values (`binds`, or a `{slot}`) is left out: a stage-only Then cannot judge the values it carries.
 */
export function phraseDrafts(
  prepared: PreparedMap,
  context: SeedContext,
  said: ReadonlySet<string>,
  first: number,
): SpecDraft[] {
  if (!hasPaths(prepared)) return [];
  const sideEffecting = new Set(
    prepared.relations.paths.flatMap((path) =>
      path.end_state ? [path.end_state.source.replace(/^tool:/, '')] : [],
    ),
  );
  const drafts: SpecDraft[] = [];
  const asked = new Set<string>();
  const stagesUsed = new Map<string, Set<string>>();
  for (const phrases of prepared.phrasesOf.values()) {
    for (const phrase of phrases) {
      if (first + drafts.length >= context.max) return drafts;
      if (said.has(phrase.text) || asked.has(phrase.text)) continue;
      if (Object.keys(phrase.binds ?? {}).length > 0 || slotsOf(phrase.text).length > 0) continue;
      const target = pickOf(prepared, phrase);
      if (!target || phrase.value === NONE) continue;
      const dimension = dimensionId(prepared, target[0]);
      const found = prepared.toolDimensions.get(target[0]);
      if (!ASKING.has(dimension) && !found) continue;
      const tools: ToolExpect[] = [];
      if (found && sideEffecting.has(found.tool.name)) tools.push({ label: found.tool.name, count: 0 });
      else if (found?.direction === 'out') tools.push({ label: found.tool.name, count: 1 });
      else if (found) continue;
      // Two phrases of one dimension said at the same stage are one-slot siblings with the same Then; when the
      // reference answers them differently (one runs a tool, one saves a file) the gate rightly rejects the
      // pair. A phrase asking for something goes to a stage no other phrase of its dimension is said at, the
      // first one along the walk; a tool's value is said after the first move, its siblings answering alike.
      const used = found ? undefined : (stagesUsed.get(dimension) ?? new Set<string>());
      const deepest = Math.max(0, ...prepared.relations.paths.map((path) => path.stages.length - 1));
      const id = `gen-phrase-${String(first + drafts.length + 1).padStart(3, '0')}`;
      let built: ReturnType<typeof scenarioDraft> | undefined;
      // A tool's value is asked for after a move that already ran the tool, whose Then checks the call and
      // the reply: a fault on the tool's arguments or its reported fields shows there first.
      const ran = (path: PathRelation, at: number, tool: string) =>
        prepared.relations.usesTools.some(
          (use) =>
            use.tool === tool &&
            use.subject.dimension === FLOW_DIMENSION &&
            use.subject.value === path.flow &&
            path.stages.some(
              (stage, index) => index < at && stage === use.stage && path.stages[index + 1] === use.to,
            ),
        );
      // A behaviour or flow phrase forbids no tool. The map does not say which tool the agent may run for a
      // behaviour (a flow phrase names a flow and runs nothing): a behaviour phrase is said once the walk's
      // moves have run every read tool its flow calls, so a fault on such a call shows at the move first. Two such phrases of one dimension at the same stage of the same flow
      // are one-slot siblings with the same Then, which the gate rejects when the reference answers them
      // differently; each takes a stage and flow none of its siblings holds, and the flow joins its cell.
      const readTools = (path: PathRelation) => [
        ...new Set(
          prepared.relations.usesTools
            .filter(
              (use) =>
                use.subject.dimension === FLOW_DIMENSION &&
                use.subject.value === path.flow &&
                !sideEffecting.has(use.tool),
            )
            .map((use) => use.tool),
        ),
      ];
      const exercised = (path: PathRelation, at: number) =>
        readTools(path).every((tool) => ran(path, at, tool));
      const slotOf = (path: PathRelation, at: number) => `${path.stages[at]}@${path.flow}`;
      const tries = found
        ? [
            ...Array.from({ length: Math.max(0, deepest - 1) }, (_, index) => ({
              at: index + 2,
              fresh: false,
              after: true,
            })),
            { at: 1, fresh: false, after: false },
          ]
        : [
            // No fallback: a sibling at a held stage and flow is rejected by the gate whenever the reference
            // answers the two differently, and the map does not say when that is.
            ...Array.from({ length: deepest }, (_, index) => ({ at: index + 1, fresh: true, after: true })),
          ];
      const flowAt = prepared.space.dimensions.findIndex((entry) => entry.id === FLOW_DIMENSION);
      for (const { at, fresh, after } of tries) {
        // Never at the last stage: a walk that reaches its end checks its end state, which the turn cuts.
        const fits = (path: PathRelation) =>
          path.stages.length > at + 1 &&
          !(fresh && used?.has(slotOf(path, at))) &&
          (!after ||
            (found ? ran(path, at, found.tool.name) : dimension === FLOW_DIMENSION || exercised(path, at)));
        const candidates = prepared.relations.paths.filter(fits);
        const own = candidates.filter((path) => dimension !== FLOW_DIMENSION || path.flow === phrase.value);
        const order = found
          ? [candidates]
          : [...own, ...candidates.filter((path) => !own.includes(path))].map((path) => [path]);
        for (const paths of order) {
          if (paths.length === 0) continue;
          const path = paths.length === 1 ? paths[0] : undefined;
          const flow = path ? prepared.space.dimensions[flowAt]?.index.get(path.flow) : undefined;
          // The flow joins the cell; a flow phrase's own value is its flow already.
          const carries: Pick[] = [
            target,
            ...(found || flow === undefined || target[0] === flowAt ? [] : [[flowAt, flow] as Pick]),
          ];
          const attempt = scenarioDraft(
            prepared,
            context,
            id,
            'cover',
            `Phrase of ${dimension}=${phrase.value}`,
            [target],
            found
              ? { preferred: own, others: candidates.filter((entry) => !own.includes(entry)) }
              : { preferred: paths, others: [] },
            {
              turn: {
                stimulus: { kind: 'phrase', phrase },
                carries,
                tools,
                free: !found,
                at,
                ...(found?.direction === 'out' && !sideEffecting.has(found.tool.name)
                  ? { report: found.tool.name }
                  : {}),
              },
            },
          );
          if ('draft' in attempt) {
            built = attempt;
            if (used && path) stagesUsed.set(dimension, used.add(slotOf(path, at)));
            break;
          }
        }
        if (built) break;
      }
      if (!built || !('draft' in built)) continue;
      asked.add(phrase.text);
      drafts.push(built.draft);
    }
  }
  return drafts;
}

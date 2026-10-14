/** Phrases no complete spec says: each said once at the stage after the walk's first move. */

import type { ToolExpect } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import { FLOW_DIMENSION, type PathRelation } from '../extract/proposal';
import { pickOf, type SpecDraft } from './assemble';
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
      // A stage none of its siblings holds first; when every stage holds one, any stage, after the first move.
      const tries = [
        ...Array.from({ length: used ? deepest : 1 }, (_, index) => ({ at: index + 1, fresh: true })),
        ...(used && used.size > 0 ? [{ at: 1, fresh: false }] : []),
      ];
      for (const { at, fresh } of tries) {
        // Never at the last stage: a walk that reaches its end checks its end state, which the turn cuts.
        const fits = (path: PathRelation) =>
          path.stages.length > at + 1 && !(fresh && used?.has(path.stages[at] as string));
        const own = prepared.relations.paths.filter(
          (path) => fits(path) && (dimension !== FLOW_DIMENSION || path.flow === phrase.value),
        );
        const others = prepared.relations.paths.filter(fits);
        if (others.length === 0) continue;
        const attempt = scenarioDraft(
          prepared,
          context,
          id,
          'cover',
          `Phrase of ${dimension}=${phrase.value}`,
          [target],
          { preferred: own, others },
          { turn: { stimulus: { kind: 'phrase', phrase }, carries: [target], tools, free: !found, at } },
        );
        if ('draft' in attempt) {
          built = attempt;
          break;
        }
      }
      if (!built || !('draft' in built)) continue;
      asked.add(phrase.text);
      const stage = built.draft.blocks.at(-1)?.stage;
      if (used && stage !== undefined) stagesUsed.set(dimension, used.add(stage));
      drafts.push(built.draft);
    }
  }
  return drafts;
}

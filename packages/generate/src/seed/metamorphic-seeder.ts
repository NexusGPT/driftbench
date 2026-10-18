/** The metamorphic seeder: phrasings of the same request that must reach the same outcome. */

import type { PathRelation, ProposalPhrase } from '../extract/proposal';
import { type Pick, pickOf, type SpecDraft } from './assemble';
import { anchorStages, probeDraft } from './deviation-seeder';
import { draftOutput } from './draft-output';
import { stageGraph } from './graph';
import { dimensionId, type PreparedMap, phraseKey } from './map';
import type { ProbeRequest } from './scenario';
import { carrierDraft, hasPaths, pad, type SeedContext, scenarioDraft, withReasons } from './seed-drafts';

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
  const output = draftOutput(context);
  const drafts = output.drafts;
  const values: string[] = [];
  const graph = stageGraph(prepared);
  const anchors = anchorStages(prepared, graph);
  let families = 0;
  if (hasPaths(prepared)) return metamorphicOnPaths(prepared, context);
  for (const [key, phrases] of prepared.phrasesOf) {
    if (phrases.length < 2 || output.count >= context.max) continue;
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
      output.push({
        ...draft,
        id,
        title: `Metamorphic ${key}, phrasing ${variant + 1} of ${phrases.length}`,
        metamorphic: { family, variant: variant + 1, of: phrases.length, relation: 'same observed outcome' },
      });
    });
  }
  return { drafts, summary: { families, specs: output.count, values } };
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
  const output = draftOutput(context);
  const drafts = output.drafts;
  const values: string[] = [];
  let families = 0;
  const transitionKey =
    prepared.transition === undefined ? undefined : dimensionId(prepared, prepared.transition);
  const deviationKey =
    prepared.deviation === undefined ? undefined : dimensionId(prepared, prepared.deviation);
  for (const [key, phrases] of prepared.phrasesOf) {
    if (output.count >= context.max) break;
    const groups = new Map<string, ProposalPhrase[]>();
    for (const phrase of phrases) {
      const group = JSON.stringify([phrase.when ?? null, phrase.binds ?? null]);
      groups.set(group, [...(groups.get(group) ?? []), phrase]);
    }
    for (const members of groups.values()) {
      if (members.length < 2 || output.count >= context.max) continue;
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
          output.push({ ...built.draft, metamorphic });
          return;
        }
        const old = carrierDraft(prepared, { ...context }, family, 'metamorphic', '', [target], {
          stimulus: { kind: 'phrase', phrase },
        });
        output.push(withReasons({ ...old, id, title, metamorphic }, built.reasons));
      });
    }
  }
  // Context families, CheckList's invariance over the context axes: one path walked with the same data
  // values and each allowed value of a persona or channel axis. The relation: the same observed outcome.
  const contextual = [...prepared.axes]
    .sort((a, b) => a - b)
    .filter((index) => ['persona', 'channel'].includes(prepared.space.dimensions[index]?.kind ?? ''));
  const indexOf = (id: string) => prepared.space.dimensions.findIndex((dimension) => dimension.id === id);
  let personasSaid = false;
  for (const path of prepared.relations.paths) {
    for (const axis of contextual) {
      if (output.count >= context.max) break;
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
      // Over the persona axis, each user says who they are in their own approved words after the first move,
      // when every member has such a phrase: the same outcome is expected whoever speaks. One family says
      // them: the twins of one family are compared with each other, never with another path's variants.
      const asides = members.map((value) => {
        const phrase =
          dimension.kind === 'persona' && !personasSaid
            ? prepared.phrasesOf.get(phraseKey(dimension.id, dimension.values[value]?.id ?? ''))?.[0]
            : undefined;
        return phrase ? { phrase, carries: [[axis, value] as Pick] } : undefined;
      });
      const aside = asides.every((entry) => entry !== undefined);
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
            ...(aside && asides[variant] ? { aside: asides[variant] } : {}),
          },
        ),
      );
      if (!built.every((entry) => 'draft' in entry)) continue;
      if (aside) personasSaid = true;
      families += 1;
      values.push(`${path.id}@${dimension.id}`);
      built.forEach((entry, variant) => {
        if (!('draft' in entry)) return;
        output.push({
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
  return { drafts, summary: { families, specs: output.count, values } };
}

import { resolve } from 'node:path';
import { type SpecBlock, writeBlocks } from '../blocks/writer';
import { FLOW_DIMENSION, type TaskFamilyRelation } from '../extract/proposal';
import {
  buildInstance,
  FamilyError,
  type Instance,
  type LoadedFamily,
  loadFamily,
  meets,
  reviewStatus,
  type SeedFiles,
  unapprovedPhrases,
} from '../families';
import { type RunIdentity, sectionsOfRules } from './assemble';
import { type PreparedMap, phraseKey } from './map';

/**
 * The task seeder: the specs a code-agent task family writes for a flow the map hands to it
 * (`task_family`). The family's oracle wrote every Then before any agent runs; this seeder only places the
 * specs in the map's space and records where they come from:
 *
 * - the values every instance holds (`holds`) become the spec's tags, as a generated spec carries its
 *   persona, data and task values;
 * - the spec holds the map's reply rule (`reply_count`), one reply per user turn unless the map says any;
 * - a planted variant, whose workspace holds an instruction in a file, also declares that file as a
 *   perturbation of the class the relation names, at the first block, with the first block's Then: the
 *   space places the class there, and a perturbed run applies the same workspace;
 * - the block writer writes the family's blocks as they are, with their links: the flow and the behaviours
 *   the spec covers as the rules, the spec with the values its instances hold (and the block's stage) as
 *   the row.
 */

export type TaskVariant = {
  /** The spec the family wrote, as a plain object. */
  spec: Record<string, unknown>;
  planted?: boolean;
  /** The workspace files, when one is not text: the spec starts from a folder that must hold them. */
  seed?: SeedFiles;
};

export type TaskInput = { relation: TaskFamilyRelation; variants: TaskVariant[] };

const KIND_TAGS: ReadonlySet<string> = new Set(['persona', 'data', 'task']);

/** The task specs of the map, placed and recorded, in the order the families gave them. */
export function taskSpecs(
  prepared: PreparedMap,
  inputs: readonly TaskInput[],
  run: RunIdentity,
): Array<{ id: string; spec: Record<string, unknown>; seed?: SeedFiles }> {
  return [...streamTaskSpecs(prepared, inputs, run)];
}

export function* streamTaskSpecs(
  prepared: PreparedMap,
  inputs: readonly TaskInput[],
  run: RunIdentity,
): Generator<{ id: string; spec: Record<string, unknown>; seed?: SeedFiles }> {
  for (const { relation, variants } of inputs) {
    const tags: string[] = [];
    for (const [dimensionId, values] of Object.entries(relation.holds ?? {})) {
      const dimension = prepared.space.dimensions.find((entry) => entry.id === dimensionId);
      if (!dimension || values.length !== 1 || !KIND_TAGS.has(dimension.kind)) continue;
      tags.push(`${dimension.kind}:${values[0]}`);
    }
    const planted = (relation.deviations ?? [])[0];
    for (const variant of variants) {
      const spec: Record<string, unknown> = { ...variant.spec };
      const own = (spec.tags as string[] | undefined) ?? [];
      spec.tags = [...own, ...tags.filter((tag) => !own.includes(tag))];
      // One reply per user turn unless the map says otherwise (`reply_count`), as on every generated spec.
      if (prepared.relations.repliesPerTurn === 'one')
        spec.rules = {
          ...((spec.rules as Record<string, unknown> | undefined) ?? {}),
          one_message_per_turn: true,
        };
      if (variant.planted && planted) {
        const blocks = (spec.blocks as Array<{ expect?: Record<string, unknown> }> | undefined) ?? [];
        const files = (spec.workspace_seed as { files?: Record<string, string> } | undefined)?.files;
        if (files && blocks[0]?.expect) {
          spec.perturbations = [
            ...((spec.perturbations as unknown[] | undefined) ?? []),
            {
              id: 'planted-instruction',
              class: planted,
              inject_at: 0,
              world: { workspace: { files } },
              expect: blocks[0].expect,
              recovery: { within_blocks: 0 },
            },
          ];
        }
      }
      const written = writeBlocks(
        ((spec.blocks as SpecBlock[] | undefined) ?? []).map((block) => ({
          block,
          origin: {
            rules: taskRules(prepared, relation, spec),
            sections: sectionsOfRules(prepared, taskRules(prepared, relation, spec), run.sections),
            row: { id: String(spec.id), values: taskValues(prepared, relation, block) },
          },
        })),
        prepared.hash,
        run.sections ? { sectionReach: run.sections.reaching } : {},
      );
      const metadata = (spec.metadata as Record<string, unknown> | undefined) ?? {};
      spec.metadata = {
        ...metadata,
        generated: {
          by: 'driftbench generate',
          seeder: 'task',
          seed: run.seed,
          map: { path: run.mapPath, agent: prepared.agent, version: prepared.version, hash: prepared.hash },
          family: relation.family,
        },
        links: written.links,
      };
      yield { id: String(spec.id), spec, ...(variant.seed ? { seed: variant.seed } : {}) };
    }
  }
}

/** The rules a task spec's blocks test: the relation's flow, then each behaviour the spec covers. */
function taskRules(
  prepared: PreparedMap,
  relation: TaskFamilyRelation,
  spec: Record<string, unknown>,
): Array<{ rule: string }> {
  const rules = [{ rule: phraseKey(FLOW_DIMENSION, relation.flow) }];
  for (const id of (spec.covers as unknown[] | undefined) ?? []) {
    if (typeof id !== 'string') continue;
    const dimension = prepared.space.dimensions.find(
      (entry) => entry.kind === 'behaviour' && entry.index.has(id),
    );
    if (dimension) rules.push({ rule: phraseKey(dimension.id, id) });
  }
  return rules;
}

/** The values of a task block's row: the flow, the single values the relation holds, the block's stage. */
function taskValues(
  prepared: PreparedMap,
  relation: TaskFamilyRelation,
  block: SpecBlock,
): Record<string, string> {
  const values: Record<string, string> = { [FLOW_DIMENSION]: relation.flow };
  for (const [dimension, held] of Object.entries(relation.holds ?? {})) {
    if (held.length === 1 && held[0] !== undefined) values[dimension] = held[0];
  }
  const stage = (block.expect as { stage?: unknown } | undefined)?.stage;
  if (typeof stage === 'string' && prepared.stage !== undefined) {
    const id = prepared.space.dimensions[prepared.stage]?.id;
    if (id !== undefined) values[id] = stage;
  }
  return values;
}

/** How many instances, per relation asked for, are drawn at most while a relation waits for its own. */
const DRAWS_PER_INSTANCE = 20;

/**
 * Builds the instances of every task family the map names, for `generateSuite`'s `tasks`: `n` instances per
 * relation from `seed`, each with its corner and planted variants. Relations on one family share its draws:
 * instances are drawn in order, and each goes to the relations whose `instances` condition its knobs meet,
 * until each relation has `n` or `n` times DRAWS_PER_INSTANCE are drawn. A relation is refused, with the
 * reason, when its family does not load, uses a phrase no person approved, has a missing, invalid or stale
 * review, has a defect the build finds, names a knob the family does not have, or gets no instance. A
 * variant whose workspace holds a file that is not text starts from the folder `seedFrom` names for its
 * spec id; without `seedFrom` such a variant is refused.
 */
export async function buildTaskInputs(
  prepared: PreparedMap,
  mapDir: string,
  options: { n: number; seed: number; seedFrom?: (specId: string) => string },
): Promise<{ inputs: TaskInput[]; refused: Array<{ family: string; reason: string }> }> {
  const refused: Array<{ family: string; reason: string }> = [];
  const placed = new Map<TaskFamilyRelation, TaskVariant[]>();
  const groups = new Map<string, TaskFamilyRelation[]>();
  for (const relation of prepared.relations.taskFamilies) {
    const key = resolve(mapDir, relation.family);
    groups.set(key, [...(groups.get(key) ?? []), relation]);
  }
  for (const [dir, relations] of groups) {
    const family = relations[0]?.family as string;
    const refuseAll = (reason: string) => {
      for (const relation of relations) refused.push({ family: relation.family, reason });
    };
    const loaded = await loadFamily(dir);
    if (!loaded.ok) {
      refuseAll(loaded.issues.map((issue) => issue.message).join('; '));
      continue;
    }
    const unapproved = unapprovedPhrases(loaded.loaded.family);
    if (unapproved.length > 0) {
      refuseAll(`unapproved phrases: ${unapproved.join(', ')}`);
      continue;
    }
    const review = await reviewStatus(loaded.loaded);
    if (review.state !== 'signed' && review.state !== 'pending') {
      refuseAll(`review ${review.state}`);
      continue;
    }
    const open: TaskFamilyRelation[] = [];
    for (const relation of relations) {
      const unknown = Object.keys(relation.instances ?? {}).filter(
        (knob) => !Object.hasOwn(loaded.loaded.family.knobs, knob),
      );
      if (unknown.length > 0) {
        refused.push({
          family: relation.family,
          reason: `instances names the knob ${unknown.join(', ')}, which the family does not have`,
        });
      } else open.push(relation);
    }
    try {
      const drawn = await drawFor(loaded.loaded, open, family, options);
      for (const relation of open) {
        const variants = drawn.get(relation) ?? [];
        if (variants.length > 0) placed.set(relation, variants);
        else {
          refused.push({
            family: relation.family,
            reason: `no instance of the first ${options.n * DRAWS_PER_INSTANCE} drawn has ${Object.entries(
              relation.instances ?? {},
            )
              .map(([knob, value]) => `${knob} ${[value].flat().join(' or ')}`)
              .join(' and ')}`,
          });
        }
      }
    } catch (cause) {
      for (const relation of open) {
        refused.push({
          family: relation.family,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }
  const inputs = prepared.relations.taskFamilies.flatMap((relation) => {
    const variants = placed.get(relation);
    return variants ? [{ relation, variants }] : [];
  });
  return { inputs, refused };
}

/** Draws instances of one family in order and hands each to the relations whose condition it meets. */
async function drawFor(
  loaded: LoadedFamily,
  relations: readonly TaskFamilyRelation[],
  family: string,
  options: { n: number; seed: number; seedFrom?: (specId: string) => string },
): Promise<Map<TaskFamilyRelation, TaskVariant[]>> {
  const out = new Map<TaskFamilyRelation, TaskVariant[]>();
  const count = new Map<TaskFamilyRelation, number>();
  if (relations.length === 0) return out;
  const review = (await reviewStatus(loaded)).state === 'signed' ? 'signed' : 'pending';
  const familyId = loaded.family.id;
  const build = {
    n: options.n,
    seed: options.seed,
    review,
    seedFrom: (instance: string, variant: string) => {
      if (!options.seedFrom) {
        throw new FamilyError(
          `${family}: a variant needs a binary seed folder, and the caller gave no place for it`,
        );
      }
      return options.seedFrom(`${familyId}-${instance}-${variant}`);
    },
  } as const;
  const wanted = (relation: TaskFamilyRelation) => (count.get(relation) ?? 0) < options.n;
  for (let index = 1; index <= options.n * DRAWS_PER_INSTANCE && relations.some(wanted); index += 1) {
    const instance: Instance = await buildInstance(loaded, index, build);
    const takers = relations.filter(
      (relation) => wanted(relation) && meets(instance.knobs, relation.instances),
    );
    if (takers.length === 0) continue;
    const variants = instance.variants.map((variant) => ({
      spec: variant.spec,
      ...(variant.planted ? { planted: true } : {}),
      ...(Object.keys(variant.seed.binary).length > 0 ? { seed: variant.seed } : {}),
    }));
    for (const relation of takers) {
      out.set(relation, [...(out.get(relation) ?? []), ...variants]);
      count.set(relation, (count.get(relation) ?? 0) + 1);
    }
  }
  return out;
}

import { resolve } from 'node:path';
import type { TaskFamilyRelation } from '../extract/proposal';
import {
  buildInstances,
  FamilyError,
  type Instance,
  loadFamily,
  reviewStatus,
  unapprovedPhrases,
} from '../families';
import type { RunIdentity } from './assemble';
import type { PreparedMap } from './map';

/**
 * The task seeder: the specs a code-agent task family writes for a flow the map hands to it
 * (`task_family`). The family's oracle wrote every Then before any agent runs; this seeder only places the
 * specs in the map's space and records where they come from:
 *
 * - the values every instance holds (`holds`) become the spec's tags, as a generated spec carries its
 *   persona, data and task values;
 * - a planted variant, whose workspace holds an instruction in a file, also declares that file as a
 *   perturbation of the class the relation names, at the first block, with the first block's Then: the
 *   space places the class there, and a perturbed run applies the same workspace.
 */

export type TaskVariant = {
  /** The spec the family wrote, as a plain object. */
  spec: Record<string, unknown>;
  planted?: boolean;
};

export type TaskInput = { relation: TaskFamilyRelation; variants: TaskVariant[] };

const KIND_TAGS: ReadonlySet<string> = new Set(['persona', 'data', 'task']);

/** The task specs of the map, placed and recorded, in the order the families gave them. */
export function taskSpecs(
  prepared: PreparedMap,
  inputs: readonly TaskInput[],
  run: RunIdentity,
): Array<{ id: string; spec: Record<string, unknown> }> {
  const out: Array<{ id: string; spec: Record<string, unknown> }> = [];
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
      };
      out.push({ id: String(spec.id), spec });
    }
  }
  return out;
}

/**
 * Builds the instances of every task family the map names, for `generateSuite`'s `tasks`: `n` instances per
 * family from `seed`, each with its corner and planted variants. A family is refused, with the reason, when
 * it does not load, uses a phrase no person approved, has a missing, invalid or stale review, has a defect
 * the build finds, or a variant needs a binary seed folder (a generated spec carries text seeds only).
 */
export async function buildTaskInputs(
  prepared: PreparedMap,
  mapDir: string,
  options: { n: number; seed: number },
): Promise<{ inputs: TaskInput[]; refused: Array<{ family: string; reason: string }> }> {
  const inputs: TaskInput[] = [];
  const refused: Array<{ family: string; reason: string }> = [];
  for (const relation of prepared.relations.taskFamilies) {
    const loaded = await loadFamily(resolve(mapDir, relation.family));
    if (!loaded.ok) {
      refused.push({
        family: relation.family,
        reason: loaded.issues.map((issue) => issue.message).join('; '),
      });
      continue;
    }
    const unapproved = unapprovedPhrases(loaded.loaded.family);
    if (unapproved.length > 0) {
      refused.push({ family: relation.family, reason: `unapproved phrases: ${unapproved.join(', ')}` });
      continue;
    }
    const review = await reviewStatus(loaded.loaded);
    if (review.state !== 'signed' && review.state !== 'pending') {
      refused.push({ family: relation.family, reason: `review ${review.state}` });
      continue;
    }
    let instances: Instance[];
    try {
      instances = await buildInstances(loaded.loaded, {
        n: options.n,
        seed: options.seed,
        review: review.state,
        seedFrom: () => {
          throw new FamilyError(
            'a variant needs a binary seed folder, which a generated spec does not carry',
          );
        },
      });
    } catch (cause) {
      refused.push({
        family: relation.family,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }
    inputs.push({
      relation,
      variants: instances.flatMap((instance) =>
        instance.variants.map((variant) => ({
          spec: variant.spec,
          ...(variant.planted ? { planted: true } : {}),
        })),
      ),
    });
  }
  return { inputs, refused };
}

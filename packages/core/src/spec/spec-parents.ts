import type { BlockSpec, CriterionDef, Spec } from '../schema/spec';
import { canonicalJson, cloneJson } from './hash';
import { specHash } from './identity';
import { error, type Issue } from './issues';
import type { LoadResult } from './load';

/**
 * Parents across specs (plan, phase 5): block 0 of a spec may name `parent: <spec id>#<block id>`, a block of
 * another spec. The child then starts where that block ended. The loader writes the chain out: the parent spec's
 * blocks up to the named one come first, renamed `<spec id>#<block id>`, then the child's own blocks, and
 * `metadata.parent` says how many leading blocks are the parent's. The runner replays those blocks unscored, and
 * blocks the child when one of them does not pass. So the child keeps its own header, end state, criteria and
 * perturbations, and means what the same blocks written inline would mean.
 */

/** A `<spec id>#<block id>` reference: another spec's block. A plain block id names a block of the same spec. */
const SPEC_REF = /^([^#\s]+)#([^#\s]+)$/;

export type SpecParentRef = { spec: string; block: string };

/** The other-spec block a `parent` value names, or undefined for a plain block id. */
export function specParentRef(parent: string | undefined): SpecParentRef | undefined {
  const match = parent === undefined ? null : SPEC_REF.exec(parent);
  return match ? { spec: match[1] as string, block: match[2] as string } : undefined;
}

/** What the loader writes in `metadata.parent` of a child it wrote out. */
export type SpecParentRecord = { from: string; replayed: number };

/** The replay record of a spec the loader wrote out, when its shape is right. */
export function specParentRecord(spec: Spec): SpecParentRecord | undefined {
  const record = spec.metadata?.parent as Partial<SpecParentRecord> | undefined;
  if (typeof record?.from !== 'string' || !Number.isInteger(record.replayed)) return undefined;
  const replayed = record.replayed as number;
  return replayed > 0 && replayed < spec.blocks.length ? { from: record.from, replayed } : undefined;
}

/** The spec-level keys a child must share with its parent spec: the parent's blocks run under the child's. */
const SHARED_KEYS = ['kind', 'channel', 'lang', 'target', 'given'] as const;

type Resolved = { spec: Spec } | { errors: Issue[] };

/**
 * Writes out every child that names another spec's block, over the specs loaded together. A reference to a spec
 * or block that is not there, a cycle, or a parent spec whose header differs on a key the run reads is an error
 * of the child; specs without such a reference come back as they were.
 */
export function resolveSpecParents(
  results: readonly LoadResult[],
  validate: (raw: unknown, path: string) => LoadResult,
): LoadResult[] {
  const byId = new Map<string, Extract<LoadResult, { ok: true }>>();
  for (const result of results) if (result.ok && !byId.has(result.spec.id)) byId.set(result.spec.id, result);
  const memo = new Map<string, Resolved>();

  const resolve = (id: string, stack: string[]): Resolved => {
    const known = memo.get(id);
    if (known) return known;
    const loaded = byId.get(id) as Extract<LoadResult, { ok: true }>;
    const spec = loaded.spec;
    const ref = specParentRef(spec.blocks[0]?.parent);
    if (!ref) {
      const own = { spec };
      memo.set(id, own);
      return own;
    }
    const fail = (code: Parameters<typeof error>[0], message: string): Resolved => {
      const failed = { errors: [error(code, 'blocks.0.parent', message)] };
      memo.set(id, failed);
      return failed;
    };
    if (ref.spec === id || stack.includes(ref.spec)) {
      const from = ref.spec === id ? stack.length : stack.indexOf(ref.spec);
      const path = [...stack.slice(from), id, ref.spec];
      return fail('PARENT_CYCLE', `parent links across specs form a cycle: ${path.join(' -> ')}`);
    }
    const parentLoaded = byId.get(ref.spec);
    if (!parentLoaded)
      return fail(
        'PARENT_MISSING',
        `parent spec "${ref.spec}" is not among the loaded specs, nor in a stems/ folder beside the child's folder: load its file with this one`,
      );
    for (const key of SHARED_KEYS) {
      if (canonicalJson(spec[key] ?? null) !== canonicalJson(parentLoaded.spec[key] ?? null))
        return fail(
          'PARENT_SPEC_MISMATCH',
          `the parent spec "${ref.spec}" has another ${key}: a child runs its parent's blocks under its own ${key}`,
        );
    }
    const parent = resolve(ref.spec, [...stack, id]);
    if ('errors' in parent) {
      const cause = parent.errors[0];
      return cause?.code === 'PARENT_CYCLE'
        ? fail('PARENT_CYCLE', cause.message)
        : fail(
            'PARENT_MISSING',
            `parent spec "${ref.spec}" is not valid: ${cause?.message ?? 'see its own errors'}`,
          );
    }
    const replayedBefore = specParentRecord(parent.spec)?.replayed ?? 0;
    const at = parent.spec.blocks.findIndex(
      (block, index) => index >= replayedBefore && block.id === ref.block,
    );
    if (at < 0)
      return fail('PARENT_MISSING', `parent block "${ref.block}" does not exist in spec "${ref.spec}"`);
    const chain: BlockSpec[] = parent.spec.blocks.slice(0, at + 1).map((block, index) => {
      if (index < replayedBefore) return cloneJson(block);
      return { ...cloneJson(block), id: `${ref.spec}#${block.id ?? index}` };
    });
    const { parent: _parent, ...first } = spec.blocks[0] as BlockSpec;
    const shift = chain.length;
    const criteria = mergeCriteria(spec.criteria, parent.spec.criteria, chain);
    if (typeof criteria === 'string') return fail('PARENT_SPEC_MISMATCH', criteria);
    const written: Record<string, unknown> = {
      ...cloneJson(spec),
      blocks: [...chain, first, ...cloneJson(spec.blocks.slice(1))],
      ...(criteria === undefined ? {} : { criteria }),
      ...(spec.perturbations
        ? {
            perturbations: spec.perturbations.map((entry) => ({
              ...cloneJson(entry),
              inject_at: entry.inject_at + shift,
            })),
          }
        : {}),
      ...(spec.end?.atBlock === undefined
        ? {}
        : { end: { ...cloneJson(spec.end), atBlock: spec.end.atBlock + shift } }),
      metadata: {
        ...cloneJson(spec.metadata ?? {}),
        parent: { from: `${ref.spec}#${ref.block}`, replayed: shift },
      },
    };
    const checked = validate(written, loaded.path);
    if (!checked.ok) {
      const failed = { errors: checked.errors };
      memo.set(id, failed);
      return failed;
    }
    const done = { spec: checked.spec };
    memo.set(id, done);
    return done;
  };

  return results.map((result) => {
    if (!result.ok || !specParentRef(result.spec.blocks[0]?.parent)) return result;
    const resolved = resolve(result.spec.id, []);
    if ('errors' in resolved)
      return { ok: false, path: result.path, errors: resolved.errors, warnings: result.warnings };
    return { ...result, spec: resolved.spec, hash: specHash(resolved.spec) };
  });
}

/** The child's criteria plus the ones its parent's replayed blocks name; one name with two definitions is refused. */
function mergeCriteria(
  own: readonly CriterionDef[] | undefined,
  parents: readonly CriterionDef[] | undefined,
  chain: readonly BlockSpec[],
): CriterionDef[] | string | undefined {
  const named = new Set(
    chain.flatMap((block) => (block.expect?.criteria ?? []).map((ref) => ref.replace(/@gating$/, ''))),
  );
  const added = (parents ?? []).filter((criterion) => named.has(criterion.name));
  if (added.length === 0) return own === undefined ? undefined : [...own];
  const merged = [...(own ?? [])];
  for (const criterion of added) {
    const same = merged.find((entry) => entry.name === criterion.name);
    if (!same) merged.push(cloneJson(criterion));
    else if (canonicalJson(same) !== canonicalJson(criterion))
      return `criterion "${criterion.name}" has another definition in the parent spec`;
  }
  return merged;
}

/**
 * The specs a stem opens, when this spec is a stem: an opening written once for the specs that start from it
 * (`metadata.stem.specs`). A stem is run and scored as a spec of its own; it is no conversation of the map, so
 * coverage counts the specs it opens, never the stem.
 */
export function stemOf(spec: Spec): string[] | undefined {
  const specs = (spec.metadata?.stem as { specs?: unknown } | undefined)?.specs;
  return Array.isArray(specs) && specs.every((entry) => typeof entry === 'string') ? specs : undefined;
}

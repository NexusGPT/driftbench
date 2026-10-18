import {
  type BlockSpec,
  type CriterionDef,
  canonicalJson,
  cloneJson,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { type StemNode, stemForest } from './trie';

/**
 * The stem post-pass (plan M5.5, option C): the openings that specs of one group share are written once, as stem
 * specs, and each spec starts from its stem with `parent: <stem id>#<block id>` on its block 0. Loaded together,
 * the specs mean what they meant: the loader writes each stem back out before its children (see
 * resolveSpecParents in core). A spec keeps its id, header, end state, criteria and perturbations.
 */

/** The spec-level keys specs must share to share an opening: those the loader checks, and those a stem runs under. */
const GROUP_KEYS = ['kind', 'channel', 'lang', 'target', 'given', 'stages', 'rules'] as const;

/** One row of the old-to-new table: where a block of a spec as generated is now. */
export type StemMapRow = {
  oldSpec: string;
  oldIndex: number;
  oldBlock?: string;
  newSpec: string;
  newBlock?: string;
  /** How many specs share the block: above 1, it lives in a stem. */
  sharedBy: number;
};

export type StemPassResult = {
  /** Every input spec, in input order: unchanged, or starting from a stem. */
  specs: Spec[];
  /** The stems, in the order their first block was met. */
  stems: Spec[];
  rows: StemMapRow[];
  /** Blocks written once instead of once per spec. */
  saved: number;
};

/** The header line of the old-to-new table, for `stemMapCsv`. */
export const STEM_MAP_HEADER = 'old_spec,old_index,old_block,new_spec,new_block,shared_by';

/**
 * Runs the post-pass. A spec shares at most its blocks before its first perturbation and its end verdict, and
 * never its last block, so it always keeps one block of its own. Two blocks share a node only with the same
 * When, Given and Then and the same definitions of the criteria they name.
 */
export function stemPass(specs: readonly Spec[]): StemPassResult {
  const ids = new Set(specs.map((spec) => spec.id));
  const groupOf = (spec: Spec) =>
    spec.blocks[0]?.parent !== undefined || spec.blocks.some((block) => block.parent !== undefined)
      ? undefined
      : canonicalJson(GROUP_KEYS.map((key) => spec[key] ?? null));
  const limitOf = (spec: Spec) =>
    Math.min(
      spec.blocks.length - 1,
      ...(spec.perturbations ?? []).map((entry) => entry.inject_at),
      ...(spec.end?.atBlock === undefined ? [] : [spec.end.atBlock]),
    );
  const blockKey = (spec: Spec, block: BlockSpec) => {
    const { id: _id, ...content } = block;
    return [content, namedCriteria(spec, [block])];
  };
  const forest = stemForest(specs, groupOf, { limitOf, blockKey });

  // The stems: maximal chains of shared nodes reached by the same specs. A chain whose first node has a shared
  // parent starts from the stem of that parent.
  const stems: Spec[] = [];
  /** Where each shared node lives: its stem and its block id there. */
  const home = new Map<string, { stem: string; block: string }>();
  const firstOf = new Map(specs.map((spec) => [spec.id, spec]));
  const visit = (node: StemNode, parentHome: { stem: string; block: string } | undefined) => {
    if (node.specs.length < 2) return;
    const chain: StemNode[] = [node];
    for (let last = node; ; ) {
      const next = last.children.find((child) => sameSpecs(child, last));
      if (!next) break;
      chain.push(next);
      last = next;
    }
    const owner = firstOf.get(node.specs[0] as string) as Spec;
    let id = `stem-${node.key.slice(0, 12)}`;
    for (let n = 2; ids.has(id); n++) id = `stem-${node.key.slice(0, 12)}-${n}`;
    ids.add(id);
    const blocks = chain.map((entry, index) => {
      const block = cloneJson(entry.block);
      // A block a loader wrote out from another spec is named <spec id>#<block id>: its stem names it by its own id.
      const blockId = (block.id ?? `b${entry.depth + 1}`).split('#').at(-1) as string;
      return {
        ...block,
        id: blockId,
        ...(index === 0 && parentHome ? { parent: `${parentHome.stem}#${parentHome.block}` } : {}),
      };
    });
    blocks.forEach((block, index) => home.set((chain[index] as StemNode).key, { stem: id, block: block.id }));
    const criteria = namedCriteria(
      owner,
      chain.map((entry) => entry.block),
    );
    const stem: Record<string, unknown> = {
      id,
      ...(owner.version === undefined ? {} : { version: owner.version }),
      kind: owner.kind,
      title: `Shared opening of ${node.specs.length} specs`,
      ...(owner.tier === undefined ? {} : { tier: owner.tier }),
      ...Object.fromEntries(
        GROUP_KEYS.filter((key) => key !== 'kind' && owner[key] !== undefined).map((key) => [
          key,
          cloneJson(owner[key]),
        ]),
      ),
      tags: ['stem'],
      ...(criteria.length === 0 ? {} : { criteria }),
      blocks,
      metadata: { stem: { specs: [...node.specs] } },
    };
    stems.push(stem as Spec);
    const tail = chain.at(-1) as StemNode;
    for (const child of tail.children) visit(child, home.get(tail.key));
  };
  for (const root of forest.roots) visit(root, undefined);

  const rows: StemMapRow[] = [];
  const out = specs.map((spec) => {
    const own = forest.rows.filter((row) => row.specId === spec.id);
    const depth = own.filter((row) => row.node !== undefined && home.has(row.node)).length;
    own.forEach((row) => {
      const shared = row.node === undefined ? undefined : home.get(row.node);
      rows.push({
        oldSpec: spec.id,
        oldIndex: row.index,
        ...(row.blockId === undefined ? {} : { oldBlock: row.blockId }),
        newSpec: shared ? shared.stem : spec.id,
        ...(shared ? { newBlock: shared.block } : row.blockId === undefined ? {} : { newBlock: row.blockId }),
        sharedBy: row.sharedBy,
      });
    });
    if (depth === 0) return spec;
    const last = home.get(own[depth - 1]?.node as string) as { stem: string; block: string };
    const [first, ...rest] = cloneJson(spec.blocks.slice(depth));
    const child: Spec = {
      ...cloneJson(spec),
      blocks: [{ ...(first as BlockSpec), parent: `${last.stem}#${last.block}` }, ...rest],
      ...(spec.perturbations
        ? {
            perturbations: spec.perturbations.map((entry) => ({
              ...cloneJson(entry),
              inject_at: entry.inject_at - depth,
            })),
          }
        : {}),
      ...(spec.end?.atBlock === undefined
        ? {}
        : { end: { ...cloneJson(spec.end), atBlock: spec.end.atBlock - depth } }),
      metadata: {
        ...cloneJson(spec.metadata ?? {}),
        generated: {
          ...cloneJson((spec.metadata?.generated as Record<string, unknown> | undefined) ?? {}),
          parent: { stem: last.stem, block: last.block, replaced: depth },
        },
      },
    };
    return child;
  });
  const saved = forest.rows.filter((row) => row.node !== undefined && home.has(row.node)).length - home.size;
  return { specs: out, stems, rows, saved };
}

/** The old-to-new table as CSV, one row per block of a spec as generated, in input order. */
export function stemMapCsv(rows: readonly StemMapRow[]): string {
  const cell = (value: string | number | undefined) => {
    const text = value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${[STEM_MAP_HEADER, ...rows.map((row) => [row.oldSpec, row.oldIndex, row.oldBlock, row.newSpec, row.newBlock, row.sharedBy].map(cell).join(','))].join('\n')}\n`;
}

function sameSpecs(a: StemNode, b: StemNode): boolean {
  return a.specs.length === b.specs.length && a.specs.every((id, index) => b.specs[index] === id);
}

/** The definitions of the criteria the blocks name, in the spec's order. */
function namedCriteria(spec: Spec, blocks: readonly BlockSpec[]): CriterionDef[] {
  const named = new Set(
    blocks.flatMap((block) => (block.expect?.criteria ?? []).map((ref) => ref.replace(/@gating$/, ''))),
  );
  return (spec.criteria ?? [])
    .filter((criterion) => named.has(criterion.name))
    .map((criterion) => cloneJson(criterion));
}

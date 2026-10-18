import { type BlockSpec, contentHash, type Spec } from '@agent-nexus/driftbench-core';

/**
 * The stem finder of the parent post-pass (plan M5.5): a trie over the blocks of the specs, each block keyed by
 * its When, Given and Then with its id left out, inside a group of specs that may share an opening. A node that
 * two or more specs pass through is a shared block: written once as a stem, its specs start from it.
 */

/** One trie node: a block content reached by the same chain of blocks from the start of a spec. */
export type StemNode = {
  /** The content hash of the chain from the root to this node, inside its group. */
  key: string;
  /** 0 for the first block of a spec. */
  depth: number;
  /** The block as the first spec that reached it wrote it, id included. */
  block: BlockSpec;
  /** The ids of the specs whose chain passes through this node, in input order. */
  specs: string[];
  children: StemNode[];
};

/** One row of the old-to-new mapping: where a block of an input spec goes. */
export type StemRow = {
  specId: string;
  index: number;
  blockId?: string;
  /** The shared node the block becomes, when two or more specs share it; absent for a block of its own. */
  node?: string;
  /** How many specs share the block, 1 for a block of its own. */
  sharedBy: number;
};

export type StemForest = {
  /** The trie roots of every group, in input order; a root reached by one spec only is a spec of its own. */
  roots: StemNode[];
  /** Every input block, in input order. */
  rows: StemRow[];
  /** Blocks written once instead of once per spec: the sum, over shared nodes, of their specs minus one. */
  saved: number;
};

/**
 * Builds the forest. `groupOf` says which specs may share an opening (the same group) and which may not
 * (undefined: the spec keeps every block of its own).
 */
export function stemForest(specs: readonly Spec[], groupOf: (spec: Spec) => string | undefined): StemForest {
  const roots: StemNode[] = [];
  const byKey = new Map<string, StemNode>();
  const placed: Array<{ spec: Spec; nodes: StemNode[] }> = [];
  for (const spec of specs) {
    const group = groupOf(spec);
    if (group === undefined) {
      placed.push({ spec, nodes: [] });
      continue;
    }
    const nodes: StemNode[] = [];
    let parent: StemNode | undefined;
    let chain: unknown[] = [group];
    spec.blocks.forEach((block, depth) => {
      const { id: _id, ...content } = block;
      chain = [...chain, content];
      const key = contentHash(chain);
      let node = byKey.get(key);
      if (!node) {
        node = { key, depth, block, specs: [], children: [] };
        byKey.set(key, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      node.specs.push(spec.id);
      nodes.push(node);
      parent = node;
    });
    placed.push({ spec, nodes });
  }
  const rows: StemRow[] = [];
  let saved = 0;
  for (const { spec, nodes } of placed) {
    spec.blocks.forEach((block, index) => {
      const node = nodes[index];
      const sharedBy = node?.specs.length ?? 1;
      rows.push({
        specId: spec.id,
        index,
        ...(block.id === undefined ? {} : { blockId: block.id }),
        ...(node && sharedBy > 1 ? { node: node.key } : {}),
        sharedBy,
      });
    });
  }
  for (const node of byKey.values()) saved += node.specs.length - 1;
  return { roots, rows, saved };
}

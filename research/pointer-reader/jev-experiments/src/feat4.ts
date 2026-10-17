// Features for the calibrated stacker: Jev probability vectors of the unit and of its neighbours, the pair answers, and structure read from the tree
// (container kind, block kind, position in the block, table column). No word list is used.
import { FILES3, TREES3, U3, offsetOf } from './p3';
import { designPasses, haikuVotes, vec6, type Vec6 } from './dec4';
import { L6 } from './p4';
import type { TNode } from './tree';

const CONTAINERS = ['heading', 'sentence', 'list_item', 'table_cell', 'front_matter_value', 'block_quote'];
const BLOCKS = ['section', 'paragraph', 'list', 'row', 'blockquote', 'frontmatter'];

type Meta = { container: string; block: string; pos: number; n: number; col: number; cols: number; leadIn: boolean; followedByList: boolean; parentId: string; blockId: string };
const META = new Map<number, Meta>();
for (const f of FILES3) {
  const t = TREES3[f.file]!;
  const leafNodes = t.nodes.filter((n) => n.kind === 'leaf');
  const nodeOf = new Map<number, TNode>(leafNodes.map((n) => [n.leaves[0]!, n]));
  t.units.forEach((u, i) => {
    const leaf = nodeOf.get(i)!;
    const parent = leaf.parent!;
    const sib = parent.children.filter((c) => c.kind === 'leaf');
    const pos = sib.indexOf(leaf);
    let block = parent.kind as string, col = 0, cols = 1, leadIn = false, followedByList = false;
    if (parent.kind === 'row') { cols = sib.length; col = pos; }
    // a block that follows a paragraph directly (list or table) is a lead-in target; a paragraph followed by a list or table has a list after it
    const blockNode = parent.kind === 'row' ? parent.parent! : parent;
    const grand = blockNode.parent;
    if (grand) {
      const k = grand.children.indexOf(blockNode);
      const prev = grand.children[k - 1], next = grand.children[k + 1];
      if ((blockNode.kind === 'list' || blockNode.kind === 'table') && prev?.kind === 'paragraph') leadIn = true;
      if (blockNode.kind === 'paragraph' && (next?.kind === 'list' || next?.kind === 'table')) followedByList = true;
    }
    if (parent.kind === 'section' || parent.kind === 'file') block = 'section';
    META.set(offsetOf[f.file]! + i + 1, { container: u.container, block, pos, n: sib.length, col, cols, leadIn, followedByList, parentId: parent.id, blockId: blockNode.id });
  });
}
const oneHot = (v: string, all: string[]) => all.map((a) => (a === v ? 1 : 0));
export function structFeat(g: number): number[] {
  const m = META.get(g)!;
  return [...oneHot(m.container, CONTAINERS), ...oneHot(m.block, BLOCKS), m.pos === 0 ? 1 : 0, m.pos === m.n - 1 ? 1 : 0, m.n === 1 ? 1 : 0, m.n > 1 ? m.pos / (m.n - 1) : 0, m.block === 'row' ? (m.col === 0 ? 1 : 0) : 0, m.block === 'row' ? (m.col === m.cols - 1 ? 1 : 0) : 0, m.leadIn ? 1 : 0, m.followedByList ? 1 : 0];
}
export const metaOf = (g: number) => META.get(g)!;
const sameFile = (a: number, b: number) => b >= 1 && b <= U3.length && U3[a - 1]!.file === U3[b - 1]!.file;

/** unit vector of a design, averaged over its passes (cached) */
const cache = new Map<string, Vec6>();
export function dv(design: string, passes: number[] | undefined, g: number): Vec6 {
  const key = `${design}|${passes?.join(',') ?? '*'}|${g}`;
  let v = cache.get(key);
  if (!v) { v = vec6(design, designPasses(design, passes), g); cache.set(key, v); }
  return v;
}
const ZERO6 = L6.map(() => 0);
const PAIR = ['joined', 'separate', 'not_instruction'];
export function pairVec(g: number, passes?: number[]): number[] {
  // answer about the pair (g, g+1): stored at the left unit
  const rs = designPasses('pc-structL', passes);
  if (!rs.length) return [0, 0, 0];
  return PAIR.map((k) => rs.reduce((a, r) => a + (r.probs[g]?.[`pc:${k}`] ?? 0), 0) / rs.length);
}
import { PROBES } from './p4';
export function probeVec(g: number, passes?: number[]): number[] {
  const rs = designPasses('pr-structS', passes);
  if (!rs.length) return PROBES.map(() => 0);
  return PROBES.map(([k]) => rs.reduce((a, r) => a + (r.probs[g]?.[`pr:${k}`] ?? 0), 0) / rs.length);
}
export type FeatSpec = { designs: Array<{ id: string; passes?: number[] }>; neighbours: boolean; pairs: boolean; structure: boolean; neighbourDesign?: string; probes?: boolean; probeNeighbours?: boolean; passes?: number[]; haiku?: boolean };
export function featureFn(spec: FeatSpec): (g: number) => number[] {
  return (g) => {
    const f: number[] = [];
    for (const d of spec.designs) f.push(...dv(d.id, d.passes ?? spec.passes, g));
    if (spec.neighbours) {
      const nd = spec.neighbourDesign ?? spec.designs[0]!.id;
      const np = spec.designs.find((d) => d.id === nd)?.passes ?? spec.passes;
      f.push(...(sameFile(g, g - 1) ? dv(nd, np, g - 1) : ZERO6), ...(sameFile(g, g + 1) ? dv(nd, np, g + 1) : ZERO6));
    }
    if (spec.pairs) f.push(...(sameFile(g, g - 1) ? pairVec(g - 1, spec.passes) : [0, 0, 0]), ...(sameFile(g, g + 1) ? pairVec(g, spec.passes) : [0, 0, 0]));
    if (spec.structure) f.push(...structFeat(g));
    if (spec.probes) f.push(...probeVec(g, spec.passes));
    if (spec.probeNeighbours) f.push(...(sameFile(g, g - 1) ? probeVec(g - 1, spec.passes) : PROBES.map(() => 0)), ...(sameFile(g, g + 1) ? probeVec(g + 1, spec.passes) : PROBES.map(() => 0)));
    if (spec.haiku) f.push(...haikuVotes(g).map((x) => x / 3));
    return f;
  };
}

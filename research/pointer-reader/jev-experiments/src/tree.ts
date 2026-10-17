// Nested units: file > section > (paragraph | list | table > row | blockquote) > leaf, with a lead-in group
// (a paragraph directly followed by a list or a table) as an overlay. Leaves are exactly the units of the prototype
// cutter (../../src/cut.ts); every node has its own ledger-style id (kind is part of the key, so a one-sentence
// paragraph and its sentence get different ids).
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { createHash } from 'node:crypto';
import { cut, fingerprint, type Unit } from '../../src/cut';

export type Kind = 'file' | 'section' | 'group' | 'paragraph' | 'list' | 'table' | 'row' | 'blockquote' | 'frontmatter' | 'leaf';
export type TNode = { id: string; kind: Kind; start: number; end: number; leaves: number[]; children: TNode[]; parent?: TNode; depth?: number };
export type Tree = { root: TNode; units: Unit[]; nodes: TNode[]; groups: TNode[]; digest: string };

type Ast = { type: string; depth?: number; children?: Ast[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function mintId(key: string): string {
  const h = createHash('sha256').update(key).digest();
  let bits = '';
  for (const byte of h.subarray(0, 7)) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 10; i++) out += B32[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out;
}

export function buildTree(source: string, file: string, estateKey: string): Tree {
  const { units, digest } = cut(source);
  if (source.charCodeAt(0) === 0xfeff) throw new Error('BOM not supported by the tree builder');
  const ast = processor.parse(source) as Ast;
  const nodes: TNode[] = [];
  const mk = (kind: Kind, start: number, end: number, parent?: TNode, depth?: number): TNode => {
    const n: TNode = { id: '', kind, start, end, leaves: [], children: [], ...(parent ? { parent } : {}), ...(depth !== undefined ? { depth } : {}) };
    parent?.children.push(n);
    nodes.push(n);
    return n;
  };
  const within = (s: number, e: number) => units.map((u, i) => (u.start >= s && u.end <= e ? i : -1)).filter((i) => i >= 0);
  const addLeaves = (parent: TNode, idxs: number[]) => { for (const i of idxs) { const l = mk('leaf', units[i]!.start, units[i]!.end, parent); l.leaves = [i]; } };
  const root = mk('file', 0, source.length);
  const stack: Array<{ node: TNode; depth: number }> = [{ node: root, depth: 0 }];
  const off = (a: Ast) => [a.position?.start.offset ?? 0, a.position?.end.offset ?? 0] as const;
  for (const child of ast.children ?? []) {
    const [s, e] = off(child);
    const top = () => stack[stack.length - 1]!;
    if (child.type === 'heading') {
      while (top().depth >= (child.depth ?? 1)) stack.pop();
      const sec = mk('section', s, e, top().node, child.depth ?? 1);
      stack.push({ node: sec, depth: child.depth ?? 1 });
      addLeaves(sec, within(s, e));
    } else if (child.type === 'yaml') {
      const fm = mk('frontmatter', s, e, root);
      addLeaves(fm, within(s, e));
    } else if (child.type === 'paragraph') {
      addLeaves(mk('paragraph', s, e, top().node), within(s, e));
    } else if (child.type === 'blockquote') {
      addLeaves(mk('blockquote', s, e, top().node), within(s, e));
    } else if (child.type === 'list') {
      const list = mk('list', s, e, top().node);
      for (const item of child.children ?? []) { const [a, b] = off(item); addLeaves(list, within(a, b)); }
    } else if (child.type === 'table') {
      const table = mk('table', s, e, top().node);
      for (const row of child.children ?? []) { const [a, b] = off(row); const r = mk('row', a, b, table); addLeaves(r, within(a, b)); }
    }
    // html blocks, code fences and thematic breaks are not used by the corpora; leaves they hold stay outside the tree.
  }
  // leaves of every node, bottom-up; ends of sections
  const fill = (n: TNode): number[] => {
    if (n.kind === 'leaf') return n.leaves;
    n.leaves = n.children.flatMap(fill);
    if (n.kind === 'section' || n.kind === 'file') { const last = n.children.at(-1); if (last) n.end = Math.max(n.end, last.end); }
    return n.leaves;
  };
  fill(root);
  const covered = new Set(root.leaves);
  const lost = units.map((_, i) => i).filter((i) => !covered.has(i));
  if (lost.length) throw new Error(`${file}: ${lost.length} units are outside the tree (first: ${JSON.stringify(units[lost[0]!]!.text.slice(0, 60))})`);
  // lead-in groups: a paragraph directly followed by a list or a table, same parent
  const groups: TNode[] = [];
  for (const n of nodes) {
    for (let i = 0; i + 1 < n.children.length; i++) {
      const a = n.children[i]!, b = n.children[i + 1]!;
      if (a.kind === 'paragraph' && (b.kind === 'list' || b.kind === 'table')) {
        const g: TNode = { id: '', kind: 'group', start: a.start, end: b.end, leaves: [...a.leaves, ...b.leaves], children: [a, b], parent: n };
        groups.push(g);
      }
    }
  }
  // ids
  const seen = new Map<string, number>();
  for (const n of [...nodes, ...groups]) {
    const text = n.kind === 'leaf' ? units[n.leaves[0]!]!.text : source.slice(n.start, n.end);
    const fp = n.kind === 'leaf' ? units[n.leaves[0]!]!.fp : fingerprint(text);
    const key = `${estateKey}\0${file}${n.kind === 'leaf' ? '' : '#' + n.kind}\0${fp}`;
    const occ = seen.get(key) ?? 0;
    seen.set(key, occ + 1);
    n.id = mintId(`${key}\0${occ}`);
  }
  return { root, units, nodes, groups, digest };
}

/** The deepest node kind that holds exactly this set of leaves, if any. */
export function alignedNode(tree: Tree, leaves: number[]): TNode | undefined {
  const key = leaves.join(',');
  const all = [...tree.nodes.filter((n) => n.kind !== 'file' && n.kind !== 'section'), ...tree.groups];
  return all.filter((n) => n.leaves.join(',') === key).sort((a, b) => rank(b) - rank(a))[0];
}
const rank = (n: TNode) => ({ leaf: 6, row: 5, paragraph: 4, list: 4, table: 3, blockquote: 3, group: 2, frontmatter: 1, section: 0, file: 0 } as Record<Kind, number>)[n.kind];

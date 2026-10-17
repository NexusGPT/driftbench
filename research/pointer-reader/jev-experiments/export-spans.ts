// Writes nodes3.json (every node of every file tree with its own id) and spans3.json (every gold rule as a list of unit ids,
// with the id of the node it aligns to, when there is one). Derived from gold3.json and the trees; changes neither.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES3, RULES3, TREES3, U3 } from './src/p3';
import { alignedNode, type TNode } from './src/tree';
const here = new URL('.', import.meta.url).pathname;
const nodes: Array<{ id: string; kind: string; file: string; parent: string | null; unitIds: string[]; firstUnit: number; lastUnit: number; level?: number }> = [];
const leafId = (file: string, i: number) => U3.find((u) => u.file === file && u.n === i + 1)!.id;
for (const f of FILES3) {
  const t = TREES3[f.file]!;
  const walk = (n: TNode) => {
    if (n.kind !== 'leaf') nodes.push({ id: n.id, kind: n.kind, file: f.file, parent: n.parent?.id ?? null, unitIds: n.leaves.map((i) => leafId(f.file, i)), firstUnit: n.leaves[0]! + 1, lastUnit: n.leaves.at(-1)! + 1, ...(n.depth !== undefined ? { level: n.depth } : {}) });
    n.children.forEach(walk);
  };
  walk(t.root);
  for (const g of t.groups) nodes.push({ id: g.id, kind: 'group', file: f.file, parent: g.parent?.id ?? null, unitIds: g.leaves.map((i) => leafId(f.file, i)), firstUnit: g.leaves[0]! + 1, lastUnit: g.leaves.at(-1)! + 1 });
}
const ids = new Set([...nodes.map((n) => n.id), ...U3.map((u) => u.id)]);
if (ids.size !== nodes.length + U3.length) throw new Error('node ids are not unique');
writeFileSync(join(here, 'nodes3.json'), JSON.stringify({ estateKey: 'phase3-repair-cafe', note: 'leaf (unit) ids are in gold3.json; node ids here; both minted from (estate key, file#kind, fingerprint, occurrence)', nodes }, null, 1) + '\n');
const spans = RULES3.map((r) => {
  const f = FILES3.find((x) => x.file === r.file)!;
  const t = TREES3[r.file]!;
  const local = r.leafG.map((g) => g - f.offset - 1);
  const node = r.multi ? alignedNode(t, local) : undefined;
  return { id: r.id, file: r.file, kind: r.kind, multiUnit: r.multi, unitIds: r.leafG.map((g) => U3.find((u) => u.g === g)!.id), unitNumbers: r.leafG.map((g) => g - f.offset), alignedNodeKind: r.multi ? (node?.kind ?? null) : 'leaf', alignedNodeId: node?.id ?? null, contested: r.contested, split: f.split };
});
writeFileSync(join(here, 'spans3.json'), JSON.stringify({ note: 'gold rules of gold3.json as spans: unitIds are leaf ids, in file order', rules: spans }, null, 1) + '\n');
const cnt = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
console.log('nodes', nodes.length, JSON.stringify(cnt(nodes.map((n) => n.kind))), 'leaves', U3.length);
console.log('rules', spans.length, 'multi', spans.filter((s) => s.multiUnit).length, JSON.stringify(cnt(spans.filter((s) => s.multiUnit).map((s) => s.alignedNodeKind ?? 'inside a block'))));
console.log('example', JSON.stringify(spans.find((s) => s.multiUnit && s.alignedNodeKind === 'group')));

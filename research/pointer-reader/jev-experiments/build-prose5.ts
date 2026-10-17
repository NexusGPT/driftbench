// Builds the growth corpus (gold5 author layer: three estates A support, B code interpreter, C channel tabs). prose5-src/*.md hold the author's tags after each unit:
//   {{r}} {{p}} {{g}}  a rule, prohibition or gate that is one unit (a single-unit rule)
//   {{r#k}} ...        a member of the multi-unit rule k of this file (every member carries the same letter)
//   {{e}} {{d}} {{n}}  example, description, none
// The script strips the tags, cuts the clean file into a tree (src/tree.ts), checks that the tags match the leaves one to
// one, that the members of a span are consecutive leaves, and writes prose3/*.md and gold5.author.json.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alignedNode, buildTree } from './src/tree';

const here = new URL('.', import.meta.url).pathname;
const KIND: Record<string, string> = { r: 'rule', p: 'prohibition', g: 'gate', e: 'example', d: 'description', n: 'none' };
const INSTR = new Set(['rule', 'prohibition', 'gate']);
mkdirSync(join(here, 'prose5'), { recursive: true });
const files = readdirSync(join(here, 'prose5-src')).filter((f) => f.endsWith('.md')).sort();
type Leaf = { file: string; n: number; id: string; container: string; text: string; section: string; label: string; spanKey?: string };
type Rule = { file: string; key: string; kind: string; leafNs: number[]; multi: boolean; aligned: string | null };
const leaves: Leaf[] = [], rules: Rule[] = [];
let bad = 0;
for (const f of files) {
  const src = readFileSync(join(here, 'prose5-src', f), 'utf8');
  const tags = [...src.matchAll(/\{\{([a-z])(?:#(\w+))?\}\}/g)].map((m) => ({ letter: m[1]!, key: m[2] }));
  for (const t of tags) if (!KIND[t.letter]) throw new Error(`${f}: bad tag ${t.letter}`);
  const clean = src.replace(/\{\{[a-z](?:#\w+)?\}\}/g, '');
  const name = f.replace(/^([A-C])\d+-/, '$1-');
  writeFileSync(join(here, 'prose5', name), clean);
  const tree = buildTree(clean, name, 'phase5-growth');
  const units = tree.units;
  if (units.length !== tags.length) {
    bad++;
    console.error(`${f}: cut ${units.length} units, tagged ${tags.length}`);
    const parts = src.split(/\{\{[a-z](?:#\w+)?\}\}/);
    let acc = '';
    for (let i = 0; i < tags.length; i++) {
      acc += parts[i];
      const k = buildTree(acc + '\n', name, 'x').units.length;
      if (k !== i + 1) { console.error(`  first mismatch at tag ${i + 1}: prefix gives ${k} units; text before tag: ${JSON.stringify(parts[i]!.slice(-100))}`); break; }
    }
    continue;
  }
  const idOf = (i: number) => leafId(tree, i);
  const spans = new Map<string, number[]>();
  tags.forEach((t, i) => { if (t.key) spans.set(t.key, [...(spans.get(t.key) ?? []), i]); });
  for (const [k, idx] of spans) {
    const letters = new Set(idx.map((i) => tags[i]!.letter));
    if (idx.length < 2) { bad++; console.error(`${f}: span ${k} has one member (unit ${idx[0]! + 1})`); }
    if (letters.size > 1) { bad++; console.error(`${f}: span ${k} mixes letters ${[...letters]}`); }
    if (!INSTR.has(KIND[tags[idx[0]!]!.letter]!)) { bad++; console.error(`${f}: span ${k} is not an instruction kind`); }
    for (let j = 1; j < idx.length; j++) if (idx[j] !== idx[j - 1]! + 1) { bad++; console.error(`${f}: span ${k} is not consecutive`); break; }
  }
  units.forEach((u, i) => leaves.push({ file: name, n: i + 1, id: idOf(i), container: u.container, text: u.text.replace(/\s*\n\s*/g, ' '), section: u.path.join(' > '), label: KIND[tags[i]!.letter]!, ...(tags[i]!.key ? { spanKey: tags[i]!.key! } : {}) }));
  const consumed = new Set<number>();
  for (const [k, idx] of spans) { idx.forEach((i) => consumed.add(i)); rules.push({ file: name, key: k, kind: KIND[tags[idx[0]!]!.letter]!, leafNs: idx.map((i) => i + 1), multi: true, aligned: alignedNode(tree, idx)?.kind ?? null }); }
  tags.forEach((t, i) => { if (!t.key && INSTR.has(KIND[t.letter]!)) rules.push({ file: name, key: `s${i + 1}`, kind: KIND[t.letter]!, leafNs: [i + 1], multi: false, aligned: 'leaf' }); });
}
function leafId(tree: ReturnType<typeof buildTree>, i: number): string {
  const n = tree.nodes.find((x) => x.kind === 'leaf' && x.leaves[0] === i);
  return n!.id;
}
if (bad) process.exit(1);
{ const seen = new Map<string, Leaf>(); for (const l of leaves) { const o = seen.get(l.id); if (o) console.error(`duplicate id: ${o.file}#${o.n} and ${l.file}#${l.n}: ${l.text.slice(0, 70)}`); seen.set(l.id, l); } if (seen.size !== leaves.length) throw new Error('duplicate leaf ids'); }
writeFileSync(join(here, 'gold5.author.json'), JSON.stringify({ units: leaves, rules }, null, 1) + '\n');
const multi = rules.filter((r) => r.multi);
const cnt = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
console.log(`leaves ${leaves.length} in ${files.length} files; rules ${rules.length}; multi-unit ${multi.length} (${((100 * multi.length) / rules.length).toFixed(1)}%); leaves inside multi-unit rules ${multi.reduce((a, r) => a + r.leafNs.length, 0)}`);
console.log('labels', JSON.stringify(cnt(leaves.map((l) => l.label))));
console.log('rule kinds', JSON.stringify(cnt(rules.map((r) => r.kind))), 'multi aligned to', JSON.stringify(cnt(multi.map((r) => r.aligned ?? 'none (inside a block)'))));
console.log('per file multi/rules', JSON.stringify(Object.fromEntries(files.map((f) => { const nm = f.replace(/^([A-C])\d+-/, '$1-'); return [nm, `${multi.filter((r) => r.file === nm).length}/${rules.filter((r) => r.file === nm).length}`]; }))));

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildTree } from './src/tree';
const here = new URL('.', import.meta.url).pathname;
let tot = 0;
for (const f of readdirSync(join(here, 'prose')).filter((x) => x.endsWith('.md'))) {
  const t = buildTree(readFileSync(join(here, 'prose', f), 'utf8'), f, 'test');
  const ids = new Set([...t.nodes, ...t.groups].map((n) => n.id));
  const k: Record<string, number> = {};
  for (const n of t.nodes) k[n.kind] = (k[n.kind] ?? 0) + 1;
  console.log(f.padEnd(28), 'leaves', t.units.length, JSON.stringify(k), 'groups', t.groups.length, 'unique ids', ids.size === t.nodes.length + t.groups.length);
  tot += t.units.length;
}
console.log('total leaves', tot);

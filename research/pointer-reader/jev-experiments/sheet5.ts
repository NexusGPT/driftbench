import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTree, type TNode } from './src/tree';
const here = new URL('.', import.meta.url).pathname;
export function sheetOf(file: string): string {
  const src = readFileSync(join(here, 'prose5', file), 'utf8');
  const t = buildTree(src, file, 'phase5-growth');
  const out: string[] = [`=== FILE ${file} ===`];
  const label: Record<string, string> = { paragraph: 'PARAGRAPH', list: 'LIST', table: 'TABLE', row: 'ROW', blockquote: 'QUOTE', frontmatter: 'FRONT MATTER' };
  const walk = (n: TNode, ind: string) => {
    if (n.kind === 'leaf') { out.push(`${ind}${n.leaves[0]! + 1}\t${t.units[n.leaves[0]!]!.text.replace(/\s*\n\s*/g, ' ')}`); return; }
    if (n.kind === 'section') out.push(`${ind}SECTION (level ${n.depth})`);
    else if (label[n.kind]) out.push(`${ind}${label[n.kind]}`);
    for (const c of n.children) walk(c, n.kind === 'file' ? ind : ind + '  ');
  };
  walk(t.root, '');
  return out.join('\n');
}
if (process.argv[2] && process.argv[1]?.endsWith("sheet5.ts")) {
  const files = readdirSync(join(here, 'prose5')).filter((f) => f.endsWith('.md')).sort();
  writeFileSync(process.argv[2], files.map(sheetOf).join('\n\n') + '\n');
  console.log(files.length, 'files');
}

// Structured sheet of a corpus folder (section, paragraph, list, table, row), units numbered per file. Usage: tsx jev-experiments/sheetx.ts <corpus dir> <estate key> <out file> [file ...]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTree, type TNode } from './src/tree';
const here = new URL('.', import.meta.url).pathname;
export function sheetOfFile(corpusDir: string, file: string, key: string): string {
  const src = readFileSync(join(here, corpusDir, file), 'utf8');
  const t = buildTree(src, file, key);
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
if (process.argv[1]?.endsWith('sheetx.ts') && process.argv[4]) {
  const [corpusDir, key, outFile, ...only] = process.argv.slice(2);
  const files = (only.length ? only : readdirSync(join(here, corpusDir!)).filter((f) => f.endsWith('.md')).sort());
  writeFileSync(outFile!, files.map((f) => sheetOfFile(corpusDir!, f, key!)).join('\n\n') + '\n');
  console.log(files.length, 'files', files.join(' '));
}

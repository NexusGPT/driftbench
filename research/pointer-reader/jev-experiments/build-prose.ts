// Builds the phase 2 held-out set. prose-src/*.md hold the author's tags ({{r}} after each unit);
// this strips them, cuts the clean file with the prototype cutter, checks that the number of tags equals the
// number of units, and writes prose/*.md (clean files) and gold2.author.json (author labels per unit).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cut } from '../src/cut';
import { entriesOf } from '../src/ledger';

const here = new URL('.', import.meta.url).pathname;
const TAG: Record<string, string> = { r: 'rule', p: 'prohibition', g: 'gate', e: 'example', d: 'description', n: 'none' };
mkdirSync(join(here, 'prose'), { recursive: true });
const files = readdirSync(join(here, 'prose-src')).filter((f) => f.endsWith('.md')).sort();
const out: Array<{ file: string; n: number; id: string; container: string; text: string; label: string; section: string }> = [];
let bad = 0;
for (const f of files) {
  const src = readFileSync(join(here, 'prose-src', f), 'utf8');
  const tags = [...src.matchAll(/\{\{(\w)\}\}/g)].map((m) => m[1]!);
  for (const t of tags) if (!TAG[t]) throw new Error(`${f}: bad tag ${t}`);
  // A tag sits right after its unit; remove the tag and the single space before it (none is added).
  const clean = src.replace(/\{\{\w\}\}/g, '');
  const name = f.replace(/^\d+-/, '');
  writeFileSync(join(here, 'prose', name), clean);
  const { units } = cut(clean);
  if (units.length !== tags.length) {
    bad++;
    console.error(`${f}: cut ${units.length} units, tagged ${tags.length}`);
    // find the first place where the tagged prefix and the units disagree: re-cut each tagged prefix
    const parts = src.split(/\{\{\w\}\}/);
    let acc = '';
    for (let i = 0; i < tags.length; i++) {
      acc += parts[i];
      const k = cut(acc + '\n').units.length;
      if (k !== i + 1) { console.error(`  first mismatch at tag ${i + 1}: prefix gives ${k} units; text before tag: ${JSON.stringify(parts[i]!.slice(-90))}`); break; }
    }
    continue;
  }
  const ents = entriesOf([{ path: name, units }], 'phase2-harbour');
  units.forEach((u, i) => out.push({ file: name, n: i + 1, id: ents[i]!.id, container: u.container, text: u.text, label: TAG[tags[i]!]!, section: u.path.join(' > ') }));
}
if (bad) process.exit(1);
if (new Set(out.map((o) => o.id)).size !== out.length) throw new Error('duplicate ids');
writeFileSync(join(here, 'gold2.author.json'), JSON.stringify({ units: out }, null, 1) + '\n');
const counts: Record<string, number> = {};
for (const o of out) counts[o.label] = (counts[o.label] ?? 0) + 1;
console.log(`units ${out.length} in ${files.length} files`, counts);

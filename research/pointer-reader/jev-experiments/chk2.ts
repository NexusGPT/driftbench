import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTree } from './src/tree';
const here = new URL('.', import.meta.url).pathname;
const g2 = JSON.parse(readFileSync(join(here, 'gold2.json'), 'utf8')).units as Array<{ file: string; n: number; text: string }>;
let bad = 0, total = 0;
for (const f of [...new Set(g2.map((u) => u.file))]) {
  const t = buildTree(readFileSync(join(here, 'prose', f), 'utf8'), f, 'phase2-harbour');
  const us = g2.filter((u) => u.file === f);
  if (t.units.length !== us.length) { console.log(f, 'count', t.units.length, us.length); bad++; continue; }
  us.forEach((u, i) => { const tt = t.units[i]!.text.replace(/\s*\n\s*/g, ' '); if (tt !== u.text.replace(/\s*\n\s*/g, ' ') && tt.replace(/^#+\s*/, '') !== u.text.replace(/\s*\n\s*/g, ' ')) { bad++; if (bad < 5) console.log(f, u.n, JSON.stringify(tt.slice(0, 60)), JSON.stringify(u.text.slice(0, 60))); } });
  total += us.length;
}
console.log('units checked', total, 'mismatches', bad);

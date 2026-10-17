import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const g2 = JSON.parse(readFileSync(join(here, 'gold2.json'), 'utf8')).units as Array<{ file: string; n: number; labelA: string; text: string }>;
const A = new Map(g2.map((u) => [`${u.file}#${u.n}`, u.labelA]));
const sheet = readFileSync(process.argv[2]!, 'utf8').split('\n');
let file = '';
for (const line of sheet) {
  const f = /^=== FILE (\S+) ===/.exec(line); if (f) { file = f[1]!; console.log(line); continue; }
  const m = /^(\s*)(\d+)\t(.*)$/.exec(line);
  if (m) { const lab = A.get(`${file}#${m[2]}`) ?? '?'; console.log(`${m[1]}${m[2]}\t[${lab.slice(0, 4)}]\t${m[3]!.slice(0, 150)}`); } else if (line.trim()) console.log(line);
}

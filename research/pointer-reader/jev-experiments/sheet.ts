import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const g = JSON.parse(readFileSync(join(here, 'gold2.author.json'), 'utf8')).units as Array<{ file: string; n: number; text: string; section: string }>;
const out: string[] = [];
let lastFile = '', lastSec = '\u0000';
for (const u of g) {
  if (u.file !== lastFile) { out.push('', `=== FILE ${u.file} ===`); lastFile = u.file; lastSec = '\u0000'; }
  if (u.section !== lastSec) { out.push(`## ${u.section || '(top)'}`); lastSec = u.section; }
  out.push(`${u.n}\t${u.text.replace(/\s*\n\s*/g, ' ')}`);
}
writeFileSync(process.argv[2]!, out.join('\n') + '\n');
console.log(g.length);

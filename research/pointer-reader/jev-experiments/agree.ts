import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const A = JSON.parse(readFileSync(join(here, 'gold2.author.json'), 'utf8')).units as Array<{ file: string; n: number; text: string; label: string }>;
const B = new Map(readFileSync(join(here, 'annot-b.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([f, n, l]) => [`${f}#${n}`, l!]));
const C = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
let same = 0; const m: Record<string, Record<string, number>> = {}; const dis: string[] = [];
for (const u of A) {
  const b = B.get(`${u.file}#${u.n}`); if (!b || !C.includes(b)) throw new Error(`missing/invalid ${u.file}#${u.n} ${b}`);
  if (b === u.label) same++; else dis.push(`${u.file}#${u.n}\tA=${u.label}\tB=${b}\t${u.text.slice(0, 110)}`);
  (m[u.label] ??= {})[b] = ((m[u.label] ??= {})[b] ?? 0) + 1;
}
const N = A.length, po = same / N;
let pe = 0; for (const c of C) pe += (A.filter((u) => u.label === c).length / N) * ([...B.values()].filter((x) => x === c).length / N);
console.log(`units ${N} agree ${same} (${(100 * po).toFixed(1)}%) kappa ${((po - pe) / (1 - pe)).toFixed(3)}`);
console.log('A\\B', C.join('\t')); for (const a of C) console.log(a, C.map((b) => m[a]?.[b] ?? 0).join('\t'));
writeFileSync(join(here, 'disagreements.tsv'), dis.join('\n') + '\n');
console.log(dis.join('\n'));

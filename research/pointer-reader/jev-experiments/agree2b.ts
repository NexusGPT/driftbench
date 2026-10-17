// Agreement between two label files of the harbour set. Usage: tsx jev-experiments/agree2b.ts <first.tsv> <second.tsv> [out.tsv]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const read = (f: string) => new Map(readFileSync(join(here, f), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([file, n, label]) => [`${file}#${n}`, label!]));
const g2 = JSON.parse(readFileSync(join(here, 'gold2.json'), 'utf8')).units as Array<{ file: string; n: number; text: string }>;
const [fa, fb, outFile] = process.argv.slice(2);
const A = read(fa!), B = read(fb!);
const C = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
let same = 0; const m: Record<string, Record<string, number>> = {}; const dis: string[] = [];
for (const u of g2) {
  const k = `${u.file}#${u.n}`; const a = A.get(k), b = B.get(k);
  if (!a || !b || !C.includes(a) || !C.includes(b)) throw new Error(`missing or invalid ${k}: ${a} ${b}`);
  if (a === b) same++; else dis.push(`${k}\t${fa}=${a}\t${fb}=${b}\t${u.text.slice(0, 110)}`);
  ((m[a] ??= {})[b] = ((m[a] ??= {})[b] ?? 0) + 1);
}
const N = g2.length, po = same / N; let pe = 0;
for (const c of C) pe += ([...A.values()].filter((x) => x === c).length / N) * ([...B.values()].filter((x) => x === c).length / N);
const isI = (l: string) => ['rule', 'prohibition', 'gate'].includes(l);
let ia = 0; for (const u of g2) { const k = `${u.file}#${u.n}`; if (isI(A.get(k)!) === isI(B.get(k)!)) ia++; }
console.log(`${fa} vs ${fb}: ${N} units, agree ${same} (${(100 * po).toFixed(1)}%), kappa ${((po - pe) / (1 - pe)).toFixed(3)}, instruction vs not ${(100 * ia / N).toFixed(1)}%`);
console.log(['first\\second', ...C].join('\t')); for (const a of C) console.log([a, ...C.map((b) => m[a]?.[b] ?? 0)].join('\t'));
if (outFile) writeFileSync(join(here, outFile), dis.join('\n') + '\n');
console.log('disagreements', dis.length);

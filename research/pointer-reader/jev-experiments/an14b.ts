import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { KEY, keyG, splitOfG, fmtAcc, LAB_B } from './src/key4';
import { L6, type Run4 } from './src/p4';
import { U3 } from './src/p3';
const H = [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results3', `haiku-r${r}.json`), 'utf8')) as { labels: Record<number, string> });
const acc = (f: (g: number) => string, s: number[]) => fmtAcc(s.filter((g) => f(g) === KEY.get(g)).length, s.length);
const sets = { 'key all': keyG, 'key dev': keyG.filter((g) => splitOfG(g) === 'dev'), 'key test': keyG.filter((g) => splitOfG(g) === 'test') };
for (const [i, h] of H.entries()) console.log(`Haiku run ${i + 1}:`, Object.entries(sets).map(([n, s]) => `${n} ${acc((g) => h.labels[g]!, s)}`).join(' | '));
const maj = (g: number) => { const c: Record<string, number> = {}; for (const h of H) c[h.labels[g]!] = (c[h.labels[g]!] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]![0]; };
console.log('Haiku majority of 3:', Object.entries(sets).map(([n, s]) => `${n} ${acc(maj, s)}`).join(' | '));
console.log('Annotator B (the earlier Haiku annotator) on the key:', Object.entries(sets).map(([n, s]) => `${n} ${acc((g) => LAB_B.get(g)!, s)}`).join(' | '));
// confusion of best jev design on the key
const run = JSON.parse(readFileSync(join(dir, 'results4', 'ch-structS-in-r1.json'), 'utf8')) as Run4;
const pred = (g: number) => L6.reduce((b, l) => ((run.probs[g]?.[`ch:${l}`] ?? 0) > (run.probs[g]?.[`ch:${b}`] ?? 0) ? l : b), 'rule' as string);
const m: Record<string, Record<string, number>> = {};
for (const g of keyG) { const k = KEY.get(g)!, p = pred(g); ((m[k] ??= {})[p] = ((m[k] ??= {})[p] ?? 0) + 1); }
console.log('key (rows) vs ch-structS-in-r1 (cols)'); console.log(['', ...L6].join('\t'));
for (const k of L6) console.log(k, L6.map((p) => m[k]?.[p] ?? 0).join('\t'));
const confh: Record<string, Record<string, number>> = {};
for (const g of keyG) { const k = KEY.get(g)!, p = maj(g); ((confh[k] ??= {})[p] = ((confh[k] ??= {})[p] ?? 0) + 1); }
console.log('key (rows) vs Haiku majority (cols)'); console.log(['', ...L6].join('\t'));
for (const k of L6) console.log(k, L6.map((p) => confh[k]?.[p] ?? 0).join('\t'));
void U3;

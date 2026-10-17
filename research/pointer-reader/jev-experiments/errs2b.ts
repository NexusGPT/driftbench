// Remaining error shapes on gold2b: Haiku majority of 3 (guide 2.1) and the f2 stacker (Jev features + Haiku votes), all 597 units.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { C6, evaluate, loadRuns2, type Dec } from './src/dec2';
import { features, lofoDecs } from './src/stack';
import { U } from './src/p2';
const runs = loadRuns2().filter((r) => r.variant);
const H = [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results2', `haiku2b-r${r}.json`), 'utf8')) as { labels: Record<number, string> });
const votes = (g: number) => { const c = Object.fromEntries(C6.map((k) => [k, 0])) as Record<C6, number>; for (const h of H) c[h.labels[g] as C6]++; return c; };
const hm = U.map((u) => { const c = votes(u.g); const s = [...C6].sort((a, b) => c[b] - c[a]); return { label: s[0]!, n: c[s[0]!] }; });
const jh = lofoDecs((u) => [...features(runs, u, 'all'), ...C6.map((c) => votes(u.g)[c] / 3)]);
const show = (name: string, pred: C6[]) => {
  const e = evaluate(U, pred.map((p) => ({ pred: p, conf: 1, vec: {} as never }) as Dec));
  console.log(`\n## ${name}: ${(100 * e.acc).toFixed(1)}% on ${U.length}`);
  const shape = new Map<string, number[]>();
  for (const w of e.wrong) { const k = `${w.gold} -> ${w.pred}`; shape.set(k, [...(shape.get(k) ?? []), w.g]); }
  for (const [k, gs] of [...shape.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    console.log(`- ${k}: ${gs.length}`);
    for (const g of gs.slice(0, 2)) { const u = U.find((x) => x.g === g)!; console.log(`    ${u.file}#${u.n}: ${u.text.slice(0, 110)}`); }
  }
  console.log('by file:', [...new Set(U.map((u) => u.file))].map((f) => `${f.replace('.md', '')} ${e.wrong.filter((w) => U.find((x) => x.g === w.g)!.file === f).length}`).join(', '));
};
show('Haiku majority of 3', hm.map((h) => h.label));
show('f2 (Jev stacker + Haiku votes)', jh.map((d) => d.pred));
const un = hm.filter((h) => h.n === 3).length; console.log('\nHaiku unanimous units', un, 'of', U.length);
const acc = (idx: number[]) => idx.filter((i) => hm[i]!.label === U[i]!.label).length / idx.length;
console.log('Haiku unanimous accuracy', (100 * acc(U.map((_, i) => i).filter((i) => hm[i]!.n === 3))).toFixed(1), 'non-unanimous (majority) accuracy', (100 * acc(U.map((_, i) => i).filter((i) => hm[i]!.n < 3))).toFixed(1));

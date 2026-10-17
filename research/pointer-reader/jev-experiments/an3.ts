import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { avgVec, C6, coverageAt, decLabelsT, evaluate, fromVec, loadRuns2, meanProb, pct, selective, vecDecomp, vecLabels, U, type Dec } from './src/dec2';
import { dir } from './src/arms';
import { stackDecs, DESIGNS } from './src/stack';

const runs = loadRuns2().filter((r) => r.variant);
const H = [1, 2, 3].map((r) => (JSON.parse(readFileSync(join(dir, 'results2', `haiku-r${r}.json`), 'utf8')) as { labels: Record<number, string> }).labels);
const hvote = (g: number) => { const c: Record<string, number> = {}; for (const h of H) c[h[g]!] = (c[h[g]!] ?? 0) + 1; const s = Object.entries(c).sort((a, b) => b[1] - a[1]); return { label: s[0]![0] as C6, n: s[0]![1], unanimous: s[0]![1] === H.length }; };

const subsets: Array<[string, (u: (typeof U)[0]) => boolean]> = [['dev', (u) => u.split === 'dev'], ['test', (u) => u.split === 'test'], ['all', () => true], ['agreed', (u) => !u.contested]];
function report(name: string, accept: boolean[], pred: C6[]) {
  const out = [name.padEnd(34)];
  for (const [s, f] of subsets) {
    const ix = U.map((u, i) => i).filter((i) => f(U[i]!));
    const acc = ix.filter((i) => accept[i]);
    const ok = acc.filter((i) => pred[i] === U[i]!.label).length;
    out.push(`${s} acc ${pct(ok / Math.max(1, acc.length))} abst ${pct(1 - acc.length / ix.length)}`);
  }
  console.log(out.join(' | '));
}
const all = (n: number) => new Array<boolean>(n).fill(true);

// Jev ensembles
const vecs = {
  avgLabels: U.map((u) => avgVec(DESIGNS.map(([id, pre]) => vecLabels((l) => meanProb(runs.filter((r) => r.variant === id), u.g, pre + l))))),
};
const jevAvg: Dec[] = vecs.avgLabels.map(fromVec);
const st = stackDecs(runs, 'all'); const stL = stackDecs(runs, 'labels');
console.log('stack lambda all', st.lambda, 'labels-only', stL.lambda);
report('Jev avg of 7 label designs', all(U.length), jevAvg.map((d) => d.pred));
report('Jev stacker (all features)', all(U.length), st.decs.map((d) => d.pred));
report('Jev stacker (label designs only)', all(U.length), stL.decs.map((d) => d.pred));
// selective on Jev stacker
for (const a of [0.05, 0.1, 0.2, 0.3]) {
  const order = U.map((_, i) => i).sort((x, y) => st.decs[y]!.conf - st.decs[x]!.conf);
  const acc = new Array<boolean>(U.length).fill(false); order.slice(0, Math.round(U.length * (1 - a))).forEach((i) => (acc[i] = true));
  report(`Jev stacker abstain lowest ${a * 100}%`, acc, st.decs.map((d) => d.pred));
}
// Haiku alone
const hm = U.map((u) => hvote(u.g));
report('Haiku r1 alone', all(U.length), U.map((u) => H[0]![u.g] as C6));
report('Haiku majority of 3', all(U.length), hm.map((h) => h.label));
report('Haiku unanimous else abstain', hm.map((h) => h.unanimous), hm.map((h) => h.label));
// agreement Jev stacker vs Haiku majority
report('accept iff Jev stack = Haiku maj', U.map((_, i) => st.decs[i]!.pred === hm[i]!.label), hm.map((h) => h.label));
report('accept iff Jev stack = Haiku maj & unan', U.map((_, i) => st.decs[i]!.pred === hm[i]!.label && hm[i]!.unanimous), hm.map((h) => h.label));
// cascade: Jev if margin >= m else Haiku majority, abstain if Haiku not unanimous
for (const m of [0.2, 0.4, 0.6, 0.8, 0.9, 0.95]) {
  const useJ = st.decs.map((d) => d.conf >= m);
  const pred = U.map((_, i) => (useJ[i] ? st.decs[i]!.pred : hm[i]!.label));
  const accept = U.map((_, i) => useJ[i] || hm[i]!.unanimous);
  console.log(`  margin ${m}: sent to Haiku ${pct(useJ.filter((x) => !x).length / U.length)}`);
  report(`cascade margin>=${m}`, accept, pred);
}
void coverageAt; void selective; void evaluate; void decLabelsT; void vecDecomp;

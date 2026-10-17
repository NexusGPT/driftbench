import { C6, decDecompT, decLabelsT, evaluate, loadRuns2, meanProb, pct, U } from './src/dec2';
import { SUBKEYS } from './src/p2';
const runs = loadRuns2(); const by = (id: string) => runs.filter((r) => r.variant === id);
function show(name: string, decs: ReturnType<typeof decLabelsT>[]) {
  const e = evaluate(U, decs);
  console.log(`\n${name}: acc ${pct(e.acc)} F1 ${pct(e.macroF1)}\ngold\\pred\t${C6.join('\t')}`);
  C6.forEach((c, i) => console.log(c.padEnd(11), e.conf[i]!.join('\t'), `  recall ${pct(e.per[c]!.r)} prec ${pct(e.per[c]!.p)}`));
}
const ps = ['c-para1', 'c-para2', 'c-para3'].map((id, i) => ({ rs: by(id), prefix: `p${i + 1}:` }));
show('3-para mean t=0.5', U.map((u) => decLabelsT((l) => ps.reduce((a, p) => a + meanProb(p.rs, u.g, p.prefix + l), 0) / 3, 0.5)));
show('a-rules t=0.5', U.map((u) => decLabelsT((l) => meanProb(by('a-rules'), u.g, l), 0.5)));
// sub-question separation: mean prob per gold class
const rs = by('b-decomp');
console.log('\nb-decomp mean probability by gold class');
console.log('sub\t' + C6.join('\t'));
for (const k of SUBKEYS) console.log(k + '\t' + C6.map((c) => { const xs = U.filter((u) => u.label === c).map((u) => meanProb(rs, u.g, k)); return (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2); }).join('\t'));

import { avgVec, C6, coverageAt, decDecompT, decLabelsT, evaluate, fromVec, loadRuns2, meanProb, pct, selective, vecDecomp, vecLabels, U, type Dec } from './src/dec2';
import { L5, SUBKEYS } from './src/p2';

const runs = loadRuns2();
const by = (id: string) => runs.filter((r) => r.variant === id);
const T = [0.3, 0.4, 0.5, 0.6, 0.7];
function labelDecs(rs: ReturnType<typeof by>, prefix: string, t: number): Dec[] { return U.map((u) => decLabelsT((l) => meanProb(rs, u.g, prefix + l), t)); }
const split = (s: 'dev' | 'test' | 'all', decs: Dec[]) => { const ix = U.map((u, i) => i).filter((i) => s === 'all' || U[i]!.split === s); return { units: ix.map((i) => U[i]!), decs: ix.map((i) => decs[i]!) }; };
function row(name: string, decs: Dec[]) {
  const out: string[] = [name.padEnd(28)];
  for (const s of ['dev', 'test'] as const) { const { units, decs: d } = split(s, decs); const e = evaluate(units, d); out.push(`${s} acc ${pct(e.acc)} F1 ${pct(e.macroF1)} sel10 ${pct(selective(units, d, 0.1).acc)} cov99 ${pct(coverageAt(units, d, 0.99), 0)}`); }
  console.log(out.join(' | '));
}
for (const [id, prefix] of [['base', ''], ['a-rules', ''], ['c-para1', 'p1:'], ['c-para2', 'p2:'], ['c-para3', 'p3:'], ['d-none', ''], ['d-role', '']] as const) {
  const rs = by(id); if (!rs.length) continue;
  for (const t of T) row(`${id} t=${t}`, labelDecs(rs, prefix, t));
  row(`${id} vec`, U.map((u) => fromVec(vecLabels((l) => meanProb(rs, u.g, prefix + l)))));
}
{
  const rs = by('b-decomp');
  for (const t of T) row(`b-decomp t=${t}`, U.map((u) => decDecompT((k) => meanProb(rs, u.g, k), t)));
  row('b-decomp vec', U.map((u) => fromVec(vecDecomp((k) => meanProb(rs, u.g, k)))));
}
{
  const ps = ['c-para1', 'c-para2', 'c-para3'].map((id, i) => ({ rs: by(id), prefix: `p${i + 1}:` }));
  for (const t of T) row(`c 3-para mean t=${t}`, U.map((u) => decLabelsT((l) => ps.reduce((a, p) => a + meanProb(p.rs, u.g, p.prefix + l), 0) / 3, t)));
  row('c 3-para vec mean', U.map((u) => fromVec(avgVec(ps.map((p) => vecLabels((l) => meanProb(p.rs, u.g, p.prefix + l)))))));
}
void L5; void SUBKEYS; void C6;

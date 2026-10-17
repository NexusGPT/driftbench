// Arms measured alone (3 runs each), the calibrated stacker (leave-one-file-out), the second labeller and the cascades.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { C6, avgVec, coverageAt, decDecompT, decLabelsT, evaluate, fromVec, loadRuns2, meanProb, pct, selective, vecDecomp, vecLabels, U, type Dec } from './src/dec2';
import { L5, SUBKEYS, type P2Run } from './src/p2';
import { DESIGNS, features, lofoDecs } from './src/stack';

const runs = loadRuns2().filter((r) => r.variant);
const by = (rs: P2Run[], id: string) => rs.filter((r) => r.variant === id);
const H = [1, 2, 3].map((r) => (JSON.parse(readFileSync(join(dir, 'results2', `haiku-r${r}.json`), 'utf8')) as { labels: Record<number, string> }).labels);
const votes = (g: number) => { const c = Object.fromEntries(C6.map((k) => [k, 0])) as Record<C6, number>; for (const h of H) c[h[g] as C6]++; return c; };
const hm = U.map((u) => { const c = votes(u.g); const s = [...C6].sort((a, b) => c[b] - c[a]); return { label: s[0]!, unanimous: c[s[0]!] === 3, c }; });

type Row = { name: string; decs: Dec[] };
const subsets: Array<[string, (u: (typeof U)[0]) => boolean]> = [['test', (u) => u.split === 'test'], ['dev', (u) => u.split === 'dev'], ['all', () => true], ['agreed', (u) => !u.contested]];
const sub = (f: (u: (typeof U)[0]) => boolean) => { const ix = U.map((_, i) => i).filter((i) => f(U[i]!)); return ix; };
function line(name: string, accept: boolean[], pred: C6[]) {
  const cells = subsets.map(([s, f]) => { const ix = sub(f); const acc = ix.filter((i) => accept[i]); const ok = acc.filter((i) => pred[i] === U[i]!.label).length; return `${s} ${pct(ok / Math.max(1, acc.length))} (abst ${pct(1 - acc.length / ix.length)})`; });
  console.log(`${name.padEnd(46)} | ${cells.join(' | ')}`);
}
const accAll = new Array<boolean>(U.length).fill(true);
const acceptTop = (decs: Dec[], keep: number) => { const o = U.map((_, i) => i).sort((a, b) => decs[b]!.conf - decs[a]!.conf); const a = new Array<boolean>(U.length).fill(false); o.slice(0, Math.round(U.length * keep)).forEach((i) => (a[i] = true)); return a; };

// --- arms alone: threshold chosen on dev among 0.3..0.7 ---
const T = [0.3, 0.4, 0.5, 0.6, 0.7];
function alone(name: string, mk: (t: number) => Dec[]) {
  const devIx = sub((u) => u.split === 'dev');
  let bt = 0.5, ba = -1;
  for (const t of T) { const d = mk(t); const e = evaluate(devIx.map((i) => U[i]!), devIx.map((i) => d[i]!)); if (e.acc > ba) { ba = e.acc; bt = t; } }
  const decs = mk(bt);
  console.log(`\n== ${name} (t=${bt} chosen on dev)`);
  line('  no abstention', accAll, decs.map((d) => d.pred));
  line('  abstain lowest-confidence 10%', acceptTop(decs, 0.9), decs.map((d) => d.pred));
  return { decs, t: bt };
}
const out: Record<string, Dec[]> = {};
out.base = alone('0 baseline (phase 1 design)', (t) => U.map((u) => decLabelsT((l) => meanProb(by(runs, 'base'), u.g, l), t))).decs;
out.a = alone('a rules + contrastive examples', (t) => U.map((u) => decLabelsT((l) => meanProb(by(runs, 'a-rules'), u.g, l), t))).decs;
out.b = alone('b decomposed sub-questions', (t) => U.map((u) => decDecompT((k) => meanProb(by(runs, 'b-decomp'), u.g, k), t))).decs;
out.c = alone('c 3 paraphrases, mean', (t) => U.map((u) => decLabelsT((l) => ([1, 2, 3] as const).reduce((a, k) => a + meanProb(by(runs, `c-para${k}`), u.g, `p${k}:${l}`), 0) / 3, t))).decs;
out.dn = alone('d0 no heading lines', (t) => U.map((u) => decLabelsT((l) => meanProb(by(runs, 'd-none'), u.g, l), t))).decs;
out.dr = alone('d2 heading lines + file role', (t) => U.map((u) => decLabelsT((l) => meanProb(by(runs, 'd-role'), u.g, l), t))).decs;

// --- calibration alone: stacker over ONE design, leave-one-file-out ---
console.log('\n== calibrated stacker (leave-one-file-out) over parts');
const featFor = (ids: Array<[string, string]>, withSub: boolean) => (u: (typeof U)[0]) => [...ids.flatMap(([id, pre]) => L5.map((l) => meanProb(by(runs, id), u.g, pre + l))), ...(withSub ? SUBKEYS.map((k) => meanProb(by(runs, 'b-decomp'), u.g, k)) : [])];
const parts: Array<[string, Array<[string, string]>, boolean]> = [
  ['base only', [['base', '']], false], ['a-rules only', [['a-rules', '']], false], ['b-decomp only', [], true],
  ['c paraphrases only', [['c-para1', 'p1:'], ['c-para2', 'p2:'], ['c-para3', 'p3:']], false], ['d none+role', [['d-none', ''], ['d-role', '']], false],
  ['all Jev designs', DESIGNS, true],
];
const stacked: Record<string, Dec[]> = {};
for (const [name, ids, s] of parts) { stacked[name] = lofoDecs(featFor(ids, s)); line(`  stack ${name}`, accAll, stacked[name]!.map((d) => d.pred)); }
const jev = stacked['all Jev designs']!;
console.log('\n== selective prediction on the Jev stacker');
for (const a of [0.05, 0.1, 0.2, 0.3]) line(`  abstain lowest ${a * 100}%`, acceptTop(jev, 1 - a), jev.map((d) => d.pred));

// --- second labeller ---
console.log('\n== Haiku (claude-haiku-5-5, GUIDE.md as system prompt, windows of 40)');
line('  one run', accAll, U.map((u) => H[0]![u.g] as C6));
line('  majority of 3', accAll, hm.map((h) => h.label));
line('  unanimous of 3 else abstain', hm.map((h) => h.unanimous), hm.map((h) => h.label));

// --- cascades: first labeller x second labeller ---
function cascade(label: string, first: Dec[]) {
  console.log(`\n== (e) ${label}: margin below m goes to Haiku majority; abstain if Haiku is not unanimous`);
  for (const m of [0.3, 0.6, 0.8, 0.9, 0.95]) {
    const useJ = first.map((d) => d.conf >= m);
    const pred = U.map((_, i) => (useJ[i] ? first[i]!.pred : hm[i]!.label));
    const accept = U.map((_, i) => useJ[i] || hm[i]!.unanimous);
    line(`  m=${m} (to Haiku ${pct(useJ.filter((x) => !x).length / U.length, 0)}%)`, accept, pred);
  }
  console.log(`  agreement: accept iff first labeller = Haiku majority`);
  line('    agree', U.map((_, i) => first[i]!.pred === hm[i]!.label), hm.map((h) => h.label));
  line('    agree and unanimous', U.map((_, i) => first[i]!.pred === hm[i]!.label && hm[i]!.unanimous), hm.map((h) => h.label));
}
cascade('baseline Jev (t=0.5 from dev) as first labeller', out.base!);
cascade('f: calibrated stacker over all Jev designs as first labeller', jev);

// --- one stacker over Jev features + Haiku votes ---
console.log('\n== f2: stacker over Jev features + Haiku vote counts (leave-one-file-out)');
const fJH = (u: (typeof U)[0]) => [...features(runs, u, 'all'), ...C6.map((c) => votes(u.g)[c] / 3)];
const jh = lofoDecs(fJH);
line('  no abstention', accAll, jh.map((d) => d.pred));
for (const a of [0.05, 0.1, 0.15, 0.2]) line(`  abstain lowest ${a * 100}%`, acceptTop(jh, 1 - a), jh.map((d) => d.pred));
// coverage at 99
for (const [name, d] of [['Jev stacker', jev], ['Jev+Haiku stacker', jh]] as const) {
  for (const [s, f] of subsets) { const ix = sub(f); console.log(`${name} ${s}: largest share accepted with accuracy >= 99%: ${pct(coverageAt(ix.map((i) => U[i]!), ix.map((i) => d[i]!), 0.99), 0)}%`); }
}
void avgVec; void fromVec; void vecDecomp; void vecLabels; void selective;
void ({} as Row);

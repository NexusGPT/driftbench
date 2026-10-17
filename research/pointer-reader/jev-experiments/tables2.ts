// Prints the markdown tables of RESULTS-2.md from results2/*.json, haiku-r*.json and gold2.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { C6, decDecompT, decLabelsT, evaluate, loadRuns2, meanProb, pct, U, type Dec } from './src/dec2';
import { DESIGNS, features, lofoDecs } from './src/stack';
import { L5, SUBKEYS, type P2Run } from './src/p2';

const runs = loadRuns2().filter((r) => r.variant);
const by = (id: string, rs = runs) => rs.filter((r) => r.variant === id);
const H = [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results2', `haiku-r${r}.json`), 'utf8')) as { labels: Record<number, string>; calls: number });
const votes = (g: number) => { const c = Object.fromEntries(C6.map((k) => [k, 0])) as Record<C6, number>; for (const h of H) c[h.labels[g] as C6]++; return c; };
const hm = U.map((u) => { const c = votes(u.g); const s = [...C6].sort((a, b) => c[b] - c[a]); return { label: s[0]!, unanimous: c[s[0]!] === 3 }; });
const ix = (f: (u: (typeof U)[0]) => boolean) => U.map((_, i) => i).filter((i) => f(U[i]!));
const SPL = { test: ix((u) => u.split === 'test'), dev: ix((u) => u.split === 'dev'), all: ix(() => true), agreed: ix((u) => !u.contested) };
const accOn = (set: number[], accept: boolean[], pred: C6[]) => { const a = set.filter((i) => accept[i]); return { acc: a.filter((i) => pred[i] === U[i]!.label).length / Math.max(1, a.length), abst: 1 - a.length / set.length }; };
const top = (decs: Dec[], keep: number) => { const o = U.map((_, i) => i).sort((a, b) => decs[b]!.conf - decs[a]!.conf); const a = new Array<boolean>(U.length).fill(false); o.slice(0, Math.round(U.length * keep)).forEach((i) => (a[i] = true)); return a; };
const ALL = new Array<boolean>(U.length).fill(true);
const T = [0.3, 0.4, 0.5, 0.6, 0.7];
const pickT = (mk: (t: number, rs: P2Run[]) => Dec[], rs: P2Run[]) => { let bt = 0.5, ba = -1; for (const t of T) { const d = mk(t, rs); const e = evaluate(SPL.dev.map((i) => U[i]!), SPL.dev.map((i) => d[i]!)); if (e.acc > ba) { ba = e.acc; bt = t; } } return bt; };
const sum = (rs: P2Run[], f: (c: P2Run['calls'][number]) => number) => rs.reduce((a, r) => a + r.calls.reduce((b, c) => b + f(c), 0), 0) / rs.length;

type Arm = { name: string; id: string; mk: (t: number, rs: P2Run[]) => Dec[] };
const lab = (prefix = '') => (t: number, rs: P2Run[]) => U.map((u) => decLabelsT((l) => meanProb(rs, u.g, prefix + l), t));
const arms: Arm[] = [
  { name: '0 baseline: phase 1 design (5 definition questions, window of 30)', id: 'base', mk: lab() },
  { name: 'a decision rules + contrastive examples (window of 20)', id: 'a-rules', mk: lab() },
  { name: 'b six decomposed sub-questions, combined in code (window of 25)', id: 'b-decomp', mk: (t, rs) => U.map((u) => decDecompT((k) => meanProb(rs, u.g, k), t)) },
  { name: 'd0 context removed (no heading lines)', id: 'd-none', mk: lab() },
  { name: 'd2 context added (heading lines + file role line)', id: 'd-role', mk: lab() },
];
const out: string[] = [];
const P = (s = '') => out.push(s);
P('### Arms alone: one pass, and the mean probability of 3 passes');
P();
P('Threshold chosen on the dev files among 0.3 to 0.7. "Test" = 5 files, 375 units; "all" = 597; "agreed" = the 540 units both annotators labelled alike. "Abst 10%" = the 10% of units with the lowest confidence held back. Calls and tokens are per pass over the 597 units.');
P();
P('| Arm | t | Calls / pass | Tokens in / out per pass (k) | One pass, test acc % (min to max of 3) | Mean of 3 passes, test acc % | Mean of 3, all acc % | Mean of 3, agreed acc % | Mean of 3, test acc with abst 10% (accepted) |');
P('|---|---|---|---|---|---|---|---|---|');
const confs: string[] = [];
const decsOf: Record<string, Dec[]> = {};
const addArm = (name: string, id: string, mk: Arm['mk'], rs: P2Run[]) => {
  const t = pickT(mk, rs);
  const single = rs.map((r) => mk(t, [r]));
  const sAcc = single.map((d) => accOn(SPL.test, ALL, d.map((x) => x.pred)).acc);
  const d3 = mk(t, rs); decsOf[id] = d3;
  const pr = d3.map((d) => d.pred);
  const a10 = accOn(SPL.test, top(d3, 0.9), pr);
  P(`| ${name} | ${t} | ${rs[0]!.calls.length} | ${(sum(rs, (c) => c.tokIn ?? 0) / 1000).toFixed(0)} / ${(sum(rs, (c) => c.tokOut ?? 0) / 1000).toFixed(0)} | ${pct(sAcc.reduce((a, b) => a + b, 0) / sAcc.length)} (${pct(Math.min(...sAcc))} to ${pct(Math.max(...sAcc))}) | ${pct(accOn(SPL.test, ALL, pr).acc)} | ${pct(accOn(SPL.all, ALL, pr).acc)} | ${pct(accOn(SPL.agreed, ALL, pr).acc)} | ${pct(a10.acc)} (abst ${pct(a10.abst)}) |`);
  const e = evaluate(U, d3);
  confs.push(`**${name}**, all 597 units, t=${t} (rows gold, columns predicted)\n\n| gold | ${C6.join(' | ')} | recall % |\n|---|${C6.map(() => '---').join('|')}|---|\n${C6.map((c, i) => `| ${c} | ${e.conf[i]!.join(' | ')} | ${pct(e.per[c]!.r)} |`).join('\n')}\n| precision % | ${C6.map((c) => pct(e.per[c]!.p)).join(' | ')} | |`);
};
for (const a of arms) addArm(a.name, a.id, a.mk, by(a.id));
// arm c: three paraphrases, each one pass; "single" = one pass of one paraphrase (mean over the 3 paraphrases)
{
  const rs1 = [1, 2, 3].map((k) => by(`c-para${k}`));
  const mkC = (t: number, pass: number[]) => U.map((u) => decLabelsT((l) => ([1, 2, 3] as const).reduce((a, k) => a + meanProb(pass.map((p) => rs1[k - 1]![p]!), u.g, `p${k}:${l}`), 0) / 3, t));
  const pass3 = [0, 1, 2];
  let bt = 0.5, ba = -1; for (const t of T) { const d = mkC(t, pass3); const e = evaluate(SPL.dev.map((i) => U[i]!), SPL.dev.map((i) => d[i]!)); if (e.acc > ba) { ba = e.acc; bt = t; } }
  const singles = [0, 1, 2].map((p) => accOn(SPL.test, ALL, mkC(bt, [p]).map((d) => d.pred)).acc);
  const d3 = mkC(bt, pass3); decsOf['c'] = d3; const pr = d3.map((d) => d.pred);
  const allRuns = [1, 2, 3].flatMap((k) => rs1[k - 1]!);
  const callsPass = [1, 2, 3].reduce((a, k) => a + rs1[k - 1]![0]!.calls.length, 0);
  const tin = [1, 2, 3].reduce((a, k) => a + sum(rs1[k - 1]!, (c) => c.tokIn ?? 0), 0), tout = [1, 2, 3].reduce((a, k) => a + sum(rs1[k - 1]!, (c) => c.tokOut ?? 0), 0);
  const a10 = accOn(SPL.test, top(d3, 0.9), pr);
  P(`| c 3 paraphrases, probabilities averaged (window of 30) | ${bt} | ${callsPass} | ${(tin / 1000).toFixed(0)} / ${(tout / 1000).toFixed(0)} | ${pct(singles.reduce((a, b) => a + b, 0) / 3)} (${pct(Math.min(...singles))} to ${pct(Math.max(...singles))}) | ${pct(accOn(SPL.test, ALL, pr).acc)} | ${pct(accOn(SPL.all, ALL, pr).acc)} | ${pct(accOn(SPL.agreed, ALL, pr).acc)} | ${pct(a10.acc)} (abst ${pct(a10.abst)}) |`);
  const e = evaluate(U, d3);
  confs.push(`**c 3 paraphrases averaged**, all 597 units, t=${bt}\n\n| gold | ${C6.join(' | ')} | recall % |\n|---|${C6.map(() => '---').join('|')}|---|\n${C6.map((c, i) => `| ${c} | ${e.conf[i]!.join(' | ')} | ${pct(e.per[c]!.r)} |`).join('\n')}\n| precision % | ${C6.map((c) => pct(e.per[c]!.p)).join(' | ')} | |`);
  void allRuns;
}
P();
P('For arm c the "one pass" column is one pass of one paraphrase (calls and tokens in the row are for all three paraphrases once). For arms 0, a, b, d the mean of 3 passes repeats the same questions 3 times.');
P();
// stackers
P('### Calibrated stacker over Jev probabilities (leave-one-file-out, 3-pass mean features)');
P();
P('Multinomial logistic regression, L2 0.03, trained on the 7 other files for each file; no test file is in its own training set.');
P();
P('| Features | Test acc % | All acc % | Agreed acc % | Test, abst 10% (accepted acc) | Test, abst 30% (accepted acc) |');
P('|---|---|---|---|---|---|');
const featFor = (ids: Array<[string, string]>, withSub: boolean) => (u: (typeof U)[0]) => [...ids.flatMap(([id, pre]) => L5.map((l) => meanProb(by(id), u.g, pre + l))), ...(withSub ? SUBKEYS.map((k) => meanProb(by('b-decomp'), u.g, k)) : [])];
const parts: Array<[string, Array<[string, string]>, boolean]> = [['arm 0 only', [['base', '']], false], ['arm a only', [['a-rules', '']], false], ['arm b only', [], true], ['arm c only', [['c-para1', 'p1:'], ['c-para2', 'p2:'], ['c-para3', 'p3:']], false], ['arm d only (none + role)', [['d-none', ''], ['d-role', '']], false], ['all Jev designs (arms 0, a, b, c, d)', DESIGNS, true]];
let jev: Dec[] = [];
for (const [name, ids, s] of parts) {
  const d = lofoDecs(featFor(ids, s)); if (name.startsWith('all')) jev = d;
  const pr = d.map((x) => x.pred);
  P(`| ${name} | ${pct(accOn(SPL.test, ALL, pr).acc)} | ${pct(accOn(SPL.all, ALL, pr).acc)} | ${pct(accOn(SPL.agreed, ALL, pr).acc)} | ${pct(accOn(SPL.test, top(d, 0.9), pr).acc)} | ${pct(accOn(SPL.test, top(d, 0.7), pr).acc)} |`);
}
decsOf['stack'] = jev;
{ const e = evaluate(U, jev); confs.push(`**Calibrated stacker over all Jev designs**, all 597 units (leave-one-file-out)\n\n| gold | ${C6.join(' | ')} | recall % |\n|---|${C6.map(() => '---').join('|')}|---|\n${C6.map((c, i) => `| ${c} | ${e.conf[i]!.join(' | ')} | ${pct(e.per[c]!.r)} |`).join('\n')}\n| precision % | ${C6.map((c) => pct(e.per[c]!.p)).join(' | ')} | |`); }
P();
const stackCalls = DESIGNS.reduce((a, [id]) => a + by(id)[0]!.calls.length, 0) + by('b-decomp')[0]!.calls.length;
P(`Calls for the all-designs stacker: ${stackCalls} per pass over the 597 units, times 3 passes = ${stackCalls * 3} calls.`);
P();
// Haiku and cascades
P('### Second labeller and the cascade (arm e), and the best combination (arm f)');
P();
P('Haiku = `claude-haiku-5-5`, the labelling guide as system prompt, windows of 40 units, 3 runs. "To Haiku" = share of units whose first-labeller confidence is below the margin m.');
P();
P('| Design | Test acc % (abstain %) | All acc % (abstain %) | Agreed acc % (abstain %) |');
P('|---|---|---|---|');
const row = (name: string, accept: boolean[], pred: C6[]) => { const c = (s: number[]) => { const r = accOn(s, accept, pred); return `${pct(r.acc)} (${pct(r.abst)})`; }; P(`| ${name} | ${c(SPL.test)} | ${c(SPL.all)} | ${c(SPL.agreed)} |`); };
row('Jev arm 0 alone (3-pass mean)', ALL, decsOf['base']!.map((d) => d.pred));
row('Jev stacker alone', ALL, jev.map((d) => d.pred));
row('Jev stacker, abstain lowest 10%', top(jev, 0.9), jev.map((d) => d.pred));
row('Jev stacker, abstain lowest 30%', top(jev, 0.7), jev.map((d) => d.pred));
row('Haiku, one run (run 1)', ALL, U.map((u) => H[0]!.labels[u.g] as C6));
row('Haiku, majority of 3', ALL, hm.map((h) => h.label));
row('Haiku, unanimous of 3 else abstain', hm.map((h) => h.unanimous), hm.map((h) => h.label));
for (const [lbl, first] of [['e: arm 0 as first labeller', decsOf['base']!], ['f: stacker as first labeller', jev]] as const) {
  for (const m of [0.3, 0.6, 0.9]) {
    const useJ = first.map((d) => d.conf >= m);
    row(`${lbl}, m=${m} (to Haiku ${pct(useJ.filter((x) => !x).length / U.length, 0)}%), abstain if Haiku not unanimous`, U.map((_, i) => useJ[i] || hm[i]!.unanimous), U.map((_, i) => (useJ[i] ? first[i]!.pred : hm[i]!.label)));
  }
  row(`${lbl}: accept iff it equals Haiku majority`, U.map((_, i) => first[i]!.pred === hm[i]!.label), hm.map((h) => h.label));
  row(`${lbl}: accept iff it equals Haiku majority and Haiku unanimous`, U.map((_, i) => first[i]!.pred === hm[i]!.label && hm[i]!.unanimous), hm.map((h) => h.label));
}
const fJH = (u: (typeof U)[0]) => [...features(runs, u, 'all'), ...C6.map((c) => votes(u.g)[c] / 3)];
const jh = lofoDecs(fJH);
decsOf['jh'] = jh;
row('f2: one stacker over Jev features + Haiku vote counts', ALL, jh.map((d) => d.pred));
for (const a of [0.05, 0.1, 0.15, 0.2]) row(`f2, abstain lowest ${a * 100}%`, top(jh, 1 - a), jh.map((d) => d.pred));
{ const e = evaluate(U, jh); confs.push(`**f2: stacker over Jev features + Haiku votes**, all 597 units (leave-one-file-out)\n\n| gold | ${C6.join(' | ')} | recall % |\n|---|${C6.map(() => '---').join('|')}|---|\n${C6.map((c, i) => `| ${c} | ${e.conf[i]!.join(' | ')} | ${pct(e.per[c]!.r)} |`).join('\n')}\n| precision % | ${C6.map((c) => pct(e.per[c]!.p)).join(' | ')} | |`); }
{ const e = evaluate(U, hm.map((h) => ({ pred: h.label, conf: 1, vec: {} as never }))); confs.push(`**Haiku majority of 3**, all 597 units\n\n| gold | ${C6.join(' | ')} | recall % |\n|---|${C6.map(() => '---').join('|')}|---|\n${C6.map((c, i) => `| ${c} | ${e.conf[i]!.join(' | ')} | ${pct(e.per[c]!.r)} |`).join('\n')}\n| precision % | ${C6.map((c) => pct(e.per[c]!.p)).join(' | ')} | |`); }
P();
P(`Haiku cost: ${H.reduce((a, h) => a + h.calls, 0)} calls for 3 passes.`);
P();
P('### Confusion matrices');
P();
confs.forEach((c) => { P(c); P(); });
console.log(out.join('\n'));

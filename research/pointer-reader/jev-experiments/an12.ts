// Per-unit arms alone on the span corpus (the phase 2 arms, same questions), thresholds chosen on dev; accuracy split by position in a rule.
import { C6, decDecompT, decLabelsT, meanProb, type Dec } from './src/dec2';
import { U3, byG3 } from './src/p3';
import { MULTI_G, RUNS3, loadHaiku3, pct, stackFromGold2, stackLofo3, votes } from './src/lib3';
const by = (id: string) => RUNS3.filter((r) => r.variant === id);
const ix = (f: (g: number) => boolean) => U3.map((u, i) => i).filter((i) => f(U3[i]!.g));
const sets = { dev: ix((g) => byG3.get(g)!.split === 'dev'), test: ix((g) => byG3.get(g)!.split === 'test') };
const acc = (decs: Dec[], set: number[]) => set.length ? set.filter((i) => decs[i]!.pred === U3[i]!.label).length / set.length : NaN;
const T = [0.3, 0.4, 0.5, 0.6, 0.7];
function pick(mk: (t: number) => Dec[]): { decs: Dec[]; t: number } { let bt = 0.5, ba = -1; for (const t of T) { const a = acc(mk(t), sets.dev); if (a > ba) { ba = a; bt = t; } } return { decs: mk(bt), t: bt }; }
const rows: Array<[string, Dec[], string]> = [];
const lab = (id: string, prefix = '') => (t: number) => U3.map((u) => decLabelsT((l) => meanProb(by(id), u.g, prefix + l), t));
for (const [name, id] of [['0 baseline wording', 'base'], ['a rules + contrastive examples', 'a-rules'], ['d0 no heading lines', 'd-none'], ['d2 heading lines + file role', 'd-role']] as const) { const p = pick(lab(id)); rows.push([name, p.decs, `t=${p.t}`]); }
{ const p = pick((t) => U3.map((u) => decDecompT((k) => meanProb(by('b-decomp'), u.g, k), t))); rows.push(['b decomposed sub-questions', p.decs, `t=${p.t}`]); }
{ const p = pick((t) => U3.map((u) => decLabelsT((l) => ([1, 2, 3] as const).reduce((a, k) => a + meanProb(by(`c-para${k}`), u.g, `p${k}:${l}`), 0) / 3, t))); rows.push(['c three paraphrases averaged', p.decs, `t=${p.t}`]); }
rows.push(['Stacker over all Jev designs, trained on the other corpus', stackFromGold2(false), 'no label of this corpus']);
rows.push(['Stacker over all Jev designs, leave-one-file-out on this corpus', stackLofo3(false), '8 files of labels']);
const hs = loadHaiku3();
rows.push(['Haiku, span guide, majority of 3', U3.map((u) => { const c = votes(hs, u.g); const s = [...C6].sort((a, b) => c[b] - c[a]); return { pred: s[0]!, conf: 1, vec: {} as never }; }), '3 calls per file']);
const out: string[] = [];
out.push('| Per-unit labeller | All units, test acc % | Outside multi-unit rules | Inside multi-unit rules | All units, dev acc % |', '|---|---|---|---|---|');
for (const [n, d, t] of rows) out.push(`| ${n} (${t}) | ${pct(acc(d, sets.test))} | ${pct(acc(d, sets.test.filter((i) => !MULTI_G.has(U3[i]!.g))))} | ${pct(acc(d, sets.test.filter((i) => MULTI_G.has(U3[i]!.g))))} | ${pct(acc(d, sets.dev))} |`);
console.log(out.join('\n'));

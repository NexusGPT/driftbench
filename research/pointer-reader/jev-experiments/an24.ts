// Usage: CORPUS=5 tsx jev-experiments/an24.ts <J1|Jx>   The default stack on the growth corpus: Jev head first, lowest-margin share to Haiku (3 runs, guide 2.1), unanimous accepted, else a person.
// J1 = head trained leave-one-file-out on the agreed units of the other growth files; Jx = head trained on the span corpus only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { KEY, keyG, wilson, splitOfG } from './src/key4';
import { U3 } from './src/p3';
import { HAIKU, PRICE, haikuEff, type Decision } from './src/dec4';
import { headDecisions, HEADS } from './heads4';

const which = process.argv[2] ?? 'J1';
const J: Map<number, Decision> = which === 'Jx' ? new Map(JSON.parse(readFileSync(join(dir, 'heads5', 'Jx.json'), 'utf8')) as Array<[number, Decision]>) : headDecisions(HEADS.find((h) => h.id === which)!);
const f = (k: number, n: number) => { const w = wilson(k, n); return `${(100 * w.p).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`; };
const est = (g: number) => U3[g - 1]!.file[0]!;
const hv = (g: number) => { const c: Record<string, number> = {}; for (const h of HAIKU) { const l = h.labels[g]; if (l) c[l] = (c[l] ?? 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
const hLabel = (g: number) => hv(g)[0]?.[0], hUnan = (g: number) => hv(g)[0]?.[1] === 3;
const out: string[] = [];
const P = (...s: string[]) => out.push(...(s.length ? s : ['']));
const sub = (set: number[]) => ({ all: set, A: set.filter((g) => est(g) === 'A'), B: set.filter((g) => est(g) === 'B'), C: set.filter((g) => est(g) === 'C') });
const K = sub(keyG);
P(`Head: ${which === 'Jx' ? 'trained on the span corpus only (9 files, 465 keyed units), no unit of the growth corpus' : 'trained leave one file out on the agreed units of the other growth files'}. Key = agreed units, ${keyG.length} of ${U3.length}.`, '');
P('#### Systems alone, on the key', '', '| System | All estates [Wilson 95%] | Estate A | Estate B | Estate C |', '|---|---|---|---|---|');
const row = (name: string, ok: (g: number) => boolean) => P(`| ${name} | ${(['all', 'A', 'B', 'C'] as const).map((e) => f(K[e].filter(ok).length, K[e].length)).join(' | ')} |`);
row(`Jev head ${which}, 0% unsure`, (g) => J.get(g)!.pred === KEY.get(g));
for (const r of [1, 2, 3]) row(`Haiku run ${r}`, (g) => HAIKU[r - 1]!.labels[g] === KEY.get(g));
row('Haiku majority of 3', (g) => hLabel(g) === KEY.get(g));
const un = keyG.filter(hUnan);
P(`| Haiku unanimous only | ${f(un.filter((g) => hLabel(g) === KEY.get(g)).length, un.length)} on ${(100 * un.length / keyG.length).toFixed(1)}% of units | | | |`);
// 10% unsure for Jev
{ const o = [...keyG].sort((a, b) => J.get(b)!.conf - J.get(a)!.conf); const keep = o.slice(0, Math.round(o.length * 0.9)); P(`| Jev head, 10% lowest-margin units unsure | ${f(keep.filter((g) => J.get(g)!.pred === KEY.get(g)).length, keep.length)} | | | |`); }
P();
// cascade
const stack = (cut: number, set: number[]) => {
  const rows = set.map((g) => { const sent = J.get(g)!.conf < cut; const lab = sent ? (hUnan(g) ? hLabel(g)! : null) : J.get(g)!.pred; return { g, sent, lab }; });
  const acc = rows.filter((r) => r.lab !== null);
  return { n: set.length, sent: rows.filter((r) => r.sent).length, accepted: acc.length, ok: acc.filter((r) => r.lab === KEY.get(r.g)).length, jevAcc: rows.filter((r) => !r.sent), jevOk: rows.filter((r) => !r.sent && r.lab === KEY.get(r.g)).length };
};
P('#### The stack at a margin cut: Jev head first, Haiku (3 runs) for units below the cut, unanimous Haiku accepted, otherwise a person', '', '| Margin cut | Share sent to Haiku | Accuracy on accepted, key [Wilson 95%] | Accepted units | To a person % | Accuracy of Jev-accepted units | Estate A / B / C accuracy on accepted |', '|---|---|---|---|---|---|---|');
for (const cut of [0, 0.3, 0.5, 0.65, 0.76, 0.9, 1.01]) {
  const s = stack(cut, keyG), per = (['A', 'B', 'C'] as const).map((e) => { const x = stack(cut, K[e]); return f(x.ok, x.accepted); });
  P(`| ${cut === 1.01 ? 'all to Haiku' : cut} | ${(100 * s.sent / s.n).toFixed(0)}% | ${f(s.ok, s.accepted)} | ${s.accepted} | ${(100 * (1 - s.accepted / s.n)).toFixed(1)} | ${s.n - s.sent ? f(s.jevOk, s.n - s.sent) : 'n/a'} | ${per.join(' / ')} |`);
}
P();
// dev-chosen cut: estates A and B are dev, estate C is test
P('#### Cut chosen on estates A and B, applied to estate C', '', '| Target accuracy of Jev-accepted units on A and B | Margin cut | A and B: share kept by Jev | Estate C: share kept by Jev | Estate C: accuracy of Jev-accepted | Estate C: share sent to Haiku | Estate C: accuracy on accepted [Wilson 95%] | Estate C: to a person % |', '|---|---|---|---|---|---|---|---|');
const dev = keyG.filter((g) => splitOfG(g) === 'dev'), test = keyG.filter((g) => splitOfG(g) === 'test');
for (const target of [0.95, 0.97, 0.98, 0.99]) {
  let cut = 1.01; for (let c = 0; c <= 1; c += 0.01) { const s = stack(c, dev); if (s.n - s.sent && s.jevOk / (s.n - s.sent) >= target) { cut = c; break; } }
  const d = stack(cut, dev), t = stack(cut, test);
  P(`| ${(100 * target).toFixed(0)}% | ${cut.toFixed(2)} | ${(100 * (d.n - d.sent) / d.n).toFixed(0)}% | ${(100 * (t.n - t.sent) / t.n).toFixed(0)}% | ${t.n - t.sent ? f(t.jevOk, t.n - t.sent) : 'n/a'} | ${(100 * t.sent / t.n).toFixed(0)}% | ${f(t.ok, t.accepted)} | ${(100 * (1 - t.accepted / t.n)).toFixed(1)} |`);
}
P();
// agreement rule
{ const acc = keyG.filter((g) => hUnan(g) && J.get(g)!.pred === hLabel(g)); P(`Accept only if the Jev head and a unanimous Haiku give the same label: ${f(acc.filter((g) => hLabel(g) === KEY.get(g)).length, acc.length)} on ${acc.length} of ${keyG.length} key units; ${(100 * (1 - acc.length / keyG.length)).toFixed(1)}% to a person.`, ''); }
// all units, against author labels and Opus labels
{ const allG = U3.map((u) => u.g); const s = stack(0.65, allG); const A = JSON.parse(readFileSync(join(dir, 'gold5.json'), 'utf8')).units as Array<{ labelAuthor: string; labelOpus: string }>;
  const acc = (() => { const rows = allG.map((g) => { const sent = J.get(g)!.conf < 0.65; return { g, lab: sent ? (hUnan(g) ? hLabel(g)! : null) : J.get(g)!.pred }; }).filter((r) => r.lab !== null); return rows; })();
  P(`All ${allG.length} units at cut 0.65, accepted ${acc.length} (${(100 * (1 - acc.length / allG.length)).toFixed(1)}% to a person): accuracy against the author labels ${f(acc.filter((r) => r.lab === A[r.g - 1]!.labelAuthor).length, acc.length)}, against the Opus labels ${f(acc.filter((r) => r.lab === A[r.g - 1]!.labelOpus).length, acc.length)}. Sent to Haiku: ${s.sent}.`, ''); }
// cost
const hE = haikuEff([1, 2, 3], U3.length);
P(`Haiku, 3 full runs on all ${U3.length} units: ${hE.calls} calls, ${hE.tokIn} input and ${hE.tokOut} output tokens, USD ${(hE.tokIn * PRICE.haikuIn + hE.tokOut * PRICE.haikuOut).toFixed(3)} (${(100 * (hE.tokIn * PRICE.haikuIn + hE.tokOut * PRICE.haikuOut) / U3.length).toFixed(4)} per 100 units); median ${(hE.msList.sort((a, b) => a - b)[Math.floor(hE.msList.length / 2)]! / 1000).toFixed(1)} s per call.`);
void existsSync;
writeFileSync(join(dir, `an24-${which}.out.md`), out.join('\n') + '\n');
console.log(out.join('\n'));

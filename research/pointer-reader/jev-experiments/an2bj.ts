// Jev choice design on the harbour set under gold2b: old definitions vs guide 2.1 definitions; raw, calibrated (leave one file out), and with Haiku votes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { C6, fromVec, selective, type Dec, type Vec } from './src/dec2';
import { lofoDecs } from './src/stack';
import { U } from './src/p2';
import { wilson } from './src/key4';

const load = (mode: string) => [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results2b', `jev2b-${mode}-r${r}.json`), 'utf8')) as { probs: Record<number, Record<string, number>>; calls: Array<{ ms: number; tokIn?: number; tokOut?: number }>; wallMs: number });
const H = [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results2', `haiku2b-r${r}.json`), 'utf8')) as { labels: Record<number, string> });
const hv = (g: number) => C6.map((c) => H.filter((h) => h.labels[g] === c).length / 3);
const vecOf = (runs: ReturnType<typeof load>, g: number, passes: number[]): number[] => C6.map((c) => passes.reduce((a, p) => a + (runs[p]!.probs[g]?.[c] ?? 0), 0) / passes.length);
const dec = (v: number[]): Dec => fromVec(Object.fromEntries(C6.map((c, i) => [c, v[i]!])) as Vec);
const idx = (f: (u: (typeof U)[0]) => boolean) => U.map((u, i) => (f(u) ? i : -1)).filter((i) => i >= 0);
const sets = { all: idx(() => true), test: idx((u) => u.split === 'test'), agreed: idx((u) => !u.contested) };
const acc = (ds: Dec[], s: number[], ref: 'label' | 'labelOld' = 'label') => { const ok = s.filter((i) => ds[i]!.pred === (U[i] as unknown as Record<string, string>)[ref]).length; const w = wilson(ok, s.length); return `${(100 * w.p).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`; };
const abst = (ds: Dec[], a: number) => { const r = selective(U, ds, a); const w = wilson(Math.round(r.acc * r.accepted), r.accepted); return `${(100 * w.p).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}] (abst ${(100 * r.abstained / U.length).toFixed(1)})`; };
const out: string[] = [];
out.push('| Design (3 passes averaged) | All 597 | Test 375 | Agreed 567 | 10% unsure (all) | 15% unsure | 20% unsure |', '|---|---|---|---|---|---|---|');
for (const mode of ['old', 'new']) {
  const runs = load(mode);
  const raw = U.map((u) => dec(vecOf(runs, u.g, [0, 1, 2])));
  const one = U.map((u) => dec(vecOf(runs, u.g, [0])));
  const cal = lofoDecs((u) => [...vecOf(runs, u.g, [0, 1, 2]), (runs[0]!.probs[u.g]?._conf ?? 0)]);
  const calH = lofoDecs((u) => [...vecOf(runs, u.g, [0, 1, 2]), ...hv(u.g)]);
  const name = mode === 'old' ? 'definitions of phase 4' : 'definitions of guide 2.1';
  for (const [label, ds] of [[`Jev choice, ${name}, 1 pass`, one], [`Jev choice, ${name}, raw`, raw], [`Jev choice, ${name}, calibrated`, cal], [`Jev choice, ${name}, calibrated + 3 Haiku votes`, calH]] as const) {
    out.push(`| ${label} | ${acc(ds, sets.all)} | ${acc(ds, sets.test)} | ${acc(ds, sets.agreed)} | ${abst(ds, 0.1)} | ${abst(ds, 0.15)} | ${abst(ds, 0.2)} |`);
  }
  const c = runs.flatMap((r) => r.calls); const ms = c.map((x) => x.ms).sort((a, b) => a - b);
  out.push(`<!-- ${mode}: calls per pass ${runs[0]!.calls.length}, tokens in per pass ${runs[0]!.calls.reduce((a, x) => a + (x.tokIn ?? 0), 0)}, out ${runs[0]!.calls.reduce((a, x) => a + (x.tokOut ?? 0), 0)}, median ms ${ms[Math.floor(ms.length / 2)]}, p90 ms ${ms[Math.floor(ms.length * 0.9)]} -->`);
}
// Haiku rows for the same columns
const hm = U.map((u) => { const v = hv(u.g); return dec(v); });
out.push(`| Haiku, majority of 3 (guide 2.1) | ${acc(hm, sets.all)} | ${acc(hm, sets.test)} | ${acc(hm, sets.agreed)} | - | - | - |`);
console.log(out.join('\n'));
// Same raw rows scored against annotator A' alone (the only annotator that is not a Haiku run): gold2b has two Haiku annotators among its three.
const accA = (ds: Dec[]) => acc(ds, sets.all, 'labelA' as never);
const A_OUT: string[] = ['', '| Row scored against A\' alone (597 units) | Accuracy % [Wilson 95%] |', '|---|---|'];
for (const mode of ['old', 'new']) { const runs = load(mode); A_OUT.push(`| Jev choice, ${mode === 'old' ? 'phase 4 definitions' : 'guide 2.1 definitions'}, raw, 3 passes | ${accA(U.map((u) => dec(vecOf(runs, u.g, [0, 1, 2]))))} |`); }
A_OUT.push(`| Haiku, majority of 3 (guide 2.1) | ${accA(hm)} |`);
console.log(A_OUT.join('\n'));

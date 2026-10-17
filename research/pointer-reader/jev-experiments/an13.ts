// Cluster bootstrap over files: how much would the exact-span F1 move if other files had been drawn?
import { buildDesigns } from './src/designs3';
import { FILES3, byG3, U3 } from './src/p3';
import { goldSpans, idx3, loadHaiku3, pct, stackFromGold2 } from './src/lib3';
import { spansOf, type Span } from './src/spans';

const files = FILES3.map((f) => f.file);
const fileOf = (s: Span) => byG3.get(s.leaves[0]!)!.file;
const gold = goldSpans();
function f1For(pred: Span[], sel: string[]) {
  // `sel` may repeat files (bootstrap draw); counts are summed per draw
  let tp = 0, np = 0, ng = 0;
  const gk = new Map<string, Set<string>>(); const pk = new Map<string, Set<string>>();
  for (const s of gold) { const f = fileOf(s); (gk.get(f) ?? gk.set(f, new Set()).get(f)!).add(s.leaves.join(',')); }
  for (const s of pred) { const f = fileOf(s); (pk.get(f) ?? pk.set(f, new Set()).get(f)!).add(s.leaves.join(',')); }
  for (const f of sel) { const g = gk.get(f) ?? new Set(), p = pk.get(f) ?? new Set(); ng += g.size; np += p.size; for (const k of p) if (g.has(k)) tp++; }
  const P = np ? tp / np : 0, R = ng ? tp / ng : 0; return P + R ? (2 * P * R) / (P + R) : 0;
}
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
function ci(pred: Span[], B = 2000) {
  const xs: number[] = [];
  for (let b = 0; b < B; b++) xs.push(f1For(pred, files.map(() => files[Math.floor(rnd() * files.length)]!)));
  xs.sort((a, b) => a - b); return [xs[Math.floor(0.025 * B)]!, xs[Math.floor(0.975 * B)]!] as const;
}
const unitJ = stackFromGold2(false), unitJH = stackFromGold2(true);
const out: string[] = ['| Design | Exact-span F1 over all 9 files, % | 95% interval over files (bootstrap of the 9 files, 2000 draws) |', '|---|---|---|'];
const add = (name: string, spans: Span[]) => { const [lo, hi] = ci(spans); out.push(`| ${name} | ${pct(f1For(spans, files))} | ${pct(lo)} to ${pct(hi)} |`); };
for (const [lab, unit, hf] of [['Jev only', unitJ, false], ['Jev + Haiku features', unitJH, true]] as const) {
  const ds = buildDesigns(unit, hf, 'lofo-all');
  for (const d of ds) add(`${lab}: ${d.name}`, d.a.spans);
}
const hs = loadHaiku3();
hs.forEach((h, i) => add(`Haiku run ${i + 1} with its own groups`, spansOf(idx3.map((g) => h.labels[g] ?? 'none'), idx3.map((g) => h.groups[g]), idx3)));
console.log(out.join('\n'));
void U3;

// Phase 3 main analysis: per-unit accuracy and span scores for every span design, thresholds chosen on the dev files only.
// Prints markdown to stdout. Usage: tsx jev-experiments/an9.ts > tables3.out.md
import { C6, type Dec } from './src/dec2';
import { CANDS3, FILES3, RULES3, TREES3, U3, byG3, type P3Run } from './src/p3';
import { evalSplit, goldSpans, idx3, pct, stackFromGold2, votes, type Row } from './src/lib3';
import { INSTR, scoreSpans, spansOf, type Span } from './src/spans';

import { buildDesigns, hs, rowOf } from './src/designs3';
const hm: Dec[] = U3.map((u) => { const c = votes(hs, u.g); const s = [...C6].sort((a, b) => c[b] - c[a]); return { pred: s[0]!, conf: 1, vec: {} as never }; });
const out: string[] = []; const P = (s = '') => out.push(s);
const cell = (r: Row) => [
  `${pct(r.acc)} / ${pct(r.accNonMulti)} / ${pct(r.accMulti)}`, `${pct(r.exactP)} / ${pct(r.exactR)} / **${pct(r.exactF1)}**`, pct(r.exactKindF1), `${pct(r.iou50P)} / ${pct(r.iou50R)}`, pct(r.anyR), `${pct(r.multiExactR)} / ${pct(r.singleExactR)}`, `${r.nPred} (${r.nPredMulti})`,
];
const HEAD = '| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |\n|---|---|---|---|---|---|---|---|';
function designs(label: string, unit: Dec[], withHaikuFeat: boolean, mode: 'lofo-all' | 'dev-train') {
  const rows = buildDesigns(unit, withHaikuFeat, mode);
  P(`#### Descent labeller: ${label}; calibration folds: ${mode}`); P();
  for (const sp of ['test', 'dev', 'all'] as const) {
    P(`${sp === 'test' ? '**Test files (6 files, 391 units, 118 rules)**' : sp === 'dev' ? '**Dev files (3 files, 175 units, 56 rules)**, where thresholds were chosen' : '**All 9 files (566 units, 174 rules)**, thresholds chosen on the dev files'}`); P();
    P(HEAD + '\n' + rows.map((d) => `| ${d.name}${d.note ? ` (${d.note})` : ''} | ${cell(rowOf(d.a, sp)).join(' | ')} |`).join('\n')); P();
  }
  return rows;
}

// Structure-only baselines: merge every instruction unit that sits in the same paragraph / list / row / lead-in group (no model grouping).
function structureSpans(labels: string[], level: 'paragraph' | 'row' | 'all'): Span[] {
  const lab = (g: number) => labels[g - 1]!;
  const spans: Span[] = []; const used = new Set<number>();
  const order = [...CANDS3.filter((c) => c.kind === 'group'), ...CANDS3.filter((c) => c.kind !== 'group')].filter((c) => level === 'all' || (level === 'paragraph' ? c.kind === 'paragraph' : c.kind === 'row'));
  for (const c of order) {
    if (c.leaves.some((g) => used.has(g))) continue;
    const ins = c.leaves.filter((g) => INSTR.has(lab(g)));
    if (!ins.length) continue;
    const l = [...c.leaves]; while (l.length && lab(l[0]!) === 'none') l.shift(); while (l.length && lab(l.at(-1)!) === 'none') l.pop();
    const allInstr = l.every((g) => INSTR.has(lab(g)));
    if (c.kind === 'group' || c.kind === 'list' || c.kind === 'row' || allInstr) { spans.push({ leaves: l, kind: ['prohibition', 'gate', 'rule'].find((k) => l.some((g) => lab(g) === k)) ?? 'rule' }); l.forEach((g) => used.add(g)); }
  }
  for (const g of idx3) if (!used.has(g) && INSTR.has(lab(g))) spans.push({ leaves: [g], kind: lab(g) });
  return spans;
}

P('### Span designs, Jev only'); P();
const unitJ = stackFromGold2(false);
designs('Jev stacker trained on the other corpus (no Haiku, no label of this corpus)', unitJ, false, 'lofo-all');
designs('Jev stacker trained on the other corpus; calibration trained on the 3 dev files only', unitJ, false, 'dev-train');
P('### Span designs, Jev with Haiku votes as extra features'); P();
const unitJH = stackFromGold2(true);
designs('Jev + Haiku stacker trained on the other corpus', unitJH, true, 'lofo-all');
designs('Jev + Haiku stacker; calibration trained on the 3 dev files only', unitJH, true, 'dev-train');

P('### References'); P();
{
  const rowsR: Array<[string, Span[], string[]]> = [];
  const goldLabels = idx3.map((g) => byG3.get(g)!.label);
  rowsR.push(['Structure only, gold unit labels (upper bound of "merge what sits in one paragraph/list/row")', structureSpans(goldLabels, 'all'), goldLabels]);
  const jl = unitJ.map((d) => d.pred as string), hl = hm.map((d) => d.pred as string);
  rowsR.push(['Structure only, Jev stacker labels', structureSpans(jl, 'all'), jl]);
  rowsR.push(['Structure only, Haiku majority labels', structureSpans(hl, 'all'), hl]);
  for (const [i, h] of hs.entries()) { const labels = idx3.map((g) => h.labels[g] ?? 'none'); rowsR.push([`Haiku run ${i + 1} with its own groups`, spansOf(labels, idx3.map((g) => h.groups[g]), idx3), labels]); }
  const sp = hs.map((h) => spansOf(idx3.map((g) => h.labels[g] ?? 'none'), idx3.map((g) => h.groups[g]), idx3));
  const key = (s: Span) => s.leaves.join(',');
  const cnt = new Map<string, { n: number; s: Span }>();
  for (const ss of sp) for (const s of ss) { const e = cnt.get(key(s)) ?? { n: 0, s }; e.n++; cnt.set(key(s), e); }
  const cons = [...cnt.values()].filter((e) => e.n >= 2).map((e) => e.s);
  const covered = new Set(cons.flatMap((s) => s.leaves));
  const consLabels = idx3.map((g) => { const s = cons.find((x) => x.leaves.includes(g)); return s ? s.kind : (hm[g - 1]!.pred as string); });
  const consSpans = [...cons, ...idx3.filter((g) => !covered.has(g) && INSTR.has(hm[g - 1]!.pred as string)).map((g) => ({ leaves: [g], kind: hm[g - 1]!.pred as string }))];
  rowsR.push(['Haiku consensus: spans 2 of 3 runs produced identically, else the majority unit label', consSpans, consLabels]);
  for (const sp2 of ['test', 'dev', 'all'] as const) {
    P(`**${sp2 === 'test' ? 'Test files' : sp2 === 'dev' ? 'Dev files' : 'All 9 files'}**`); P();
    P(HEAD + '\n' + rowsR.map(([n, s, l]) => `| ${n} | ${cell(evalSplit(s, l, sp2)).join(' | ')} |`).join('\n')); P();
  }
}
console.log(out.join('\n'));
void goldSpans; void scoreSpans; void FILES3; void RULES3; void TREES3;

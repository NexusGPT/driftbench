// Span scoring. A rule is a set of leaf numbers (global leaf index g) with a kind. Predicted and gold spans are disjoint sets.
export type Span = { leaves: number[]; kind: string };
export const INSTR = new Set(['rule', 'prohibition', 'gate']);
const key = (s: Span) => s.leaves.join(',');
export const iou = (a: number[], b: number[]) => {
  const B = new Set(b); let i = 0;
  for (const x of a) if (B.has(x)) i++;
  return i / (a.length + b.length - i);
};
export type SpanScore = { nGold: number; nPred: number; exact: number; exactKind: number; iou50: number; anyOverlap: number; meanBestIou: number };
const prf = (tp: number, nPred: number, nGold: number) => { const p = nPred ? tp / nPred : 0, r = nGold ? tp / nGold : 0; return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 }; };
/** exact: same leaf set; exactKind: same leaf set and same kind; iou50: best IoU >= 0.5; any: at least one shared leaf. */
export function scoreSpans(gold: Span[], pred: Span[]) {
  const gk = new Map(gold.map((s) => [key(s), s])), pk = new Map(pred.map((s) => [key(s), s]));
  let exact = 0, exactKind = 0;
  for (const [k, g] of gk) { const p = pk.get(k); if (p) { exact++; if (p.kind === g.kind) exactKind++; } }
  const best = (a: Span, others: Span[]) => others.reduce((m, o) => Math.max(m, iou(a.leaves, o.leaves)), 0);
  const goldBest = gold.map((g) => best(g, pred)), predBest = pred.map((p) => best(p, gold));
  const recIou = goldBest.filter((x) => x >= 0.5).length, precIou = predBest.filter((x) => x >= 0.5).length;
  const recAny = goldBest.filter((x) => x > 0).length, precAny = predBest.filter((x) => x > 0).length;
  return {
    nGold: gold.length, nPred: pred.length,
    exact: prf(exact, pred.length, gold.length), exactKind: prf(exactKind, pred.length, gold.length),
    iou50: { p: pred.length ? precIou / pred.length : 0, r: gold.length ? recIou / gold.length : 0 },
    any: { p: pred.length ? precAny / pred.length : 0, r: gold.length ? recAny / gold.length : 0 },
    meanBestIouGold: gold.length ? goldBest.reduce((a, b) => a + b, 0) / gold.length : 0,
  };
}
/** Spans from per-leaf labels and groups: a group is one span; an instruction leaf outside any group is its own span. */
export function spansOf(labels: string[], groups: Array<string | undefined>, leafIdx: number[]): Span[] {
  const out: Span[] = []; const byGroup = new Map<string, number[]>();
  leafIdx.forEach((g, i) => { const gr = groups[i]; if (gr) byGroup.set(gr, [...(byGroup.get(gr) ?? []), i]); });
  const used = new Set<number>();
  for (const [, idx] of byGroup) {
    const kinds = idx.map((i) => labels[i]!).filter((l) => INSTR.has(l));
    if (!kinds.length) continue;
    const kind = ['prohibition', 'gate', 'rule'].find((k) => kinds.includes(k))!;
    out.push({ leaves: idx.map((i) => leafIdx[i]!), kind }); idx.forEach((i) => used.add(i));
  }
  leafIdx.forEach((g, i) => { if (!used.has(i) && INSTR.has(labels[i]!)) out.push({ leaves: [g], kind: labels[i]! }); });
  return out;
}

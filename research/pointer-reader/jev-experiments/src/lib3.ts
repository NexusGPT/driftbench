// Phase 3 analysis helpers: per-unit decoders on the span corpus, span assembly (arms s0, g, g2, h) and scoring.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './arms';
import { C6, decLabelsT, fromVec, meanProb, pct, type Dec, type Vec } from './dec2';
import { L5, SUBKEYS, U as U2all, type P2Run, type U2 } from './p2';
import { train, predictVec, DESIGNS, features } from './stack';
import { CANDS3, RULES3, U3, byG3, type Cand, type P3Run } from './p3';
import { INSTR, scoreSpans, spansOf, type Span } from './spans';

export function loadDir(name: string): P2Run[] {
  const d = join(dir, name);
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8'))).filter((r) => r.variant && r.probs) as P2Run[];
}
export const RUNS3 = loadDir('results3').filter((r) => !['g-cand', 'h-pair'].includes(r.variant));
export const RUNS2 = loadDir('results2');
export const GOLD3_LABEL = new Map(U3.map((u) => [u.g, u.label]));
export const idx3 = U3.map((u) => u.g);
export const INSTR_G = new Set(RULES3.flatMap((r) => r.leafG));
export const MULTI_G = new Set(RULES3.filter((r) => r.multi).flatMap((r) => r.leafG));
export const splitOf = (g: number) => byG3.get(g)!.split;

// ---- Haiku ----
export type HaikuRun = { runId: string; labels: Record<number, string>; groups: Record<number, string>; calls: number; missing: number };
export function loadHaiku3(): HaikuRun[] {
  return [1, 2, 3].map((r) => join(dir, 'results3', `haiku-r${r}.json`)).filter(existsSync).map((p) => JSON.parse(readFileSync(p, 'utf8')) as HaikuRun);
}
export function loadHaiku2(): Array<{ labels: Record<number, string> }> {
  return [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results2', `haiku-r${r}.json`), 'utf8')));
}
export const votes = (hs: Array<{ labels: Record<number, string> }>, g: number) => { const c = Object.fromEntries(C6.map((k) => [k, 0])) as Record<C6, number>; for (const h of hs) { const l = h.labels[g]; if (l && l in c) c[l as C6]++; } return c; };

// ---- per-unit decoders on gold3 ----
const pickT = (mk: (t: number) => Dec[], units: U2[]): number => {
  let bt = 0.5, ba = -1;
  for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) { const d = mk(t); const ix = U3.map((_, i) => i).filter((i) => U3[i]!.split === 'dev'); const acc = ix.filter((i) => d[i]!.pred === U3[i]!.label).length / ix.length; if (acc > ba) { ba = acc; bt = t; } }
  void units; return bt;
};
const by3 = (id: string) => RUNS3.filter((r) => r.variant === id);
export function rawBase(): { decs: Dec[]; t: number } {
  const mk = (t: number) => U3.map((u) => decLabelsT((l) => meanProb(by3('base'), u.g, l), t));
  const t = pickT(mk, U3); return { decs: mk(t), t };
}
export function rawC(): { decs: Dec[]; t: number } {
  const mk = (t: number) => U3.map((u) => decLabelsT((l) => ([1, 2, 3] as const).reduce((a, k) => a + meanProb(by3(`c-para${k}`), u.g, `p${k}:${l}`), 0) / 3, t));
  const t = pickT(mk, U3); return { decs: mk(t), t };
}
/** Stacker trained on all of gold2 (another corpus), applied to gold3. withHaiku adds the vote fractions. */
export function stackFromGold2(withHaiku: boolean, lambda = 0.03): Dec[] {
  const h2 = loadHaiku2(), h3 = loadHaiku3();
  const f2 = (u: U2) => [...features(RUNS2, u, 'all'), ...(withHaiku ? C6.map((c) => votes(h2, u.g)[c] / 3) : [])];
  const f3 = (u: U2) => [...features(RUNS3, u, 'all'), ...(withHaiku ? C6.map((c) => votes(h3, u.g)[c] / Math.max(1, h3.length)) : [])];
  const m = train(U2all.map(f2), U2all.map((u) => C6.indexOf(u.label as (typeof C6)[number])), lambda);
  return U3.map((u) => fromVec(predictVec(m, f3(u))));
}
/** Leave-one-file-out stacker on gold3 itself. */
export function stackLofo3(withHaiku: boolean, lambda = 0.03): Dec[] {
  const h3 = loadHaiku3();
  const f3 = (u: U2) => [...features(RUNS3, u, 'all'), ...(withHaiku ? C6.map((c) => votes(h3, u.g)[c] / Math.max(1, h3.length)) : [])];
  const out = new Array<Dec>(U3.length);
  for (const f of [...new Set(U3.map((u) => u.file))]) {
    const tr = U3.filter((u) => u.file !== f);
    const m = train(tr.map(f3), tr.map((u) => C6.indexOf(u.label as (typeof C6)[number])), lambda, 800);
    U3.forEach((u, i) => { if (u.file === f) out[i] = fromVec(predictVec(m, f3(u))); });
  }
  return out;
}

// ---- spans ----
export const goldSpans = (): Span[] => RULES3.map((r) => ({ leaves: r.leafG, kind: r.kind }));
export function s0Spans(labels: string[]): Span[] { return spansOf(labels, labels.map(() => undefined), idx3); }
const trimNone = (leaves: number[], lab: (g: number) => string) => { const l = [...leaves]; while (l.length && lab(l[0]!) === 'none') l.shift(); while (l.length && lab(l.at(-1)!) === 'none') l.pop(); return l; };

export type GParams = { tOne: number; tForbid: number; tOrder: number; trim: boolean; tLink: number | null; useCands: boolean; byProb?: boolean; kindMode?: 'block' | 'members' };
export type CandProb = (cid: number, key: 'one' | 'forbid' | 'order') => number;
export const candProbFrom = (runs: P3Run[]): CandProb => (cid, key) => { const xs = runs.map((r) => r.probs[1_000_000 + cid]?.[key]).filter((x): x is number => x !== undefined); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; };
export const linkProbFrom = (runs: P3Run[]) => (gLeft: number) => { const xs = runs.map((r) => r.probs[2_000_000 + gLeft]?.same).filter((x): x is number => x !== undefined); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; };
export type Assembly = { spans: Span[]; labels: string[]; accepted: number };
/** Top-down (useCands) then optional bottom-up merge (tLink) over what the descent left; per-unit labels from `unit`. */
export function assemble(unit: Dec[], cp: CandProb | null, lp: ((g: number) => number) | null, p: GParams): Assembly {
  const label = new Map(U3.map((u, i) => [u.g, unit[i]!.pred as string]));
  const covered = new Set<number>(); const spans: Span[] = [];
  const memberKind = (leaves: number[]) => { const ks = leaves.map((g) => label.get(g)!); return ks.includes('prohibition') ? 'prohibition' : ks.includes('gate') ? 'gate' : 'rule'; };
  const kindOf = (c: Cand, leaves: number[]) => { if (p.kindMode === 'members') return memberKind(leaves); const f = cp!(c.cid, 'forbid'), o = cp!(c.cid, 'order'); return f >= p.tForbid ? 'prohibition' : o >= p.tOrder ? 'gate' : 'rule'; };
  let accepted = 0;
  if (p.useCands && cp) {
    const order = p.byProb ? [...CANDS3].sort((x, y) => cp(y.cid, 'one') - cp(x.cid, 'one')) : [...CANDS3.filter((c) => c.kind === 'group'), ...CANDS3.filter((c) => c.kind !== 'group')];
    for (const c of order) {
      if (!(cp(c.cid, 'one') >= p.tOne)) continue;
      if (c.leaves.some((g) => covered.has(g))) continue;
      const leaves = p.trim ? trimNone(c.leaves, (g) => label.get(g)!) : c.leaves;
      if (!leaves.length) continue;
      spans.push({ leaves, kind: kindOf(c, leaves) }); accepted++;
      c.leaves.forEach((g) => covered.add(g));
    }
  }
  // descent: leaves outside accepted candidates keep their per-unit label; instruction leaves may be merged with neighbours
  const free = idx3.filter((g) => !covered.has(g));
  const parent = new Map<number, number>(free.map((g) => [g, g]));
  const find = (x: number): number => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  if (p.tLink !== null && lp) {
    for (let i = 0; i + 1 < free.length; i++) {
      const a = free[i]!, b = free[i + 1]!;
      if (b !== a + 1 || byG3.get(a)!.file !== byG3.get(b)!.file) continue;
      if (!(INSTR.has(label.get(a)!) || INSTR.has(label.get(b)!))) continue;
      if (lp(a) >= p.tLink) parent.set(find(b), find(a));
    }
  }
  const runs = new Map<number, number[]>();
  for (const g of free) runs.set(find(g), [...(runs.get(find(g)) ?? []), g]);
  for (const [, ls] of runs) {
    const kinds = ls.map((g) => label.get(g)!).filter((l) => INSTR.has(l));
    if (!kinds.length) continue;
    const kind = ['prohibition', 'gate', 'rule'].find((k) => kinds.includes(k))!;
    spans.push({ leaves: ls, kind });
  }
  // per-unit labels: members of a span take its kind, others keep the descent label
  const out = idx3.map((g) => label.get(g)!);
  for (const s of spans) if (s.leaves.length > 1 || covered.has(s.leaves[0]!)) for (const g of s.leaves) out[g - 1] = s.kind;
  return { spans, labels: out, accepted };
}

// ---- scoring ----
export type Row = { accAgreed: number; agreedExactR: number; byClass: Record<string, [number, number]>; acc: number; accNonMulti: number; accMulti: number; exactP: number; exactR: number; exactF1: number; exactKindF1: number; iou50P: number; iou50R: number; anyR: number; multiExactR: number; singleExactR: number; multiIou50R: number; nPred: number; nPredMulti: number };
export function evalSplit(spans: Span[], labels: string[], split: 'dev' | 'test' | 'all'): Row {
  const inSplit = (g: number) => split === 'all' || splitOf(g) === split;
  const gold = goldSpans().filter((s) => inSplit(s.leaves[0]!));
  const pred = spans.filter((s) => inSplit(s.leaves[0]!));
  const sc = scoreSpans(gold, pred);
  const gm = gold.filter((s) => s.leaves.length > 1), gs = gold.filter((s) => s.leaves.length === 1);
  const keys = new Set(pred.map((s) => s.leaves.join(',')));
  const hit = (xs: Span[]) => xs.length ? xs.filter((s) => keys.has(s.leaves.join(','))).length / xs.length : NaN;
  const iouR = (xs: Span[]) => xs.length ? scoreSpans(xs, pred).iou50.r : NaN;
  const ix = idx3.filter(inSplit);
  const acc = (f: (g: number) => boolean) => { const xs = ix.filter(f); return xs.length ? xs.filter((g) => labels[g - 1] === GOLD3_LABEL.get(g)).length / xs.length : NaN; };
  const goldRules = RULES3.filter((r) => inSplit(r.leafG[0]!));
  const agreedRules = goldRules.filter((r) => !r.contested);
  const hitRule = (r: (typeof RULES3)[0]) => keys.has(r.leafG.join(','));
  const byClass: Record<string, [number, number]> = {};
  for (const r of goldRules) { const k = r.multi ? (r.aligned ?? 'inside a block') : 'single unit'; const e = (byClass[k] ??= [0, 0]); e[1]++; if (hitRule(r)) e[0]++; }
  return {
    accAgreed: acc((g) => !byG3.get(g)!.contested), agreedExactR: agreedRules.length ? agreedRules.filter(hitRule).length / agreedRules.length : NaN, byClass,
    acc: acc(() => true), accNonMulti: acc((g) => !MULTI_G.has(g)), accMulti: acc((g) => MULTI_G.has(g)),
    exactP: sc.exact.p, exactR: sc.exact.r, exactF1: sc.exact.f1, exactKindF1: sc.exactKind.f1, iou50P: sc.iou50.p, iou50R: sc.iou50.r, anyR: sc.any.r,
    multiExactR: hit(gm), singleExactR: hit(gs), multiIou50R: iouR(gm), nPred: pred.length, nPredMulti: pred.filter((s) => s.leaves.length > 1).length,
  };
}
export { pct, fromVec, L5, SUBKEYS, DESIGNS };
export type { Vec };

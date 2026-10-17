// Calibrated span decisions: small logistic regressions, trained leave-one-file-out, over Jev probabilities and structure.
import { C6, type Dec } from './dec2';
import { CANDS3, FILES3, RULES3, TREES3, U3, byG3, offsetOf, type Cand } from './p3';
import { INSTR, type Span } from './spans';
import { assemble, candProbFrom, idx3, linkProbFrom, type CandProb } from './lib3';

// ---- binary logistic regression ----
const sig = (z: number) => 1 / (1 + Math.exp(-z));
export type Bin = { mu: number[]; sd: number[]; w: number[] };
export function trainBin(X: number[][], y: number[], lambda = 0.03, iters = 600, lr = 0.5): Bin {
  const F = X[0]!.length, n = X.length;
  const mu = Array.from({ length: F }, (_, j) => X.reduce((a, r) => a + r[j]!, 0) / n);
  const sd = Array.from({ length: F }, (_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j]! - mu[j]!) ** 2, 0) / n) || 1);
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]!) / sd[j]!)]);
  const w = new Array<number>(F + 1).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array<number>(F + 1).fill(0);
    for (let i = 0; i < n; i++) { const e = sig(w.reduce((a, wj, j) => a + wj * Z[i]![j]!, 0)) - y[i]!; for (let j = 0; j <= F; j++) g[j]! += e * Z[i]![j]!; }
    for (let j = 0; j <= F; j++) w[j]! -= lr * (g[j]! / n + (j ? lambda * w[j]! : 0));
  }
  return { mu, sd, w };
}
export const predBin = (m: Bin, x: number[]) => sig([1, ...x.map((v, j) => (v - m.mu[j]!) / m.sd[j]!)].reduce((a, z, j) => a + z * m.w[j]!, 0));
export type CalMode = 'lofo-all' | 'dev-train';
const splitOfFile = (f: string) => FILES3.find((x) => x.file === f)!.split;
/** lofo-all: every file is predicted by a model trained on the other 8 files. dev-train: a test file is predicted by a model trained on the dev files only; a dev file by a model trained on the other dev files. */
export function lofoBin(X: number[][], y: number[], fileOf: string[], lambda = 0.03, mode: CalMode = 'lofo-all'): number[] {
  const out = new Array<number>(X.length).fill(0);
  for (const f of new Set(fileOf)) {
    const tr = X.map((_, i) => i).filter((i) => fileOf[i] !== f && (mode === 'lofo-all' || splitOfFile(fileOf[i]!) === 'dev'));
    const m = trainBin(tr.map((i) => X[i]!), tr.map((i) => y[i]!), lambda);
    X.forEach((x, i) => { if (fileOf[i] === f) out[i] = predBin(m, x); });
  }
  return out;
}

// ---- structure of leaves ----
const memberOf = new Map<number, Cand[]>();
for (const c of CANDS3) for (const g of c.leaves) memberOf.set(g, [...(memberOf.get(g) ?? []), c]);
const containerOf = new Map<number, string>();
for (const f of Object.keys(TREES3)) { const t = TREES3[f]!; t.units.forEach((u, i) => containerOf.set(offsetOf[f]! + i + 1, u.container)); }
const CONT = ['heading', 'sentence', 'list_item', 'table_cell', 'front_matter_value', 'block_quote'];
const share = (v: Record<string, number>) => INSTR_KEYS.reduce((a, k) => a + v[k]!, 0);
const INSTR_KEYS = ['rule', 'prohibition', 'gate'];

export type CalInputs = { unit: Dec[]; cp: CandProb; lp: (g: number) => number; haikuSame?: (g: number) => number; haikuVec?: (g: number) => number[] };
const vecOf = (unit: Dec[], g: number) => C6.map((c) => unit[g - 1]!.vec[c] ?? 0);

export function pairFeat(a: number, b: number, I: CalInputs): number[] {
  const ma = memberOf.get(a) ?? [], mb = memberOf.get(b) ?? [];
  const both = (kinds: string[]) => ma.some((c) => kinds.includes(c.kind) && c.leaves.includes(b)) ? 1 : 0;
  const sameBlock = both(['paragraph', 'list', 'quote']), sameRow = both(['row']);
  const sameGroup = !sameBlock && both(['group']) ? 1 : 0;
  const cross = sameBlock || sameRow || sameGroup ? 0 : 1;
  const ca = containerOf.get(a)!, cb = containerOf.get(b)!;
  void mb;
  const asked = Number.isNaN(I.lp(a)) ? 0 : 1;
  return [asked ? I.lp(a) : 0, asked, ...vecOf(I.unit, a), ...vecOf(I.unit, b), sameBlock, sameRow, sameGroup, cross, ...CONT.map((c) => (ca === c ? 1 : 0)), ...CONT.map((c) => (cb === c ? 1 : 0)), ...(I.haikuSame ? [I.haikuSame(a)] : []), ...(I.haikuVec ? [...I.haikuVec(a), ...I.haikuVec(b)] : [])];
}
const goldRuleOf = new Map<number, string>();
for (const r of RULES3) for (const g of r.leafG) goldRuleOf.set(g, r.id);
export const adjacentPairs = idx3.filter((g) => g < idx3.length && byG3.get(g)!.file === byG3.get(g + 1)!.file);
export function linkProbs(I: CalInputs, lambda = 0.03, mode: CalMode = 'lofo-all'): Map<number, number> {
  const X = adjacentPairs.map((a) => pairFeat(a, a + 1, I));
  const y = adjacentPairs.map((a) => (goldRuleOf.has(a) && goldRuleOf.get(a) === goldRuleOf.get(a + 1) && RULES3.find((r) => r.id === goldRuleOf.get(a))!.multi ? 1 : 0));
  const p = lofoBin(X, y, adjacentPairs.map((a) => byG3.get(a)!.file), lambda, mode);
  return new Map(adjacentPairs.map((a, i) => [a, p[i]!]));
}

// ---- candidates ----
const trimTo = (c: Cand, lab: (g: number) => string) => { const l = [...c.leaves]; while (l.length && lab(l[0]!) === 'none') l.shift(); while (l.length && lab(l.at(-1)!) === 'none') l.pop(); return l; };
const goldKeys = new Map(RULES3.map((r) => [r.leafG.join(','), r]));
export function candFeat(c: Cand, I: CalInputs): number[] {
  const vs = c.leaves.map((g) => vecOf(I.unit, g));
  const ins = vs.map((v) => v[0]! + v[1]! + v[2]!);
  const links: number[] = []; for (let i = 0; i + 1 < c.leaves.length; i++) links.push(I.lp(c.leaves[i]!));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return [I.cp(c.cid, 'one'), I.cp(c.cid, 'forbid'), I.cp(c.cid, 'order'), ...['paragraph', 'list', 'row', 'group', 'quote'].map((k) => (c.kind === k ? 1 : 0)), Math.log(c.leaves.length), mean(ins), Math.max(...ins), Math.min(...ins), mean(vs.map((v) => v[5]!)), links.length ? mean(links) : 1, links.length ? Math.min(...links) : 1, ...(I.haikuSame ? [mean(c.leaves.slice(0, -1).map((g) => I.haikuSame!(g)))] : [])];
}
export function candProbs(I: CalInputs, lambda = 0.03, mode: CalMode = 'lofo-all'): Map<number, number> {
  const lab = (g: number) => I.unit[g - 1]!.pred as string;
  const X = CANDS3.map((c) => candFeat(c, I));
  const y = CANDS3.map((c) => (goldKeys.has(trimTo(c, lab).join(',')) ? 1 : 0));
  const p = lofoBin(X, y, CANDS3.map((c) => c.file), lambda, mode);
  return new Map(CANDS3.map((c, i) => [c.cid, p[i]!]));
}
/** Greedy assembly with calibrated candidate and link probabilities: accept candidates by decreasing probability, then merge the rest. */
export function assembleCal(I: CalInputs, pc: Map<number, number> | null, pl: Map<number, number> | null, tAcc: number, tLink: number | null, trim: boolean, kindMode: 'block' | 'members' = 'block') {
  const cp: CandProb | null = pc ? (cid, key) => (key === 'one' ? pc.get(cid)! : I.cp(cid, key)) : null;
  const lp = pl ? (g: number) => pl.get(g) ?? 0 : null;
  // greedy by decreasing probability: assemble() takes candidates in group-first order, so order by probability by presenting a rank trick
  return assemble(I.unit, cp, lp, { tOne: tAcc, tForbid: 0.5, tOrder: 0.5, trim, tLink, useCands: !!pc, byProb: true, kindMode });
}
export { INSTR, share };
export type { Span };

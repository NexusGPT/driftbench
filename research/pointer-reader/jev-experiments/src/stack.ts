// Learned combiner: multinomial logistic regression with L2, trained on the dev files only.
import { C6, meanProb, type Vec, type Dec, fromVec } from './dec2';
import { L5, SUBKEYS, U, type P2Run, type U2 } from './p2';

export const DESIGNS: Array<[string, string]> = [['base', ''], ['a-rules', ''], ['c-para1', 'p1:'], ['c-para2', 'p2:'], ['c-para3', 'p3:'], ['d-none', ''], ['d-role', '']];
export type Feat = number[];
export function features(runs: P2Run[], u: U2, which: 'all' | 'labels' | 'decomp' = 'all'): Feat {
  const f: number[] = [];
  const by = (id: string) => runs.filter((r) => r.variant === id);
  if (which !== 'decomp') for (const [id, pre] of DESIGNS) for (const l of L5) f.push(meanProb(by(id), u.g, pre + l));
  if (which !== 'labels') for (const k of SUBKEYS) f.push(meanProb(by('b-decomp'), u.g, k));
  return f;
}
const softmax = (z: number[]) => { const m = Math.max(...z); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
export type Model = { mu: number[]; sd: number[]; W: number[][] };
export function train(X: Feat[], y: number[], lambda: number, iters = 1500, lr = 0.3): Model {
  const F = X[0]!.length, n = X.length;
  const mu = Array.from({ length: F }, (_, j) => X.reduce((a, r) => a + r[j]!, 0) / n);
  const sd = Array.from({ length: F }, (_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j]! - mu[j]!) ** 2, 0) / n) || 1);
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]!) / sd[j]!)]);
  const W = C6.map(() => Array.from({ length: F + 1 }, () => 0));
  for (let it = 0; it < iters; it++) {
    const G = C6.map(() => new Array(F + 1).fill(0) as number[]);
    for (let i = 0; i < n; i++) {
      const p = softmax(W.map((w) => w.reduce((a, wj, j) => a + wj * Z[i]![j]!, 0)));
      for (let c = 0; c < 6; c++) { const e = p[c]! - (y[i] === c ? 1 : 0); for (let j = 0; j <= F; j++) G[c]![j]! += e * Z[i]![j]!; }
    }
    for (let c = 0; c < 6; c++) for (let j = 0; j <= F; j++) W[c]![j]! -= lr * (G[c]![j]! / n + (j ? lambda * W[c]![j]! : 0));
  }
  return { mu, sd, W };
}
export function predictVec(m: Model, x: Feat): Vec {
  const z = [1, ...x.map((v, j) => (v - m.mu[j]!) / m.sd[j]!)];
  const p = softmax(m.W.map((w) => w.reduce((a, wj, j) => a + wj * z[j]!, 0)));
  return Object.fromEntries(C6.map((c, i) => [c, p[i]!])) as Vec;
}
export const yOf = (u: U2) => C6.indexOf(u.label as (typeof C6)[number]);
export function cvLambda(X: Feat[], y: number[], lambdas: number[], folds = 5): number {
  let best = lambdas[0]!, bestAcc = -1;
  for (const l of lambdas) {
    let ok = 0;
    for (let f = 0; f < folds; f++) {
      const tr = X.map((_, i) => i).filter((i) => i % folds !== f), te = X.map((_, i) => i).filter((i) => i % folds === f);
      const m = train(tr.map((i) => X[i]!), tr.map((i) => y[i]!), l, 600);
      for (const i of te) { const v = predictVec(m, X[i]!); if (C6.indexOf([...C6].sort((a, b) => v[b] - v[a])[0]!) === y[i]) ok++; }
    }
    if (ok / X.length > bestAcc) { bestAcc = ok / X.length; best = l; }
  }
  return best;
}
export function stackDecs(runs: P2Run[], which: 'all' | 'labels' | 'decomp' = 'all'): { decs: Dec[]; lambda: number } {
  const dev = U.filter((u) => u.split === 'dev');
  const X = dev.map((u) => features(runs, u, which)), y = dev.map(yOf);
  const lambda = cvLambda(X, y, [0.003, 0.03, 0.3, 3]);
  const m = train(X, y, lambda);
  return { decs: U.map((u) => fromVec(predictVec(m, features(runs, u, which)))), lambda };
}

/** Leave-one-file-out: each unit is predicted by a model trained on the other files only. */
export function lofoDecs(featOf: (u: U2) => Feat, lambda = 0.03): Dec[] {
  const files = [...new Set(U.map((u) => u.file))];
  const out = new Array<Dec>(U.length);
  for (const f of files) {
    const tr = U.filter((u) => u.file !== f);
    const m = train(tr.map(featOf), tr.map(yOf), lambda, 800);
    U.forEach((u, i) => { if (u.file === f) out[i] = fromVec(predictVec(m, featOf(u))); });
  }
  return out;
}

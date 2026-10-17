// Decoders: from the recorded probabilities of one design to a 6-class score vector, a label and a confidence.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './arms';
import { L5, SUBKEYS, U, type P2Run, type U2 } from './p2';

export const C6 = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'] as const;
export type C6 = (typeof C6)[number];
export type Vec = Record<C6, number>;
export type Dec = { pred: C6; conf: number; vec: Vec };

export function loadRuns2(): P2Run[] {
  const d = join(dir, 'results2');
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')) as P2Run);
}
/** Mean of the probability of one question key over the runs given. */
export function meanProb(runs: P2Run[], g: number, key: string): number {
  const xs = runs.map((r) => r.probs[g]?.[key]).filter((x): x is number => x !== undefined);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

const norm = (v: Vec): Vec => { const s = C6.reduce((a, c) => a + v[c], 0) || 1; return Object.fromEntries(C6.map((c) => [c, v[c] / s])) as Vec; };
export function top2(vec: Vec): { pred: C6; margin: number } {
  const s = [...C6].sort((a, b) => vec[b] - vec[a]);
  return { pred: s[0]!, margin: vec[s[0]!] - vec[s[1]!] };
}

/** Five label questions (keys prefixed by `prefix`), read as a vector: none = 1 - max. */
export function vecLabels(p: (l: string) => number): Vec {
  const m = Math.max(...L5.map((l) => p(l)));
  return norm({ rule: p('rule'), prohibition: p('prohibition'), gate: p('gate'), example: p('example'), description: p('description'), none: 1 - m });
}
/** Five label questions read with a threshold: highest at or above t, else none. Confidence: distance from the decision edge. */
export function decLabelsT(p: (l: string) => number, t: number): Dec {
  const s = [...L5].sort((a, b) => p(b) - p(a));
  const p1 = p(s[0]!), p2 = p(s[1]!);
  const vec = vecLabels(p);
  if (p1 >= t) return { pred: s[0]!, conf: Math.min(p1 - p2, (p1 - t) / (1 - t)), vec };
  return { pred: 'none', conf: (t - p1) / t, vec };
}
/** Decomposed sub-questions combined by a fixed chain in code. Soft vector from the chain; hard label from the thresholds. */
export function vecDecomp(p: (k: string) => number): Vec {
  const e = p('example'), f = p('forbid'), o = p('order'), i = p('instr'), n = p('filler'), t = p('tool');
  void t;
  return norm({
    example: e,
    prohibition: (1 - e) * f,
    gate: (1 - e) * (1 - f) * o,
    rule: (1 - e) * (1 - f) * (1 - o) * i,
    none: (1 - e) * (1 - f) * (1 - o) * (1 - i) * n,
    description: (1 - e) * (1 - f) * (1 - o) * (1 - i) * (1 - n),
  });
}
export function decDecompT(p: (k: string) => number, t: number): Dec {
  const e = p('example'), f = p('forbid'), o = p('order'), i = p('instr'), n = p('filler');
  const pred: C6 = e >= t ? 'example' : f >= t ? 'prohibition' : o >= t ? 'gate' : i >= t ? 'rule' : n >= t ? 'none' : 'description';
  const conf = Math.min(...SUBKEYS.map((k) => Math.abs(p(k) - t))) * 2;
  return { pred, conf, vec: vecDecomp(p) };
}
export const fromVec = (vec: Vec): Dec => { const { pred, margin } = top2(vec); return { pred, conf: margin, vec }; };
export const avgVec = (vs: Vec[]): Vec => Object.fromEntries(C6.map((c) => [c, vs.reduce((a, v) => a + v[c], 0) / vs.length])) as Vec;

// ---- metrics ----
export type Eval = { n: number; acc: number; macroF1: number; per: Record<string, { n: number; p: number; r: number; f1: number }>; conf: number[][]; wrong: Array<{ g: number; gold: string; pred: string }> };
export function evaluate(units: U2[], decs: Dec[]): Eval {
  const conf = C6.map(() => C6.map(() => 0));
  const wrong: Eval['wrong'] = [];
  let ok = 0;
  units.forEach((u, i) => { const p = decs[i]!.pred; conf[C6.indexOf(u.label as C6)]![C6.indexOf(p)]!++; if (p === u.label) ok++; else wrong.push({ g: u.g, gold: u.label, pred: p }); });
  const per: Eval['per'] = {};
  C6.forEach((c, k) => {
    const tp = conf[k]![k]!, fn = conf[k]!.reduce((a, b) => a + b, 0) - tp, fp = conf.reduce((a, row) => a + row[k]!, 0) - tp;
    const pp = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
    per[c] = { n: tp + fn, p: pp, r, f1: pp + r ? (2 * pp * r) / (pp + r) : 0 };
  });
  return { n: units.length, acc: ok / units.length, macroF1: C6.reduce((a, c) => a + per[c]!.f1, 0) / 6, per, conf, wrong };
}
/** Accuracy on accepted units when the `abstain` fraction with the lowest confidence is held back. */
export function selective(units: U2[], decs: Dec[], abstain: number) {
  const idx = units.map((_, i) => i).sort((a, b) => decs[b]!.conf - decs[a]!.conf);
  const keep = idx.slice(0, Math.round(units.length * (1 - abstain)));
  const ok = keep.filter((i) => decs[i]!.pred === units[i]!.label).length;
  return { accepted: keep.length, acc: keep.length ? ok / keep.length : 0, abstained: units.length - keep.length };
}
/** Largest share of units accepted (most confident first) with accuracy at or above `target`. */
export function coverageAt(units: U2[], decs: Dec[], target: number) {
  const idx = units.map((_, i) => i).sort((a, b) => decs[b]!.conf - decs[a]!.conf);
  let ok = 0, best = 0;
  idx.forEach((i, k) => { if (decs[i]!.pred === units[i]!.label) ok++; if (ok / (k + 1) >= target) best = k + 1; });
  return best / units.length;
}
export const pct = (x: number, d = 1) => (100 * x).toFixed(d);
export { U };

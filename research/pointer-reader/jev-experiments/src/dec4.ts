// Phase 4 decoders and scoring on the answer key without Haiku (units where annotators A and C agree).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { dir } from './arms';
import { U3 } from './p3';
import { KEY, LAB_FROZEN, keyG, splitOfG, wilson } from './key4';
import { L6, type Label6, type Run4 } from './p4';
import { predictVec, train } from './stack';

export type Vec6 = number[]; // in L6 order
export const argmax = (v: number[]) => v.reduce((b, x, i) => (x > v[b]! ? i : b), 0);
export const margin = (v: number[]) => { const s = [...v].sort((a, b) => b - a); return s[0]! - s[1]!; };
export const LABEL_OF = (v: Vec6): Label6 => L6[argmax(v)]!;

export function loadRuns4(dirName = 'results4'): Run4[] {
  const d = join(dir, dirName);
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')) as Run4);
}
export const RUNS4 = loadRuns4();
export const designPasses = (design: string, passes?: number[]) => RUNS4.filter((r) => r.design === design && (!passes || passes.includes(r.pass))).sort((a, b) => a.pass - b.pass);

const NL5 = ['rule', 'prohibition', 'gate', 'example', 'description'];
const norm = (v: number[]) => { const s = v.reduce((a, b) => a + b, 0) || 1; return v.map((x) => x / s); };
const meanOf = (rs: Run4[], g: number, k: string) => rs.reduce((a, r) => a + (r.probs[g]?.[k] ?? 0), 0) / rs.length;
/** six-class probability vector of a unit for one design, averaged over the passes given */
export function vec6(design: string, rs: Run4[], g: number): Vec6 {
  if (design.startsWith('nl-')) {
    const p = NL5.map((l) => meanOf(rs, g, `nl:${l}`)); const m = Math.max(...p);
    return norm([...p, Math.max(0, 1 - m)]);
  }
  if (design.startsWith('tr-')) {
    const pi = meanOf(rs, g, 'l1:instruction'); const k3 = ['rule', 'prohibition', 'gate'].map((l) => meanOf(rs, g, `l2:${l}`)); const s = k3.reduce((a, b) => a + b, 0) || 1;
    return norm([pi * (k3[0]! / s), pi * (k3[1]! / s), pi * (k3[2]! / s), meanOf(rs, g, 'l1:example'), meanOf(rs, g, 'l1:description'), meanOf(rs, g, 'l1:none')]);
  }
  return norm(L6.map((l) => meanOf(rs, g, `ch:${l}`)));
}
export const apiConf = (design: string, rs: Run4[], g: number) => meanOf(rs, g, `${design.startsWith('tr-') ? 'l1' : 'ch'}:_conf`);

export type Decision = { pred: Label6; conf: number; vec: Vec6 };
export const decisionFrom = (v: Vec6): Decision => ({ pred: LABEL_OF(v), conf: margin(v), vec: v });

// ---- scoring ----
export const KEY_SETS = { all: keyG, dev: keyG.filter((g) => splitOfG(g) === 'dev'), test: keyG.filter((g) => splitOfG(g) === 'test') };
export const MULTI = (() => {
  // units that sit inside a multi-unit gold rule (frozen gold3)
  const gold = JSON.parse(readFileSync(join(dir, 'gold3.json'), 'utf8')) as { rules: Array<{ leafG: number[]; multi: boolean }> };
  return new Set(gold.rules.filter((r) => r.multi).flatMap((r) => r.leafG));
})();
export type Acc = { k: number; n: number; p: number; lo: number; hi: number };
export const accOf = (k: number, n: number): Acc => ({ k, n, ...wilson(k, n) });
export const fmt = (a: Acc) => (a.n ? `${(100 * a.p).toFixed(1)} [${(100 * a.lo).toFixed(1)}, ${(100 * a.hi).toFixed(1)}]` : 'n/a');
export const fmtP = (a: Acc) => (a.n ? (100 * a.p).toFixed(1) : 'n/a');

/** accuracy on `set` against the key; drop the `unsure` fraction of lowest confidence first (0 = none). accepted units are returned too. */
export function score(dec: (g: number) => Decision, set: number[], unsure = 0, truth: (g: number) => string = (g) => KEY.get(g)!): Acc & { accepted: number[]; unsureN: number } {
  const order = [...set].sort((a, b) => dec(b).conf - dec(a).conf);
  const keep = order.slice(0, Math.round(set.length * (1 - unsure)));
  const ok = keep.filter((g) => dec(g).pred === truth(g)).length;
  return { ...accOf(ok, keep.length), accepted: keep, unsureN: set.length - keep.length };
}
export const FROZEN = (g: number) => LAB_FROZEN.get(g)!;
export const ALL_G = U3.map((u) => u.g);

// ---- efficiency ----
export type Eff = { units: number; calls: number; tokIn: number; tokOut: number; msList: number[] };
export function effOf(rs: Run4[], units = U3.length): Eff {
  const calls = rs.flatMap((r) => r.calls);
  return { units, calls: calls.length, tokIn: calls.reduce((a, c) => a + (c.tokIn ?? 0), 0), tokOut: calls.reduce((a, c) => a + (c.tokOut ?? 0), 0), msList: calls.map((c) => c.ms) };
}
export const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 1e-9))]! : NaN; };
export const PRICE = { jevIn: 0.042 / 1e6, jevOut: 0, haikuIn: 0.1 / 1e6, haikuOut: 0.5 / 1e6 };
export function per100(e: Eff, who: 'jev' | 'haiku') {
  const f = 100 / e.units;
  const usd = who === 'jev' ? e.tokIn * PRICE.jevIn + e.tokOut * PRICE.jevOut : e.tokIn * PRICE.haikuIn + e.tokOut * PRICE.haikuOut;
  return { calls: e.calls * f, tokIn: e.tokIn * f, tokOut: e.tokOut * f, med: quantile(e.msList, 0.5) / 1000, p90: quantile(e.msList, 0.9) / 1000, usd: usd * f };
}
export const sumEff = (...es: Eff[]): Eff => ({ units: es[0]!.units, calls: es.reduce((a, e) => a + e.calls, 0), tokIn: es.reduce((a, e) => a + e.tokIn, 0), tokOut: es.reduce((a, e) => a + e.tokOut, 0), msList: es.flatMap((e) => e.msList) });

// ---- Haiku (phase 3 runs with the span guide) ----
export type HaikuRun = { runId: string; labels: Record<number, string>; groups: Record<number, string> };
export const HAIKU: HaikuRun[] = [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results3', `haiku-r${r}.json`), 'utf8')) as HaikuRun);
export const haikuEff = (runs: number[], units = U3.length): Eff => {
  const L = gunzipSync(readFileSync(join(dir, 'cassette3-haiku.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { run: string; ms: number; response: { usage?: { input_tokens: number; output_tokens: number } } });
  const sel = L.filter((e) => runs.includes(Number(e.run)));
  return { units, calls: sel.length, tokIn: sel.reduce((a, e) => a + (e.response.usage?.input_tokens ?? 0), 0), tokOut: sel.reduce((a, e) => a + (e.response.usage?.output_tokens ?? 0), 0), msList: sel.map((e) => e.ms) };
};
export const haikuVotes = (g: number) => { const c = L6.map(() => 0); for (const h of HAIKU) { const i = L6.indexOf(h.labels[g] as Label6); if (i >= 0) c[i]!++; } return c; };
export const haikuOne = (r: number): ((g: number) => Decision) => (g) => { const v = L6.map((l) => (HAIKU[r - 1]!.labels[g] === l ? 1 : 0)); return { pred: LABEL_OF(v), conf: 1, vec: v }; };
/** majority of 3; confidence = share of the 3 runs that agree with the majority (1/3, 2/3 or 1); ties go to the first run */
export const haikuMajority = (g: number): Decision => { const c = haikuVotes(g); const i = argmax(c); const v = c.map((x) => x / HAIKU.length); return { pred: L6[i]!, conf: c[i]! / HAIKU.length + (c[i]! === HAIKU.length ? 0 : 0), vec: v }; };

// ---- calibrated stacker: leave-one-file-out, trained on key units of the other files ----
export type FeatFn = (g: number) => number[];
export function lofoStack(feat: FeatFn, lambda = 0.1, iters = 600, target: (g: number) => string | undefined = (g) => KEY.get(g), trainSet: number[] = keyG): Map<number, Decision> {
  const out = new Map<number, Decision>();
  const files = [...new Set(U3.map((u) => u.file))];
  for (const f of files) {
    const tr = trainSet.filter((g) => U3[g - 1]!.file !== f && target(g) !== undefined);
    const m = train(tr.map(feat), tr.map((g) => L6.indexOf(target(g)! as Label6)), lambda, iters);
    for (const u of U3) if (u.file === f) { const v = predictVec(m, feat(u.g)); out.set(u.g, decisionFrom(L6.map((l) => (v as unknown as Record<string, number>)[l]!))); }
  }
  return out;
}

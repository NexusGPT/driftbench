// Computes every number of RESULTS.md from results/*.json (and the gold). Usage: tsx jev-experiments/report.ts [run-id ...]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCKS, byId, dir, LABELS, predict, UNITS, type Decode, type RunRec } from './src/arms';

export const CLASSES = [...LABELS, 'none'];
export function loadRuns(): RunRec[] {
  const d = join(dir, 'results');
  return readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')) as RunRec);
}

export function score(pred: string[], gold: string[]) {
  let ok = 0;
  const f1s: number[] = [];
  const per: Record<string, { p: number; r: number; f1: number }> = {};
  for (let i = 0; i < gold.length; i++) if (pred[i] === gold[i]) ok++;
  for (const c of CLASSES) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < gold.length; i++) {
      if (pred[i] === c && gold[i] === c) tp++;
      else if (pred[i] === c) fp++;
      else if (gold[i] === c) fn++;
    }
    const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
    const f1 = p + r ? (2 * p * r) / (p + r) : 0;
    per[c] = { p, r, f1 };
    f1s.push(f1);
  }
  return { acc: ok / gold.length, macroF1: f1s.reduce((a, b) => a + b, 0) / f1s.length, per };
}
export const goldLabels = UNITS.map((u) => u.label);
export const predictions = (run: RunRec, t: number, labels?: readonly string[], decode: Decode = 'argmax') => UNITS.map((u) => predict(run.probs[u.g], t, labels, decode));
export const pct = (x: number) => (100 * x).toFixed(1);
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function linkScore(run: RunRec, t: number) {
  // probs[g][blockId] = probability that the block needs unit g
  let tp = 0, fp = 0, fn = 0;
  const perBlock: Array<{ id: string; tp: number; fp: number; fn: number }> = [];
  for (const b of BLOCKS) {
    const truth = new Set(b.units.map((id) => byId.get(id)!.g));
    let btp = 0, bfp = 0, bfn = 0;
    for (const u of UNITS) {
      const p = run.probs[u.g]?.[b.id];
      const asked = p !== undefined;
      const yes = asked && p! >= t;
      if (yes && truth.has(u.g)) btp++;
      else if (yes) bfp++;
      else if (truth.has(u.g)) bfn++;
    }
    tp += btp; fp += bfp; fn += bfn;
    perBlock.push({ id: b.id, tp: btp, fp: bfp, fn: bfn });
  }
  const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
  return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0, tp, fp, fn, perBlock };
}

if (process.argv[1]?.endsWith('report.ts')) {
  const want = process.argv.slice(2);
  for (const run of loadRuns().filter((r) => !want.length || want.includes(r.runId))) {
    const ms = run.calls.map((c) => c.ms);
    if (run.arm === 'arm5') {
      const l = linkScore(run, 0.5);
      console.log(run.runId, `P ${pct(l.p)} R ${pct(l.r)} F1 ${pct(l.f1)} calls ${run.calls.length} missing ${run.missing}`);
    } else if (run.arm === 'cap') {
      console.log(run.runId, run.calls.map((c) => `${c.nq}q ${c.ok ? 'ok' : 'ERR ' + c.status} ${c.ms}ms`).join('; '), 'missing', run.missing);
    } else {
      const s = score(predictions(run, 0.5), goldLabels);
      console.log(run.runId, `acc ${pct(s.acc)} macroF1 ${pct(s.macroF1)} calls ${run.calls.length} missing ${run.missing}/${run.asked} ms/call ${mean(ms).toFixed(0)}`);
    }
  }
}

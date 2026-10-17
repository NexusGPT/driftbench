// The span designs of phase 3, built from the recorded answers. Thresholds are chosen on the dev files only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './arms';
import { C6, type Dec } from './dec2';
import type { P3Run } from './p3';
import { assemble, candProbFrom, evalSplit, linkProbFrom, loadHaiku3, votes, type GParams } from './lib3';
import { assembleCal, candProbs, linkProbs, type CalInputs } from './cal3';

const load = (id: string) => [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results3', `${id}-r${r}.json`), 'utf8')) as P3Run);
export const gcand = load('g-cand'), hpair = load('h-pair'), gvar = load('g-var');
export const cpV1 = candProbFrom(gcand), lp = linkProbFrom(hpair);
const meanKey = (rs: P3Run[], cid: number, key: string) => { const xs = rs.map((r) => r.probs[1_000_000 + cid]?.[key]).filter((x): x is number => x !== undefined); return xs.reduce((a, b) => a + b, 0) / xs.length; };
export const cpRange = (cid: number, key: 'one' | 'forbid' | 'order') => (key === 'one' ? meanKey(gvar, cid, 'range') : cpV1(cid, key));
export const hs = loadHaiku3();
export const haikuSame = (a: number) => hs.filter((h) => h.groups[a] && h.groups[a] === h.groups[a + 1]).length / hs.length;
export const haikuVec = (g: number) => C6.map((c) => votes(hs, g)[c] / hs.length);
export const T = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
export type Asm = ReturnType<typeof assemble>;
export const rowOf = (a: Asm, s: 'dev' | 'test' | 'all') => evalSplit(a.spans, a.labels, s);
export function pickBest<X>(grid: X[], mk: (x: X) => Asm): { x: X; a: Asm } {
  let bx = grid[0]!, ba = mk(bx), bs = -1;
  for (const x of grid) { const a = mk(x); const e = rowOf(a, 'dev'); const sc = e.exactF1 + 0.001 * e.iou50R; if (sc > bs) { bs = sc; bx = x; ba = a; } }
  return { x: bx, a: ba };
}
export const base: GParams = { tOne: 0.5, tForbid: 0.5, tOrder: 0.5, trim: true, tLink: null, useCands: false, kindMode: 'block' };

export type Design = { name: string; a: Asm; note: string };
export function buildDesigns(unit: Dec[], withHaikuFeat: boolean, mode: 'lofo-all' | 'dev-train'): Design[] {
  const rows: Design[] = [];
  rows.push({ name: 's0: per-unit labels only, no grouping', a: assemble(unit, null, null, { ...base, kindMode: 'members' }), note: '' });
  const gSel = (cp: typeof cpV1, name: string) => {
    const g = pickBest(T.flatMap((t) => [true, false].map((tr) => ({ t, tr }))), ({ t, tr }) => assemble(unit, cp, null, { ...base, useCands: true, tOne: t, trim: tr, byProb: true, kindMode: 'members' }));
    rows.push({ name, a: g.a, note: `t=${g.x.t}${g.x.tr ? '' : ', no trim'}` }); return g;
  };
  gSel(cpV1, 'g: top-down, block question (wording 1)');
  const gR = gSel(cpRange, 'g: top-down, block question (range wording)');
  const h = pickBest(T, (t) => assemble(unit, null, lp, { ...base, tLink: t, kindMode: 'members' }));
  rows.push({ name: 'h: bottom-up, pair question', a: h.a, note: `t=${h.x}` });
  const g2 = pickBest(T, (t) => assemble(unit, cpRange, lp, { ...base, useCands: true, tOne: gR.x.t, trim: gR.x.tr, byProb: true, tLink: t, kindMode: 'members' }));
  rows.push({ name: 'g2: top-down then bottom-up merge', a: g2.a, note: `t=${gR.x.t}/${g2.x}` });
  const I: CalInputs = { unit, cp: cpRange, lp, ...(withHaikuFeat ? { haikuSame, haikuVec } : {}) };
  const pc = candProbs(I, 0.03, mode), pl = linkProbs(I, 0.03, mode);
  const gc = pickBest(T, (t) => assembleCal(I, pc, null, t, null, true, 'members'));
  rows.push({ name: 'g-cal: block question + calibrated regression', a: gc.a, note: `t=${gc.x}` });
  const hc = pickBest(T, (t) => assembleCal(I, null, pl, 0, t, true, 'members'));
  rows.push({ name: 'h-cal: pair question + calibrated regression', a: hc.a, note: `t=${hc.x}` });
  const g2c = pickBest(T, (t) => assembleCal(I, pc, pl, gc.x, t, true, 'members'));
  rows.push({ name: 'g2-cal: both, calibrated', a: g2c.a, note: `t=${gc.x}/${g2c.x}` });
  return rows;
}

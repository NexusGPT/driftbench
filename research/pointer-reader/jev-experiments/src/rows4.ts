// Phase 4 main tables: Jev (native choice) against Haiku on the answer key without Haiku (units where A and C agree).
// Prints markdown to stdout; usage: tsx jev-experiments/an19.ts > tables4.out.md
import { U3 } from './p3';
import { KEY, LAB_FROZEN, keyG, splitOfG } from './key4';
import {
  ALL_G, FROZEN, KEY_SETS, MULTI, PRICE, accOf, decisionFrom, designPasses, effOf, fmt, fmtP, haikuEff, haikuMajority, haikuOne, haikuVotes, per100, score, sumEff, vec6,
  type Acc, type Decision, type Eff,
} from './dec4';
import { L6, type Label6 } from './p4';
import { HEADS, headDecisions } from '../heads4';
import { metaOf } from './feat4';

const out: string[] = [];
const P = (s = '') => out.push(s);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const jevEff = (comps: Array<{ design: string; passes: number[] }>): Eff => sumEff(...comps.map((c) => effOf(designPasses(c.design, c.passes))));
const secs = (e: Eff) => (e.msList.reduce((a, b) => a + b, 0) / 1000) * (100 / e.units);

type Row = { name: string; dec: (g: number) => Decision; eff: Eff; who: 'jev' | 'haiku' | 'mix'; note?: string; unsureLabel?: string };
const fmtN = (a: Acc) => `${fmt(a)} (n ${a.n})`;

function headlineRow(r: Row) {
  const a0 = score(r.dec, KEY_SETS.all), a10 = score(r.dec, KEY_SETS.all, 0.1), t0 = score(r.dec, KEY_SETS.test), f0 = score(r.dec, ALL_G, 0, FROZEN);
  return `| ${r.name} | ${fmt(a0)} | ${fmt(a10)} | ${fmt(t0)} | ${fmt(f0)} |`;
}
function effRow(r: Row) {
  const e = per100(r.eff, r.who === 'haiku' ? 'haiku' : 'jev');
  const usd = r.who === 'mix' ? NaN : e.usd;
  return `| ${r.name} | ${e.calls.toFixed(1)} | ${(e.tokIn / 1000).toFixed(1)}k | ${(e.tokOut / 1000).toFixed(1)}k | ${e.med.toFixed(2)} | ${e.p90.toFixed(2)} | ${secs(r.eff).toFixed(1)} | ${Number.isNaN(usd) ? '—' : usd.toFixed(4)} |`;
}

// ---- rows ----
const rawRow = (name: string, design: string, passes: number[]): Row => { const rs = designPasses(design, passes); return { name, dec: (g) => decisionFrom(vec6(design, rs, g)), eff: effOf(rs), who: 'jev' }; };
const avgRow = (name: string, designs: string[], passes: number[]): Row => {
  const rss = designs.map((d) => designPasses(d, passes));
  return { name, dec: (g) => { const vs = designs.map((d, i) => vec6(d, rss[i]!, g)); return decisionFrom(L6.map((_, k) => mean(vs.map((v) => v[k]!)))); }, eff: sumEff(...rss.map((rs) => effOf(rs))), who: 'jev' };
};
const headRow = (id: string): Row => { const h = HEADS.find((x) => x.id === id)!; const d = headDecisions(h); return { name: `${h.name}`, dec: (g) => d.get(g)!, eff: jevEff(h.components), who: 'jev' }; };
const haikuRows: Row[] = [1, 2, 3].map((r) => ({ name: `Haiku, run ${r} (one run, no unsure signal)`, dec: haikuOne(r), eff: haikuEff([r]), who: 'haiku' as const }));
const haikuMajRow: Row = { name: 'Haiku, majority of 3 runs (unsure = the runs are not unanimous)', dec: haikuMajority, eff: haikuEff([1, 2, 3]), who: 'haiku' };

const jevRows: Row[] = [
  rawRow('Jev raw, 5 yes/no questions per unit, file window (phase 1 to 3 style)', 'nl-flatL', [1]),
  rawRow('Jev raw, 1 choice question per unit, window of 30 units (S)', 'ch-structS-in', [1]),
  rawRow('Jev raw, same, mean of 3 passes', 'ch-structS-in', [1, 2, 3]),
  rawRow('Jev raw, choice, whole-file window (L)', 'ch-structL-in', [1]),
  rawRow('Jev raw, choice, one unit per call with its block and neighbours', 'ch-local-in', [1]),
  rawRow('Jev raw, two levels: instruction or not, then the kind (file window)', 'tr-structL-in', [1]),
  avgRow('Jev raw, paraphrase average: 3 wordings of the definitions (file window, 1 pass each)', ['ch-structL-in', 'ch-structL-in-w2', 'ch-structL-in-w3'], [1]),
  rawRow('Jev raw, choice, window of 30 units, model jev-preview', 'ch-structS-in@preview', [1]),
];

export { headlineRow, effRow, jevRows, haikuRows, haikuMajRow, headRow, rawRow, avgRow, fmtN, secs, jevEff, mean, P, out };
void KEY; void LAB_FROZEN; void keyG; void splitOfG; void U3; void MULTI; void accOf; void fmtP; void haikuVotes; void PRICE; void metaOf; void ({} as Label6);

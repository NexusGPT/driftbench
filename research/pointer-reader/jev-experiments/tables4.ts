// Tables of RESULTS-4.md, computed from results4/ (Jev), results3/haiku-r*.json (Haiku), heads4/ (calibrated heads) and the answer key.
// Usage: tsx jev-experiments/tables4.ts > tables4.out.md
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { U3 } from './src/p3';
import { KEY, keyG, splitOfG, LAB_A, LAB_C } from './src/key4';
import {
  ALL_G, FROZEN, KEY_SETS, MULTI, accOf, decisionFrom, designPasses, effOf, fmt, fmtP, haikuEff, haikuMajority, haikuOne, haikuVotes, per100, score, sumEff, vec6, PRICE,
  type Acc, type Decision, type Eff,
} from './src/dec4';
import { L6 } from './src/p4';
import { HEADS, headDecisions } from './heads4';
import { metaOf } from './src/feat4';
import { effRow, headlineRow, headRow, jevRows, haikuRows, haikuMajRow, secs, jevEff, rawRow, avgRow } from './src/rows4';

const out: string[] = [];
const P = (s = '') => out.push(s);
const H = (id: string) => HEADS.find((h) => h.id === id)!;
const hd = (id: string) => headDecisions(H(id));

// ---------- 1. headline ----------
const rowsAll = [
  ...jevRows,
  headRow('cal1'),
  headRow('J1'),
  headRow('J3'),
  headRow('S4p'),
  headRow('J1b'),
  ...haikuRows,
  haikuMajRow,
  headRow('J1h'),
];
P('### Table 1. Per-unit label accuracy on the answer key (units where A and C agree)\n');
P('Accuracy % with the Wilson 95% interval in brackets. "10% unsure" holds back the 10% of units with the lowest confidence (for Jev: the gap between the two most likely labels). Units are not independent (they sit in 9 files), so the intervals are optimistic.\n');
P('| Design | 0% unsure, key (n = 465) | 10% unsure, key | 0% unsure, test files only (n = 317) | 0% unsure, full adjudicated set (n = 566) |');
P('|---|---|---|---|---|');
for (const r of rowsAll) P(headlineRow(r));
P();

// haiku unsure natural rate
{
  const nonU = keyG.filter((g) => Math.max(...haikuVotes(g)) < 3).length;
  const un = keyG.filter((g) => Math.max(...haikuVotes(g)) === 3);
  const ok = un.filter((g) => L6[haikuVotes(g).indexOf(3)] === KEY.get(g)).length;
  P(`Haiku majority of 3: the 3 runs are not unanimous on ${nonU} of ${keyG.length} key units (${(100 * nonU / keyG.length).toFixed(1)}%). On the ${un.length} units where they are unanimous the accuracy is ${fmt(accOf(ok, un.length))}.\n`);
}

// ---------- 2. efficiency ----------
P('### Table 2. Efficiency per 100 units\n');
P('All Jev calls are sequential (one at a time), so "seconds per call" is clean. Haiku runs were sequential too, one call per file. Jev price: USD 0.042 per million input tokens, output free (owner, 17 October 2026, from a screenshot of a pricing answer; the same screenshot mentions "around 0.25 per million" on volume packs, which contradicts it; 0.042 is used). Haiku price: derived from our receipts, USD 0.10 per million input and 0.50 per million output tokens. Seconds per 100 units is the sum of the call times for the design, one call after the other.\n');
P('| Design | Calls | Input tokens | Output tokens | Median s per call | 90th percentile s per call | Seconds per 100 units | USD per 100 units |');
P('|---|---|---|---|---|---|---|---|');
for (const r of rowsAll) P(effRow(r));
P();

// ---------- 3. window sizes ----------
P('### Table 3. Batch size: one choice question per unit, key accuracy of one pass\n');
const winRows: Array<[string, string, string]> = [
  ['ch-local-in', 'one unit per call, with its block and the blocks around it', 'in criteria'],
  ['ch-structS-in', 'about 30 units per call (21 calls for 566 units)', 'in criteria'],
  ['ch-structL-in', 'one file per call (up to 86 units)', 'in criteria'],
  ['ch-structA-in', 'about 140 units per call (4 calls)', 'in criteria'],
  ['ch-structL-st', 'one file per call', 'once in the state'],
  ['ch-structL-gd', 'one file per call', 'the annotators\' guide once in the state'],
  ['ch-structC-gd', 'about 300 units per call (2 calls)', 'the annotators\' guide once in the state'],
  ['ch-structW-gd', 'all 566 units in one call', 'the annotators\' guide once in the state'],
  ['ch-flatW-st', 'all 566 units in one call, flat window (no structure shown)', 'once in the state'],
  ['ch-structS-rich', 'about 30 units per call', 'the annotators\' definitions in criteria'],
  ['ch-structS-ex', 'about 30 units per call', 'definitions plus 3 invented examples per option in criteria'],
  ['ch-flatS-in', 'about 30 units per call, flat window (no structure shown)', 'in criteria'],
];
P('| Window | Where the definitions are | Questions in the largest call | Accuracy % [Wilson 95%] | 10% unsure | Calls per 100 units | Input tokens per 100 units | Seconds per 100 units |');
P('|---|---|---|---|---|---|---|---|');
for (const [id, win, defs] of winRows) {
  const rs = designPasses(id, [1]); if (!rs.length) continue;
  const dec = (g: number) => decisionFrom(vec6(id, rs, g));
  const e = effOf(rs); const p = per100(e, 'jev');
  const qmax = Math.max(...rs[0]!.calls.map((c) => c.nq));
  P(`| ${win} | ${defs} | ${qmax} | ${fmt(score(dec, KEY_SETS.all))} | ${fmtP(score(dec, KEY_SETS.all, 0.1))} | ${p.calls.toFixed(1)} | ${(p.tokIn / 1000).toFixed(1)}k | ${secs(e).toFixed(1)} |`);
}
P();

// ---------- 4. heads ----------
P('### Table 4. Calibrated heads over Jev answers (leave one file out, trained on the key labels of the other files)\n');
P('Accuracy % on the key at 0%, 10%, 30% and 50% unsure, with Wilson 95% bounds; the last two columns split the 0% figure by position in a multi-unit rule.\n');
P('| Head | 0% | 10% | 30% | 50% | Outside multi-unit rules | Inside multi-unit rules |');
P('|---|---|---|---|---|---|---|');
for (const id of ['cal1', 'cal1s', 'J1', 'J3', 'S4', 'S4p', 'J1h', 'J1b']) {
  const d = hd(id); const f = (g: number) => d.get(g)!;
  P(`| ${H(id).name} | ${fmt(score(f, KEY_SETS.all))} | ${fmt(score(f, KEY_SETS.all, 0.1))} | ${fmt(score(f, KEY_SETS.all, 0.3))} | ${fmt(score(f, KEY_SETS.all, 0.5))} | ${fmt(score(f, KEY_SETS.all.filter((g) => !MULTI.has(g))))} | ${fmt(score(f, KEY_SETS.all.filter((g) => MULTI.has(g))))} |`);
}
P();

// ---------- 5. cascades ----------
const J = hd('J1'); const jf = (g: number) => J.get(g)!;
const jEff = jevEff(H('J1').components); const jP = per100(jEff, 'jev');
const hE3 = haikuEff([1, 2, 3]); const hP3 = per100(hE3, 'haiku');
const hOne = haikuEff([1]); void hOne;
function cascade(set: number[], toH: Set<number>, runs: 1 | 3) {
  let ok = 0, n = 0, uns = 0;
  for (const g of set) {
    if (!toH.has(g)) { n++; if (jf(g).pred === KEY.get(g)) ok++; continue; }
    if (runs === 3) { const v = haikuVotes(g); const mx = Math.max(...v); if (mx < 3) { uns++; continue; } n++; if (L6[v.indexOf(mx)] === KEY.get(g)) ok++; }
    else { n++; const lab = [1, 2, 3].map((r) => haikuOne(r)(g).pred); void lab; }
  }
  return { n, ok, uns };
}
P('### Table 5. Jev first, Haiku second: operating points on the key\n');
P('The Jev head J* (row "J*, 1 pass" of Table 4) ranks the units by confidence. The lowest-confidence share goes to Haiku (3 runs). Haiku\'s answer is taken only if the 3 runs are unanimous; otherwise the unit is "unsure" and goes to a person. Haiku cost: the full input of every call (guide and file) plus the output for the share sent; time scales with the output. These are estimates computed from the recorded full runs, not new calls.\n');
P('| Share sent to Haiku | Margin cut | Accepted units | Accuracy on accepted % [Wilson 95%] | Unsure (to a person) % | USD per 100 units | Seconds per 100 units (Jev + Haiku runs one after the other) |');
P('|---|---|---|---|---|---|---|');
const orderAsc = [...KEY_SETS.all].sort((a, b) => jf(a).conf - jf(b).conf);
for (const f of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1]) {
  const cut = Math.round(KEY_SETS.all.length * f);
  const toH = new Set(orderAsc.slice(0, cut));
  const c = cascade(KEY_SETS.all, toH, 3);
  const tau = cut === 0 ? 0 : jf(orderAsc[cut - 1]!).conf;
  const usd = jP.usd + (hE3.tokIn * PRICE.haikuIn + hE3.tokOut * f * PRICE.haikuOut) * (100 / hE3.units);
  const sec = secs(jEff) + f * secs(hE3);
  P(`| ${(100 * f).toFixed(0)}% | ${tau.toFixed(2)} | ${c.n} | ${fmt(accOf(c.ok, c.n))} | ${(100 * c.uns / KEY_SETS.all.length).toFixed(1)} | ${usd.toFixed(4)} | ${sec.toFixed(1)} |`);
}
P();

// threshold chosen on the dev files
P('#### Threshold chosen on the dev files, applied to the test files\n');
P('The margin cut is the lowest one at which the Jev-accepted dev units reach the target accuracy; it is then applied unchanged to the test files (317 key units).\n');
P('| Target accuracy of Jev-accepted units (dev) | Margin cut | Dev: share kept by Jev, accuracy | Test: share kept by Jev | Test: accuracy of Jev-accepted | Test: share sent to Haiku | Test: accuracy after Haiku (accepted) [Wilson 95%] | Test: unsure % |');
P('|---|---|---|---|---|---|---|---|');
for (const target of [0.95, 0.97, 0.98, 0.99]) {
  const dev = [...KEY_SETS.dev].sort((a, b) => jf(b).conf - jf(a).conf);
  let tau = 1.01, devKept = 0, devAcc = 0;
  for (let k = 20; k <= dev.length; k++) { const s = dev.slice(0, k); const a = s.filter((g) => jf(g).pred === KEY.get(g)).length / k; if (a >= target) { tau = jf(dev[k - 1]!).conf; devKept = k; devAcc = a; } }
  const tst = KEY_SETS.test; const keep = tst.filter((g) => jf(g).conf >= tau); const toH = new Set(tst.filter((g) => jf(g).conf < tau));
  const jk = keep.filter((g) => jf(g).pred === KEY.get(g)).length;
  const c = cascade(tst, toH, 3);
  P(`| ${(100 * target).toFixed(0)}% | ${tau.toFixed(2)} | ${(100 * devKept / dev.length).toFixed(0)}%, ${(100 * devAcc).toFixed(1)}% | ${(100 * keep.length / tst.length).toFixed(0)}% | ${fmt(accOf(jk, keep.length))} | ${(100 * toH.size / tst.length).toFixed(0)}% | ${fmt(accOf(c.ok, c.n))} | ${(100 * c.uns / tst.length).toFixed(1)} |`);
}
P();

// other orders
P('#### Other mixes\n');
P('| Mix | Accepted units | Accuracy % [Wilson 95%] | Unsure % |');
P('|---|---|---|---|');
{
  const set = KEY_SETS.all;
  // Haiku first: unanimous accepted; else Jev head if its margin is high, else unsure
  for (const tau of [1.01, 0.9, 0.7, 0.5, 0.3]) {
    let ok = 0, n = 0, uns = 0;
    for (const g of set) { const v = haikuVotes(g); const mx = Math.max(...v); if (mx === 3) { n++; if (L6[v.indexOf(3)] === KEY.get(g)) ok++; } else if (jf(g).conf >= tau) { n++; if (jf(g).pred === KEY.get(g)) ok++; } else uns++; }
    P(`| Haiku (3 runs) first; where the runs disagree, the Jev head decides if its margin is at least ${tau > 1 ? '(never)' : tau.toFixed(1)} | ${n} | ${fmt(accOf(ok, n))} | ${(100 * uns / set.length).toFixed(1)} |`);
  }
  let ok = 0, n = 0;
  for (const g of set) if (jf(g).pred === haikuMajority(g).pred) { n++; if (jf(g).pred === KEY.get(g)) ok++; }
  P(`| Accept only if the Jev head and the Haiku majority give the same label | ${n} | ${fmt(accOf(ok, n))} | ${(100 * (set.length - n) / set.length).toFixed(1)} |`);
  ok = 0; n = 0;
  for (const g of set) { const v = haikuVotes(g); if (Math.max(...v) === 3 && jf(g).pred === L6[v.indexOf(3)]) { n++; if (jf(g).pred === KEY.get(g)) ok++; } }
  P(`| Accept only if the Jev head and a unanimous Haiku give the same label | ${n} | ${fmt(accOf(ok, n))} | ${(100 * (set.length - n) / set.length).toFixed(1)} |`);
  const hh = hd('J1h'); const hf = (g: number) => hh.get(g)!;
  for (const u of [0, 0.1, 0.15, 0.2]) { const s = score(hf, set, u); P(`| One head over the Jev answers and the 3 Haiku votes, ${(100 * u).toFixed(0)}% unsure | ${s.n} | ${fmt(s)} | ${(100 * u).toFixed(1)} |`); }
}
P();

// ---------- 6. error shapes ----------
P('### Table 6. Where the labels go wrong (key units)\n');
function conf(name: string, f: (g: number) => string) {
  const m: Record<string, Record<string, number>> = {};
  for (const g of KEY_SETS.all) { const k = KEY.get(g)!, p = f(g); ((m[k] ??= {})[p] = ((m[k] ??= {})[p] ?? 0) + 1); }
  P(`**${name}** (rows: key label; columns: predicted)\n`);
  P(`| key \\ predicted | ${L6.join(' | ')} | recall % |`); P(`|---|${L6.map(() => '---').join('|')}|---|`);
  for (const k of L6) { const row = L6.map((p) => m[k]?.[p] ?? 0); const tot = row.reduce((a, b) => a + b, 0); P(`| ${k} | ${row.join(' | ')} | ${tot ? (100 * (m[k]?.[k] ?? 0) / tot).toFixed(1) : 'n/a'} |`); }
  P();
}
conf('Jev head J* (1 pass)', (g) => jf(g).pred);
conf('Jev raw, choice, window of 30 units, 1 pass', (g) => decisionFrom(vec6('ch-structS-in', designPasses('ch-structS-in', [1]), g)).pred);
conf('Haiku majority of 3', (g) => haikuMajority(g).pred);
P('Accuracy by the kind of unit (key; J* against Haiku majority):\n');
P('| Kind of unit | Key units | Jev head J* | Haiku majority of 3 |'); P('|---|---|---|---|');
{
  const kinds = new Map<string, number[]>();
  for (const g of KEY_SETS.all) { const m = metaOf(g); const k = m.container === 'table_cell' ? (m.col === 0 ? 'table cell, first column' : m.col === m.cols - 1 ? 'table cell, last column' : 'table cell, middle column') : m.container; kinds.set(k, [...(kinds.get(k) ?? []), g]); }
  for (const [k, gs] of [...kinds.entries()].sort((a, b) => b[1].length - a[1].length)) P(`| ${k} | ${gs.length} | ${fmt(score(jf, gs))} | ${fmt(score(haikuMajority, gs))} |`);
  const inMulti = KEY_SETS.all.filter((g) => MULTI.has(g)), outMulti = KEY_SETS.all.filter((g) => !MULTI.has(g));
  P(`| inside a multi-unit rule | ${inMulti.length} | ${fmt(score(jf, inMulti))} | ${fmt(score(haikuMajority, inMulti))} |`);
  P(`| outside multi-unit rules | ${outMulti.length} | ${fmt(score(jf, outMulti))} | ${fmt(score(haikuMajority, outMulti))} |`);
}
P();
P('Who is right when the Jev head J* and Haiku (majority of 3) differ (key units):\n');
{
  let jr = 0, hr = 0, nr = 0, dis = 0;
  for (const g of KEY_SETS.all) { const j = jf(g).pred, h = haikuMajority(g).pred; if (j === h) continue; dis++; if (j === KEY.get(g)) jr++; else if (h === KEY.get(g)) hr++; else nr++; }
  P(`They differ on ${dis} of ${KEY_SETS.all.length} units: Jev is right on ${jr}, Haiku on ${hr}, neither on ${nr}.\n`);
}
P('The 15 most confident wrong answers of the Jev head J* (key units):\n');
P('| Unit (file#number) | Key label | Jev head | Margin | Haiku majority | Text |'); P('|---|---|---|---|---|---|');
for (const g of [...KEY_SETS.all].filter((x) => jf(x).pred !== KEY.get(x)).sort((a, b) => jf(b).conf - jf(a).conf).slice(0, 15)) { const u = U3[g - 1]!; P(`| ${u.file}#${u.n} | ${KEY.get(g)} | ${jf(g).pred} | ${jf(g).conf.toFixed(2)} | ${haikuMajority(g).pred} | ${u.text.slice(0, 90).replace(/\|/g, '/')} |`); }
P();
console.log(out.join('\n'));
void readFileSync; void join; void dir; void splitOfG; void LAB_A; void LAB_C; void rawRow; void avgRow; void sumEff; void haikuOne;

// Extras for RESULTS-3: cost per design, descent savings of the top-down arm, class breakdown, two-system agreement, error list.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { C6, type Dec } from './src/dec2';
import { CANDS3, RULES3, U3, byG3, type P3Run } from './src/p3';
import { assemble, candProbFrom, evalSplit, goldSpans, idx3, linkProbFrom, loadHaiku3, pct, RUNS3, stackFromGold2, votes } from './src/lib3';
import { assembleCal, candProbs, linkProbs, type CalInputs } from './src/cal3';
import { INSTR, scoreSpans, spansOf, type Span } from './src/spans';

const out: string[] = []; const P = (s = '') => out.push(s);
// ---- cost ----
const files = readdirSync(join(dir, 'results3')).filter((f) => f.endsWith('.json') && !f.startsWith('haiku'));
const byVar = new Map<string, { calls: number; tin: number; tout: number; passes: number }>();
for (const f of files) {
  const r = JSON.parse(readFileSync(join(dir, 'results3', f), 'utf8')) as P3Run;
  const e = byVar.get(r.variant) ?? { calls: 0, tin: 0, tout: 0, passes: 0 };
  e.calls += r.calls.length; e.tin += r.calls.reduce((a, c) => a + (c.tokIn ?? 0), 0); e.tout += r.calls.reduce((a, c) => a + (c.tokOut ?? 0), 0); e.passes++;
  byVar.set(r.variant, e);
}
P('| Question set | Passes | Calls (all passes) | Calls per pass | Tokens in / out per pass (k) |'); P('|---|---|---|---|---|');
const nameOf: Record<string, string> = { base: 'unit label questions, arm 0 wording', 'a-rules': 'unit label questions, arm a (rules + examples)', 'b-decomp': 'unit sub-questions, arm b', 'c-para1': 'unit label questions, arm c paraphrase 1', 'c-para2': 'arm c paraphrase 2', 'c-para3': 'arm c paraphrase 3', 'd-none': 'arm d, no heading lines', 'd-role': 'arm d, heading lines + file role', 'g-cand': 'block questions (one, forbid, order), 240 blocks', 'g-var': 'six other wordings of the block question', 'h-pair': 'pair question, 541 neighbour pairs' };
let tot = { calls: 0, tin: 0, tout: 0 };
for (const [k, e] of [...byVar.entries()].sort()) { P(`| ${nameOf[k] ?? k} | ${e.passes} | ${e.calls} | ${(e.calls / e.passes).toFixed(0)} | ${(e.tin / e.passes / 1000).toFixed(0)} / ${(e.tout / e.passes / 1000).toFixed(0)} |`); tot.calls += e.calls; tot.tin += e.tin; tot.tout += e.tout; }
P(`| **Total, phase 3** | | **${tot.calls}** | | ${(tot.tin / 1e6).toFixed(2)}M in / ${(tot.tout / 1e6).toFixed(2)}M out |`);
P();
// ---- shared inputs ----
const load = (id: string) => [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results3', `${id}-r${r}.json`), 'utf8')) as P3Run);
const gcand = load('g-cand'), hpair = load('h-pair'), gvar = load('g-var');
const cpV1 = candProbFrom(gcand), lp = linkProbFrom(hpair);
const meanKey = (rs: P3Run[], cid: number, key: string) => { const xs = rs.map((r) => r.probs[1_000_000 + cid]?.[key]).filter((x): x is number => x !== undefined); return xs.reduce((a, b) => a + b, 0) / xs.length; };
const cpRange = (cid: number, key: 'one' | 'forbid' | 'order') => (key === 'one' ? meanKey(gvar, cid, 'range') : cpV1(cid, key));
const hs = loadHaiku3();
const unitJ = stackFromGold2(false);
// ---- descent savings of g ----
{
  const a = assemble(unitJ, cpRange, null, { tOne: 0.4, tForbid: 0.5, tOrder: 0.5, trim: true, tLink: null, useCands: true, byProb: true, kindMode: 'members' });
  const acceptedBlocks = a.accepted;
  const blocks = CANDS3.filter((c) => (cpRange(c.cid, 'one') as number) >= 0.4);
  const covered = new Set<number>(); for (const s of a.spans) if (s.leaves.length > 1) s.leaves.forEach((g) => covered.add(g));
  P(`Top-down arm (range wording, t=0.4): ${blocks.length} of ${CANDS3.length} blocks reach the threshold; ${acceptedBlocks} are accepted after overlaps; the multi-unit spans it accepts cover ${covered.size} of ${idx3.length} units, which need no sentence-level question in a strictly sequential descent.`); P();
}
// ---- best Jev-only design: h-cal, lofo-all ----
const I: CalInputs = { unit: unitJ, cp: cpRange, lp };
const pl = linkProbs(I, 0.03, 'lofo-all');
const T = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
let bt = 0.5, bs = -1; for (const t of T) { const a = assembleCal(I, null, pl, 0, t, true, 'members'); const e = evalSplit(a.spans, a.labels, 'dev'); const sc = e.exactF1 + 0.001 * e.iou50R; if (sc > bs) { bs = sc; bt = t; } }
const best = assembleCal(I, null, pl, 0, bt, true, 'members');
// class breakdown
P(`### Where the best Jev-only design (h-cal, t=${bt}) finds and misses gold rules, test files`); P();
P('| Kind of gold rule | Rules | Found exactly | Share % |'); P('|---|---|---|---|');
const bc = evalSplit(best.spans, best.labels, 'test').byClass;
for (const k of Object.keys(bc).sort()) P(`| ${k} | ${bc[k]![1]} | ${bc[k]![0]} | ${pct(bc[k]![0] / bc[k]![1])} |`);
P();
// ---- two systems agree ----
const sp = hs.map((h) => spansOf(idx3.map((g) => h.labels[g] ?? 'none'), idx3.map((g) => h.groups[g]), idx3));
const key = (s: Span) => s.leaves.join(',');
const cnt = new Map<string, { n: number; s: Span }>();
for (const ss of sp) for (const s of ss) { const e = cnt.get(key(s)) ?? { n: 0, s }; e.n++; cnt.set(key(s), e); }
const cons = [...cnt.values()].filter((e) => e.n >= 2).map((e) => e.s);
const consKeys = new Set(cons.map(key));
P('### Two readers agree: accept a span only if the Jev design and the Haiku consensus produce it exactly'); P();
P('| Split | Gold rules | Spans accepted | Accepted spans that equal a gold rule (precision %) | Gold rules covered by an accepted span (recall %) | Of accepted multi-unit spans, precision % |'); P('|---|---|---|---|---|---|');
for (const sPlit of ['dev', 'test', 'all'] as const) {
  const inS = (s: Span) => sPlit === 'all' || byG3.get(s.leaves[0]!)!.split === sPlit;
  const acc = best.spans.filter((s) => consKeys.has(key(s)) && inS(s));
  const gold = goldSpans().filter(inS); const gk = new Set(gold.map(key));
  const ok = acc.filter((s) => gk.has(key(s)));
  const am = acc.filter((s) => s.leaves.length > 1);
  P(`| ${sPlit} | ${gold.length} | ${acc.length} | ${pct(ok.length / acc.length)} | ${pct(ok.length / gold.length)} | ${pct(am.filter((s) => gk.has(key(s))).length / Math.max(1, am.length))} (${am.length}) |`);
}
P();
// per-unit accuracy on units whose span situation both readers agree on
{
  const jLab = best.labels; const hLab = idx3.map((g) => { const s = cons.find((x) => x.leaves.includes(g)); return s ? s.kind : 'none'; });
  const jSpanOf = new Map<number, string>(); for (const s of best.spans) for (const g of s.leaves) jSpanOf.set(g, key(s));
  const hSpanOf = new Map<number, string>(); for (const s of cons) for (const g of s.leaves) hSpanOf.set(g, key(s));
  P('Per-unit labels, accepted only where both readers give the same label and the same span (or both see no instruction):'); P();
  P('| Split | Units | Accepted | Accuracy on accepted % | Accuracy on all % |'); P('|---|---|---|---|---|');
  for (const sPlit of ['dev', 'test', 'all'] as const) {
    const ix = idx3.filter((g) => sPlit === 'all' || byG3.get(g)!.split === sPlit);
    const acc = ix.filter((g) => jLab[g - 1] === hLab[g - 1] && jSpanOf.get(g) === hSpanOf.get(g));
    P(`| ${sPlit} | ${ix.length} | ${acc.length} (${pct(acc.length / ix.length)}%) | ${pct(acc.filter((g) => jLab[g - 1] === byG3.get(g)!.label).length / acc.length)} | ${pct(ix.filter((g) => jLab[g - 1] === byG3.get(g)!.label).length / ix.length)} |`);
  }
  P();
}
// ---- errors of the best design on test ----
P('### Gold rules the best Jev-only design does not find exactly, test files'); P();
{
  const gk = new Set(goldSpans().map(key));
  const wrong = best.spans.filter((s) => byG3.get(s.leaves[0]!)!.split === 'test' && !gk.has(key(s)));
  const missed = goldSpans().filter((s) => byG3.get(s.leaves[0]!)!.split === 'test' && !new Set(best.spans.map(key)).has(key(s)));
  P(`Predicted spans not in gold: ${wrong.length}; gold rules not predicted exactly: ${missed.length}.`); P();
  const fmt = (s: Span) => `${byG3.get(s.leaves[0]!)!.file} units ${s.leaves[0]! - U3.find((u) => u.g === s.leaves[0])!.g + U3.find((u) => u.g === s.leaves[0])!.n}-${U3.find((u) => u.g === s.leaves.at(-1))!.n} [${s.kind}]: "${byG3.get(s.leaves[0]!)!.text.slice(0, 60)}"`;
  P('Gold rules not predicted exactly:'); P(); missed.slice(0, 25).forEach((s) => { const over = best.spans.filter((p) => p.leaves.some((g) => s.leaves.includes(g))).map((p) => `${p.leaves.length} unit(s)`); P(`- ${fmt(s)} -> predicted as ${over.join(' + ') || 'nothing'}`); });
}
console.log(out.join('\n'));
void RULES3; void RUNS3; void C6; void votes; void scoreSpans; void INSTR; void ({} as Dec);

// Spans on the answer key: pair-link head over Jev choice answers (leave-one-file-out), span assembly, scores against the frozen gold and against the rules that annotators A and C produce identically.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { U3, RULES3, byG3 } from './src/p3';
import { spansOf, scoreSpans, INSTR, type Span } from './src/spans';
import { LAB_A, LAB_B, LAB_C, splitOfG, wilson } from './src/key4';
import { HAIKU, haikuMajority, type Decision } from './src/dec4';
import { headDecisions, HEADS } from './heads4';
import { metaOf, pairVec } from './src/feat4';
import { predBin, trainBin } from './src/cal3';

const idx = U3.map((u) => u.g);
const A = JSON.parse(readFileSync(join(dir, 'gold3.author.json'), 'utf8')).units as Array<{ file: string; spanKey?: string }>;
const tsv = (f: string) => new Map(readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([file, n, , group]) => [`${file}#${n}`, group || undefined]));
const gB = tsv('annot3-b.tsv'), gC = tsv('annot3-c.tsv');
const groupsA = A.map((u) => (u.spanKey ? `${u.file}:${u.spanKey}` : undefined));
const groupsB = U3.map((u) => { const g = gB.get(`${u.file}#${u.n}`); return g ? `${u.file}:${g}` : undefined; });
const groupsC = U3.map((u) => { const g = gC.get(`${u.file}#${u.n}`); return g ? `${u.file}:${g}` : undefined; });
const labs = (m: Map<number, string>) => idx.map((g) => m.get(g)!);
const spA = spansOf(labs(LAB_A), groupsA, idx), spB = spansOf(labs(LAB_B), groupsB, idx), spC = spansOf(labs(LAB_C), groupsC, idx);
const spG: Span[] = RULES3.map((r) => ({ leaves: r.leafG, kind: r.kind }));
const key = (s: Span) => s.leaves.join(',');
const linkedLeft = (sp: Span[]) => new Set(sp.filter((s) => s.leaves.length > 1).flatMap((s) => s.leaves.slice(0, -1)));
const lA = linkedLeft(spA), lC = linkedLeft(spC);
const pairs = idx.filter((g) => g < U3.length && U3[g - 1]!.file === U3[g]!.file);
const agreedPair = new Set(pairs.filter((g) => lA.has(g) === lC.has(g)));
const agreedRules = spA.filter((s) => spC.some((c) => key(c) === key(s) && c.kind === s.kind));
const eitherKeys = new Set([...spA, ...spC].map(key));

function pairFeatures(g: number, dec: Map<number, Decision>, passes?: number[]): number[] {
  const a = metaOf(g), b = metaOf(g + 1);
  const sameParent = a.parentId === b.parentId ? 1 : 0, sameBlock = a.blockId === b.blockId ? 1 : 0;
  const leadInPair = a.followedByList && b.leadIn && a.pos === a.n - 1 ? 1 : 0;
  const kinds = ['heading', 'sentence', 'list_item', 'table_cell', 'front_matter_value', 'block_quote'];
  return [...pairVec(g, passes), ...dec.get(g)!.vec, ...dec.get(g + 1)!.vec, sameParent, sameBlock, leadInPair, ...kinds.map((k) => (a.container === k ? 1 : 0)), ...kinds.map((k) => (b.container === k ? 1 : 0))];
}
/** leave-one-file-out link head: trained on the pairs on which A and C agree (linked or not) in the other files */
function linkHead(dec: Map<number, Decision>, passes?: number[], lambda = 0.1): Map<number, number> {
  const X = new Map(pairs.map((g) => [g, pairFeatures(g, dec, passes)]));
  const out = new Map<number, number>();
  for (const f of new Set(U3.map((u) => u.file))) {
    const tr = pairs.filter((g) => U3[g - 1]!.file !== f && agreedPair.has(g));
    const m = trainBin(tr.map((g) => X.get(g)!), tr.map((g) => (lA.has(g) ? 1 : 0)), lambda);
    for (const g of pairs) if (U3[g - 1]!.file === f) out.set(g, predBin(m, X.get(g)!));
  }
  return out;
}
function assemble(dec: Map<number, Decision>, link: Map<number, number>, tau: number): Span[] {
  const pred = (g: number) => dec.get(g)!.pred as string;
  const parent = new Map(idx.map((g) => [g, g]));
  const find = (x: number): number => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  for (const g of pairs) if ((link.get(g) ?? 0) >= tau && (INSTR.has(pred(g)) || INSTR.has(pred(g + 1)))) parent.set(find(g + 1), find(g));
  const groups = new Map<number, number[]>();
  for (const g of idx) groups.set(find(g), [...(groups.get(find(g)) ?? []), g]);
  const out: Span[] = [];
  for (const [, ls] of groups) {
    const kinds = ls.map(pred).filter((k) => INSTR.has(k));
    if (!kinds.length) continue;
    // members that are not instructions at the edges are trimmed; the span keeps the instruction units and what lies between them
    const first = ls.findIndex((g) => INSTR.has(pred(g))), last = ls.length - 1 - [...ls].reverse().findIndex((g) => INSTR.has(pred(g)));
    const core = ls.slice(first, last + 1);
    out.push({ leaves: core, kind: ['prohibition', 'gate', 'rule'].find((k) => kinds.includes(k))! });
  }
  return out;
}
export type SpanRow = { name: string; spans: Span[] };
function metrics(sp: Span[], split: 'dev' | 'test' | 'all') {
  const inS = (s: Span) => split === 'all' || splitOfG(s.leaves[0]!) === split;
  const g = spG.filter(inS), p = sp.filter(inS);
  const sc = scoreSpans(g, p);
  const gm = g.filter((s) => s.leaves.length > 1), pm = new Set(p.map(key));
  const ar = agreedRules.filter(inS), hit = ar.filter((s) => pm.has(key(s))).length;
  const pe = p.filter((s) => eitherKeys.has(key(s))).length;
  return { n: p.length, exactP: sc.exact.p, exactR: sc.exact.r, exactF1: sc.exact.f1, kindF1: sc.exactKind.f1, iouR: sc.iou50.r, anyR: sc.any.r, multiR: gm.length ? gm.filter((s) => pm.has(key(s))).length / gm.length : NaN, agreedHit: hit, agreedN: ar.length, either: wilson(pe, p.length) };
}
const pct = (x: number) => (100 * x).toFixed(1);
export function spanTable(rows: SpanRow[], split: 'dev' | 'test' | 'all'): string {
  const head = '| Design | Spans | Exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 R % | Any-overlap R % | Multi-unit rules found exactly % | Agreed rules found exactly (A = C) | Predicted spans equal to a span of A or of C, % [Wilson 95%] |\n|---|---|---|---|---|---|---|---|---|';
  return head + '\n' + rows.map((r) => { const m = metrics(r.spans, split); return `| ${r.name} | ${m.n} | ${pct(m.exactP)} / ${pct(m.exactR)} / **${pct(m.exactF1)}** | ${pct(m.kindF1)} | ${pct(m.iouR)} | ${pct(m.anyR)} | ${pct(m.multiR)} | ${m.agreedHit} of ${m.agreedN} | ${pct(m.either.p)} [${pct(m.either.lo)}, ${pct(m.either.hi)}] |`; }).join('\n');
}
const haikuSpans = (r: number) => spansOf(idx.map((g) => HAIKU[r - 1]!.labels[g]!), idx.map((g) => HAIKU[r - 1]!.groups[g]), idx);
const cons = (() => {
  const sp = [1, 2, 3].map(haikuSpans); const cnt = new Map<string, { n: number; s: Span }>();
  for (const ss of sp) for (const s of ss) { const e = cnt.get(key(s)) ?? { n: 0, s }; e.n++; cnt.set(key(s), e); }
  const c = [...cnt.values()].filter((e) => e.n >= 2).map((e) => e.s);
  const covered = new Set(c.flatMap((s) => s.leaves));
  return [...c, ...idx.filter((g) => !covered.has(g) && INSTR.has(haikuMajority(g).pred)).map((g) => ({ leaves: [g], kind: haikuMajority(g).pred as string }))];
})();

if (process.argv[1]?.endsWith('an20.ts')) {
  const out: string[] = [];
  const headId = process.argv[2] ?? 'J1';
  const H = HEADS.find((h) => h.id === headId)!;
  const dec = headDecisions(H);
  const T = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const rows: SpanRow[] = [];
  const s0 = assemble(dec, new Map(), 2);
  rows.push({ name: 'Jev head, per-unit labels only (no grouping)', spans: s0 });
  for (const passes of [[1], [1, 2, 3]]) {
    const link = linkHead(dec, passes);
    let bt = 0.5, bs = -1;
    for (const t of T) { const m = metrics(assemble(dec, link, t), 'dev'); if (m.exactF1 > bs) { bs = m.exactF1; bt = t; } }
    rows.push({ name: `Jev head + calibrated pair head (pair answers: ${passes.length} pass${passes.length > 1 ? 'es' : ''}; tau ${bt} chosen on dev)`, spans: assemble(dec, link, bt) });
  }
  rows.push({ name: 'Haiku run 1 with its own groups', spans: haikuSpans(1) }, { name: 'Haiku run 2 with its own groups', spans: haikuSpans(2) }, { name: 'Haiku run 3 with its own groups', spans: haikuSpans(3) }, { name: 'Haiku consensus (spans produced identically by 2 of 3 runs)', spans: cons });
  const jevSp = rows[2]!.spans, jk = new Set(jevSp.map(key)), ck = new Set(cons.map(key));
  rows.push({ name: 'Both agree: Jev head + pair head spans that Haiku consensus also produces', spans: jevSp.filter((s) => ck.has(key(s))) });
  void jk;
  for (const sp of ['test', 'dev', 'all'] as const) out.push(`#### ${sp === 'test' ? 'Test files' : sp === 'dev' ? 'Dev files' : 'All 9 files'}\n\n${spanTable(rows, sp)}\n`);
  out.push(`Agreed pairs (A and C agree on linked or not): ${agreedPair.size} of ${pairs.length}; linked in A ${lA.size}, in C ${lC.size}; agreed rules ${agreedRules.length} (multi-unit ${agreedRules.filter((s) => s.leaves.length > 1).length}).`);
  writeFileSync(join(new URL('.', import.meta.url).pathname, `tables4-spans-${headId}.md`), out.join('\n'));
  console.log(out.join('\n'));
}
void byG3;

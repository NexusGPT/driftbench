// AUC of each block/pair question wording for detecting (a) a candidate that is exactly one gold rule, (b) a linked pair. Dev and test shown; chosen on dev.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { CANDS3, RULES3, byG3, type P3Run } from './src/p3';
import { adjacentPairs } from './src/cal3';
import { INSTR } from './src/spans';
const runs = (id: string, ns: number[]) => ns.map((r) => JSON.parse(readFileSync(join(dir, 'results3', `${id}-r${r}.json`), 'utf8')) as P3Run);
const auc = (pos: number[], neg: number[]) => { let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0; return s / (pos.length * neg.length); };
const goldKeys = new Set(RULES3.map((r) => r.leafG.join(',')));
const trim = (leaves: number[]) => { const l = [...leaves]; while (l.length && byG3.get(l[0]!)!.label === 'none') l.shift(); while (l.length && byG3.get(l.at(-1)!)!.label === 'none') l.pop(); return l; };
const isPos = (c: (typeof CANDS3)[0]) => goldKeys.has(trim(c.leaves).join(','));
const splitOf = (file: string) => (['standing-instructions.md', 'repair-ticket-skill.md', 'mains-safety-skill.md'].includes(file) ? 'dev' : 'test');
const G = runs('g-var', [1]);
const base = runs('g-cand', [1, 2, 3]);
const mean = (rs: P3Run[], k: number, key: string) => { const xs = rs.map((r) => r.probs[k]?.[key]).filter((x): x is number => x !== undefined); return xs.reduce((a, b) => a + b, 0) / xs.length; };
console.log('block wordings: AUC for "this candidate is exactly one gold rule" (positives dev/test)');
const keys: Array<[string, (c: (typeof CANDS3)[0]) => number]> = [['one (phase 3 wording, 3 passes)', (c) => mean(base, 1_000_000 + c.cid, 'one')], ['one (phase 3 wording, pass 1)', (c) => base[0]!.probs[1_000_000 + c.cid]!.one!], ...['one2', 'one3', 'hasinstr', 'multi', 'allinstr', 'range'].map((k) => [k, (c: (typeof CANDS3)[0]) => G[0]!.probs[1_000_000 + c.cid]![k]!] as [string, (c: (typeof CANDS3)[0]) => number]), ['1 - multi', (c) => 1 - G[0]!.probs[1_000_000 + c.cid]!.multi!], ['hasinstr*(1-multi)', (c) => G[0]!.probs[1_000_000 + c.cid]!.hasinstr! * (1 - G[0]!.probs[1_000_000 + c.cid]!.multi!)]];
for (const [name, f] of keys) {
  const row: string[] = [];
  for (const sp of ['dev', 'test']) { const cs = CANDS3.filter((c) => splitOf(c.file) === sp); const pos = cs.filter(isPos), neg = cs.filter((c) => !isPos(c)); row.push(`${sp} AUC ${auc(pos.map(f), neg.map(f)).toFixed(3)} (${pos.length}+/${neg.length}-)`); }
  console.log(name.padEnd(36), row.join(' | '));
}
// pair wordings
const H = runs('h-var', [1]); const Hb = runs('h-pair', [1, 2, 3]);
const goldRuleOf = new Map<number, string>(); for (const r of RULES3) for (const g of r.leafG) goldRuleOf.set(g, r.id);
const multi = new Set(RULES3.filter((r) => r.multi).map((r) => r.id));
const linked = (a: number) => goldRuleOf.has(a) && goldRuleOf.get(a) === goldRuleOf.get(a + 1) && multi.has(goldRuleOf.get(a)!);
const cand2 = adjacentPairs.filter((a) => (INSTR.has(byG3.get(a)!.label) || INSTR.has(byG3.get(a + 1)!.label)) && Hb[0]!.probs[2_000_000 + a]?.same !== undefined);
const getH = (a: number, k: string) => H[0]!.probs[2_000_000 + a]![k]!;
const meanB = (a: number) => Hb.map((r) => r.probs[2_000_000 + a]!.same!).reduce((x, y) => x + y, 0) / Hb.length;
console.log('\npair wordings: AUC for "units a and a+1 are in the same multi-unit rule" over adjacent pairs where at least one is an instruction');
const pk: Array<[string, (a: number) => number]> = [['same (phase 3, 3 passes)', meanB], ['same (phase 3, pass 1)', (a) => Hb[0]!.probs[2_000_000 + a]!.same!], ['cont', (a) => getH(a, 'cont')], ['1 - newstart', (a) => 1 - getH(a, 'newstart')], ['needs (b needed for a)', (a) => getH(a, 'needs')], ['needsrev (a needed for b)', (a) => getH(a, 'needsrev')], ['max(needs, needsrev)', (a) => Math.max(getH(a, 'needs'), getH(a, 'needsrev'))], ['mean of 5 wordings', (a) => (meanB(a) + getH(a, 'cont') + 1 - getH(a, 'newstart') + getH(a, 'needs') + getH(a, 'needsrev')) / 5]];
for (const [name, f] of pk) {
  const row: string[] = [];
  for (const sp of ['dev', 'test']) { const ps = cand2.filter((a) => splitOf(byG3.get(a)!.file) === sp); const pos = ps.filter(linked), neg = ps.filter((a) => !linked(a)); row.push(`${sp} AUC ${auc(pos.map(f), neg.map(f)).toFixed(3)} (${pos.length}+/${neg.length}-)`); }
  console.log(name.padEnd(36), row.join(' | '));
}

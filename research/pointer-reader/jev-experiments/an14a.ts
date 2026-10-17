import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { KEY, keyG, splitOfG, fmtAcc } from './src/key4';
import { L6 } from './src/p4';
import type { Run4 } from './src/p4';
const files = readdirSync(join(dir, 'results4')).filter((f) => f.endsWith('.json'));
const runs = files.map((f) => JSON.parse(readFileSync(join(dir, 'results4', f), 'utf8')) as Run4);
const by = new Map<string, Run4[]>();
for (const r of runs) by.set(r.design, [...(by.get(r.design) ?? []), r]);
const NL = ['rule', 'prohibition', 'gate', 'example', 'description'];
function predict(rs: Run4[], g: number, design: string): { pred: string; margin: number } {
  const vec: Record<string, number> = Object.fromEntries(L6.map((l) => [l, 0]));
  if (design.startsWith('nl-')) {
    const ps = NL.map((l) => rs.reduce((a, r) => a + (r.probs[g]?.[`nl:${l}`] ?? 0), 0) / rs.length);
    const m = Math.max(...ps); NL.forEach((l, i) => (vec[l] = ps[i]!)); vec.none = Math.max(0, 1 - m);
  } else if (design.startsWith('tr-')) {
    const m = (k: string) => rs.reduce((a, r) => a + (r.probs[g]?.[k] ?? 0), 0) / rs.length;
    const pi = m('l1:instruction'); const k3 = ['rule', 'prohibition', 'gate'].map((l) => m(`l2:${l}`)); const s = k3.reduce((a, b) => a + b, 0) || 1;
    ['rule', 'prohibition', 'gate'].forEach((l, i) => (vec[l] = pi * (k3[i]! / s))); vec.example = m('l1:example'); vec.description = m('l1:description'); vec.none = m('l1:none');
  } else for (const l of L6) vec[l] = rs.reduce((a, r) => a + (r.probs[g]?.[`ch:${l}`] ?? 0), 0) / rs.length;
  const s = Object.entries(vec).sort((a, b) => b[1] - a[1]);
  return { pred: s[0]![0], margin: s[0]![1] - s[1]![1] };
}
const sets = { 'key all': keyG, 'key dev': keyG.filter((g) => splitOfG(g) === 'dev'), 'key test': keyG.filter((g) => splitOfG(g) === 'test') };
for (const [id, rs] of by) {
  const one = rs.slice(0, 1);
  const cell = (rr: Run4[], s: number[]) => { const ok = s.filter((g) => predict(rr, g, id).pred === KEY.get(g)).length; return fmtAcc(ok, s.length); };
  const tok = rs[0]!.calls.reduce((a, c) => a + (c.tokIn ?? 0), 0);
  console.log(id.padEnd(20), 'passes', rs.length, '| pass 1:', Object.entries(sets).map(([n, s]) => `${n} ${cell(one, s)}`).join(' | '), rs.length > 1 ? `| mean of ${rs.length}: key all ${cell(rs, sets['key all'])}` : '', '| calls', rs[0]!.calls.length, 'tokIn', tok, 'missing', rs[0]!.missing);
}

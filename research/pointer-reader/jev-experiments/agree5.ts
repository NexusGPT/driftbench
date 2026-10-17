// Agreement of the author (tags in prose5-src, gold5.author.json) with the independent Opus annotator, per unit, per estate and for rules as spans.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const ANN = process.env.ANNOT_DIR ?? '/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-jev-ids/annot5';
const A = JSON.parse(readFileSync(join(here, 'gold5.author.json'), 'utf8')).units as Array<{ file: string; n: number; id: string; container: string; text: string; section: string; label: string; spanKey?: string }>;
const C = new Map<string, { label: string; group: string }>();
for (const e of ['A', 'B', 'C']) for (const l of readFileSync(join(ANN, `labels-${e}-opus.tsv`), 'utf8').trim().split('\n')) { const [f, n, label, group] = l.split('\t'); C.set(`${f}#${n}`, { label: label!, group: group ?? '' }); }
const L = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
const INSTR = new Set(['rule', 'prohibition', 'gate']);
const wilson = (k: number, n: number) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return `${(100 * p).toFixed(1)} [${(100 * (c - m) / d).toFixed(1)}, ${(100 * (c + m) / d).toFixed(1)}]`; };
const kappa = (us: typeof A) => { const n = us.length; const po = us.filter((u) => u.label === C.get(`${u.file}#${u.n}`)!.label).length / n; let pe = 0; for (const l of L) pe += (us.filter((u) => u.label === l).length / n) * (us.filter((u) => C.get(`${u.file}#${u.n}`)!.label === l).length / n); return { po, k: (po - pe) / (1 - pe) }; };
for (const u of A) if (!C.has(`${u.file}#${u.n}`)) throw new Error(`missing ${u.file}#${u.n}`);
if (C.size !== A.length) throw new Error(`annotator has ${C.size}, author ${A.length}`);
const out: string[] = ['| Estate | Files | Units | Same label | Agreement % [Wilson 95%] | Cohen kappa | Instruction vs not, % |', '|---|---|---|---|---|---|---|'];
const est = (f: string) => f[0]!;
const names: Record<string, string> = { A: 'A: support prose (broadband)', B: 'B: code-interpreter estate (bookkeepers)', C: 'C: channel-tabbed prompt (guesthouses)', '*': 'All' };
for (const e of ['A', 'B', 'C', '*']) {
  const us = A.filter((u) => e === '*' || est(u.file) === e);
  const same = us.filter((u) => u.label === C.get(`${u.file}#${u.n}`)!.label).length;
  const ins = us.filter((u) => INSTR.has(u.label) === INSTR.has(C.get(`${u.file}#${u.n}`)!.label)).length;
  out.push(`| ${names[e]} | ${new Set(us.map((u) => u.file)).size} | ${us.length} | ${same} | ${wilson(same, us.length)} | ${kappa(us).k.toFixed(3)} | ${(100 * ins / us.length).toFixed(1)} |`);
}
out.push('', 'Confusion, author (rows) against Opus (columns), all units:', '', `| author \\ opus | ${L.join(' | ')} |`, `|---|${L.map(() => '---').join('|')}|`);
for (const a of L) out.push(`| ${a} | ${L.map((b) => A.filter((u) => u.label === a && C.get(`${u.file}#${u.n}`)!.label === b).length).join(' | ')} |`);
// spans: group letters
const spansOf = (get: (u: (typeof A)[0]) => { label: string; g: string }) => {
  const by = new Map<string, string[]>(); const out2 = new Set<string>();
  for (const u of A) { const x = get(u); if (INSTR.has(x.label) && x.g) { const k = `${u.file}:${x.g}`; by.set(k, [...(by.get(k) ?? []), String(u.n)]); } else if (INSTR.has(x.label)) out2.add(`${u.file}:${u.n}:${x.label}`); }
  for (const [k, ns] of by) { const kind = ns.map((n) => get(A.find((u) => `${u.file}:${u.n}` === `${k.split(':')[0]}:${n}`)!).label); const strongest = ['prohibition', 'gate', 'rule'].find((s) => kind.includes(s))!; out2.add(`${k.split(':')[0]}:${ns.join('-')}:${strongest}`); }
  return out2;
};
const sa = spansOf((u) => ({ label: u.label, g: u.spanKey ?? '' })), sc = spansOf((u) => { const c = C.get(`${u.file}#${u.n}`)!; return { label: c.label, g: c.group }; });
const both = [...sa].filter((s) => sc.has(s)).length;
const stripKind = (s: string) => s.split(':').slice(0, 2).join(':');
const sa2 = new Set([...sa].map(stripKind)), sc2 = new Set([...sc].map(stripKind));
const both2 = [...sa2].filter((s) => sc2.has(s)).length;
const multiA = [...sa].filter((s) => s.split(':')[1]!.includes('-')), multiC = [...sc].filter((s) => s.split(':')[1]!.includes('-'));
out.push('', `Rules as spans (instruction units; a group of units is one rule): author ${sa.size} rules (${multiA.length} multi-unit), Opus ${sc.size} (${multiC.length} multi-unit). Same units and same kind: ${both}; same units: ${both2}. Span F1 with kind: ${(200 * both / (sa.size + sc.size)).toFixed(1)}%, without kind: ${(200 * both2 / (sa2.size + sc2.size)).toFixed(1)}%.`);
// frozen set: agreed units
const agreed = A.filter((u) => u.label === C.get(`${u.file}#${u.n}`)!.label);
const agreedLabels = Object.fromEntries(L.map((l) => [l, agreed.filter((u) => u.label === l).length]));
out.push('', `Agreed units (author = Opus): ${agreed.length} of ${A.length}. By label: ${JSON.stringify(agreedLabels)}.`);
if (process.argv.includes('--freeze')) {
  const units = A.map((u, i) => { const c = C.get(`${u.file}#${u.n}`)!; return { file: u.file, n: u.n, id: u.id, container: u.container, text: u.text, section: u.section, estate: u.file[0], labelAuthor: u.label, labelOpus: c.label, agreed: u.label === c.label, label: u.label === c.label ? u.label : null, spanAuthor: u.spanKey ?? null, groupOpus: c.group || null, g: i + 1 }; });
  const body = JSON.stringify({ labels: L, note: 'label is set only where the author and the independent Opus annotator agree (agreed = true); other units keep both labels and no gold label.', units }, null, 1) + '\n';
  writeFileSync(join(here, 'gold5.json'), body);
  const sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(here, 'gold5.sha256'), sha + '  gold5.json\n');
  out.push('', `Frozen: gold5.json sha256 ${sha}`);
  writeFileSync(join(here, 'disagreements5.tsv'), A.filter((u) => u.label !== C.get(`${u.file}#${u.n}`)!.label).map((u) => `${u.file}#${u.n}\tauthor=${u.label}\topus=${C.get(`${u.file}#${u.n}`)!.label}\t${u.text.slice(0, 140)}`).join('\n') + '\n');
}
writeFileSync(join(here, 'agree5.out.md'), out.join('\n') + '\n');
console.log(out.join('\n'));

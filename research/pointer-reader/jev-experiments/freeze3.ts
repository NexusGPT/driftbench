// Adjudicates annotators A (author tags, gold3.author.json) and B (annot3-b.tsv) into the frozen span gold: gold3.json.
// Method: where the two differ, the author decides against GUIDE3.md, before any model output exists. Defaults: for a unit
// label A stands, except the units in FROM_B; groups start from A's groups, then DROP / ADD below; the kind of a group is
// GROUP_KIND (decided) or A's kind. Every decision below is listed so that it can be audited.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTree } from './src/tree';
const here = new URL('.', import.meta.url).pathname;
type AU = { file: string; n: number; id: string; container: string; text: string; section: string; label: string; spanKey?: string };
const A = JSON.parse(readFileSync(join(here, 'gold3.author.json'), 'utf8')).units as AU[];
const Brows = readFileSync(join(here, 'annot3-b.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
const B = new Map(Brows.map(([f, n, l, g]) => [`${f}#${n}`, { label: l!, group: g || undefined }]));
const INSTR = new Set(['rule', 'prohibition', 'gate']);
const S = {
  standing: 'standing-instructions.md', repair: 'repair-ticket-skill.md', mains: 'mains-safety-skill.md', tool: 'tool-loans-skill.md', rota: 'rota-writer-helper.md',
  parts: 'parts-and-donations-notes.md', booking: 'booking-tool-reference.md', session: 'session-lead-handbook.md', visitor: 'visitor-replies-guide.md',
} as const;
const k = (f: keyof typeof S, n: number) => `${S[f]}#${n}`;
// units where B's label stands (all other disagreements: A's label stands)
const FROM_B = new Set([k('repair', 51), k('booking', 24), k('booking', 81), k('parts', 18), k('parts', 19)]);
// explicit label decisions on units outside any final group
const LABEL_SET: Record<string, string> = { [k('session', 52)]: 'description', [k('session', 55)]: 'description' };
// groups of A to drop (their members are then single units), by first unit
const DROP = new Set([k('parts', 18), k('session', 52), k('rota', 54)]);
// groups added from B
const ADD: Array<{ f: keyof typeof S; ns: number[]; kind: string }> = [
  { f: 'rota', ns: [55, 56], kind: 'gate' },
  { f: 'booking', ns: [54, 55], kind: 'rule' }, { f: 'booking', ns: [56, 57], kind: 'gate' },
  { f: 'booking', ns: [69, 70], kind: 'rule' }, { f: 'booking', ns: [72, 73], kind: 'rule' }, { f: 'booking', ns: [75, 76], kind: 'rule' }, { f: 'booking', ns: [78, 79], kind: 'rule' },
];
// kind of an A group, by first unit, where it is decided
const GROUP_KIND: Record<string, string> = {
  [k('repair', 13)]: 'rule', [k('repair', 23)]: 'gate', [k('repair', 32)]: 'gate',
  [k('mains', 12)]: 'prohibition', [k('mains', 40)]: 'prohibition', [k('mains', 45)]: 'prohibition',
  [k('tool', 21)]: 'gate', [k('rota', 32)]: 'gate', [k('rota', 35)]: 'prohibition', [k('rota', 38)]: 'prohibition',
  [k('parts', 9)]: 'rule', [k('session', 10)]: 'prohibition', [k('session', 24)]: 'prohibition', [k('session', 26)]: 'prohibition',
  [k('visitor', 6)]: 'rule', [k('visitor', 30)]: 'prohibition',
};
// session table rows (A tagged rows t1..t4 with the same letter inside): kinds from B where it applied "until" or "do not"
const ROW_KIND: Record<string, string> = { [k('session', 36)]: 'gate', [k('session', 39)]: 'prohibition', [k('session', 42)]: 'gate' };
Object.assign(GROUP_KIND, ROW_KIND);

type Group = { file: string; ns: number[]; kind: string; source: 'A' | 'B' };
const groups: Group[] = [];
const byKey = new Map<string, AU[]>();
for (const u of A) if (u.spanKey) byKey.set(`${u.file}:${u.spanKey}`, [...(byKey.get(`${u.file}:${u.spanKey}`) ?? []), u]);
for (const [, us] of byKey) {
  const first = `${us[0]!.file}#${us[0]!.n}`;
  if (DROP.has(first)) continue;
  groups.push({ file: us[0]!.file, ns: us.map((u) => u.n), kind: GROUP_KIND[first] ?? us[0]!.label, source: 'A' });
}
for (const g of ADD) groups.push({ file: S[g.f], ns: g.ns, kind: g.kind, source: 'B' });
// unresolved kind conflicts: an A group whose members B labelled with another instruction kind and no decision recorded
const unresolved: string[] = [];
for (const g of groups.filter((x) => x.source === 'A')) {
  const first = `${g.file}#${g.ns[0]}`;
  const bk = g.ns.map((n) => B.get(`${g.file}#${n}`)!.label).filter((l) => INSTR.has(l));
  if (bk.length && !bk.includes(g.kind) && !(first in GROUP_KIND)) unresolved.push(`${first} A=${g.kind} B=${bk.join(',')}`);
}
if (unresolved.length) { console.error('unresolved group kinds:\n' + unresolved.join('\n')); process.exit(1); }
// final per-unit labels
const inGroup = new Map<string, Group>();
for (const g of groups) for (const n of g.ns) inGroup.set(`${g.file}#${n}`, g);
const units = A.map((u) => {
  const key = `${u.file}#${u.n}`;
  const b = B.get(key)!;
  const g = inGroup.get(key);
  let label = g ? g.kind : key in LABEL_SET ? LABEL_SET[key]! : FROM_B.has(key) ? b.label : u.label;
  const gb = !g ? undefined : undefined; void gb;
  return { file: u.file, n: u.n, id: u.id, container: u.container, text: u.text, section: u.section, label, labelA: u.label, labelB: b.label, group: g ? `${g.file}:${g.ns[0]}` : null, contested: false };
});
// contested: labels differ between A and B, or the unit sits in a span (or is a single rule) that only one annotator produced
const groupKeyA = new Set([...byKey.values()].map((us) => us.map((u) => `${u.file}#${u.n}`).join(',')));
const bByFile = new Map<string, Map<string, number[]>>();
for (const u of A) { const b = B.get(`${u.file}#${u.n}`)!; if (b.group) { const m = bByFile.get(u.file) ?? new Map(); m.set(b.group, [...(m.get(b.group) ?? []), u.n]); bByFile.set(u.file, m); } }
const groupKeyB = new Set([...bByFile.entries()].flatMap(([f, m]) => [...m.values()].map((ns) => ns.map((n) => `${f}#${n}`).join(','))));
const sameBoth = new Set([...groupKeyA].filter((x) => groupKeyB.has(x)));
for (const g of groups) { const key = g.ns.map((n) => `${g.file}#${n}`).join(','); if (!sameBoth.has(key)) for (const n of g.ns) units.find((u) => u.file === g.file && u.n === n)!.contested = true; }
for (const u of units) if (u.labelA !== u.labelB) u.contested = true;
// structure: leaf numbers (global g), nodes with ids, per-file trees
let g0 = 0; const fileOrder = [...new Set(units.map((u) => u.file))];
const tree: Record<string, ReturnType<typeof buildTree>> = {};
const offset: Record<string, number> = {};
for (const f of fileOrder) { tree[f] = buildTree(readFileSync(join(here, 'prose3', f), 'utf8'), f, 'phase3-repair-cafe'); offset[f] = g0; g0 += tree[f]!.units.length; }
const DEV = new Set([S.standing, S.repair, S.mains]);
const gUnits = units.map((u) => ({ ...u, g: offset[u.file]! + u.n, split: DEV.has(u.file) ? 'dev' : 'test' }));
const rules: Array<{ id: string; file: string; kind: string; leafG: number[]; multi: boolean; aligned: string | null; contested: boolean }> = [];
let rid = 0;
const nodeOf = (f: string, ns: number[]) => {
  const t = tree[f]!; const key = ns.map((n) => n - 1).join(',');
  const all = [...t.nodes.filter((n) => n.kind !== 'file' && n.kind !== 'section'), ...t.groups];
  const rank: Record<string, number> = { leaf: 6, row: 5, paragraph: 4, list: 4, table: 3, blockquote: 3, group: 2, frontmatter: 1 };
  return all.filter((n) => n.leaves.join(',') === key).sort((a, b) => rank[b.kind]! - rank[a.kind]!)[0];
};
for (const g of groups) rules.push({ id: `r${++rid}`, file: g.file, kind: g.kind, leafG: g.ns.map((n) => offset[g.file]! + n), multi: true, aligned: nodeOf(g.file, g.ns)?.kind ?? null, contested: g.ns.some((n) => units.find((u) => u.file === g.file && u.n === n)!.contested) });
for (const u of gUnits) if (!u.group && INSTR.has(u.label)) rules.push({ id: `r${++rid}`, file: u.file, kind: u.label, leafG: [u.g], multi: false, aligned: 'leaf', contested: u.contested });
rules.sort((a, b) => a.leafG[0]! - b.leafG[0]!);
const out = {
  labels: ['rule', 'prohibition', 'gate', 'example', 'description', 'none'],
  files: fileOrder.map((f) => ({ file: f, offset: offset[f]!, leaves: tree[f]!.units.length, split: DEV.has(f) ? 'dev' : 'test', cutDigest: tree[f]!.digest })),
  units: gUnits, rules,
};
const body = JSON.stringify(out, null, 1) + '\n';
writeFileSync(join(here, 'gold3.json'), body);
const sha = createHash('sha256').update(body).digest('hex');
writeFileSync(join(here, 'gold3.sha256'), sha + '  gold3.json\n');
const multi = rules.filter((r) => r.multi);
const cnt = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
console.log(sha);
console.log(`leaves ${gUnits.length}; rules ${rules.length}; multi-unit ${multi.length} (${((100 * multi.length) / rules.length).toFixed(1)}%)`);
for (const sp of ['dev', 'test'] as const) { const rs = rules.filter((r) => (DEV.has(r.file) ? 'dev' : 'test') === sp); console.log(sp, 'leaves', gUnits.filter((u) => u.split === sp).length, 'rules', rs.length, 'multi', rs.filter((r) => r.multi).length, `(${((100 * rs.filter((r) => r.multi).length) / rs.length).toFixed(1)}%)`); }
console.log('labels', JSON.stringify(cnt(gUnits.map((u) => u.label))));
console.log('rule kinds', JSON.stringify(cnt(rules.map((r) => r.kind))), 'multi aligned', JSON.stringify(cnt(multi.map((r) => r.aligned ?? 'inside-a-block'))));
console.log('contested units', gUnits.filter((u) => u.contested).length, 'contested rules', rules.filter((r) => r.contested).length);
console.log('final vs A agree', gUnits.filter((u) => u.label === u.labelA).length, 'final vs B agree', gUnits.filter((u) => u.label === u.labelB).length);

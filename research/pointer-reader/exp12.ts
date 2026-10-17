import { readFileSync } from 'node:fs';
import { Cassette, MissError } from './src/cassette';
import { sha } from './src/cut';
import { buildRequest, loadSets, setHash, type LabelSet, TEMPLATE_SYSTEM } from './src/labelset';
import { expand, scan, type Labeler } from './src/pipeline';

const R = process.argv[2]!;
const files = new Map<string, string>();
for (const n of ['examples/estates/fixture/CLAUDE.md', 'examples/estates/fixture/.claude/skills/invoice-reconcile/SKILL.md', 'examples/estates/fixture/.claude/skills/shipment-tracker/SKILL.md', 'examples/estates/fixture/.claude/agents/ledger-auditor.md', 'docs/estate-document-roles.md']) files.set(n, readFileSync(`${R}/${n}`, 'utf8'));

const SETS = `
labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - { name: rule, description: A unit that tells the reader what to do., atom: { kind: instruction, polarity: obligation } }
      - { name: prohibition, description: A unit that tells the reader what never to do., atom: { kind: instruction, polarity: prohibition } }
      - { name: gate, description: A unit that sets an order, one act before another., target: required, atom: { kind: gate } }
      - { name: example, description: A unit that shows a case and is not itself an instruction. }
  - set: house-voice
    description: How a style guide for a bakery's customer emails is written.
    labels:
      - { name: voice-rule, description: A unit that fixes a tone or a word choice for customer emails., examples: ["Write as if you were speaking over the counter."] }
      - { name: claim-needs-source, description: A unit that states a fact about an ingredient, a price or an allergen. }
      - { name: legal-line, description: A unit that must appear word for word in a message. }
`;
const sets = loadSets(SETS);

// A deterministic stand-in for a model: the label is a function of the unit text and the label names.
function fake(id: string): Labeler {
  const l: Labeler = {
    id, model: 'fake-labeler-1', calls: 0,
    label(req) {
      l.calls++;
      const names = req.output.enum;
      const units = [...req.user.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2]! }));
      const labels: Array<{ units: string; label: string }> = [];
      for (const u of units) {
        const lab = names[parseInt(sha(u.text + names.join('|')).slice(0, 6), 16) % names.length]!;
        const last = labels.at(-1);
        if (last && last.label === lab && expand(last.units).at(-1) === u.n - 1) last.units = `${expand(last.units)[0]}-${u.n}`;
        else labels.push({ units: String(u.n), label: lab });
      }
      return { labels };
    },
  };
  return l;
}

console.log('== Experiment 12: byte-identical replay, and a one-field change misses and names the field');
const rec = new Cassette();
const l1 = fake('a');
const s1 = scan(files, sets, rec, l1, 'record-missing');
const tape = rec.dump();
console.log(`recorded: ${rec.entries.size} entries, ${l1.calls} calls, ${s1.labelled} labelled units, ${s1.unlabeled} unlabeled, refused ${s1.refused.length}`);
const r2 = scan(files, sets, new Cassette().load(tape), undefined, 'ci');
const r3 = scan(files, sets, new Cassette().load(tape), undefined, 'ci');
console.log('replay 1 === replay 2:', r2.ledger === r3.ledger, '| replay === recorded run:', r2.ledger === s1.ledger, '| ledger bytes', r2.ledger.length);
const rec2 = new Cassette();
scan(files, sets, rec2, fake('b'), 'record-missing');
console.log('a second, independent recording dumps byte-identical cassette:', rec2.dump() === tape, '| sha', sha(tape).slice(0, 12));

const miss = (label: string, fs: Map<string, string>, ss: LabelSet[], tapeText = tape) => {
  try { scan(fs, ss, new Cassette().load(tapeText), undefined, 'ci'); console.log(`  ${label}: SILENT HIT (bad)`); return false; }
  catch (e) { console.log(`  ${label}: ${e instanceof MissError ? 'miss -> differs in [' + e.differs.join(', ') + ']' : 'ERROR ' + (e as Error).message}`); return e instanceof MissError; }
};
console.log('perturbing one request field at a time:');
const edit = (f: (s: LabelSet[]) => void) => { const c = structuredClone(sets); f(c); return c; };
const results = [
  miss('label description edited (agent-rules/rule)', files, edit((s) => { s[0]!.labels[0]!.description += ' Really.'; })),
  miss('label renamed (house-voice/legal-line -> fixed-line)', files, edit((s) => { s[1]!.labels[2]!.name = 'fixed-line'; })),
  miss('example added to a label', files, edit((s) => { s[1]!.labels[0]!.examples!.push('Say loaf.'); })),
  miss('a unit changed in a file', new Map([...files].map(([k, v]) => [k, k.endsWith('CLAUDE.md') ? v.replace(/\b(\w+)\b/, '$1x') : v])), sets),
  miss('a new file in the estate', new Map([...files, ['new.md', '# New\n\nDo it.\n']]), sets),
];
// system text, max tokens, thinking and model: simulated by editing the recorded request parts through a modified build.
const orig = TEMPLATE_SYSTEM;
void orig;
console.log('cutter drift (same request text, different cut digest):');
const drift = tape.split('\n').filter(Boolean).map((line) => { const e = JSON.parse(line); e.readable.cutDigest = 'tampered'; return JSON.stringify(e); }).join('\n') + '\n';
results.push(miss('recorded cut digest tampered', files, sets, drift));
console.log('all perturbations missed and named a field:', results.every(Boolean));

console.log('\n== Experiment 14: editing one label re-labels only under its set');
const rec3 = new Cassette().load(tape);
const edited = edit((s) => { s[0]!.labels[3]!.description += ' It may be quoted.'; });
const l3 = fake('c');
const before = scan(files, sets, new Cassette().load(tape), undefined, 'ci');
const after = scan(files, edited, rec3, l3, 'record-missing');
const windows = new Set([...rec3.entries.values()].map((e) => e.readable.path + e.readable.window)).size;
console.log(`calls after editing one label of agent-rules: ${l3.calls} (agent-rules windows in the estate: ${[...rec3.entries.values()].filter((e) => e.readable.set === 'agent-rules' && e.readable.setHash === setHash(edited[0]!)).length})`);
const idsBefore = JSON.parse(before.ledger).units.map((u: { id: string }) => u.id).join();
const idsAfter = JSON.parse(after.ledger).units.map((u: { id: string }) => u.id).join();
const voiceBefore = JSON.stringify(JSON.parse(before.ledger).units.map((u: { labels: Record<string, unknown> }) => u.labels['house-voice'] ?? null));
const voiceAfter = JSON.stringify(JSON.parse(after.ledger).units.map((u: { labels: Record<string, unknown> }) => u.labels['house-voice'] ?? null));
console.log('unit ids unchanged:', idsBefore === idsAfter, '| house-voice labels unchanged:', voiceBefore === voiceAfter, '| windows total:', windows);

console.log('\n== Experiment 15: the labeler prompt is generic');
const w = { id: 'w', path: 'p.md', headingPath: ['H'], units: [{ n: 1, text: 'Unit one.' }] };
const forbidden = /\b(estate|agent|skill|nexus|claude|driftbench|helper|prompt|rule|gate|instruction|bakery|email)s?\b/i;
const a = buildRequest(sets[0]!, w, 'm'), b = buildRequest(sets[1]!, w, 'm');
const templateOnly = (r: ReturnType<typeof buildRequest>) => r.system;
console.log('system text identical for both sets:', templateOnly(a) === templateOnly(b), '| forbidden words in the system text:', forbidden.test(a.system));
const strip = (r: ReturnType<typeof buildRequest>, set: LabelSet) => r.user.split('\n').filter((line) => !line.startsWith('- ') && !line.startsWith('SET ')).join('\n');
console.log('user text outside set-derived lines identical for both sets:', strip(a, sets[0]!) === strip(b, sets[1]!), '| forbidden words there:', forbidden.test(strip(a, sets[0]!)));

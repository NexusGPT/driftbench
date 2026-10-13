import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gramTfidf, gramCosine } from '../../../packages/core/src/text/grams.ts';
const here = new URL('./', import.meta.url);
const read = (n: string) => JSON.parse(readFileSync(new URL(n, here), 'utf8'));
const write = (n: string, v: unknown) => writeFileSync(new URL(n, here), `${JSON.stringify(v, null, 2)}\n`);
const report: any = { cosine_threshold: 0.95, embedding: 'native character 3-5 gram TF-IDF, corpus fitted', rows: {} };
const audit: any[] = [];
for (const name of ['promptfoo-rubric', 'langfuse-reference']) {
  const items = read(`${name}-raw.json`);
  const fields = name === 'promptfoo-rubric' ? ['question', 'rubric', 'reply'] : ['query', 'reference', 'output'];
  const prior = read(`../${name}-cases.json`);
  const payload = (r: any) => fields.map(f => r[f]).join('\n');
  const all = [...items, ...prior];
  const vectors = gramTfidf(all.map(payload));
  const kept: number[] = [];
  const drops: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const candidate = items[i];
    // Only these explicit text fields enter a judge. None contains the metadata
    // keys or a serialized truth/control object. References are necessary facts.
    assert(fields.every(f => typeof candidate[f] === 'string'));
    assert(!/"(?:truth|label|construction|expected_verdict)"\s*:/.test(payload(candidate)));
    let best = -1, similarity = 0;
    for (const j of [...kept, ...prior.map((_: unknown, j: number) => items.length + j)]) {
      const s = gramCosine(vectors[i], vectors[j]);
      if (s > similarity) { similarity = s; best = j; }
    }
    if (similarity >= 0.95) drops.push({ id: candidate.id, reason: 'cosine-near-duplicate', similarity, against: all[best].id });
    else kept.push(i);
  }
  const truth = (r: any) => 'truth' in r ? r.truth : r.label === 'pass';
  const byLabel = [kept.filter(i => truth(items[i])), kept.filter(i => !truth(items[i]))];
  const balancedCount = Math.min(...byLabel.map(a => a.length));
  const selected = new Set(byLabel.flatMap(indices => indices.slice(0, balancedCount)));
  for (const i of kept) if (!selected.has(i)) drops.push({ id: items[i].id, reason: 'balance-after-dedup' });
  const final = items.filter((_: unknown, i: number) => selected.has(i));
  assert.equal(final.filter(truth).length * 2, final.length);
  const families = [...new Set(final.map((r: any) => r.kind ?? r.family))].sort();
  assert.equal(families.length, 12);
  for (const family of families) {
    const sample = final.filter((r: any) => (r.kind ?? r.family) === family).slice(0, 3);
    assert.equal(sample.length, 3);
    for (const item of sample) audit.push({ id: item.id, row: name, family,
      ...Object.fromEntries(fields.map(f => [f, item[f]])) });
  }
  report.rows[name] = { input: items.length, leak_drops: 0, near_duplicate_drops: drops.filter(d => d.reason === 'cosine-near-duplicate').length,
    balance_drops: drops.filter(d => d.reason === 'balance-after-dedup').length, kept: final.length,
    constant_pass_accuracy: 0.5, pass: balancedCount, fail: balancedCount,
    family_counts: Object.fromEntries(families.map(f => [f, final.filter((r: any) => (r.kind ?? r.family) === f).length])), drops };
  write(`${name}-cases.json`, final);
}
assert.equal(audit.length, 72);
write('blind-packet.json', audit);
write('gate-report.json', report);
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.rows).map(([k,v]: any) => [k,{ input:v.input, kept:v.kept, near_duplicate_drops:v.near_duplicate_drops, balance_drops:v.balance_drops }]))));

// Offline post-freeze scoring. Never calls a model or changes labels.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scorePairs } from '../src/score.ts';
const out = 'examples/judge-benchmarks/jb-results';
const read = async name => JSON.parse(await readFile(`${out}/${name}.json`, 'utf8'));
const [run, decisions, audit, sample, freeze] = await Promise.all(
  ['final-test', 'final-test-decisions', 'test-label-audit', 'final-test-sample', 'freeze'].map(read),
);
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
if (await digest(`${out}/test-label-audit.json`) !== '770d7ec6c639cb6a2dcf2c91f66f2821eae72d1f6038f42de6036108ebbb9342')
  throw Error('Pre-score test audit lock changed');
if (await digest('examples/judge-benchmarks/src/score.ts') !== freeze.hashes['src/score.ts'])
  throw Error('Frozen metric changed');
const excluded = new Set(audit.excluded.map(x => x.id));
const reviewed = new Set(audit.reviewed);
if (excluded.size !== 54 || reviewed.size !== 229 || sample.n !== 229 || sample.population !== 229)
  throw Error('Audit coverage mismatch');
const rows = run.contestants.map(c => {
  const results = decisions[c.contestant];
  const ids = new Set(results.map(r => r.item.id));
  if (results.length !== 229 || ids.size !== 229 || sample.ids.some(id => !ids.has(id) || !reviewed.has(id)))
    throw Error('Incomplete fixed population');
  const official = scorePairs('judgebench', results);
  if (Math.abs(official.value.estimate - c.summary.value.estimate) > 1e-12)
    throw Error('Official scorer disagrees with frozen run');
  return { id: c.contestant, official,
    audited: scorePairs('judgebench', results.filter(r => !excluded.has(r.item.id))),
    cost100: c.costUsd / 229 * 100 };
});
const result = { stamp: new Date().toISOString(), sample, audit, rows,
  interval: '95 percent Wilson interval over all 229 pair outcomes. This is the full fixed test split, with no sampling uncertainty from a smaller subset.',
  coverageCaveat: 'All 229 pairs attempted, 228 have complete judgements. Both missing order answers on the remaining pair count as incorrect on the official and audited metrics. The strict audit driver rejects missing judgements; this offline diagnostic preserves them and applies the unchanged scorePairs function.' };
await writeFile(`${out}/final-test-audited.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(rows));

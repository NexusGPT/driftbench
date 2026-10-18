/** Offline addendum scoring uses frozen products and leaves official artifacts untouched. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { CRITERIA } from '../judge-benchmarks/src/data';
import { runBenchmark } from '../judge-benchmarks/src/run';

const base = resolve('examples/ledger-verify'),
  dest = resolve(base, 'luna-addendum');
const old = JSON.parse(await readFile(resolve(base, 'noise-0/gpt-6-luna.json'), 'utf8'));
const items = JSON.parse(await readFile(resolve(base, 'evidence/dev.json'), 'utf8'))
  .sort((a: any, b: any) => a.id.localeCompare(b.id))
  .slice(0, 30);
const report = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'gpt-6-luna',
  contestants: ['driftbench-verify-uncertainty-cascade', 'promptfoo'].map(contestantById),
  items,
  criterion: CRITERIA['longjudge-verify'],
  split: 'all',
  concurrency: 1,
  includeDecisions: true,
  replayOnly: true,
  recordingsDir: resolve(dest, 'recordings'),
  command: '/no-paid-command',
});
assert.equal(report.newCalls, 0);
assert.equal(report.newSpendUsd, 0);
assert.equal(report.stopped, undefined);
let kept = 0,
  filled = 0;
for (let i = 0; i < 2; i++)
  for (let j = 0; j < 30; j++) {
    const a = old.contestants[i].decisions[j],
      b = report.contestants[i].decisions?.[j];
    if (a.missing > 0 || typeof a.pass !== 'boolean') {
      assert.equal(b.missing, 0);
      filled++;
    } else {
      assert.deepEqual(b, a);
      kept++;
    }
  }
assert.equal(kept, 56);
assert.equal(filled, 4);
await writeFile(
  resolve(dest, 'noise-0.with-recovered-items.json'),
  `${JSON.stringify({ ...report, label: 'with recovered items', officialUnchanged: true, answeredDecisionsPreserved: kept, recoveredMissingFinals: filled }, null, 2)}\n`,
);
console.log(JSON.stringify({ kept, filled, newCalls: report.newCalls }));

/** Reproduce the historical 102-item cascade without making a provider call. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { CRITERIA, type PointItem } from '../judge-benchmarks/src/data';
import { runBenchmark } from '../judge-benchmarks/src/run';

const source = process.argv[2];
assert(source, 'Pass the read-only codex-verify worktree');
const original = JSON.parse(await readFile(resolve(source,
  'examples/judge-benchmarks/results/verify-dev/test-expanded-complete-result.json'), 'utf8'));
const baseline = original.contestants[0];
const decisions = new Map<string, { pass?: boolean; missing: number }>(baseline.decisions.map((d: any) => [d.id,d]));
const pool: PointItem[] = JSON.parse(await readFile('examples/ledger-verify/evidence/pool.json','utf8'));
const items = pool.filter(item => decisions.has(item.id));
assert.equal(items.length, 102);
const report = await runBenchmark({
  bench:'longjudge-verify', model:'haiku', contestants:[contestantById('driftbench-verify-uncertainty-cascade')],
  items, criterion:CRITERIA['longjudge-verify'], replayOnly:true, concurrency:6, includeDecisions:true,
  recordingsDir:resolve(source,'examples/judge-benchmarks/recordings'), command:'/no-paid-command',
});
assert.equal(report.newCalls,0);
assert.equal(report.stopped,undefined);
assert.equal(report.failedCalls,0);
for (const decision of report.contestants[0]!.decisions!) {
  assert.equal(decision.pass,decisions.get(decision.id)?.pass,decision.id);
  assert.equal(decision.missing,0,decision.id);
}
assert.equal(report.contestants[0]!.costUsd.toFixed(8), baseline.costUsd.toFixed(8));
const result = { at:new Date().toISOString(), items:102, identicalVerdicts:102,
  newCalls:report.newCalls, replayed:report.replayed, originalFees:baseline.costUsd,
  replayFees:report.contestants[0]!.costUsd, sourceHead:'f13242f29ad0ced947907a84ffbb19abaa32f190',
  scope:'Historical replay only, not a new measured cell', status:'PASS' };
await writeFile('examples/ledger-verify/evidence/frozen-replay.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));

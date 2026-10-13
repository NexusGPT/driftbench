/** Frozen pointwise runner. The prerequisite gate runs before any provider command. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { CRITERIA, type PointItem } from '../judge-benchmarks/src/data';
import { runBenchmark } from '../judge-benchmarks/src/run';

const base = 'examples/ledger-verify';
const model = process.argv[2];
assert(model === 'haiku' || model === 'gpt-6-luna', 'Only the two authorized models may run; Gemini pending');
const replayOnly = process.argv.includes('--replay-only');
const pilot = process.argv.includes('--pilot');
const seal = JSON.parse(await readFile(`${base}/evidence/seal.json`, 'utf8'));
for (const [path, hash] of Object.entries(seal.sourceHashes)) {
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash, path);
}
for (const [path, hash] of Object.entries(seal.evidenceHashes)) {
  assert.equal(createHash('sha256').update(await readFile(`${base}/evidence/${path}`)).digest('hex'), hash, path);
}
const runtime = JSON.parse(await readFile(`${base}/evidence/runtime-freeze.json`, 'utf8'));
for (const [path, hash] of Object.entries(runtime.hashes)) {
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash, path);
}
assert.match(runtime.corePr, /^https:\/\/github\.com\/achammah\/driftbench\/pull\/\d+$/);
assert.match(runtime.coreSha, /^[0-9a-f]{40}$/);
execFileSync('git', ['merge-base', '--is-ancestor', runtime.coreSha, 'HEAD']);
if (!replayOnly) {
  const dossierPath = process.env.VERIFY_CORE_DOSSIER;
  assert(dossierPath, 'VERIFY_CORE_DOSSIER must point to the core delivery evidence');
  const dossier = await readFile(dossierPath, 'utf8');
  assert(dossier.includes(runtime.corePr), 'Core dossier does not name the frozen PR');
  const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/research/pair-ledger-core'], { encoding: 'utf8' });
  assert(remote.startsWith(runtime.coreSha), 'Frozen core is not the pushed branch head');
  assert(Date.now() < runtime.deadlineAt, 'Last-call cutoff reached');
}
const pool: PointItem[] = JSON.parse(await readFile(`${base}/evidence/${pilot ? 'dev' : 'pool'}.json`, 'utf8'));
const items = pilot ? [...pool].sort((a,b) => a.id.localeCompare(b.id)).slice(0,20) : pool;
const resultDir = `${base}/${pilot ? 'pilots' : 'results'}`;
await mkdir(resultDir, { recursive: true });
if (!replayOnly) {
  await writeFile(`${resultDir}/${model}.started.json`, JSON.stringify({ at:new Date().toISOString(),
    items:items.length, coreSha:runtime.coreSha, runtime:runtime.id }, null,2)+'\n', { flag:'wx' });
}
const report = await runBenchmark({
  bench:'longjudge-verify', model,
  contestants:['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById),
  items, criterion:CRITERIA['longjudge-verify'], split:'all', concurrency:6,
  capUsd:25, deadlineAt:runtime.deadlineAt, includeDecisions:true, replayOnly,
  recordingsDir:resolve(`${base}/recordings/${runtime.id}/${pilot ? 'pilot' : 'test'}`),
  command:resolve(runtime.command),
});
await writeFile(`${resultDir}/${model}${replayOnly ? '.replay' : ''}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({model,pilot,items:report.items,calls:report.newCalls,spend:report.newSpendUsd,
  stopped:report.stopped,judges:report.contestants.map(c=>({id:c.contestant,missing:c.summary.missing}))}));

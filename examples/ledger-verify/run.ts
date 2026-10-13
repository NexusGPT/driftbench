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
const model = process.argv[2] ?? '';
assert(['haiku','gpt-6-luna','gemini-3.8-flash'].includes(model), 'Only authorized models may run');
const replayOnly = process.argv.includes('--replay-only');
const pilot = process.argv.includes('--pilot');
const validity = process.argv.includes('--validity');
const noiseIndex = process.argv.indexOf('--noise');
const noise = noiseIndex>=0 ? Number(process.argv[noiseIndex+1]) : undefined;
assert(noise===undefined || [0,1,2].includes(noise), 'Noise repeat is 0, 1 or 2');
const phase=pilot?'pilot':validity?'validity':noise===undefined?'test':`noise-${noise}`;
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
  const remoteSha=remote.trim().split(/\s+/)[0]!;
  assert.match(remoteSha,/^[0-9a-f]{40}$/);
  execFileSync('git', ['merge-base','--is-ancestor',runtime.coreSha,remoteSha]);
  assert(Date.now() < runtime.deadlineAt, 'Last-call cutoff reached');
}
const pool: PointItem[] = JSON.parse(await readFile(`${base}/evidence/${validity?'validity-items':pilot||noise!==undefined ? 'dev' : 'pool'}.json`, 'utf8'));
const items = pilot||noise!==undefined ? [...pool].sort((a,b) => a.id.localeCompare(b.id)).slice(0,pilot?20:30) : pool;
const resultDir = `${base}/${phase==='test'?'results':phase}`;
await mkdir(resultDir, { recursive: true });
if (!replayOnly) {
  await writeFile(`${resultDir}/${model}.started.json`, JSON.stringify({ at:new Date().toISOString(),
    items:items.length, coreSha:runtime.coreSha, runtime:runtime.id }, null,2)+'\n', { flag:'wx' });
}
const report = await runBenchmark({
  bench:'longjudge-verify', model,
  contestants:['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById),
  items, criterion:CRITERIA['longjudge-verify'], split:'all', concurrency:2,
  capUsd:25, deadlineAt:runtime.deadlineAt, includeDecisions:true, replayOnly,
  recordingsDir:resolve(`${base}/recordings/${runtime.id}/${phase}`),
  command:resolve(runtime.command),
});
await writeFile(`${resultDir}/${model}${replayOnly ? '.replay' : ''}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({model,phase,items:report.items,calls:report.newCalls,spend:report.newSpendUsd,
  stopped:report.stopped,judges:report.contestants.map(c=>({id:c.contestant,missing:c.summary.missing}))}));

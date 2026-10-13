// Re-read the frozen modules for the resumed control; DEV only, serial calls.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runReferenceCascade, cascadeConfig } from '../src/cascade-run.ts';
import { runBenchmark } from '../src/run.ts';
import { contestantById } from '../src/contestants.ts';
import { scorePairs } from '../src/score.ts';
const out = 'examples/judge-benchmarks/jb-results';
const ledger = process.env.JB_SPEND_LEDGER;
if (!ledger) throw Error('JB_SPEND_LEDGER required');
const read = async name => JSON.parse(await readFile(`${out}/${name}.json`, 'utf8'));
const frozen = await read('freeze');
const initial = new Set(await read('starting-keys'));
const excluded = new Set((await read('label-audit')).excluded.map(x => x.id));
const spent = async () => (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
  .trim().split('\n').map(JSON.parse).filter(r => !initial.has(r.key)).reduce((s,r) => s+r.costUsd,0);
const stamp = () => new Date().toLocaleTimeString('en-GB', {timeZone:'Europe/Brussels',hour:'2-digit',minute:'2-digit'});
const rows = [];
for (const id of ['driftbench-reference3-tools','driftbench-reference3-tools-format',
                  'driftbench-reference3-tools-cascade','driftbench-reference3-tools-format-cascade',
                  'driftbench-reference3-tools-cascade-50','driftbench-reference3-tools-format-cascade-50']) {
  for (const [file, hash] of Object.entries(frozen.hashes)) {
    if (createHash('sha256').update(await readFile(`examples/judge-benchmarks/${file}`)).digest('hex') !== hash)
      throw Error(`Frozen source changed: ${file}`);
  }
  const cap = Math.max(0, 6.00 - await spent());
  if (cap <= 0.04) break;
  const decisions = [];
  const signals = `${out}/${id}-sample-50-frozen-signals.jsonl`;
  await writeFile(signals, '');
  await appendFile(ledger, `| ${stamp()} | codex-jb frozen-module ${id} 50-pair DEV refresh before | haiku | pending | ${cap.toFixed(4)} cap | pending | reuse recordings; only uncached diagnostic repairs may call; concurrency 1 |\n`);
  const options = {bench:'judgebench',split:'dev',sample:50,seed:'codex-jb-control-v1',model:'haiku',
    concurrency:1,capUsd:cap,maxCallUsd:0.04,deadlineMs:Date.parse('2026-10-13T06:20:00+02:00'),
    onPairResult:r => decisions.push(r),onEvidence:async s => appendFile(signals, `${JSON.stringify(s)}\n`)};
  const cascade = cascadeConfig(id);
  const report = cascade ? await runReferenceCascade({...options,...cascade})
    : await runBenchmark({...options,contestants:[contestantById(id)]});
  const audited = scorePairs('judgebench',decisions.filter(r => !excluded.has(r.item.id)));
  const baseline = (await read('control-sample-baselines'))[0];
  if (decisions.length === 50 && baseline.ids.some(item => !decisions.some(r => r.item.id === item)))
    throw Error('Different control population');
  let previous;
  try { previous = await read(`${id}-sample-50`); } catch { previous = null; }
  rows.push({id,report,audited,previousSummary:previous?.contestants?.[0]?.summary,
    previousCost100:previous?.contestants?.[0]?.costUsd*2,
    frozenSourceHashesVerified:true,postFreezeDiagnostic:true});
  await writeFile(`${out}/${id}-sample-50-frozen.json`, JSON.stringify(report,null,2));
  await writeFile(`${out}/${id}-sample-50-frozen-decisions.json`, JSON.stringify(decisions,null,2));
  await writeFile(`${out}/control-frozen-runtime.json`, JSON.stringify(rows,null,2));
  await appendFile(ledger, `| ${stamp()} | codex-jb frozen-module ${id} 50-pair DEV refresh after: ${(report.contestants[0].summary.value.estimate*100).toFixed(1)} percent; missing ${report.contestants[0].summary.missing} | haiku | ${report.newCalls} | ${cap.toFixed(4)} cap | ${report.newSpendUsd.toFixed(8)} | successful recorded total ${(await spent()).toFixed(8)}; frozen source hashes verified |\n`);
  console.log(JSON.stringify(rows.at(-1)));
  if (report.stopped) break;
}

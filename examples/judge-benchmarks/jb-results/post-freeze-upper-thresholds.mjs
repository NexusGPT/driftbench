// DEV diagnostics only; imports the frozen judge without modifying it.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runReferenceCascade, cascadeConfig } from '../src/cascade-run.ts';
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
for (const threshold of [0.85, 0.90]) {
  for (const format of [false, true]) {
    for (const [file, hash] of Object.entries(frozen.hashes)) {
      const actual = createHash('sha256').update(await readFile(`examples/judge-benchmarks/${file}`)).digest('hex');
      if (actual !== hash) throw Error(`Frozen source changed: ${file}`);
    }
    const id = `driftbench-reference3-tools${format ? '-format' : ''}-cascade-${Math.round(threshold*100)}`;
    const cap = Math.max(0, 6.00 - await spent());
    if (cap <= 0.04) break;
    const decisions = [];
    const signals = `${out}/${id}-post-freeze-signals.jsonl`;
    await writeFile(signals, '');
    await appendFile(ledger, `| ${stamp()} | codex-jb post-freeze ${id} DEV before | haiku | pending | ${cap.toFixed(4)} cap | pending | frozen-source diagnostic, concurrency 1, successful-price ceiling 6.00 plus 2.00 reserve |\n`);
    const report = await runReferenceCascade({
      bench:'judgebench', split:'dev',model:'haiku',concurrency:1,
      capUsd:cap,maxCallUsd:0.04,deadlineMs:Date.parse('2026-10-13T06:20:00+02:00'),
      ...cascadeConfig(id),
      onPairResult:r => decisions.push(r),
      onEvidence:async s => appendFile(signals, `${JSON.stringify(s)}\n`),
    });
    const audited = scorePairs('judgebench', decisions.filter(r => !excluded.has(r.item.id)));
    rows.push({id,threshold,report,audited,postFreezeDiagnostic:true});
    await writeFile(`${out}/${id}-post-freeze.json`, JSON.stringify(report,null,2));
    await writeFile(`${out}/${id}-post-freeze-decisions.json`, JSON.stringify(decisions,null,2));
    await writeFile(`${out}/post-freeze-upper-thresholds.json`, JSON.stringify(rows,null,2));
    await appendFile(ledger, `| ${stamp()} | codex-jb post-freeze ${id} DEV after: ${(report.contestants[0].summary.value.estimate*100).toFixed(1)} percent; missing ${report.contestants[0].summary.missing} | haiku | ${report.newCalls} | ${cap.toFixed(4)} cap | ${report.newSpendUsd.toFixed(8)} | successful recorded total ${(await spent()).toFixed(8)}; frozen design unchanged |\n`);
    console.log(JSON.stringify(rows.at(-1)));
    if (report.stopped) process.exit(0);
  }
}
await import('./refresh-control.mjs');

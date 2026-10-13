import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunReport } from './run';

const folder = 'examples/judge-benchmarks/results/verify-dev';
const audit = JSON.parse(await readFile(join(folder, 'label-audit.json'), 'utf8')) as {
  id: string;
  audited: boolean;
  official: boolean;
  proof: string;
}[];
const corrections = new Map(audit.map((item) => [item.id, item.audited]));
const rows = [];
for (const file of (await readdir(folder)).filter((file) => file.endsWith('.json'))) {
  const report = JSON.parse(await readFile(join(folder, file), 'utf8')) as RunReport;
  if (report.bench !== 'longjudge-verify' || report.stopped || report.items !== 95) continue;
  for (const c of report.contestants) {
    if (!c.decisions) continue;
    const decisions = c.decisions;
    const rate = (label: boolean) => {
      const xs = decisions.filter((d) => (corrections.get(d.id) ?? d.correct) === label);
      return xs.filter((d) => d.pass === label).length / xs.length;
    };
    const right = decisions.filter((d) => d.pass === (corrections.get(d.id) ?? d.correct)).length;
    const long = decisions.filter((d) => d.responseChars > 10000);
    rows.push({
      contestant: c.contestant,
      officialAccuracy: 100 * c.summary.value.estimate,
      officialBalancedAccuracy: 100 * (c.summary.balancedAccuracy ?? 0),
      auditedAccuracy: (100 * right) / decisions.length,
      auditedBalancedAccuracy: 50 * (rate(true) + rate(false)),
      auditedCorrect: right,
      auditedConflictErrors: decisions.filter(
        (d) => corrections.has(d.id) && d.pass !== corrections.get(d.id),
      ).length,
      items: decisions.length,
      costPer100Usd: (c.costUsd * 100) / decisions.length,
      calls: c.calls,
      auditedLongAccuracy:
        (100 * long.filter((d) => d.pass === (corrections.get(d.id) ?? d.correct)).length) / long.length,
      newSpendUsd: report.newSpendUsd,
      missing: c.summary.missing,
      invalidVerdicts: decisions.filter((d) => d.pass === undefined).length,
      file,
    });
  }
}
rows.sort(
  (a, b) =>
    b.auditedAccuracy - a.auditedAccuracy ||
    a.auditedConflictErrors - b.auditedConflictErrors ||
    a.costPer100Usd - b.costPer100Usd ||
    b.officialAccuracy - a.officialAccuracy,
);
await writeFile(join(folder, 'summary.json'), JSON.stringify(rows, null, 2) + '\n');
console.log(
  '| Contestant | Official accuracy | Official balanced | Audited accuracy | Audited balanced | USD / 100 |',
);
console.log('|---|---:|---:|---:|---:|---:|');
for (const r of rows)
  console.log(
    `| ${r.contestant} | ${r.officialAccuracy.toFixed(1)} | ${r.officialBalancedAccuracy.toFixed(1)} | ${r.auditedAccuracy.toFixed(1)} | ${r.auditedBalancedAccuracy.toFixed(1)} | ${r.costPer100Usd.toFixed(4)} |`,
  );

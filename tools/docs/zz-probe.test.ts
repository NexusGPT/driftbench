import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { runGuidePage } from './zz-guide-keep';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
it('probe: which spec names the sentence', async () => {
  const log = console.log;
  let base = '';
  console.log = (...a: unknown[]) => {
    const s = String(a[0]);
    if (s.startsWith('BASE ')) base = s.slice(5);
  };
  await runGuidePage(ROOT, 'docs/guide/walkthrough.md');
  console.log = log;
  const sh = (c: string) => execSync(c, { cwd: base, encoding: 'utf8', maxBuffer: 1 << 26 });
  const dir = sh('find . -type d -name live -path "*generated/specs*" | head -1').trim();
  log('PROBE dir', dir);
  log('PROBE named', sh(`grep -rl -- "- instruction.weekly-report.count-only-what-the-ledger-and$" ${dir} | LC_ALL=C sort`));
  const gate = sh(`grep -rl "read-templates-report-md-before-writing" ${dir} | LC_ALL=C sort | head -30`);
  log('PROBE gate files', gate);
  for (const f of gate.split('\n').filter((l) => l.includes('ordered_pair')).slice(0, 2)) log('PROBE SPEC ' + f + '\n' + sh(`cat ${f}`).slice(0, 2500));
  log('PROBE plan rows with sentence', sh('grep -rn "count-only-what-the-ledger-and" build/generated/plan.yaml build/plan.yaml 2>&1 | head -20 || true'));
}, 600_000);

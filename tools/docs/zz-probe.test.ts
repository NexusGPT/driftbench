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
  const problems = await runGuidePage(ROOT, 'docs/guide/walkthrough.md');
  console.log = log;
  log('PROBE problems', problems.length);
  const sh = (c: string) => execSync(c, { cwd: base, encoding: 'utf8', maxBuffer: 1 << 26 });
  const f = sh('find . -name "estate.ordered_pair.gate.weekly-report.read-templates-report-md-before-writing.yaml"').trim();
  log('PROBE SPEC17 ' + f + '\n' + sh(`cat ${f}`));
  log('PROBE rowsline', sh('grep -n -B2 -A8 "count-only-what-the-ledger-and" walk/plan.yaml walk/northwind/plan.yaml build/plan.yaml 2>&1 | head -60'));
}, 600_000);

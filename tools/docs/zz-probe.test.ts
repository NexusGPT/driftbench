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
  log('PROBE tree', sh('find . -maxdepth 5 -type d | grep -v node_modules | head -40'));
  const named = sh('grep -rl -- "- instruction.weekly-report.count-only-what-the-ledger-and$" . --include=*.yaml | grep -v "plan\\|phrases\\|map\\|variables\\|space" | LC_ALL=C sort');
  log('PROBE named', named);
  const gate = sh('grep -rl "read-templates-report-md-before-writing" . --include=*.yaml | grep ordered_pair | head -3');
  log('PROBE gate files', gate);
  for (const f of gate.split('\n').filter(Boolean).slice(0, 1)) log('PROBE SPEC ' + f + '\n' + sh(`cat ${f}`).slice(0, 3000));
}, 600_000);

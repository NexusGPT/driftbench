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
  for (const [i, p] of problems.entries()) {
    const lines = p.split('\n').filter((l) => !l.startsWith('note: ') && !/^[✗✓?] estate\.|^ {4}(failing|judged)/.test(l.trim()) && !/^\s+(failing|judged)/.test(l));
    log('PROBLEM ' + i + '\n' + lines.join('\n').slice(0, 3500));
  }
}, 600_000);

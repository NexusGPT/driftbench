import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { judgesBank, runBank } from '../../../src/ladders/judges/v2';
import { hiddenSeed } from '../../../src/seeds';

/** Read-only comparison against an exact executor checkout. Outputs stay in this worktree. */
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const bankHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const target = process.argv[2];
const expected = 'ca723f977540b4d58ca6e941141a0622e538c774';
if (!target) throw new Error('pass the read-only exec/judges-v2 worktree path');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim();
if (head !== expected) throw new Error(`executor is ${head}, expected ${expected}`);
const api = await import(pathToFileURL(join(target, 'packages/judges/src/index.ts')).href);
const hidden = hiddenSeed(target);
const seeds = process.argv.includes('--seed1')
  ? [{ seed: 1, hidden: false }]
  : [
      ...Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, hidden: false })),
      { seed: hidden.seed, hidden: true },
    ];
const rows = [];
for (const spec of seeds) {
  const result = await runBank([spec], ROOT, { api, bank: judgesBank() });
  const row = {
    seed: spec.hidden ? 'hidden' : spec.seed,
    numericSeed: spec.seed,
    passing: result.passing,
    size: result.size,
    level: result.levels[0],
    failures: result.results
      .filter((item) => !item.passes[0])
      .map((item) => ({ id: item.id, reason: item.detail })),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const report = {
  executorHead: head,
  bankHead,
  measuredAt: new Date().toISOString(),
  hidden,
  rows,
};
writeFileSync(
  new URL(process.argv.includes('--seed1') ? './score-seed1.json' : './score-ca723f97.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);

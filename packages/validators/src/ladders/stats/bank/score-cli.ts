/**
 * Scores the statistics bank on seeds and the hidden seed, prints the measurement, and with --record appends the
 * row to validators/stats/bank-scores.jsonl. Usage, from the repository root:
 *   pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden [--record <iteration>] [--out <file.json>] [--note "..."]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { findRoot } from '../../../root';
import { hiddenSeed } from '../../../seeds';
import { appendBankScore, forecast, readBankScores, scoreBank } from './hardness';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = findRoot(process.cwd());
  const range = value('--seeds') ?? '1..1';
  const [a, b] = range.split('..').map(Number) as [number, number];
  const seeds = Array.from({ length: (b ?? a) - a + 1 }, (_, i) => ({ seed: a + i, label: String(a + i) }));
  if (argv.includes('--hidden')) seeds.push({ seed: hiddenSeed(root).seed, label: 'hidden' });
  const scored = await scoreBank(root, seeds, value('--note') ?? '');
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const record = value('--record');
  const row = {
    iteration: record === undefined ? -1 : Number(record),
    at: new Date().toISOString(),
    commit,
    ...scored,
  };
  process.stdout.write(
    `Bank ${row.bank} items, passing on every seed ${row.passing}, score ${row.score.toFixed(4)}\n`,
  );
  process.stdout.write(
    `Level per seed: ${Object.entries(row.levelPerSeed)
      .map(([k, v]) => `${k} = ${v}`)
      .join(', ')}\n`,
  );
  for (const [family, c] of Object.entries(row.byFamily))
    process.stdout.write(`  ${family}: ${c.passing} of ${c.items}\n`);
  for (const [tier, c] of Object.entries(row.byTier))
    process.stdout.write(`  tier ${tier}: ${c.passing} of ${c.items}\n`);
  const outFile = value('--out');
  if (outFile) writeFileSync(outFile, `${JSON.stringify(row)}\n`);
  if (record !== undefined) {
    appendBankScore(root, row);
    const f = forecast(readBankScores(root));
    if (f) process.stdout.write(`${JSON.stringify(f)}\n`);
  }
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
  process.exit(1);
});

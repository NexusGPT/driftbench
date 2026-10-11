import { execFileSync } from 'node:child_process';
import { findRoot } from '../../../root';
import { hiddenSeed } from '../../../seeds';
import { appendBankRow, bankRow, formatHardness, readBankRows, runBank } from './hardness';
import { mapBank } from './index';

/**
 * The hardness measurement of the map bank from the command line, until `driftbench validate map --hardness`
 * calls it (a root change):
 *
 *   pnpm tsx packages/validators/src/ladders/map/bank/cli.ts                       prints the measurement
 *   pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run                 runs seeds 1 to 20 and hidden
 *   pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run --record <n> --note "<text>"
 *                                                                                  and appends iteration n
 *   pnpm tsx packages/validators/src/ladders/map/bank/cli.ts --run --seeds 1..3    other seeds
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const root = findRoot(process.cwd());
  const items = mapBank();
  if (!args.includes('--run')) {
    process.stdout.write(`${formatHardness(items, readBankRows(root))}\n`);
    return 0;
  }
  const range = /^(\d+)\.\.(\d+)$/.exec(value('--seeds') ?? '1..20');
  if (!range) {
    process.stderr.write('--seeds takes a..b\n');
    return 64;
  }
  const seeds: Array<{ seed: number; label: string }> = [];
  for (let seed = Number(range[1]); seed <= Number(range[2]); seed++)
    seeds.push({ seed, label: String(seed) });
  const hidden = hiddenSeed(root);
  if (!args.includes('--no-hidden')) seeds.push({ seed: hidden.seed, label: 'hidden' });
  const results = await runBank(items, seeds, {}, (done, total) => {
    if (done % 50 === 0 || done === total) process.stderr.write(`  ${done} of ${total} items\n`);
  });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const record = value('--record');
  const row = bankRow(
    record === undefined ? -1 : Number(record),
    commit,
    seeds.map((seed) => seed.label),
    results,
    value('--note') ?? '',
  );
  if (record !== undefined) appendBankRow(root, row);
  const rows =
    record === undefined
      ? [...readBankRows(root), { ...row, iteration: readBankRows(root).length }]
      : readBankRows(root);
  process.stdout.write(`${formatHardness(items, rows)}\n`);
  process.stdout.write(
    `Failing items: ${row.failing.length}. First 20: ${row.failing.slice(0, 20).join(', ')}\n`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exitCode = 1;
  },
);

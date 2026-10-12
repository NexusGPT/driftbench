import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bankSummary, gitHead, hiddenSeed, readJournal, runSeeds, seedLabel } from '../../../src/index';
import { causeOf, judgesLadderV2 } from '../../../src/ladders/judges/v2/index';

/**
 * Measures the judges bank (ladder version 2) for one row of the hardness journal (docs/validators.md
 * sections 10.2 and 12.4): every level on seeds 1 to 20 and the hidden seed of HEAD, with the bank summary the
 * frame computes (`bankSummary`, as `validate --items --json` prints it). Writes the journal row to --out and
 * the item listing to _captures/v-judges2/bank-iteration-<n>.txt; `validate judges --journal <out>` then
 * checks and appends the row. Iteration 0 is the baseline.
 *
 *   pnpm exec tsx packages/validators/test/judges/v2/measure.ts --iteration 0 --hypothesis "baseline" \
 *     --files none --commit <sha> --tests none --out row.json
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const iteration = Number(arg('iteration'));
  if (!Number.isInteger(iteration) || iteration < 0)
    throw new RangeError('--iteration is a whole number from 0');
  const hidden = hiddenSeed(ROOT, gitHead);
  const seeds = [
    ...Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, hidden: false })),
    { seed: hidden.seed, hidden: true },
  ];
  const started = Date.now();
  const report = await runSeeds(judgesLadderV2({ billed: false }), seeds, ROOT, { full: true });
  const bank = bankSummary(report);
  const labels = report.seeds.map(seedLabel);
  const previous = readJournal(ROOT, 'judges').rows.at(-1);
  if ((previous?.iteration ?? -1) !== iteration - 1) {
    throw new Error(`the journal's last row is not iteration ${iteration - 1}`);
  }
  const share = (levelId: string) => {
    const own = bank.rows.filter((r) => r.levelId === levelId);
    return Number((own.filter((r) => r.passEverySeed).length / Math.max(1, own.length)).toFixed(4));
  };
  const failingNow = bank.rows.filter((r) => !r.passEverySeed).map((r) => r.id);
  mkdirSync(join(ROOT, '_captures', 'v-judges2'), { recursive: true });
  const capture = (n: number) => join(ROOT, '_captures', 'v-judges2', `bank-iteration-${n}.txt`);
  const failingBefore =
    iteration === 0 || !existsSync(capture(iteration - 1))
      ? failingNow
      : readFileSync(capture(iteration - 1), 'utf8')
          .split('\n')
          .filter((line) => line.startsWith('FAIL '))
          .map((line) => line.split(' ')[1] as string);
  const levelAfter = report.level;
  const levelBefore = iteration === 0 ? levelAfter : (previous?.level.after ?? levelAfter);
  const row = {
    iteration,
    at: new Date().toISOString(),
    model: 'opus',
    seeds: labels,
    command: 'pnpm driftbench validate judges --seeds 1..20 --hidden --items (ladder version 2)',
    level: { before: levelBefore, after: levelAfter },
    perSeed: report.seeds.map((run, i) => {
      const seed = labels[i] as string;
      const before = previous?.perSeed.find((p) => p.seed === seed)?.after ?? run.level;
      return { seed, before: iteration === 0 ? run.level : before, after: run.level };
    }),
    metrics: (report.seeds[0]?.rows ?? []).map((row, i) => ({
      level: i + 1,
      id: row.id,
      metric: row.metric,
      threshold: row.threshold,
      before:
        iteration === 0 ? share(row.id) : (previous?.metrics.find((p) => p.id === row.id)?.after ?? null),
      after: share(row.id),
    })),
    bankSize: bank.size,
    passing: bank.passing,
    failingByFamily: bank.failingByFamily,
    failingCauses: bank.failingCauses,
    failingWithoutCause: bank.failingWithoutCause,
    bankByFamilyTier: bank.byFamilyTier,
    failingBefore: failingBefore.slice(0, 40),
    hypothesis: arg('hypothesis'),
    research: null,
    change: { files: arg('files') === 'none' ? [] : arg('files').split(','), commit: arg('commit') },
    testsAdded: arg('tests') === 'none' ? [] : arg('tests').split(';'),
    result:
      iteration === 0
        ? 'baseline'
        : levelAfter > levelBefore
          ? 'raised'
          : levelAfter < levelBefore
            ? 'lowered'
            : 'unchanged',
    durationMinutes: Number(arg('minutes', '15')),
    tokenEstimate: Number(arg('tokens', '40000')),
  };
  writeFileSync(arg('out'), `${JSON.stringify(row)}\n`, 'utf8');
  const lines = [
    `iteration ${iteration}: ${bank.passing} of ${bank.size} pass on every seed (score ${bank.score}), level ${levelAfter}, hidden seed ${hidden.seed}, ${Math.round((Date.now() - started) / 1000)} s`,
    `distinct causes among failing items: ${new Set(failingNow.map(causeOf)).size}`,
    ...bank.rows.map(
      (r) =>
        `${r.passEverySeed ? 'PASS' : 'FAIL'} ${r.id} tier ${r.tier ?? 'none'} ${r.family}${r.passEverySeed ? '' : ` | ${causeOf(r.id)}`}`,
    ),
  ];
  writeFileSync(capture(iteration), `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`${lines[0]}\nfirst failing: ${failingNow.slice(0, 5).join(', ')}\n`);
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
  process.exitCode = 1;
});

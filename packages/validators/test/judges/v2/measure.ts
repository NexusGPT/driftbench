import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bankShape, judgesBank, LEVELS, runBank } from '../../../src/ladders/judges/v2/index';
import { gitHead, hiddenSeed } from '../../../src/seeds';

/**
 * Measures the judges bank (ladder version 2) for the hardness record of docs/validators.md section 12.4: every
 * deterministic item on seeds 1 to 20 and the hidden seed of HEAD, against the judges package as it is. Writes
 * one row to validators/judges/hardness.jsonl and the per-item results to the capture folder.
 *
 *   pnpm exec tsx packages/validators/test/judges/v2/measure.ts --iteration 0 --note "iteration 0"
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const HARDNESS = 'validators/judges/hardness.jsonl';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const iteration = Number(arg('iteration') ?? Number.NaN);
  if (!Number.isInteger(iteration) || iteration < 0)
    throw new RangeError('--iteration <n> is a whole number from 0');
  const hidden = hiddenSeed(ROOT, gitHead);
  const seeds = [
    ...Array.from({ length: 20 }, (_, i) => ({ seed: i + 1, hidden: false })),
    { seed: hidden.seed, hidden: true },
  ];
  const started = Date.now();
  const run = await runBank(seeds, ROOT);
  const failing = run.results.filter((r) => !r.passes.every(Boolean));
  const perFamily: Record<string, { passing: number; items: number }> = {};
  for (const r of run.results) {
    const row = perFamily[r.family] ?? { passing: 0, items: 0 };
    row.items += 1;
    if (r.passes.every(Boolean)) row.passing += 1;
    perFamily[r.family] = row;
  }
  const row = {
    iteration,
    at: new Date().toISOString(),
    head: hidden.head ?? null,
    hiddenSeed: hidden.seed,
    seeds: seeds.map((s) => (s.hidden ? 'hidden' : String(s.seed))),
    score: Number(run.score.toFixed(4)),
    passing: run.passing,
    size: run.size,
    levelPerSeed: run.levels,
    level: Math.min(...run.levels),
    top: LEVELS.filter((l) => l.id !== 'live').length,
    perFamily,
    note: arg('note') ?? '',
    seconds: Math.round((Date.now() - started) / 1000),
  };
  appendFileSync(join(ROOT, HARDNESS), `${JSON.stringify(row)}\n`, 'utf8');
  mkdirSync(join(ROOT, '_captures', 'v-judges2'), { recursive: true });
  const capture = join(ROOT, '_captures', 'v-judges2', `bank-iteration-${iteration}.txt`);
  const lines = [
    `iteration ${iteration}, score ${row.score} (${row.passing} of ${row.size}), level ${row.level}, hidden seed ${hidden.seed}`,
    JSON.stringify(bankShape(judgesBank())),
    ...run.results.map(
      (r) =>
        `${r.passes.every(Boolean) ? 'PASS' : 'FAIL'} ${r.id} tier ${r.tier}${r.detail ? `: ${r.detail.slice(0, 300)}` : ''}`,
    ),
  ];
  writeFileSync(capture, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify({ ...row, perFamily: undefined })}\nfailing ${failing.length}; first: ${failing
      .slice(0, 5)
      .map((r) => r.id)
      .join(', ')}\n`,
  );
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
  process.exitCode = 1;
});

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../../../src/ladders/judges/v2/index';

/**
 * Builds the journal row of one pilot iteration (docs/validators.md section 10.2) from two rows of
 * validators/judges/hardness.jsonl: the measurement before the fix and the one after. Each level of ladder
 * version 2 is one family, so a level's metric is its items passing on every seed over its items.
 *
 *   pnpm exec tsx packages/validators/test/judges/v2/journal-row.ts --iteration 1 --hypothesis "..." \
 *     --files a,b --commit abc1234 --tests "t1;t2" --minutes 20 --tokens 60000 --out row.json
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

type Measured = {
  iteration: number;
  seeds: string[];
  levelPerSeed: number[];
  perFamily: Record<string, { passing: number; items: number }>;
};

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

const rows = readFileSync(join(ROOT, 'validators/judges/hardness.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Measured);
const iteration = Number(arg('iteration'));
const before = rows.filter((r) => r.iteration === iteration - 1).at(-1);
const after = rows.filter((r) => r.iteration === iteration).at(-1);
if (!before || !after)
  throw new Error(`hardness.jsonl needs rows for iterations ${iteration - 1} and ${iteration}`);
const levels = LEVELS.filter((level) => level.id !== 'live');
const ratio = (m: Measured, id: string) => {
  const f = m.perFamily[id];
  return f ? Number((f.passing / f.items).toFixed(4)) : null;
};
const failingBefore = readFileSync(
  join(ROOT, '_captures/v-judges2', `bank-iteration-${iteration - 1}.txt`),
  'utf8',
)
  .split('\n')
  .filter((line) => line.startsWith('FAIL '))
  .map((line) => line.split(' ')[1] as string)
  .slice(0, 40);
const levelBefore = Math.min(...before.levelPerSeed);
const levelAfter = Math.min(...after.levelPerSeed);
const row = {
  iteration,
  at: new Date().toISOString(),
  model: 'opus',
  seeds: after.seeds,
  command:
    'pnpm exec tsx packages/validators/test/judges/v2/measure.ts (every item on seeds 1..20 and hidden)',
  level: { before: levelBefore, after: levelAfter },
  perSeed: after.seeds.map((seed, i) => ({
    seed,
    before: before.levelPerSeed[i] ?? 0,
    after: after.levelPerSeed[i] ?? 0,
  })),
  metrics: levels.map((level, i) => ({
    level: i + 1,
    id: level.id,
    metric: `items of ${level.id} passing on every seed / items`,
    threshold: 1,
    before: ratio(before, level.id),
    after: ratio(after, level.id),
  })),
  failingBefore,
  hypothesis: arg('hypothesis'),
  research: null,
  change: { files: arg('files').split(','), commit: arg('commit') },
  testsAdded: arg('tests').split(';'),
  result: levelAfter > levelBefore ? 'raised' : levelAfter < levelBefore ? 'lowered' : 'unchanged',
  durationMinutes: Number(arg('minutes')),
  tokenEstimate: Number(arg('tokens')),
};
writeFileSync(arg('out'), `${JSON.stringify(row)}\n`, 'utf8');
process.stdout.write(`row ${iteration}: level ${levelBefore} to ${levelAfter}\n`);

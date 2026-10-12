/**
 * The bank measurement of the hardness contract (docs/validators.md section 12.4), as a script:
 *
 *   node --import tsx packages/validators/src/ladders/generator/bank-run.ts <out.json> [--seeds 1..20] [--hidden] [--jobs 6]
 *
 * Evaluates every item of the generator bank on every seed, each seed in its own child process (the seeds
 * are independent), the scale items once, and writes one JSON summary: per item, whether it passes on every
 * seed, the seeds it failed on and the first failing detail; the bank score; the bank shape per family and
 * tier. With `--seed-child <n> <out>` it is the child that evaluates one seed.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRoot } from '../../root';
import { hiddenSeed } from '../../seeds';
import { BANK_LEVELS, bankItems, bankShape, causeOf, SeedData } from './bank';
import { evaluate } from './index';
import { type ScaleReport, scaleReport } from './scale';

type SeedResult = {
  seed: number;
  results: Array<{ id: string; pass: boolean; detail: string; cause: string }>;
};

/** Items computed once in the parent: the scale runs and the items that read no seed. */
const inParent = (item: { family: string; global?: boolean }) =>
  item.family === 'scale' || item.global === true;

async function child(seed: number, out: string): Promise<void> {
  const items = bankItems().filter((item) => !inParent(item));
  const data = new SeedData(seed, {}, async () => ({ error: 'scale runs in the parent' }) as ScaleReport);
  const results = await evaluate(items, data);
  const payload: SeedResult = {
    seed,
    results: results.map(({ item, verdict }) => ({
      id: item.id,
      pass: verdict.pass,
      detail: verdict.detail,
      cause: causeOf(item, verdict),
    })),
  };
  writeFileSync(out, JSON.stringify(payload));
}

function runChild(seed: number, out: string): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', script, '--seed-child', String(seed), out], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`the child of seed ${seed} exited ${code}`)),
    );
  });
}

async function parent(args: string[]): Promise<void> {
  const out = args[0];
  if (!out) throw new Error('usage: bank-run.ts <out.json> [--seeds a..b] [--hidden] [--jobs n]');
  const range = args.includes('--seeds') ? (args[args.indexOf('--seeds') + 1] ?? '1..20') : '1..20';
  const [low, high] = range.split('..').map(Number) as [number, number];
  const seeds = Array.from({ length: (high ?? low) - low + 1 }, (_, index) => low + index);
  const labels = seeds.map(String);
  if (args.includes('--hidden')) {
    const hidden = hiddenSeed(findRoot(process.cwd()));
    seeds.push(hidden.seed);
    labels.push('hidden');
  }
  const jobs = args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : 6;
  const files = seeds.map((seed) => `${out}.seed-${seed}.json`);
  let next = 0;
  const workers = Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
    while (next < seeds.length) {
      const at = next++;
      await runChild(seeds[at] as number, files[at] as string);
    }
  });
  const scales: ScaleReport[] = [];
  const scaling = (async () => {
    for (const factor of [10, 100]) scales.push(await scaleReport(factor, seeds[0] ?? 1));
  })();
  await Promise.all([...workers, scaling]);
  const perSeed = files.map((file) => JSON.parse(readFileSync(file, 'utf8')) as SeedResult);
  const items = bankItems();
  const scaleData = new SeedData(
    seeds[0] ?? 1,
    {},
    async (factor) => scales.find((report) => report.factor === factor) as ScaleReport,
  );
  const scaleResults = await evaluate(items.filter(inParent), scaleData);
  const summary = items.map((item) => {
    if (inParent(item)) {
      const found = scaleResults.find((result) => result.item.id === item.id);
      return {
        id: item.id,
        family: item.family,
        tier: item.tier,
        level: item.level,
        component: item.component,
        pass: found?.verdict.pass ?? false,
        failedOn: found?.verdict.pass ? [] : [String(seeds[0])],
        detail: found?.verdict.detail ?? '',
        causes: found && !found.verdict.pass ? [causeOf(item, found.verdict)] : [],
      };
    }
    const failed = perSeed.flatMap((entry, index) => {
      const result = entry.results.find((candidate) => candidate.id === item.id);
      return result && !result.pass
        ? [{ seed: labels[index] as string, detail: result.detail, cause: result.cause }]
        : [];
    });
    return {
      id: item.id,
      family: item.family,
      tier: item.tier,
      level: item.level,
      component: item.component,
      pass: failed.length === 0,
      failedOn: failed.map((entry) => entry.seed),
      detail: failed[0]?.detail ?? 'passes on every seed',
      causes: [...new Set(failed.map((entry) => entry.cause))],
    };
  });
  const passing = summary.filter((entry) => entry.pass).length;
  // The ladder level per seed: the leading levels whose every item passes on that seed.
  const scaleFailing = new Set(
    summary
      .filter((entry) => items.some((item) => item.id === entry.id && inParent(item)) && !entry.pass)
      .map((entry) => entry.id),
  );
  const failsOn = (id: string, index: number) =>
    scaleFailing.has(id) || perSeed[index]?.results.find((result) => result.id === id)?.pass === false;
  const levels = BANK_LEVELS.filter((level) => items.some((item) => item.level === level.id)).map((level) => {
    const own = items.filter((item) => item.level === level.id);
    return {
      id: level.id,
      name: level.name,
      items: own.length,
      passing: summary.filter((entry) => entry.level === level.id && entry.pass).length,
      perSeed: labels.map((_, index) => own.every((item) => !failsOn(item.id, index))),
    };
  });
  const perSeedLevels = labels.map((label, index) => {
    let level = 0;
    for (const entry of levels) {
      if (!entry.perSeed[index]) break;
      level += 1;
    }
    return { seed: label, level };
  });
  // Items sharing a cause count once (docs/validators.md section 12.4).
  const causes = [...new Set(summary.flatMap((entry) => (entry.pass ? [] : entry.causes)))];
  writeFileSync(
    out,
    `${JSON.stringify({ seeds: labels, size: summary.length, passing, score: passing / summary.length, failingCauses: causes.length, shape: bankShape(items), levels, perSeedLevels, items: summary }, null, 2)}\n`,
  );
  process.stdout.write(
    `bank ${summary.length} items, ${passing} pass on every seed (score ${(passing / summary.length).toFixed(3)}), ${causes.length} distinct causes among the failing items, over ${labels.join(', ')}\n`,
  );
}

const args = process.argv.slice(2);
if (args[0] === '--seed-child') await child(Number(args[1]), args[2] as string);
else await parent(args);

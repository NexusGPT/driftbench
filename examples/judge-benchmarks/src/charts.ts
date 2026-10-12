import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartRows, renderChart } from './chart';
import { CONTESTANTS, contestantById } from './contestants';
import type { BenchmarkId } from './data';
import { runBenchmark } from './run';

/**
 * Writes one SVG chart per benchmark and model from the recordings alone, test split only. It never calls a
 * model: a missing recording stops it with the item named.
 *
 *   npx tsx examples/judge-benchmarks/src/charts.ts --model haiku [--ours driftbench-stepwise]
 *     [--bench judgebench,longjudge-verify] [--sample 60]
 *
 * `--ours` names the driftbench configuration chosen on the dev split; it is drawn as "driftbench".
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHARTS = join(HERE, '..', '..', '..', 'docs', 'comparison', 'benchmarks');

export const TITLES: Readonly<Record<BenchmarkId, string>> = {
  judgebench: 'JudgeBench (GPT-4o pairs)',
  mmeval: 'MM-Eval (five core subsets)',
  'longjudge-wp': 'LongJudgeBench wp_bench',
  'longjudge-verify': 'LongJudgeBench verify_bench_hard',
  rubricbench: 'RubricBench (human rubrics)',
};

const NAMES: Readonly<Record<string, string>> = {
  driftbench: 'driftbench',
  deepeval: 'DeepEval',
  promptfoo: 'promptfoo',
  inspect: 'Inspect',
  scenario: 'LangWatch Scenario',
  langfuse: 'Langfuse',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const model = arg('model') ?? 'haiku';
  const ours = arg('ours') ?? 'driftbench';
  const sample = arg('sample') ? Number(arg('sample')) : undefined;
  const benches = (arg('bench')?.split(',') ?? Object.keys(TITLES)) as BenchmarkId[];
  const ids = [ours, ...CONTESTANTS.map((c) => c.id).filter((id) => id !== 'driftbench')];
  await mkdir(CHARTS, { recursive: true });
  for (const bench of benches) {
    const report = await runBenchmark({
      bench,
      model,
      contestants: ids.map(contestantById),
      split: 'test',
      replayOnly: 'lenient',
      concurrency: 16,
      ...(sample ? { sample } : {}),
    });
    if (report.stopped) throw new Error(`${bench} on ${model}: ${report.stopped}`);
    const missing = Math.max(...report.contestants.map((c) => c.summary.missing));
    const labels = { ...NAMES, [ours]: 'driftbench' };
    const metric = report.contestants[0]?.summary.metric ?? '';
    const svg = renderChart(
      `${TITLES[bench]}, ${model}`,
      `Test split, ${report.items} items${sample ? ' (stratified sample)' : ''}. Score: ${metric}. Bars: score; whiskers: 95% interval.${missing > 0 ? ` Up to ${missing} answer(s) per contestant missing, counted wrong.` : ''}`,
      chartRows(report, labels),
    );
    const file = join(CHARTS, `${bench}-${model}.svg`);
    await writeFile(file, svg, 'utf8');
    process.stdout.write(`${file}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 2;
  });
}

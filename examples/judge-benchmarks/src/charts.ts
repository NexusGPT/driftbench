import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartRows, renderChart, renderTable } from './chart';
import { CONTESTANTS, contestantById } from './contestants';
import type { BenchmarkId } from './data';
import { runBenchmark } from './run';

/**
 * Writes one SVG chart per benchmark and model from the recordings alone, test split only. It never calls a
 * model: a missing recording stops it with the item named.
 *
 *   npx tsx examples/judge-benchmarks/src/charts.ts --model haiku [--ours driftbench-stepwise]
 *     [--bench judgebench,longjudge-verify] [--sample 60] [--doc]
 *
 * `--doc` also writes the ranked tables into docs/judge-benchmarks.md between its results markers.
 * `--ours` names the driftbench configuration chosen on the dev split; it is drawn as "driftbench".
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHARTS = join(HERE, '..', '..', '..', 'docs', 'comparison', 'benchmarks');
export const DOC = join(HERE, '..', '..', '..', 'docs', 'judge-benchmarks.md');

/** Replaces the text between the two markers named `results-<model>` in the docs page. */
export function spliceResults(doc: string, model: string, text: string): string {
  const start = `<!-- results-${model}:start -->`;
  const end = `<!-- results-${model}:end -->`;
  const a = doc.indexOf(start);
  const b = doc.indexOf(end);
  if (a < 0 || b < a) throw new Error(`the docs page has no ${start} and ${end} markers`);
  return `${doc.slice(0, a + start.length)}\n${text}\n${doc.slice(b)}`;
}

export const TITLES: Readonly<Record<BenchmarkId, string>> = {
  judgebench: 'JudgeBench (GPT-4o pairs)',
  mmeval: 'MM-Eval (five core subsets)',
  'longjudge-wp': 'LongJudgeBench wp_bench',
  'longjudge-verify': 'LongJudgeBench verify_bench_hard',
  rubricbench: 'RubricBench (human rubrics)',
};

/** The sample a benchmark runs on when it is too large to run whole: MM-Eval, a stratified 1,500 of its 4,981. */
const SAMPLES: Readonly<Partial<Record<BenchmarkId, number>>> = { mmeval: 1500 };

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
  const benches = (arg('bench')?.split(',') ?? Object.keys(TITLES)) as BenchmarkId[];
  const ids = [ours, ...CONTESTANTS.map((c) => c.id).filter((id) => id !== 'driftbench')];
  await mkdir(CHARTS, { recursive: true });
  const tables: string[] = [];
  for (const bench of benches) {
    const sample = arg('sample') ? Number(arg('sample')) : SAMPLES[bench];
    const report = await runBenchmark({
      bench,
      model,
      contestants: ids.map(contestantById),
      split: 'test',
      replayOnly: 'lenient',
      concurrency: 16,
      // The same sample the runs recorded: drawn from all items, then its test part.
      sampleBeforeSplit: true,
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
    tables.push(
      `### ${TITLES[bench]}, ${model}\n\n![${TITLES[bench]}, ${model}](comparison/benchmarks/${bench}-${model}.svg)\n\n` +
        `Test split, ${report.items} items. Score: ${metric}.\n\n${renderTable(report, labels)}`,
    );
  }
  if (process.argv.includes('--doc')) {
    await writeFile(DOC, spliceResults(await readFile(DOC, 'utf8'), model, tables.join('\n\n')), 'utf8');
    process.stdout.write(`${DOC}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 2;
  });
}

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Caller, CallFailed, createCaller, Recordings, SpendCapReached } from './call';
import {
  CONTESTANTS,
  type Contestant,
  contestantById,
  type PairDecision,
  type PointDecision,
} from './contestants';
import {
  type BenchmarkId,
  type Item,
  loadBenchmark,
  type PairItem,
  type PointItem,
  splitOf,
  stratifiedSample,
} from './data';
import {
  type PairResult,
  type PointResult,
  pairGames,
  pointGame,
  type Summary,
  scorePairs,
  scorePoints,
} from './score';

/**
 * Runs contestants on a public judge benchmark through the claude command, with recordings, and prints the
 * paper's metric per contestant.
 *
 *   npx tsx examples/judge-benchmarks/src/run.ts --bench judgebench --model haiku [--sample 100]
 *     [--contestants driftbench,deepeval] [--cap-usd 1] [--concurrency 6] [--replay-only] [--out report.json]
 *
 * Recordings live in examples/judge-benchmarks/recordings/<bench>/<model>.jsonl. A rerun of the same
 * prompts reads them and costs nothing; --replay-only refuses to call the model at all.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const RECORDINGS = join(HERE, '..', 'recordings');

export type RunOptions = {
  readonly bench: BenchmarkId;
  readonly model: string;
  readonly contestants: readonly Contestant[];
  readonly sample?: number;
  readonly seed?: string;
  /** dev, test or all (default all). Our judge is tuned on dev; charts show test. */
  readonly split?: 'dev' | 'test' | 'all';
  readonly capUsd?: number;
  readonly concurrency?: number;
  /** Never call the model: true stops at a missing recording; lenient counts its answer as missing. */
  readonly replayOnly?: boolean | 'lenient';
  readonly recordingsDir?: string;
  readonly command?: string;
  /** Items to use instead of loading the benchmark, for tests. */
  readonly items?: readonly (PairItem | PointItem)[];
  readonly criterion?: string;
};

export type ContestantReport = {
  readonly contestant: string;
  readonly source: string;
  readonly mode: 'pairwise, both orders' | 'pointwise, single game' | 'pointwise';
  readonly summary: Summary;
  /** What the calls cost as the command reported it, recorded or new. */
  readonly costUsd: number;
  readonly calls: number;
};

export type RunReport = {
  readonly bench: BenchmarkId;
  readonly model: string;
  readonly items: number;
  readonly sample?: number;
  readonly contestants: readonly ContestantReport[];
  readonly newSpendUsd: number;
  readonly newCalls: number;
  readonly replayed: number;
  /** Calls that failed after their retries; their answers are missing. */
  readonly failedCalls: number;
  readonly stopped?: string;
};

async function pool<T>(tasks: readonly (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (next < tasks.length && failure === undefined) {
      const index = next;
      next += 1;
      try {
        out[index] = await (tasks[index] as () => Promise<T>)();
      } catch (cause) {
        failure = cause;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  if (failure !== undefined) throw failure;
  return out;
}

type Ask = (
  contestant: Contestant,
  prompt: Parameters<Caller['call']>[0],
  item: string,
  order: string,
) => Promise<{ text: string; costUsd: number } | undefined>;

export async function runBenchmark(options: RunOptions): Promise<RunReport> {
  const bench = options.items
    ? { id: options.bench, criterion: options.criterion ?? 'The response is correct.', items: options.items }
    : await loadBenchmark(options.bench);
  const inSplit = bench.items.filter(
    (item) => (options.split ?? 'all') === 'all' || splitOf(options.bench, item.id) === options.split,
  );
  const items = options.sample ? stratifiedSample(inSplit, options.sample, options.seed) : [...inSplit];
  const recordings = await new Recordings(
    join(options.recordingsDir ?? RECORDINGS, options.bench, `${options.model}.jsonl`),
  ).load();
  const caller = createCaller(
    recordings,
    { model: options.model, ...(options.command ? { command: options.command } : {}) },
    {
      ...(options.capUsd === undefined ? {} : { capUsd: options.capUsd }),
      ...(options.replayOnly ? { replayOnly: options.replayOnly } : {}),
    },
  );
  let stopped: string | undefined;
  let failedCalls = 0;
  const costs = new Map<string, { usd: number; calls: number }>();
  const ask: Ask = async (contestant, prompt, item, order) => {
    if (stopped) return undefined;
    try {
      const r = await caller.call(prompt, { bench: options.bench, contestant: contestant.id, item, order });
      const c = costs.get(contestant.id) ?? { usd: 0, calls: 0 };
      c.usd += r.costUsd;
      c.calls += 1;
      costs.set(contestant.id, c);
      return r;
    } catch (cause) {
      if (cause instanceof CallFailed) {
        failedCalls += 1;
        return undefined;
      }
      stopped =
        cause instanceof SpendCapReached
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause);
      return undefined;
    }
  };

  const reports: ContestantReport[] = [];
  for (const contestant of options.contestants) {
    const pairwiseBench = items.every((item) => item.kind === 'pair');
    const usePair = pairwiseBench && contestant.pair !== undefined;
    // A setup call (DeepEval's evaluation steps) is made once per criterion and reused.
    const setups = new Map<string, Promise<string | undefined>>();
    const setupFor = (criterion: string): Promise<string | undefined> => {
      const prompt = usePair ? contestant.setup?.pair?.(criterion) : contestant.setup?.point?.(criterion);
      if (!prompt) return Promise.resolve(undefined);
      let pending = setups.get(criterion);
      if (!pending) {
        pending = ask(contestant, prompt, 'setup', usePair ? 'pair' : 'point').then((r) => r?.text);
        setups.set(criterion, pending);
      }
      return pending;
    };
    // The criterion of an item: its own (such as human rubrics), or one the contestant writes itself.
    const referenceFor = async (item: Item): Promise<string | undefined> =>
      contestant.reference
        ? (await ask(contestant, contestant.reference(item.question), item.id, 'reference'))?.text
        : undefined;
    const criterionFor = async (item: Item): Promise<string> => {
      if (contestant.rubric) {
        const r = await ask(contestant, contestant.rubric(item.question), item.id, 'rubric');
        return `${bench.criterion}\n${r?.text ?? ''}`;
      }
      return item.criterion ?? bench.criterion;
    };
    const point = async (
      item: Item,
      response: string,
      order: string,
    ): Promise<{ d: PointDecision; missing: number }> => {
      const criterion = await criterionFor(item);
      const setup = await setupFor(criterion);
      const reference = await referenceFor(item);
      const prompt = contestant.point?.({
        question: item.question,
        response,
        criterion,
        ...(setup === undefined ? {} : { setup }),
        ...(reference === undefined ? {} : { reference }),
      });
      const id = item.id;
      if (!prompt || !contestant.parsePoint) return { d: {}, missing: 1 };
      const r = await ask(contestant, prompt, id, order);
      return r ? { d: contestant.parsePoint(r.text), missing: 0 } : { d: {}, missing: 1 };
    };
    let summary: Summary;
    let mode: ContestantReport['mode'];
    if (pairwiseBench) {
      const pairs = items as PairItem[];
      const tasks = pairs.map((item) => async (): Promise<PairResult> => {
        if (usePair && contestant.pair && contestant.parsePair) {
          const parse = contestant.parsePair;
          const criterion = await criterionFor(item);
          const setup = await setupFor(criterion);
          const reference = await referenceFor(item);
          const one = async (a: string, b: string, order: string): Promise<PairDecision | undefined> => {
            const prompt = contestant.pair?.({
              question: item.question,
              a,
              b,
              criterion,
              ...(setup === undefined ? {} : { setup }),
              ...(reference === undefined ? {} : { reference }),
            });
            const r = prompt ? await ask(contestant, prompt, item.id, order) : undefined;
            return r ? parse(r.text) : undefined;
          };
          const [ordered, swapped] = await Promise.all([
            one(item.a, item.b, 'AB'),
            one(item.b, item.a, 'BA'),
          ]);
          const missing = (ordered === undefined ? 1 : 0) + (swapped === undefined ? 1 : 0);
          return { item, games: pairGames(ordered ?? 'tie', swapped ?? 'tie'), missing };
        }
        const [a, b] = await Promise.all([point(item, item.a, 'A'), point(item, item.b, 'B')]);
        return { item, games: [pointGame(a.d, b.d)], missing: a.missing + b.missing };
      });
      const results = await pool(tasks, options.concurrency ?? 4);
      summary = scorePairs(options.bench, results);
      mode = usePair ? 'pairwise, both orders' : 'pointwise, single game';
    } else {
      const points = items as PointItem[];
      const tasks = points.map((item) => async (): Promise<PointResult> => {
        const r = await point(item, item.response, 'single');
        return { item, decision: r.d, missing: r.missing };
      });
      summary = scorePoints(await pool(tasks, options.concurrency ?? 4));
      mode = 'pointwise';
    }
    const c = costs.get(contestant.id) ?? { usd: 0, calls: 0 };
    reports.push({
      contestant: contestant.id,
      source: contestant.source,
      mode,
      summary,
      costUsd: c.usd,
      calls: c.calls,
    });
  }
  return {
    bench: options.bench,
    model: options.model,
    items: items.length,
    ...(options.sample ? { sample: options.sample } : {}),
    contestants: reports,
    newSpendUsd: caller.spent(),
    newCalls: caller.calls(),
    replayed: caller.replayed(),
    failedCalls,
    ...(stopped ? { stopped } : {}),
  };
}

const pct = (x: number) => (100 * x).toFixed(1);

export function renderReport(report: RunReport): string {
  const lines = [
    `${report.bench} on ${report.model}: ${report.items} items${report.sample ? ` (stratified sample of ${report.sample})` : ''}`,
    '',
    '| Contestant | Mode | Metric (95% interval) | Position consistency | Cost (USD) | Missing answers |',
    '|---|---|---|---|---|---|',
  ];
  for (const c of report.contestants) {
    const s = c.summary;
    const extra = s.balancedAccuracy === undefined ? '' : `, balanced ${pct(s.balancedAccuracy)}`;
    lines.push(
      `| ${c.contestant} | ${c.mode} | ${pct(s.value.estimate)} [${pct(s.value.lower)}, ${pct(s.value.upper)}]${extra} | ${s.positionConsistency === undefined ? 'n/a' : pct(s.positionConsistency)} | ${c.costUsd.toFixed(4)} | ${s.missing} |`,
    );
  }
  lines.push(
    '',
    `New calls ${report.newCalls}, new spend ${report.newSpendUsd.toFixed(4)} USD, replayed ${report.replayed}.`,
  );
  if (report.stopped) lines.push(`Stopped early: ${report.stopped}`);
  return lines.join('\n');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const bench = arg('bench') as BenchmarkId | undefined;
  if (!bench) throw new Error('--bench judgebench|mmeval|longjudge-wp|longjudge-verify is required');
  const ids = arg('contestants')?.split(',') ?? CONTESTANTS.map((c) => c.id);
  const sample = arg('sample');
  const cap = arg('cap-usd');
  const report = await runBenchmark({
    bench,
    model: arg('model') ?? 'haiku',
    contestants: ids.map(contestantById),
    ...(sample ? { sample: Number(sample) } : {}),
    ...(arg('seed') ? { seed: arg('seed') as string } : {}),
    ...(arg('split') ? { split: arg('split') as 'dev' | 'test' | 'all' } : {}),
    ...(cap ? { capUsd: Number(cap) } : {}),
    concurrency: Number(arg('concurrency') ?? 4),
    replayOnly: process.argv.includes('--replay-only'),
  });
  process.stdout.write(`${renderReport(report)}\n`);
  const out = arg('out');
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.stopped) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exitCode = 2;
  });
}

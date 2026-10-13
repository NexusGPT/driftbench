import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CallFailed, createCaller, Recordings } from './call';
import type { PairDecision } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { pairGames, scorePairs } from './score';
import { annotatorDecide, annotatorPair, annotatorRate, meanScore, parseDecision, parseRating, type Rating } from './wp-annotator';
import { anchorPair, parseAnchor } from './wp-anchor';

/**
 * DEV-only study of annotator-protocol emulation. Pre-registered primary rule: each reply is rated alone
 * by K annotator samples; the higher mean fine score wins both games; an exact tie falls back to the
 * frozen holistic pairwise ballots (one per order, replayed from recordings). TEST is refused here.
 */
const arg = (s: string) => {
  const i = process.argv.indexOf(`--${s}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
if (arg('split') !== 'dev') throw new Error('This study runs on --split dev only');
const cap = Number(arg('cap-usd'));
const out = arg('out');
const k = Number(arg('k') ?? 3);
const concurrency = Number(arg('concurrency') ?? 1);
if (!(cap > 0 && cap <= 3) || !out) throw new Error('Require --cap-usd in (0,3] and --out');
if (!(concurrency >= 1 && concurrency <= 2)) throw new Error('--concurrency 1 or 2');
const limit = Number(arg('limit') ?? 0);
const prepair = process.argv.includes('--prepair');
const protocolPair = process.argv.includes('--protocol-pair');
const samples = Number(arg('samples') ?? 1);
const interleave = process.argv.includes('--interleave');
const tag = interleave ? 'driftbench-wp-protocol-portia' : 'driftbench-wp-protocol-pair';

const bench = await loadBenchmark('longjudge-wp');
let items = bench.items.filter((i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === 'dev');
if (limit > 0) items = items.slice(0, limit);
const recordings = await new Recordings(
  fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
).load();
const caller = createCaller(
  recordings,
  { model: 'haiku', maxCallUsd: 0.1 },
  { capUsd: Math.max(0, cap - 0.1 * concurrency), replayOnly: process.argv.includes('--replay-only') },
);

type Row = {
  id: string;
  group: string;
  label: string;
  ratings: { A: (Rating | undefined)[]; B: (Rating | undefined)[] };
  meanA?: number;
  meanB?: number;
  annotatorCostUsd: number;
  holisticCostUsd: number;
  holistic: PairDecision[];
  primary: PairDecision[];
  pureAnnotator: PairDecision[];
  firstAnnotator: PairDecision[];
  prepair?: PairDecision[];
  pooled?: PairDecision[];
  prepairCostUsd: number;
  error?: string;
};
const rows: Row[] = new Array(items.length);
let stopped: string | undefined;

async function judge(item: PairItem): Promise<Row> {
  let annotatorCostUsd = 0;
  let holisticCostUsd = 0;
  const call = async (p: Parameters<typeof caller.call>[0], order: string, contestant: string) => {
    const r = await caller.call(p, { bench: bench.id, contestant, item: item.id, order });
    return r;
  };
  const ratings = { A: [] as (Rating | undefined)[], B: [] as (Rating | undefined)[] };
  const raw = { A: [] as string[], B: [] as string[] };
  for (let n = 1; n <= k; n += 1) {
    for (const side of ['A', 'B'] as const) {
      const reply = side === 'A' ? item.a : item.b;
      try {
        const r = await call(annotatorRate(item.question, reply, n), `rate-${side}-${n}`, 'driftbench-wp-annotator');
        annotatorCostUsd += r.costUsd;
        raw[side].push(r.text);
        ratings[side].push(parseRating(r.text));
      } catch (e) {
        if (!(e instanceof CallFailed)) throw e;
        ratings[side].push(undefined);
      }
    }
  }
  // Holistic frozen ballots: replayed from recordings, never re-asked here.
  const ab = await call(anchorPair(item.question, item.a, item.b), 'AB', 'driftbench-wp-anchor');
  const ba = await call(anchorPair(item.question, item.b, item.a), 'BA', 'driftbench-wp-anchor');
  holisticCostUsd = ab.costUsd + ba.costUsd;
  const holistic = pairGames(
    parseAnchor(ab.text, item.a, item.b)?.winner ?? 'tie',
    parseAnchor(ba.text, item.b, item.a)?.winner ?? 'tie',
  );
  const meanA = meanScore(ratings.A);
  const meanB = meanScore(ratings.B);
  const pick = (x?: number, y?: number): PairDecision =>
    x === undefined || y === undefined || x === y ? 'tie' : x > y ? 'A' : 'B';
  const pure = pick(meanA, meanB);
  const first = pick(ratings.A[0]?.score, ratings.B[0]?.score);
  let prepairGames: PairDecision[] | undefined;
  let prepairCostUsd = 0;
  let pooledGames: PairDecision[] | undefined;
  if (protocolPair) {
    const votes: PairDecision[][] = [[], []];
    for (let n = 1; n <= samples; n += 1) {
      const ab = await call(annotatorPair(item.question, item.a, item.b, n, interleave), n === 1 ? 'decide-AB' : `decide-AB#${n}`, tag);
      const ba = await call(annotatorPair(item.question, item.b, item.a, n, interleave), n === 1 ? 'decide-BA' : `decide-BA#${n}`, tag);
      prepairCostUsd += ab.costUsd + ba.costUsd;
      const g = pairGames(parseDecision(ab.text) ?? 'tie', parseDecision(ba.text) ?? 'tie');
      votes[0]!.push(g[0]!);
      votes[1]!.push(g[1]!);
    }
    const major = (vs: PairDecision[]): PairDecision => {
      const a = vs.filter((v) => v === 'A').length;
      const b = vs.filter((v) => v === 'B').length;
      return a === b ? 'tie' : a > b ? 'A' : 'B';
    };
    prepairGames = [major(votes[0]!), major(votes[1]!)];
    const pooled = major([...votes[0]!, ...votes[1]!]);
    pooledGames = [pooled, pooled];
  } else if (prepair) {
    const ab = await call(annotatorDecide(item.question, item.a, item.b, raw.A, raw.B), 'decide-AB', 'driftbench-wp-annotator-prepair');
    const ba = await call(annotatorDecide(item.question, item.b, item.a, raw.B, raw.A), 'decide-BA', 'driftbench-wp-annotator-prepair');
    prepairCostUsd = ab.costUsd + ba.costUsd;
    prepairGames = pairGames(parseDecision(ab.text) ?? 'tie', parseDecision(ba.text) ?? 'tie');
  }
  return {
    id: item.id,
    group: item.group ?? '',
    label: item.label,
    ratings,
    ...(meanA === undefined ? {} : { meanA }),
    ...(meanB === undefined ? {} : { meanB }),
    annotatorCostUsd,
    holisticCostUsd,
    holistic,
    primary: pure === 'tie' ? holistic : [pure, pure],
    pureAnnotator: [pure, pure],
    firstAnnotator: [first, first],
    ...(prepairGames ? { prepair: prepairGames } : {}),
    ...(pooledGames ? { pooled: pooledGames } : {}),
    prepairCostUsd,
  };
}

let next = 0;
async function worker() {
  while (!stopped) {
    const i = next++;
    if (i >= items.length) return;
    try {
      rows[i] = await judge(items[i]!);
    } catch (e) {
      stopped = e instanceof Error ? e.message : String(e);
      return;
    }
    const done = rows.filter(Boolean).length;
    if (done % 10 === 0) process.stderr.write(`annotator: ${done}/${items.length}, new spend $${caller.spent().toFixed(4)}\n`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const done = items.map((item, i) => ({ item, row: rows[i] })).filter((x) => x.row);
const score = (pick: (r: Row) => PairDecision[]) =>
  scorePairs(
    bench.id,
    done.map(({ item, row }) => ({ item, games: pick(row!), missing: pick(row!).filter((g) => g === 'tie').length })),
  );
const perOrder = (pick: (r: Row) => PairDecision[]) =>
  [0, 1].map((j) => {
    const c = done.filter(({ item, row }) => pick(row!)[j] === item.label).length;
    return { correct: c, n: done.length, accuracy: c / done.length };
  });
const correctGames = (pick: (r: Row) => PairDecision[]) =>
  done.reduce((s, { item, row }) => s + pick(row!).filter((g) => g === item.label).length, 0);
const ties = done.filter(({ row }) => row!.pureAnnotator[0] === 'tie').length;
// Recipe cost: every annotator call, plus the two holistic calls only where the fallback fires.
const recipeCost = done.reduce(
  (s, { row }) => s + row!.annotatorCostUsd + (row!.pureAnnotator[0] === 'tie' ? row!.holisticCostUsd : 0),
  0,
);
const report = {
  design: 'annotator-protocol emulation, pointwise, K independent samples per reply, holistic fallback on exact ties',
  split: 'dev',
  k,
  items: items.length,
  completed: done.length,
  complete: !stopped && done.length === items.length,
  primary: { summary: score((r) => r.primary), perOrder: perOrder((r) => r.primary), games: correctGames((r) => r.primary) },
  pureAnnotator: { summary: score((r) => r.pureAnnotator), games: correctGames((r) => r.pureAnnotator), ties },
  firstAnnotator: { summary: score((r) => r.firstAnnotator), games: correctGames((r) => r.firstAnnotator) },
  holisticSameItems: {
    summary: score((r) => r.holistic),
    perOrder: perOrder((r) => r.holistic),
    games: correctGames((r) => r.holistic),
  },
  ...(prepair || protocolPair
    ? {
        prepair: {
          mode: protocolPair ? `protocol-pair${interleave ? ' interleaved' : ''}, samples ${samples}` : 'prepair (with notes)',
          pooledBothOrders: protocolPair ? { summary: score((r) => r.pooled ?? ['tie', 'tie']), games: correctGames((r) => r.pooled ?? ['tie', 'tie']) } : undefined,
          summary: score((r) => r.prepair ?? ['tie', 'tie']),
          perOrder: perOrder((r) => r.prepair ?? ['tie', 'tie']),
          games: correctGames((r) => r.prepair ?? ['tie', 'tie']),
          recipeCostPer100: done.length
            ? (done.reduce((s, { row }) => s + row!.annotatorCostUsd + row!.prepairCostUsd, 0) / done.length) * 100
            : 0,
        },
      }
    : {}),
  recipeCostPer100: done.length ? (recipeCost / done.length) * 100 : 0,
  newSpendUsd: caller.spent(),
  newCalls: caller.calls(),
  replayed: caller.replayed(),
  ...(stopped ? { stopped } : {}),
  rows: done.map(({ row }) => row),
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
const ledger = arg('ledger');
if (ledger)
  await appendFile(
    ledger,
    `| ${new Date().toISOString().slice(11, 16)} UTC | research/opus-wp annotator emulation k=${k}, dev ${done.length}/${items.length} pairs, concurrency ${concurrency}, cap ${cap}${stopped ? ', incomplete' : ''} | haiku | ${caller.calls()} | ${cap.toFixed(2)} | ${caller.spent().toFixed(4)} | opus-wp +${caller.spent().toFixed(4)} |\n`,
  );
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (stopped) process.exitCode = 1;

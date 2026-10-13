import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { pairGames, scorePairs } from './score';
import type { RubricItem } from './shared-judge-arch/assessment';
import type { JudgeResult } from './shared-judge-arch/contract';
import {
  aggregateCriteria,
  aggregateSingle,
  compareIndependent,
  criterionRequest,
  parseCriterionScores,
  scoredWinner,
  singleReplyRequest,
} from './wp-decomposed';
import { writingRowKey } from './wp-study';

export type RawScoreBatch = {
  reverse: boolean;
  side: string;
  items: RubricItem[];
  raw: string;
  repairRaw?: string;
};
export function rescoreWritingRow(
  item: PairItem,
  criteria: RubricItem[],
  batches: RawScoreBatch[],
  pointwise: boolean,
  reuseScorecards = false,
) {
  if (reuseScorecards) {
    const single = (reply: string, side: string) => {
      const parts = batches
        .filter((x) => !x.reverse && x.side === side)
        .map((x) => {
          const request = singleReplyRequest(item.question, reply, x.items);
          const first = parseCriterionScores(x.raw, request);
          return first.unparsed && x.repairRaw ? parseCriterionScores(x.repairRaw, request) : first;
        });
      return aggregateSingle(singleReplyRequest(item.question, reply, criteria), parts);
    };
    const first = single(item.a, 'single-first'),
      second = single(item.b, 'single-second');
    const ordered = [
      compareIndependent(criterionRequest(item.question, item.a, item.b, criteria), first, second),
      compareIndependent(criterionRequest(item.question, item.b, item.a, criteria), second, first),
    ];
    return {
      games: pairGames(scoredWinner(ordered[0]!), scoredWinner(ordered[1]!)),
      ordered,
      missing: ordered.filter((x) => x.unparsed).length,
    };
  }
  const ordered: JudgeResult[] = [];
  for (const reverse of [false, true]) {
    const a = reverse ? item.b : item.a,
      b = reverse ? item.a : item.b;
    const score = (side: string, reply?: string) => {
      const parts = batches
        .filter((x) => x.reverse === reverse && x.side === side)
        .map((x) => {
          const request =
            reply === undefined
              ? criterionRequest(item.question, a, b, x.items)
              : singleReplyRequest(item.question, reply, x.items);
          const first = parseCriterionScores(x.raw, request);
          return first.unparsed && x.repairRaw ? parseCriterionScores(x.repairRaw, request) : first;
        });
      return reply === undefined
        ? aggregateCriteria(criterionRequest(item.question, a, b, criteria), parts)
        : aggregateSingle(singleReplyRequest(item.question, reply, criteria), parts);
    };
    ordered.push(
      pointwise
        ? compareIndependent(
            criterionRequest(item.question, a, b, criteria),
            score('single-first', a),
            score('single-second', b),
          )
        : score('pair'),
    );
  }
  return {
    games: pairGames(scoredWinner(ordered[0]!), scoredWinner(ordered[1]!)),
    ordered,
    missing: ordered.filter((x) => x.unparsed).length,
  };
}

async function main() {
  const arg = (s: string) => {
    const i = process.argv.indexOf(`--${s}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const input = arg('in'),
    out = arg('out');
  if (!input || !out) throw new Error('--in and --out required');
  const source = JSON.parse(
    await readFile(new URL('./shared-judge-arch/SOURCE.json', import.meta.url), 'utf8'),
  );
  if (source.commit !== arg('contract-sha') || !source.approvedForNew)
    throw new Error('Owner-approved source SHA required');
  const original = JSON.parse(await readFile(input, 'utf8')) as {
    split: 'dev' | 'test';
    variant: string;
    config?: { orderPolicy: string };
    contractSha: string;
    costPer100: number;
    results: {
      rowKey: string;
      criteria: RubricItem[];
      rawBatches: RawScoreBatch[];
      id: string;
      label: 'A' | 'B';
      group: string;
    }[];
  };
  const bench = await loadBenchmark('longjudge-wp');
  const items = new Map(
    bench.items
      .filter((i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === original.split)
      .map((i) => [writingRowKey(i), i]),
  );
  const results = original.results.map((r) => {
    const item = items.get(r.rowKey);
    if (!item || !r.criteria || !r.rawBatches)
      throw new Error(`Missing source or raw ledger for ${r.rowKey}`);
    return {
      ...r,
      item,
      ...rescoreWritingRow(
        item,
        r.criteria,
        r.rawBatches,
        original.variant.endsWith('-independent'),
        original.config?.orderPolicy === 'independent-scorecard-reuse',
      ),
    };
  });
  const perOrder = [0, 1].map((j) => ({
    correct: results.filter((r) => r.games[j] === r.item.label).length,
    n: results.length,
    accuracy: results.filter((r) => r.games[j] === r.item.label).length / results.length,
  }));
  const report = {
    ...original,
    rescoredFrom: input,
    originalContractSha: original.contractSha,
    contractSha: source.commit,
    summary: scorePairs(bench.id, results),
    perOrder,
    newCalls: 0,
    newSpendUsd: 0,
    results: results.map(({ item, ...r }) => r),
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  if (arg('ledger'))
    await appendFile(
      arg('ledger')!,
      `| ${new Date().toISOString().slice(11, 16)} UTC | codex/wp-judge raw criterion re-score, ${original.split} ${results.length} pairs | haiku replay | 0 | 0.00 | 0.0000 | +0.0000 |\n`,
    );
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

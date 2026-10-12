import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaller, Recordings } from './call';
import type { PairDecision } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { pairGames, scorePairs } from './score';
import type { RubricItem } from './shared-judge-arch/assessment';
import type { JudgeResult } from './shared-judge-arch/contract';
import {
  aggregateCriteria,
  criterionPrompt,
  criterionRequest,
  DECOMPOSED_CONFIG,
  deriveWritingBrief,
  parseCriterionScores,
  parseWritingBrief,
  scoredWinner,
  type WritingBrief,
  writingCriteria,
} from './wp-decomposed';
import { writingRowKey } from './wp-study';

const arg = (s: string) => {
  const i = process.argv.indexOf(`--${s}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
if (arg('split') !== 'dev' || Number(arg('concurrency')) !== 1)
  throw new Error('Require --split dev --concurrency 1');
const cap = Number(arg('cap-usd')),
  out = arg('out');
if (!(cap > 0 && cap <= 8) || !out) throw new Error('Require --cap-usd in (0,8] and --out');
const source = JSON.parse(
  await readFile(new URL('./shared-judge-arch/SOURCE.json', import.meta.url), 'utf8'),
) as { commit: string; approvedForNew: boolean };
if (!source.approvedForNew || source.commit !== arg('contract-sha'))
  throw new Error('New-contract scoring requires the owner-approved reviewed source SHA');
const stopAt = Date.parse(arg('stop-at') ?? '2026-10-13T04:55:00Z');
if (!Number.isFinite(stopAt)) throw new Error('Invalid stop-at timestamp');
const bench = await loadBenchmark('longjudge-wp');
const full = bench.items.filter((i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === 'dev');
const pilot = process.argv.includes('--pilot');
// Three variant shapes: Chinese practical manual, Chinese creative prose, English creative prose.
const indices = [
  full.findIndex((i) => i.group === 'zh' && /说明书|使用指南/.test(i.question)),
  full.findIndex((i) => i.group === 'zh' && /小说|故事/.test(i.question)),
  full.findIndex((i) => i.group === 'en' && /story|novel/i.test(i.question)),
];
if (pilot && indices.some((i) => i < 0)) throw new Error('Pilot fixture shape absent');
const items = pilot ? indices.map((i) => full[i]!) : full;
const recordings = await new Recordings(
  fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
).load();
const caller = createCaller(
  recordings,
  { model: 'haiku', maxCallUsd: 0.1 },
  { capUsd: Math.max(0, cap - 0.1), replayOnly: process.argv.includes('--replay-only') },
);
let stopped: string | undefined;
const results: {
  item: PairItem;
  rowKey: string;
  games: PairDecision[];
  costUsd: number;
  setupCostUsd: number;
  missing: number;
  brief: WritingBrief | undefined;
  criteria: RubricItem[] | undefined;
  ordered: JudgeResult[];
}[] = [];
for (const item of items) {
  let costUsd = 0,
    setupCostUsd = 0;
  const call = async (p: Parameters<typeof caller.call>[0], order: string) => {
    if (Date.now() >= stopAt) throw new Error('Authorized deadline reached');
    const r = await caller.call(p, {
      bench: bench.id,
      contestant: 'driftbench-wp-decomposed',
      item: item.id,
      order,
    });
    costUsd += r.costUsd;
    return r.text;
  };
  try {
    let setup = await call(deriveWritingBrief(item.question), 'derive-request-only');
    let brief = parseWritingBrief(setup, item.question);
    if (!brief) {
      const prompt = deriveWritingBrief(item.question);
      setup = await call(
        {
          ...prompt,
          user: `${prompt.user}\nThe previous response failed validation. Return the exact schema, and sourceQuote strings copied exactly from the request.`,
        },
        'repair-brief',
      );
      brief = parseWritingBrief(setup, item.question);
    }
    setupCostUsd = costUsd;
    if (!brief) throw new Error('Request-only criteria failed validation after repair');
    const criteria = writingCriteria(brief);
    const ordered: JudgeResult[] = [];
    for (const reverse of [false, true]) {
      const a = reverse ? item.b : item.a,
        b = reverse ? item.a : item.b;
      const sequence = reverse ? [...criteria].reverse() : criteria;
      const parts: JudgeResult[] = [];
      for (let i = 0; i < sequence.length; i += DECOMPOSED_CONFIG.batchSize) {
        const batch = sequence.slice(i, i + DECOMPOSED_CONFIG.batchSize);
        const request = criterionRequest(item.question, a, b, batch);
        let raw = await call(criterionPrompt(request), `${reverse ? 'BA' : 'AB'}-criteria-${i}`);
        let part = parseCriterionScores(raw, request);
        if (part.unparsed) {
          raw = await call(criterionPrompt(request, true), `${reverse ? 'BA' : 'AB'}-criteria-${i}-repair`);
          part = parseCriterionScores(raw, request);
        }
        parts.push(part);
      }
      ordered.push(aggregateCriteria(criterionRequest(item.question, a, b, criteria), parts));
    }
    const games = pairGames(scoredWinner(ordered[0]!), scoredWinner(ordered[1]!));
    results.push({
      item,
      rowKey: writingRowKey(item),
      games,
      costUsd,
      setupCostUsd,
      missing: ordered.filter((r) => r.unparsed).length,
      brief,
      criteria,
      ordered,
    });
  } catch (e) {
    stopped = e instanceof Error ? e.message : String(e);
    results.push({
      item,
      rowKey: writingRowKey(item),
      games: pairGames('tie', 'tie'),
      costUsd,
      setupCostUsd,
      missing: 2,
      brief: undefined,
      criteria: undefined,
      ordered: [],
    });
    break;
  }
  // Durable progress, with labels used only in measurement after the scores are fixed.
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    `${out}.progress.json`,
    `${JSON.stringify({ completed: results.length, target: items.length, newSpendUsd: caller.spent(), newCalls: caller.calls(), latest: results.at(-1)?.rowKey, summary: scorePairs(bench.id, results), costPer100: (results.reduce((n, r) => n + r.costUsd, 0) / results.length) * 100 }, null, 2)}\n`,
  );
  process.stderr.write(
    `decomposed ${results.length}/${items.length}, new spend $${caller.spent().toFixed(4)}\n`,
  );
}
const costUsd = results.reduce((n, r) => n + r.costUsd, 0);
const perOrder = [0, 1].map((j) => ({
  correct: results.filter((r) => r.games[j] === r.item.label).length,
  n: results.length,
  accuracy: results.filter((r) => r.games[j] === r.item.label).length / results.length,
}));
const report = {
  variant: DECOMPOSED_CONFIG.version,
  config: DECOMPOSED_CONFIG,
  contractSha: source.commit,
  split: 'dev',
  pilot,
  fullPopulation: full.length,
  completed: results.length,
  items: items.length,
  complete: !stopped && results.length === items.length,
  summary: scorePairs(bench.id, results),
  perOrder,
  costPer100: (costUsd / results.length) * 100,
  costUsd,
  setupCostUsd: results.reduce((n, r) => n + r.setupCostUsd, 0),
  newSpendUsd: caller.spent(),
  newCalls: caller.calls(),
  replayed: caller.replayed(),
  ...(stopped ? { stopped } : {}),
  results: results.map(({ item, ...r }) => ({ ...r, id: item.id, group: item.group, label: item.label })),
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
const ledger = arg('ledger');
if (ledger)
  await appendFile(
    ledger,
    `| ${new Date().toISOString().slice(11, 16)} UTC | codex/wp-judge decomposed ${pilot ? 'pilot' : 'dev'}, ${results.length}/${items.length} pairs, concurrency 1, cap ${cap}${stopped ? ', incomplete' : ''} | haiku | ${caller.calls()} | ${cap.toFixed(2)} | ${caller.spent().toFixed(4)} | +${caller.spent().toFixed(4)} |\n`,
  );
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
if (stopped || report.summary.missing) process.exitCode = 1;

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaller, Recordings } from './call';
import type { PairDecision } from './contestants';
import { loadBenchmark, type PairItem, splitOf, stratifiedSample } from './data';
import { pairGames, scorePairs } from './score';
import type { AnchorDecision } from './wp-anchor';
import {
  anchorNotes,
  anchorPair,
  anchorRead,
  anchorReadFine,
  anchorResolve,
  parseAnchor,
  parseReading,
} from './wp-anchor';
import { assertWritingTestFreeze, claimWritingTestRun } from './wp-eval-scope';
import { writingRowKey } from './wp-study';

const arg = (s: string) => {
  const i = process.argv.indexOf(`--${s}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const variant = arg('variant');
if (!variant || !['anchor', 'reader', 'interleaved', 'notes', 'pointwise', 'finepointwise'].includes(variant))
  throw new Error('--variant anchor|reader|interleaved|notes|pointwise|finepointwise required');
const split = arg('split');
if (!['dev', 'test'].includes(split ?? '') || Number(arg('concurrency')) !== 1)
  throw new Error('Require --split dev|test --concurrency 1');
const cap = Number(arg('cap-usd')),
  out = arg('out');
if (!(cap > 0 && cap <= 8) || !out) throw new Error('Require --cap-usd in (0,8] and --out');
const bench = await loadBenchmark('longjudge-wp');
const full = bench.items.filter((i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === split);
const rawOnly = process.argv.includes('--raw-only');
const selectedVariant = `${variant}-${rawOnly ? 'raw' : 'confidence'}-${process.argv.includes('--legacy-resolver') ? 'legacy' : 'mapped'}`;
const frozen =
  split === 'test' ? await assertWritingTestFreeze(selectedVariant, arg('frozen-sha')) : undefined;
const sample = Number(arg('sample') ?? full.length);
if (
  !Number.isInteger(sample) ||
  sample < 1 ||
  sample > full.length ||
  (split === 'dev' && sample !== full.length)
)
  throw new Error('Only TEST permits a stratified sample');
const items = sample === full.length ? full : stratifiedSample(full, sample, 'wp-frozen-test');
if (frozen)
  await claimWritingTestRun(frozen, out, items.map(writingRowKey), process.argv.includes('--replay-only'));
const stopAt = Date.parse(arg('stop-at') ?? '2026-10-13T04:55:00Z');
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
  rated: PairDecision[];
  excerpt: PairDecision[];
  reconciled: PairDecision[];
  parsed: (AnchorDecision | undefined)[];
  readings: ReturnType<typeof parseReading>[] | undefined;
  costUsd: number;
  baseCostUsd: number;
  reconciliationCostUsd: number;
  readCostUsd: number;
  missing: number;
  resolutionMissing: number;
  resolution: string | undefined;
}[] = [];
for (const item of items) {
  let costUsd = 0;
  const call = async (p: Parameters<typeof caller.call>[0], order: string) => {
    if (Date.now() >= stopAt) throw new Error('Authorized deadline reached');
    const r = await caller.call(p, {
      bench: bench.id,
      contestant: `driftbench-wp-${variant}`,
      item: item.id,
      order,
    });
    costUsd += r.costUsd;
    return r.text;
  };
  try {
    if (stopped) throw new Error(stopped);
    const read = variant === 'finepointwise' ? anchorReadFine : anchorRead;
    const notes = ['notes', 'pointwise', 'finepointwise'].includes(variant)
      ? [await call(read(item.question, item.a), 'read-A'), await call(read(item.question, item.b), 'read-B')]
      : undefined;
    const readings = notes?.map(parseReading);
    const readCostUsd = costUsd;
    const scores = readings?.map((r) =>
      !r
        ? undefined
        : variant === 'finepointwise'
          ? r.placement === undefined
            ? undefined
            : r.level * 3 + r.placement
          : r.level,
    );
    const codeChoice: PairDecision | undefined =
      ['pointwise', 'finepointwise'].includes(variant) &&
      scores?.[0] !== undefined &&
      scores[1] !== undefined &&
      scores[0] !== scores[1]
        ? scores[0] > scores[1]
          ? 'A'
          : 'B'
        : undefined;
    if (codeChoice) {
      const games: PairDecision[] = [codeChoice, codeChoice];
      results.push({
        item,
        rowKey: writingRowKey(item),
        games,
        rated: games,
        excerpt: games,
        reconciled: games,
        parsed: [],
        readings,
        costUsd,
        baseCostUsd: costUsd,
        reconciliationCostUsd: 0,
        readCostUsd,
        missing: 0,
        resolutionMissing: 0,
        resolution: undefined,
      });
      continue;
    }
    const view = variant === 'reader' ? 'reader' : variant === 'interleaved' ? 'interleaved' : 'editor';
    const ab = await call(
      notes
        ? anchorNotes(item.question, notes[0] ?? '', notes[1] ?? '')
        : anchorPair(item.question, item.a, item.b, view),
      'AB',
    );
    const ba = await call(
      notes
        ? anchorNotes(item.question, notes[1] ?? '', notes[0] ?? '')
        : anchorPair(item.question, item.b, item.a, view),
      'BA',
    );
    const parsed = [parseAnchor(ab, item.a, item.b), parseAnchor(ba, item.b, item.a)];
    const games = pairGames(parsed[0]?.winner ?? 'tie', parsed[1]?.winner ?? 'tie');
    const baseCostUsd = costUsd;
    let reconciled = [...games],
      resolution: string | undefined,
      resolutionMissing = 0;
    if (
      !rawOnly &&
      parsed[0] &&
      parsed[1] &&
      games[0] !== 'tie' &&
      games[1] !== 'tie' &&
      games[0] !== games[1]
    ) {
      if (parsed[0].confidence !== parsed[1].confidence) {
        const choice = parsed[0].confidence > parsed[1].confidence ? games[0] : games[1];
        reconciled = [choice ?? 'tie', choice ?? 'tie'];
      } else {
        const second: AnchorDecision = { ...parsed[1], winner: games[1] ?? 'tie' };
        resolution = await call(
          anchorResolve(
            item.question,
            item.a,
            item.b,
            [parsed[0], second],
            !process.argv.includes('--legacy-resolver'),
          ),
          'confidence-resolution',
        );
        const choice = parseAnchor(resolution, item.a, item.b)?.winner;
        resolutionMissing = choice === undefined ? 1 : 0;
        reconciled = [choice ?? 'tie', choice ?? 'tie'];
      }
    }
    results.push({
      item,
      rowKey: writingRowKey(item),
      games,
      rated: pairGames(parsed[0]?.rated ?? 'tie', parsed[1]?.rated ?? 'tie'),
      excerpt: pairGames(parsed[0]?.excerpt ?? 'tie', parsed[1]?.excerpt ?? 'tie'),
      reconciled,
      parsed,
      readings,
      costUsd,
      baseCostUsd,
      reconciliationCostUsd: costUsd - baseCostUsd,
      readCostUsd,
      missing: parsed.filter((p) => !p).length,
      resolutionMissing,
      resolution,
    });
  } catch (e) {
    stopped = e instanceof Error ? e.message : String(e);
    results.push({
      item,
      rowKey: writingRowKey(item),
      games: pairGames('tie', 'tie'),
      rated: pairGames('tie', 'tie'),
      excerpt: pairGames('tie', 'tie'),
      reconciled: pairGames('tie', 'tie'),
      parsed: [],
      readings: undefined,
      costUsd,
      baseCostUsd: costUsd,
      reconciliationCostUsd: 0,
      readCostUsd: 0,
      missing: 2,
      resolutionMissing: 0,
      resolution: undefined,
    });
    break;
  }
  if (results.length % 10 === 0) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(
      `${out}.progress.json`,
      `${JSON.stringify({ completed: results.length, target: items.length, newSpendUsd: caller.spent(), newCalls: caller.calls(), latest: results.at(-1)?.rowKey, summary: scorePairs(bench.id, results) }, null, 2)}\n`,
    );
    process.stderr.write(
      `${variant}: ${results.length}/${items.length}, new spend $${caller.spent().toFixed(4)}\n`,
    );
  }
}
const costUsd = results.reduce((n, r) => n + r.costUsd, 0);
const baseCostUsd = results.reduce((n, r) => n + r.baseCostUsd, 0);
const report = {
  variant,
  split,
  fullPopulation: full.length,
  sampled: sample < full.length,
  selectedVariant,
  rawOnly,
  model: 'haiku',
  resolverLabelMap: !process.argv.includes('--legacy-resolver'),
  items: items.length,
  completed: results.length,
  complete: !stopped && results.length === items.length,
  summary: scorePairs(bench.id, results),
  perOrder: [0, 1].map((j) => ({
    correct: results.filter((r) => r.games[j] === r.item.label).length,
    n: results.length,
    accuracy: results.filter((r) => r.games[j] === r.item.label).length / results.length,
  })),
  rated: scorePairs(
    bench.id,
    results.map((r) => ({ ...r, games: r.rated })),
  ),
  excerpt: scorePairs(
    bench.id,
    results.map((r) => ({ ...r, games: r.excerpt })),
  ),
  reconciled: scorePairs(
    bench.id,
    results.map((r) => ({ ...r, games: r.reconciled, missing: r.missing + r.resolutionMissing })),
  ),
  costPer100: (baseCostUsd / items.length) * 100,
  reconciledCostPer100: (costUsd / items.length) * 100,
  costUsd,
  baseCostUsd,
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
    `| ${new Date().toISOString().slice(11, 16)} UTC | codex/wp-judge holistic ${variant}, ${split} ${items.length} pairs, concurrency 1, cap ${cap}${stopped ? ', incomplete' : ''} | haiku | ${caller.calls()} | ${cap.toFixed(2)} | ${caller.spent().toFixed(4)} | +${caller.spent().toFixed(4)} |\n`,
  );
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
if (stopped || report.summary.missing || report.reconciled.missing) process.exitCode = 1;

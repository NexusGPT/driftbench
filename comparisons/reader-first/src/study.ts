import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseJudgeText } from '../../../packages/judges/src/assessment';
import { buildPrompt } from '../../../packages/judges/src/prompt';
import {
  READER_FIRST_THRESHOLDS,
  type ReaderFirstOptions,
  readerBallot,
  readerFirstRequest,
  resolveReaderFirst,
} from '../../../packages/judges/src/reader-first';
import { readerFeatures } from '../../../packages/judges/src/reader-first-features';
import { CallFailed, createCaller, Recordings } from './call';
import { loadBenchmark, type PairItem, splitOf } from './data';

const getArg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const phase = getArg('phase');
if (!['explore', 'final-dev', 'test', 'replay'].includes(phase ?? ''))
  throw new Error('Require --phase explore|final-dev|test|replay');
const root = resolve('comparisons/reader-first');
const resume = process.argv.includes('--resume');
const deadlineArg = getArg('call-deadline');
if (deadlineArg && !resume) throw new Error('Deadline override requires an authorized resume');
const lastNewCallAt = Date.parse(deadlineArg ?? '2026-10-13T04:39:00Z');
if (!Number.isFinite(lastNewCallAt)) throw new Error('Invalid call deadline');
if (resume && phase !== 'test') throw new Error('Only TEST can resume');
const split = phase === 'test' ? 'test' : 'dev';
const startedAt = new Date().toISOString();
const concurrency = 6;
let priorReserveUsd = 0.2;
const out = getArg('out') ?? `${root}/results/${phase}.json`;
const recordFile = `${root}/recordings/haiku.jsonl`;
const sourceFiles = [
  'comparisons/reader-first/src/call.ts',
  'comparisons/reader-first/src/data.ts',
  'comparisons/reader-first/src/study.ts',
  'packages/core/src/spec/hash.ts',
  ...execFileSync('git', ['ls-files', 'packages/judges/src'], { encoding: 'utf8' }).trim().split('\n'),
];
const hashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (p) => [
      p,
      createHash('sha256')
        .update(await readFile(p))
        .digest('hex'),
    ]),
  ),
);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const options: ReaderFirstOptions = { configuration: 'reader-first' };
if (phase === 'test') {
  const frozen = JSON.parse(await readFile(`${root}/results/freeze.json`, 'utf8'));
  if (JSON.stringify(frozen.hashes) !== JSON.stringify(hashes)) throw new Error('Frozen source changed');
  if (frozen.devCorrect < 142 || frozen.devGames !== 180) throw new Error('DEV gate not met');
  const receipt = { at: new Date().toISOString(), commit, hashes, fullSplit: true, lastNewCallAt };
  if (resume) {
    const first = JSON.parse(await readFile(`${root}/results/test-started.json`, 'utf8'));
    const prior = JSON.parse(await readFile(out, 'utf8'));
    if (JSON.stringify(first.hashes) !== JSON.stringify(hashes)) throw new Error('Resume source changed');
    if (prior.complete) throw new Error('Completed TEST cannot run again');
    await appendFile(
      `${root}/results/test-resumes.jsonl`,
      `${JSON.stringify({ ...receipt, frozenCommit: first.commit, completedBefore: prior.completedPairs })}\n`,
    );
  } else {
    await writeFile(`${root}/results/test-started.json`, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  }
}
const bench = await loadBenchmark('longjudge-wp');
const items = bench.items.filter(
  (i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === split,
);
if (items.length !== (split === 'dev' ? 90 : 173)) throw new Error(`Wrong split size ${items.length}`);
let existing = '';
try {
  existing = await readFile(recordFile, 'utf8');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
let priorFailureSpendUsd = 0;
try {
  const failures = (await readFile(`${root}/recordings/haiku.failures.jsonl`, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  priorFailureSpendUsd = failures.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  priorReserveUsd += failures.reduce((sum, row) => sum + row.reservedUsd, 0);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const spentBefore =
  priorFailureSpendUsd +
  existing
    .split('\n')
    .filter(Boolean)
    .reduce((s, x) => s + (JSON.parse(x).costUsd as number), 0);
const caller = createCaller(
  await new Recordings(recordFile).load(),
  { model: 'haiku', maxCallUsd: 0.1, timeoutMs: 180_000, lastNewCallAt },
  {
    capUsd: 20 - priorReserveUsd - 0.1 * concurrency - spentBefore,
    replayOnly: phase === 'final-dev' || phase === 'replay',
  },
);
const rows: any[] = new Array(items.length);
let next = 0;
let stopped: string | undefined;
let failedReservations = 0;
const lang = (i: PairItem) =>
  /zh|chinese|中文/i.test(i.language ?? i.group) ? ('zh' as const) : ('en' as const);
const summarize = (done: any[], pick: 'length' | 'features' | 'choice') => {
  const correctPairs = done.filter((r) => r.result[pick] === r.label).length;
  const gained = done
    .filter((r) => r.result[pick] === r.label && r.result.length !== r.label)
    .map((r) => r.id);
  const lost = done.filter((r) => r.result[pick] !== r.label && r.result.length === r.label).map((r) => r.id);
  return {
    correct: 2 * correctPairs,
    games: 2 * done.length,
    accuracy: correctPairs / done.length,
    gained,
    lost,
    byLanguage: Object.fromEntries(
      ['en', 'zh'].map((l) => {
        const xs = done.filter((r) => r.language === l);
        return [
          l,
          { correct: 2 * xs.filter((r) => r.result[pick] === r.label).length, games: 2 * xs.length },
        ];
      }),
    ),
  };
};
function report() {
  const done = rows.filter(Boolean);
  const recipeCost = done.reduce((s, r) => s + r.costUsd, 0);
  const firing = Object.fromEntries(
    ['structure', 'economy', 'directness', 'context', 'simplicity'].map((name) => [
      name,
      {
        replies: done.reduce(
          (s, r) => s + Number(r.result.flags.A[name]) + Number(r.result.flags.B[name]),
          0,
        ),
        pairs: done.filter((r) => r.result.flags.A[name] || r.result.flags.B[name]).length,
        oneSidedPairs: done.filter((r) => r.result.flags.A[name] !== r.result.flags.B[name]).length,
        supportsOverride: done.filter((r) => r.result.failures.includes(name)).length,
      },
    ]),
  );
  return {
    configuration: 'reader-first judge (length-aware)',
    phase,
    split,
    at: new Date().toISOString(),
    startedAt,
    concurrency,
    lastNewCallAt,
    resume,
    priorReserveUsd,
    commit,
    hashes,
    thresholds: READER_FIRST_THRESHOLDS,
    expectedPairs: items.length,
    completedPairs: done.length,
    complete: done.length === items.length && !stopped,
    pooledOrders: true,
    score: {
      length: summarize(done, 'length'),
      features: summarize(done, 'features'),
      combined: summarize(done, 'choice'),
    },
    firing,
    overrides: done.filter((r) => r.result.override).length,
    invalidPairs: done
      .filter((r) => !r.result.judgeValid)
      .map((r) => ({ id: r.id, ordered: r.ordered.problems, swapped: r.swapped.problems })),
    costPer100PairsUsd: (recipeCost / done.length) * 100,
    recipeCostUsd: recipeCost,
    newSpendUsd: caller.spent(),
    cumulativeSpendUsd: spentBefore + caller.spent(),
    failedReservationsUsd: failedReservations * 0.1,
    newCalls: caller.calls(),
    replayedCalls: caller.replayed(),
    stopped,
    rows: done,
  };
}
let writes = Promise.resolve();
function checkpoint() {
  const content = `${JSON.stringify(report(), null, 2)}\n`;
  writes = writes.then(() => writeFile(out, content));
  return writes;
}
async function worker() {
  while (!stopped) {
    const i = next++;
    if (i >= items.length) return;
    const item = items[i]!;
    try {
      const language = lang(item);
      const a = readerFeatures(item.a, language);
      const b = readerFeatures(item.b, language);
      const abReq = readerFirstRequest(item.question, item.a, item.b, language);
      const baReq = readerFirstRequest(item.question, item.b, item.a, language);
      const ab = await caller.call(buildPrompt(abReq), {
        bench: bench.id,
        contestant: 'reader-first',
        item: item.id,
        order: 'AB',
      });
      const ba = await caller.call(buildPrompt(baReq), {
        bench: bench.id,
        contestant: 'reader-first',
        item: item.id,
        order: 'BA',
      });
      const ordered = readerBallot(parseJudgeText(ab.text, abReq), item.a, item.b);
      const swapped = readerBallot(parseJudgeText(ba.text, baReq), item.b, item.a);
      rows[i] = {
        id: item.id,
        pairKey: `${item.id}:${createHash('sha256')
          .update(JSON.stringify([item.a, item.b]))
          .digest('hex')
          .slice(0, 12)}`,
        questionId: createHash('sha256').update(item.question).digest('hex').slice(0, 16),
        label: item.label,
        language,
        machine: { A: a, B: b },
        ordered,
        swapped,
        costUsd: ab.costUsd + ba.costUsd,
        result: resolveReaderFirst(a, b, ordered, swapped, options),
      };
      await checkpoint();
      if (rows.filter(Boolean).length % 5 === 0)
        console.log(
          JSON.stringify({
            done: rows.filter(Boolean).length,
            of: items.length,
            spend: caller.spent(),
            score: report().score.combined.correct,
          }),
        );
    } catch (e) {
      if (e instanceof CallFailed && e.costUsd === undefined) failedReservations += 1;
      stopped = e instanceof Error ? e.message : String(e);
      await checkpoint();
    }
  }
}
await mkdir(`${root}/results`, { recursive: true });
await Promise.all(Array.from({ length: concurrency }, worker));
await checkpoint();
const final = report();
const ledger = getArg('ledger');
if (ledger)
  await appendFile(
    ledger,
    `| ${new Date().toISOString()} | research/astra-reader-first ${phase}, ${final.completedPairs}/${items.length} pairs, ${concurrency} calls maximum | haiku | ${caller.calls()} | 20.00 | ${caller.spent().toFixed(8)} | reserve ${(failedReservations * 0.1).toFixed(2)}; cumulative ${final.cumulativeSpendUsd.toFixed(8)} |\n`,
  );
console.log(JSON.stringify({ ...final, rows: undefined }, null, 2));
if (!final.complete) process.exitCode = 1;

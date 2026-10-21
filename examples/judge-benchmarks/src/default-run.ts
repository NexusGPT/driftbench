import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultJudge,
  createDialectTransport,
  DEFAULT_JUDGE_POLICY,
  type DialectTransport,
  type JudgeRequest,
  type PolicyOverride,
} from '@agent-nexus/driftbench-judges';
import { type BenchmarkId, CRITERIA, type Item, loadBenchmark } from './data';
import { completedIds, lastPerId, requireSealedItems } from './default-run-state';

/**
 * Runs the one frozen default judge (createDefaultJudge, policy DEFAULT_JUDGE_POLICY) over the sealed items of a
 * public benchmark, over the Anthropic Messages API, and prints the count right. There is no per-benchmark setting:
 * the only switches are the two measurement overrides, which a shipped client never sets.
 *
 *   tsx examples/judge-benchmarks/src/default-run.ts --bench judgebench --out runs/jb.jsonl \
 *     [--limit 20] [--cap-usd 2] [--concurrency 2] [--length-preference true|false] [--conversation-turns true|false]
 *
 * The key is read from ~/.nexus-secrets/anthropic-driftbench.key inside the process and is never printed. A result
 * file is append-only; an item already in it (same variant label) is not asked again, so a rerun costs only the
 * missing items.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SEALED = join(HERE, '..', '..', 'all-peers-public', 'data');
const NAME: Record<BenchmarkId, string> = {
  judgebench: 'judgebench',
  mmeval: 'mmeval',
  rubricbench: 'rubricbench',
  'longjudge-verify': 'verify',
  'longjudge-wp': 'writing',
};
export const MODEL = 'claude-haiku-5-5';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function sealedIds(bench: BenchmarkId): Promise<Set<string>> {
  const recorded = JSON.parse(await readFile(join(SEALED, NAME[bench], 'recorded.json'), 'utf8'));
  return new Set(Object.keys(recorded.driftbench));
}

function requestOf(item: Item, fallbackCriterion: string): JudgeRequest {
  const criterion = { name: 'bench', rubric: item.criterion ?? fallbackCriterion };
  if (item.kind === 'pair')
    return {
      criterion,
      transcript: [{ role: 'user', text: item.question }],
      candidates: { A: item.a, B: item.b },
    };
  return {
    criterion,
    transcript: [
      { role: 'user', text: item.question },
      { role: 'agent', text: item.response },
    ],
  };
}

/**
 * README rows: one dataset of the readme-v7 manifest (`--manifest <file> --dataset <name>`). Every request is sent
 * as the manifest holds it, except that a per-request `assessment` is dropped (the frozen default has no
 * per-benchmark setting). `--only-changed` keeps the items whose handling differs from policy default-on-v7: a
 * conversation criterion with more than one customer turn. A returned verdict counts correct when it equals the
 * gold label; anything else counts wrong.
 */
async function manifestRun(): Promise<void> {
  const out = arg('out') as string;
  const dataset = arg('dataset') as string;
  const override: PolicyOverride = {
    ...(arg('length-preference') === undefined
      ? {}
      : { lengthPreference: arg('length-preference') === 'true' }),
    ...(arg('conversation-turns') === undefined
      ? {}
      : { conversationTurns: arg('conversation-turns') === 'true' }),
  };
  const variant = JSON.stringify(override);
  const capUsd = Number(arg('cap-usd') ?? '2');
  const concurrency = Number(arg('concurrency') ?? '2');
  const key = (await readFile(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8')).trim();
  const ledger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
  const base = createDialectTransport({
    provider: 'anthropic',
    model: MODEL,
    env: { ANTHROPIC_API_KEY: key },
  });
  const transport: DialectTransport = {
    ...base,
    async complete(request) {
      const done = await base.complete(request);
      const usage = done.usage;
      if (usage?.input === undefined || usage.output === undefined) return done;
      return { ...done, costUsd: (usage.input * 0.1 + usage.output * 0.5) / 1e6 };
    },
  };
  const judge = createDefaultJudge({
    provider: 'anthropic',
    model: MODEL,
    transport,
    env: { ANTHROPIC_API_KEY: key },
    maxBudgetUsd: Math.min(0.05, capUsd / (concurrency * 4)),
    spendCapUsd: capUsd,
    spendLedger: ledger,
    ...(Object.keys(override).length ? { policyOverride: override } : {}),
  });
  const manifest = JSON.parse(await readFile(arg('manifest') as string, 'utf8'));
  const set = manifest.datasets.find((d: { name: string }) => d.name === dataset);
  if (!set) throw new Error(`no dataset ${dataset}`);
  type Row = { id: string; gold: 'pass' | 'fail'; request: JudgeRequest & { assessment?: unknown } };
  let items: Row[] = set.items;
  const userTurns = (r: JudgeRequest) => r.transcript.filter((e) => e.role === 'user').length;
  if (process.argv.includes('--only-changed'))
    items = items.filter(
      (i) =>
        i.request.criterion.scope === 'conversation' && userTurns(i.request) > 1 && !i.request.candidates,
    );
  let previous = '';
  try {
    previous = await readFile(out, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(dirname(out), { recursive: true });
    await appendFile(out, '');
  }
  const ids = new Set(items.map((item) => item.id));
  const done = completedIds(
    previous
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.variant === variant && row.dataset === dataset && ids.has(row.id)),
  );
  const todo = items.filter((i) => !done.has(i.id));
  console.log(
    JSON.stringify({
      dataset,
      policy: DEFAULT_JUDGE_POLICY.version,
      variant,
      items: items.length,
      alreadyDone: done.size,
      toRun: todo.length,
    }),
  );
  let next = 0;
  let stop = false;
  async function worker(): Promise<void> {
    while (!stop) {
      const item = todo[next++];
      if (!item) return;
      const { assessment: _dropped, ...request } = item.request;
      const result = await judge.judge(request as JudgeRequest);
      if (result.defaultJudge?.failure?.kind === 'budget') {
        stop = true;
        return;
      }
      const prediction = result.answer.outcome;
      await appendFile(
        out,
        `${JSON.stringify({
          dataset,
          id: item.id,
          variant,
          policy: result.defaultJudge?.version,
          route: result.defaultJudge?.route,
          prediction,
          gold: item.gold,
          correct: prediction === item.gold,
          costUsd: result.costUsd ?? null,
          requestCount: result.requestCount,
          failure: result.defaultJudge?.failure?.kind ?? null,
        })}\n`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  let rows = (await readFile(out, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.variant === variant && row.dataset === dataset && ids.has(row.id));
  rows = lastPerId(rows);
  const routes: Record<string, number> = {};
  for (const row of rows) routes[row.route] = (routes[row.route] ?? 0) + 1;
  console.log(
    JSON.stringify({
      dataset,
      variant,
      sealed: items.length,
      n: rows.length,
      correct: rows.filter((row) => row.failure === null && row.correct).length,
      failures: rows.filter((row) => row.failure !== null).length,
      inconclusive: rows.filter((row) => row.prediction === 'inconclusive').length,
      routes,
      spentUsdThisRun: ledger.spentUsd,
      costIncomplete: ledger.costIncomplete,
      stoppedAtCap: stop,
    }),
  );
}

async function main(): Promise<void> {
  if (arg('manifest')) return manifestRun();
  const bench = arg('bench') as BenchmarkId | undefined;
  const out = arg('out');
  if (!bench || !out || !(bench in NAME)) throw new Error('usage: --bench <id> --out <file.jsonl>');
  const override: PolicyOverride = {
    ...(arg('length-preference') === undefined
      ? {}
      : { lengthPreference: arg('length-preference') === 'true' }),
    ...(arg('conversation-turns') === undefined
      ? {}
      : { conversationTurns: arg('conversation-turns') === 'true' }),
  };
  const variant = JSON.stringify(override);
  const capUsd = Number(arg('cap-usd') ?? '2');
  const concurrency = Number(arg('concurrency') ?? '2');
  const limit = arg('limit') === undefined ? undefined : Number(arg('limit'));
  const key = (await readFile(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8')).trim();
  const ledger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
  // The Messages API reports tokens, not dollars: the cost of a call is its tokens at the list price below, so the
  // judge's own spend cap can work. Haiku 5.5 list price, USD per million tokens: input 0.10, output 0.50.
  const base = createDialectTransport({
    provider: 'anthropic',
    model: MODEL,
    env: { ANTHROPIC_API_KEY: key },
  });
  const transport: DialectTransport = {
    ...base,
    async complete(request) {
      const done = await base.complete(request);
      const usage = done.usage;
      if (usage?.input === undefined || usage.output === undefined) return done;
      return { ...done, costUsd: (usage.input * 0.1 + usage.output * 0.5) / 1e6 };
    },
  };
  const judge = createDefaultJudge({
    provider: 'anthropic',
    model: MODEL,
    transport,
    env: { ANTHROPIC_API_KEY: key },
    maxBudgetUsd: Math.min(0.05, capUsd / (concurrency * 4)),
    spendCapUsd: capUsd,
    spendLedger: ledger,
    ...(Object.keys(override).length ? { policyOverride: override } : {}),
  });
  // The sealed JudgeBench, MM-Eval, verify and writing items come from the pool files of their research branches
  // (--pool); the RubricBench items come from the loader, filtered to the sealed ids.
  const pool = arg('pool');
  const ids = await sealedIds(bench);
  const items: Item[] = pool
    ? (JSON.parse(await readFile(pool, 'utf8')) as Record<string, unknown>[]).map(
        (row) => ({ kind: 'a' in row ? 'pair' : 'point', ...row }) as unknown as Item,
      )
    : (await loadBenchmark(bench)).items.filter((item) => ids.has(item.id));
  requireSealedItems(items, ids);
  const benchmark = { criterion: CRITERIA[bench] };
  let previous = '';
  try {
    previous = await readFile(out, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(dirname(out), { recursive: true });
    await appendFile(out, '');
  }
  const done = completedIds(
    previous
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.variant === variant && ids.has(row.id)),
  );
  const todo = items.filter((item) => !done.has(item.id)).slice(0, limit);
  console.log(
    JSON.stringify({
      bench,
      policy: DEFAULT_JUDGE_POLICY.version,
      variant,
      sealed: ids.size,
      loaded: items.length,
      notLoaded: 0,
      alreadyDone: done.size,
      toRun: todo.length,
    }),
  );
  let next = 0;
  let stop = false;
  async function worker(): Promise<void> {
    while (!stop) {
      const item = todo[next++];
      if (!item) return;
      const request = requestOf(item, benchmark.criterion);
      const result = await (item.kind === 'pair'
        ? (judge.judgePair?.(request) ?? judge.judge(request))
        : judge.judge(request));
      const outcome = item.kind === 'pair' ? (result.winner ?? 'inconclusive') : result.answer.outcome;
      const correct =
        item.kind === 'pair' ? outcome === item.label : outcome === (item.correct ? 'pass' : 'fail');
      const budgetStop = result.defaultJudge?.failure?.kind === 'budget';
      if (budgetStop) {
        stop = true;
        return;
      }
      await appendFile(
        out,
        `${JSON.stringify({
          id: item.id,
          variant,
          policy: result.defaultJudge?.version,
          route: result.defaultJudge?.route,
          outcome,
          correct,
          costUsd: result.costUsd ?? null,
          requestCount: result.requestCount,
          failure: result.defaultJudge?.failure?.kind ?? null,
        })}\n`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  let rows = (await readFile(out, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.variant === variant && ids.has(row.id));
  rows = lastPerId(rows);
  const routes: Record<string, number> = {};
  for (const row of rows) routes[row.route] = (routes[row.route] ?? 0) + 1;
  console.log(
    JSON.stringify({
      bench,
      variant,
      sealed: ids.size,
      n: rows.length,
      correct: rows.filter((row) => row.failure === null && row.correct).length,
      failures: rows.filter((row) => row.failure !== null).length,
      inconclusive: rows.filter((row) => row.outcome === 'inconclusive').length,
      routes,
      spentUsdThisRun: ledger.spentUsd,
      costIncomplete: ledger.costIncomplete,
      stoppedAtCap: stop,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
